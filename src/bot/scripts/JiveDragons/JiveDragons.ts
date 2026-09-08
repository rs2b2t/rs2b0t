import { reader } from '../../adapter/ClientAdapter.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { SolveClue } from '../../api/ai/clues/SolveClue.js';
import { paintClueProgress } from '../../api/ai/clues/cluePaint.js';
import { AXES } from '../../api/acquisition/Tools.js';
import { Bank } from '../../api/bank/Bank.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EMPTY_VIAL, plannedPotions, potionToSip, rangingPlan, type PotionPlan } from '../../api/combat/boostPotions.js';
import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS, parseCombatStyle, parseRangeStyle, type MeleeCombatStyle } from '../../api/combat/CombatStyle.js';
import { castsAvailable } from '../../api/combat/CombatStyleLogic.js';
import { Special } from '../../api/combat/Special.js';
import { Prayer } from '../../api/prayer/Prayer.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { ARROWS, BOWS, MELEE_WEAPONS, STAFFS } from '../../api/combat/equipment.js';
import { bestMeleeWeapon, knownMeleeWeapon } from '../../api/combat/meleeWeapons.js';
import { foodCount as foodCountIn, foodForms, foodHealAmount, isFoodItem, shouldEatToUseFood } from '../../api/combat/food.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems, type GroundItem } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { scriptFood, suppliesOf } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING, selectedLoadout } from '../../api/loadout/loadoutSetting.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DROP_DB } from '../../data/dropdb.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import Tile from '../../geometry/Tile.js';
import { COMBAT_SKILLS, XpTracker, jiveFrame, paintLevels } from '../../paint/jive.js';
import { fmtDuration, wrapText } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsBag, SettingsSchema } from '../../runtime/Settings.js';
import { Fight, HoldSafespot, Retreat, WalkToSpot, anchorFor, type CombatHost } from './combat.js';
import { ANTIFIRE_MARGIN_TICKS, ANTIFIRE_TICKS, POTION_PROTECTS, SHIELD_ABSORBS, antifireDue, antifireLapsed, keepDoses, keyStatus, lootHalts, lootReach, shieldGate, siteTileOf, chaseMode, prayerFor, prayerSipDue, styleGate, wantsDrop, type Style } from './logic.js';
import { BRIMHAVEN_IRON, BRIMHAVEN_STEEL, GUTANOTH_BLUE, HEROES_BLUE, MAX_STANDS, SITE_OPTIONS, STAND_SITE_KEYS, TAVERLEY_BLACK, TAVERLEY_BLUE, huntNames, needsShield, siteFor, standFor, type DragonSite } from './sites.js';
import { ANTIFIRE_DOSES, ANTIPOISON_DOSES, PRAYER_DOSES, prayerPlan, COINS, POISONED, acquireKey, antifirePlan, antipoisonPlan, bankRoutine, doseToDrink, enterLair, escapeRunesFor, feePrepaid, inCell, leaveCell, type BankOpts, type KeyState } from './supply.js';

const SHIELD = 'Dragonfire shield';

const LOOT_BURST_MAX = 8;
/** How near a dragon has to be for the overhead to go up ahead of the fight. */
const PRAYER_FIELD_RADIUS = 10;
const LOOT_SKIP_MS = 30_000;
const LOOT_WAIT_MS = 4000;
const LOOT_WALK_MS = 30_000;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;
const SIP_RETRY_MS = 5000;
const PARK_TICKS = 10;

// Why: the byline owns the row under the body and the controls need the one above it, so the drop list and the park reason are budgeted against the tallest section.
const LOOT_SHOWN = 6;
const PARK_ROWS = 2;
const PARK_FG = '#e0705a';
/** The gap and the button row that follow every section. */
const CONTROL_ROWS = 2;

/** Cells laid out two across, the shape statGrid draws. */
function inPairs<T>(cells: T[]): T[][] {
    return Array.from({ length: Math.ceil(cells.length / 2) }, (_, i) => cells.slice(i * 2, i * 2 + 2));
}

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };
const BEST_WEAPON = 'Best available';
const SHOW_SAFESPOT = { key: 'combatStyle', anyOf: ['mage', 'range'] };
const SHOW_STAND = { key: 'site', anyOf: STAND_SITE_KEYS };
const SHOW_BRIMHAVEN = { key: 'site', anyOf: [BRIMHAVEN_IRON.key, BRIMHAVEN_STEEL.key] };

const DROPS: string[] = DROP_DB[TAVERLEY_BLUE.target] ?? [];
// Why: Bass is food the run never eats and a coin pile is 11 to 440, so both spend a walk off the safespot that the hides pay for better.
const DEFAULT_LOOT = DROPS.filter(n => !['bass', 'coins'].includes(n.toLowerCase()));

const BLACK_DROPS: string[] = DROP_DB['Black dragon'] ?? [];
// Why: the same rule as the blue table, a pile of coins or a cake is a walk off the safespot the hides and the bones pay for better.
const DEFAULT_BLACK_LOOT = BLACK_DROPS.filter(n => !['coins', 'chocolate cake'].includes(n.toLowerCase()));

// Why: the Enclave kills blue dragons and greater demons off one stand, so its chips are the two tables merged rather than either alone.
const ENCLAVE_DROPS: string[] = [...new Set([...DROPS, ...(DROP_DB['Greater demon'] ?? [])])].sort((a, b) => a.localeCompare(b));
// Why: the same rule as the other tables, plus Ashes and Thread, which a greater demon drops by the pile and neither sells nor stacks into anything.
const DEFAULT_ENCLAVE_LOOT = ENCLAVE_DROPS.filter(n => !['bass', 'coins', 'ashes', 'thread', 'tuna'].includes(n.toLowerCase()));

// Why: the bars are the drop the trip is for, five a kill, and a coin pile here is 270 to 990 against a walk of a few tiles, so only the bolts and the curry start unticked.
const IRON_DROPS: string[] = DROP_DB[BRIMHAVEN_IRON.target] ?? [];
const DEFAULT_IRON_LOOT = IRON_DROPS.filter(n => !['bolts', 'curry'].includes(n.toLowerCase()));
const STEEL_DROPS: string[] = DROP_DB[BRIMHAVEN_STEEL.target] ?? [];
const DEFAULT_STEEL_LOOT = STEEL_DROPS.filter(n => !['bolts', 'curry'].includes(n.toLowerCase()));

// Why: both Taverley blue and the guild pen read the same drop table off the same `loot` key, so the chips show for either.
const SHOW_BLUE = { key: 'site', anyOf: [TAVERLEY_BLUE.key, HEROES_BLUE.key] };
const SHOW_ENCLAVE = { key: 'site', anyOf: [GUTANOTH_BLUE.key] };
const SHOW_BLACK = { key: 'site', anyOf: [TAVERLEY_BLACK.key] };
const SHOW_IRON = { key: 'site', anyOf: [BRIMHAVEN_IRON.key] };
const SHOW_STEEL = { key: 'site', anyOf: [BRIMHAVEN_STEEL.key] };

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'range', options: ['melee', 'mage', 'range'], label: 'Combat style', help: 'mage and range fight from a tile no dragon can path to. Melee stands in the dragonfire and needs the Dragonfire shield' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE },
    weapon: { type: 'string', default: BEST_WEAPON, options: [BEST_WEAPON, ...MELEE_WEAPONS], label: 'Weapon', group: 'Combat', showIf: SHOW_MELEE, help: 'Best available wears whatever the bank, the pack or the body holds that ranks highest and the Attack level allows, stab first on the metal dragons; a name pins that weapon. 1-handed, so the shield slot stays free for the Dragonfire shield' },
    staff: { type: 'string', default: 'Staff of fire', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 2000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    runeBuffer: { type: 'number', default: 300, min: 0, max: 2000, label: 'Spare runes per type', group: 'Combat', showIf: SHOW_MAGE, help: 'withdrawn on top of the cast budget. Blue dragons drop fire, water, nature and law runes, so looted runes let a trip cast past its budget and drain whichever rune is scarcest. When that is the law rune the escape teleport needs, the way home is the long walk out' },
    bow: { type: 'string', default: 'Maple shortbow', options: BOWS, label: 'Bow', group: 'Combat', showIf: SHOW_RANGE },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Iron arrow', options: ARROWS, label: 'Ammo', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },
    useSpecial: { type: 'boolean', default: true, label: 'Use special attacks', group: 'Combat', showIf: SHOW_MELEE, help: 'arms the spec bar for the attack that opens each kill, whenever the energy is there and the wielded weapon has a special (dragon dagger, dragon longsword and the rest). A weapon with none is left alone' },
    usePotions: { type: 'boolean', default: true, label: 'Drink super attack / strength', group: 'Combat', showIf: SHOW_MELEE, help: 'sips a dose once the boost decays to within a tenth of the base level. The loadout carry list sets the dose form and the count per trip, otherwise one Super attack(3) and one Super strength(3)' },
    prayMelee: { type: 'boolean', default: true, label: 'Pray Protect from Melee on the metal dragons', group: 'Combat', showIf: SHOW_MELEE, help: 'the metal dragons stop at ten tiles and breathe, so melee walks to one and fights beside it, where it headbutts for up to 22; the overhead makes that 0 and the shield with a dose takes the close breath. Needs 43 Prayer' },

    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    panicHp: { type: 'number', default: 30, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'out of food and this low, the run leaves the lair for the bank' },
    retreatHp: { type: 'number', default: 50, min: 0, max: 99, label: 'Retreat to a safespot below HP%', group: 'Food & healing', help: 'off the safespot and this hurt, the run walks back to the nearest one and heals there. Eating in dragonfire loses the race, so this outranks the bite. An empty pack sends it back whatever the HP, since nothing in the lair heals. 0 turns off both' },
    foodReserve: { type: 'number', default: 4, min: 0, max: 27, label: 'Food kept back from slot-freeing', group: 'Food & healing', help: 'a full pack spends food to make room for loot instead of banking, never below this many' },
    healTo: { type: 'number', default: 90, min: 10, max: 100, label: 'Heal to HP% before heading back', group: 'Food & healing', help: 'the walk in is long, so the trip eats up at the booth and tops the food back up after' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', showIf: SHOW_BLUE, help: 'the blue dragon table. Everything picked up is banked. Bass and Coins start unticked because neither pays for the walk off the safespot' },
    lootBlack: { type: 'string[]', default: DEFAULT_BLACK_LOOT, options: BLACK_DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', showIf: SHOW_BLACK, help: 'the black dragon table, a different list from the blue one. Everything picked up is banked. Coins and Chocolate cake start unticked because neither pays for the walk off the safespot' },
    lootEnclave: { type: 'string[]', default: DEFAULT_ENCLAVE_LOOT, options: ENCLAVE_DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', showIf: SHOW_ENCLAVE, help: 'the blue dragon and greater demon tables merged, since the stand kills both. Everything picked up is banked. Bass, Coins, Tuna, Ashes and Thread start unticked because none pays for the walk off the safespot' },
    lootIron: { type: 'string[]', default: DEFAULT_IRON_LOOT, options: IRON_DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', showIf: SHOW_IRON, help: 'the iron dragon table. Every kill drops five Iron bars and the bones, and the coin piles are 270 to 990, so all three start ticked; untick the bars to spend the slots on food. Bolts and Curry start unticked' },
    lootSteel: { type: 'string[]', default: DEFAULT_STEEL_LOOT, options: STEEL_DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', showIf: SHOW_STEEL, help: 'the steel dragon table. Every kill drops five Steel bars and the bones, and the coin piles are 470 to 650, so all three start ticked. Bolts and Curry start unticked' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury dragon bones', group: 'Banking & loot', help: 'bury Dragon bones for Prayer xp instead of banking them (always looted when on). They are the best drop here, so this trades gold for xp' },
    rangingPotion: { type: 'boolean', default: false, label: 'Drink a ranging potion', group: 'Combat', showIf: SHOW_RANGE, help: 'sips a dose once the boost decays to within a tenth of the base level. The loadout carry list sets the dose form and the count per trip, otherwise one Ranging potion(3)' },
    antipoisonDoses: { type: 'number', default: 1, min: 0, max: 4, label: 'Superantipoison flasks per trip', group: 'Food & healing', showIf: SHOW_BLACK, help: 'the walk to the black dragons passes the dungeon spiders. A dose is drunk on the poison message; 0 carries none' },
    antifireDoses: { type: 'number', default: 3, min: 0, max: 6, label: 'Antifire potion flasks per trip', group: 'Food & healing', showIf: SHOW_BRIMHAVEN, help: 'a metal dragon breathes from ten tiles and the shield alone leaves 5 a breath; a dose on top makes it 0 for six minutes, and the next goes down as the last lapses, so the doses are what a trip burns and three flasks is 72 minutes. The Brimhaven sites carry 8 food a trip while the food knob sits on its default. 0 carries none and the food takes the breaths' },
    prayerDoses: { type: 'number', default: 3, min: 0, max: 6, label: 'Prayer potion flasks per trip', group: 'Food & healing', showIf: SHOW_BRIMHAVEN, help: 'melee only. A dose restores a quarter of the level plus seven, and Protect from Melee drains about a point every two seconds beside a dragon' },
    axe: { type: 'string', default: 'Rune axe', options: AXES.map(t => t.name), label: 'Axe for the vines', group: 'Location', showIf: SHOW_BRIMHAVEN, help: 'the walk in chops through two vine walls, so an axe rides in the pack every trip; any tier works, a better one chops faster' },

    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues', help: 'blue dragons drop hard clues. The trail leaves the dungeon and comes back' },

    site: { type: 'string', default: 'taverley-blue', options: SITE_OPTIONS, label: 'Dragon site', group: 'Location', help: "below combat 97 the Taverley baby blues aggress on the walk in, above it they never do. The Heroes' Guild dragon is one adult penned behind a fence, so the fight is cast through it and only the loot walk opens the gate; the guild doors need Heroes' Quest. The Gu'Tanoth Enclave is a mage site: the Enclave guard waves you past once Watch Tower is complete, the stand looks at one dragon of the six and nothing else, and the cave shares its floor with greater demons, ogre shamans and chieftains, so melee there is your own risk. The Brimhaven Dungeon metal dragons cost Saniboch 875 coins a trip and the walk in chops two vines and crosses stepping stones, a log and a pipe, so it wants Woodcutting 22, Agility 34 and an axe; they park at ten tiles and breathe, so the stand is the open tile that sees the most of them, every style wears the Dragonfire shield with an Antifire dose up, range is refused, iron and steel finish whichever bites, and the trip banks at Ardougne on the Ardougne teleport, which needs Plague City" },
    stand: { type: 'number', default: 1, min: 1, max: MAX_STANDS, label: 'Stand', group: 'Location', showIf: SHOW_STAND, help: 'which of the site\'s numbered stands to fight from, one per dragon. The Enclave has six, listed north, west, north-west, south, east, far east; 1 is the roomiest and the one with a live proof behind it. The iron dragons have two open camps, the east side of the room with four in view then the north-east corner with two, both clear of every dragon\'s idle wander. A number past the end takes the last, and a site with one stand ignores it' },
    safespot1: { type: 'tile', default: TAVERLEY_BLUE.safespots[0], label: 'Safespot 1', group: 'Location', showIf: SHOW_SAFESPOT, help: 'the chosen stand fills these; set one to move it off the derived tile' },
    safespot2: { type: 'tile', default: TAVERLEY_BLUE.safespots[1], label: 'Safespot 2', group: 'Location', showIf: SHOW_SAFESPOT, help: 'the ladder rotates here when a hit lands, or when nothing is in range for 20s' },
    safespot3: { type: 'tile', default: TAVERLEY_BLUE.safespots[2], label: 'Safespot 3', group: 'Location', showIf: SHOW_SAFESPOT },
    meleeTile: { type: 'tile', default: TAVERLEY_BLUE.meleeAnchor, label: 'Melee anchor tile', group: 'Location', showIf: SHOW_MELEE, help: 'derived bordering an adult body no baby can reach; a dragon further out gets leashed in' },
    bankTile: { type: 'tile', default: TAVERLEY_BLUE.bank, label: 'Bank stand tile', group: 'Location' },
    leaveVia: { type: 'string', default: 'teleport', options: ['teleport', 'walk'], optionLabels: { teleport: 'The escape teleport this site names', walk: 'Walk out' }, label: 'Leave the lair by', group: 'Location', help: 'the teleport falls back to the walk when the runes or the magic level are short. Each site names the one spell that lands nearest its bank: Falador for Taverley and the guild, Watchtower for the Enclave, Ardougne for Brimhaven' },
    teleStock: { type: 'number', default: 2, min: 0, max: 10, label: 'Spare escape casts', group: 'Location', help: 'casts carried on top of the one needed to leave' },
    logDetail: { type: 'string', default: 'Normal', options: ['Normal', 'Verbose'], label: 'Log detail', group: 'Diagnostics', help: 'Verbose adds the loot, slot-freeing and key-state traces' }
};

/** The panel keys the safespot ladder is offered through. A site with more tiles keeps the rest of its own. */
const SPOT_KEYS = ['safespot1', 'safespot2', 'safespot3'];

/** The site's own tile, unless the panel setting has been moved off its schema default. */
export function siteTile(bag: SettingsBag, key: string | undefined, site: Tile): Tile {
    return siteTileOf(SETTINGS, bag, key, site);
}

let SITE: DragonSite = TAVERLEY_BLUE;
let STYLE: Style = 'range';
let MELEE_STYLE: MeleeCombatStyle = 'strength';
let RANGE_MODE = 1;
let WEAPON = '';
/** Whether the weapon is picked from what the bank holds rather than pinned by name. */
let WEAPON_PICKED = false;
const unusableWeapons = new Set<string>();

/** A melee weapon worn or carried, when the pick may settle on one without a bank stop. */
function meleeWeaponHeld(): string | null {
    return knownMeleeWeapon(Equipment.items().map(i => i.name ?? '')) ?? knownMeleeWeapon(Inventory.items().map(i => i.name ?? ''));
}
let SPELL = 'Fire Strike';
let AMMO = 'Iron arrow';
let FOOD_NAME = 'Lobster';
let ESCAPE_LABEL = escapeRunesFor(TAVERLEY_BLUE.escapeTeleportId).label;
let LEAVE_WALK = false;
let BURY_BONES = false;
let SOLVE_CLUES = true;

let PANIC_HP = 0.3;
let RETREAT_HP = 0.5;
let RUNE_CASTS = 150;
let RUNE_BUFFER = 300;
let AMMO_WITHDRAW = 500;
let FOOD_WITHDRAW = 20;
let FOOD_RESERVE = 4;
let ESCAPE_STOCK = 2;
let HEAL_TO = 0.9;
let LOOT_SET = new Set<string>();
let ANTIPOISON_WANT = 0;
let ANTIFIRE_WANT = 0;
let AXE = '';
let BANK_COMMON = true;
let VERBOSE = false;
let USE_SPECIAL = true;
/** Empty in mage and range mode: an attack or strength boost does nothing for a spell or a bow. */
let POTIONS: PotionPlan[] = [];
/** The overhead the run keeps up beside a dragon, or null. */
let PRAYER: string | null = null;
let PRAYER_WANT = 0;

function wieldedNames(): string[] {
    return Equipment.items().map(i => i.name ?? '');
}
function hpFrac(): number {
    return Skills.hpFraction();
}
function foodCount(): number {
    return foodCountIn(Inventory.items(), FOOD_NAME);
}
function hasFood(): boolean {
    return foodCount() > 0;
}

/** Below the eat threshold with food in the pack. The fight loop reads a refused eat as an empty pack, so the food half of this is load-bearing. */
function needEat(): boolean {
    if (!hasFood()) {
        return false;
    }
    return shouldEatToUseFood({
        hp: Skills.effective('hitpoints'),
        maxHp: Skills.level('hitpoints'),
        heal: foodHealAmount(FOOD_NAME),
        foodCount: foodCount()
    });
}

function castsLeft(): number {
    return castsAvailable(SPELL, wieldedNames(), rune => Inventory.count(rune));
}
function quiverCount(): number {
    return Equipment.items().find(i => (i.name ?? '').toLowerCase() === AMMO.toLowerCase())?.count ?? 0;
}
function ammoLeft(): number {
    return quiverCount() + Inventory.count(AMMO);
}
function needStyleSupplies(): boolean {
    if (STYLE === 'mage') {
        return castsLeft() < 1;
    }
    // Why: a melee run with its weapon in the bank walked in and fought with its fists, since nothing on the bank list was about the weapon.
    if (STYLE === 'melee') {
        return WEAPON === '' || (!Equipment.contains(WEAPON) && Inventory.first(WEAPON) === null);
    }
    return STYLE === 'range' && ammoLeft() === 0;
}

// Why: every optional field falls back to a supply.ts module default, so a knob left out of this object is one the panel offers and the run ignores.

/** Every setting bankRoutine reads. */
function bankOpts(): BankOpts {
    return {
        withdrawFood: true, runeCasts: RUNE_CASTS, runeBuffer: RUNE_BUFFER, ammo: AMMO_WITHDRAW, escapeStock: ESCAPE_STOCK, healTo: HEAL_TO, potions: POTIONS,
        flasks: [...(ANTIPOISON_WANT > 0 ? [antipoisonPlan(ANTIPOISON_WANT)] : []), ...(ANTIFIRE_WANT > 0 ? [antifirePlan(ANTIFIRE_WANT)] : []), ...(PRAYER_WANT > 0 ? [prayerPlan(PRAYER_WANT)] : [])],
        carry: SITE.axe === true && AXE !== '' ? [AXE] : []
    };
}

/** Whether the pack is short of the coins the way in costs, with a fee already paid needing none. */
function needCoins(): boolean {
    return SITE.feeGate !== undefined && !feePrepaid(SITE) && Inventory.count(COINS) < SITE.feeGate.coins;
}

// Why: bankRoutine returns void and countBankTrip fires only where it runs to the end, so the counter moving is what separates an empty bank from a walk that never got there.

/** Take the trip, and latch what it came back with when it finished. */
async function bankTrip(bot: JiveDragons): Promise<void> {
    const before = bot.bankTrips;
    await bankRoutine(bot, SITE, bankOpts());
    if (bot.bankTrips > before) {
        bot.noteTrip(hasFood(), !needStyleSupplies());
    }
}

/** Drink the smallest antipoison flask held. False with none in the pack. */
async function drinkAntipoison(): Promise<boolean> {
    const name = doseToDrink(n => Inventory.count(n));
    const dose = name === null ? null : Inventory.first(name);
    if (name === null || dose === null) {
        return false;
    }
    // Why: a sip turns the (4) into a (3), so the flask count never moves; the dose form's own count is what drops.
    const before = Inventory.count(name);
    if (!(await dose.interact('Drink'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(name) < before, 3000);
}

function antifireHeld(): number {
    return ANTIFIRE_DOSES.reduce((n, name) => n + Inventory.count(name), 0);
}

function prayerHeld(): number {
    return PRAYER_DOSES.reduce((n, name) => n + Inventory.count(name), 0);
}

/** Whether a dragon the run hunts stands inside the fight's field of the bot. */
function adultInField(): boolean {
    const names = huntNames(SITE);
    return Npcs.query().where(n => names.includes(n.name ?? '')).within(PRAYER_FIELD_RADIUS).results().length > 0;
}

/** Whether the overhead should be up right now: inside the lair with a dragon in reach or a fight live. */
function prayerWanted(bot: JiveDragons): boolean {
    return PRAYER !== null && SITE.inArea(Game.tile()) && (bot.targetIdx !== null || adultInField());
}

function prayerDue(): boolean {
    return PRAYER !== null && SITE.inArea(Game.tile()) && prayerSipDue(Prayer.points(), Prayer.max());
}

/** Put the overhead up or take it down, saying so once per change. False when the toggle did not land. */
// Why: the Sustain hook flips it from inside walks and fights and the task flips it between them, so one helper carries the log line or the change made inside a fight is never seen.
async function setOverhead(bot: JiveDragons, want: boolean): Promise<boolean> {
    if (PRAYER === null || Prayer.active(PRAYER) === want || (want && !Prayer.available(PRAYER))) {
        return true;
    }
    if (!(await Prayer.set(PRAYER, want))) {
        return false;
    }
    bot.log(want ? `praying ${PRAYER} (${Prayer.points()}/${Prayer.max()})` : `${PRAYER} off, nothing in reach`);
    return true;
}

/** Drink the smallest Prayer flask held, and put the overhead back up if the pool had run dry mid-fight. False with none in the pack. */
async function sipPrayer(bot: JiveDragons): Promise<boolean> {
    const name = doseToDrink(n => Inventory.count(n), PRAYER_DOSES);
    const dose = name === null ? null : Inventory.first(name);
    if (name === null || dose === null) {
        return false;
    }
    const status = bot.status;
    bot.setStatus('drinking a Prayer potion');
    const before = Inventory.count(name);
    const drunk = (await dose.interact('Drink')) && (await Execution.delayUntil(() => Inventory.count(name) < before, 3000));
    bot.setStatus(status);
    if (!drunk) {
        return false;
    }
    bot.log(`drank ${name}, prayer ${Prayer.points()}/${Prayer.max()} (holding ${PRAYER_DOSES.map(n => `${Inventory.count(n)}x ${n}`).filter(t => !t.startsWith('0x')).join(', ') || 'none'})`);
    await setOverhead(bot, prayerWanted(bot));
    return true;
}

// Why: `%dragonresist` never reaches the client, so the lapse is kept as a tick from the sip, and a breath the shield took with no potion line after it resets the clock to now. The hook runs from the fight's idle ticks as well as its own task, since a fight holds the loop for two minutes and a dose lapsing inside one is two minutes of breaths.

/** The Antifire clock: when the last dose lapses, and the chat mark the breath lines are read from. */
const antifire = {
    until: 0,
    mark: GameMessages.mark(),
    warned: false,
    noteBreaths(): void {
        if (antifireLapsed(GameMessages.sawSince(this.mark, SHIELD_ABSORBS), GameMessages.sawSince(this.mark, POTION_PROTECTS))) {
            this.until = 0;
        }
        this.mark = GameMessages.mark();
    },
    due(): boolean {
        this.noteBreaths();
        return antifireDue({ inLair: SITE.inArea(Game.tile()), tick: Game.tick(), until: this.until });
    },
    ticksLeft(): number {
        return Math.max(0, this.until - Game.tick());
    },
    reset(): void {
        this.until = 0;
        this.mark = GameMessages.mark();
        this.warned = false;
    }
};

/** Drink the smallest Antifire flask held and start the clock. False with none in the pack. */
async function sipAntifire(bot: JiveDragons): Promise<boolean> {
    const name = doseToDrink(n => Inventory.count(n), ANTIFIRE_DOSES);
    const dose = name === null ? null : Inventory.first(name);
    if (name === null || dose === null) {
        return false;
    }
    // Why: the sip runs inside walks and fights through the Sustain hook, so the status it shows goes back to whatever the task had up.
    const status = bot.status;
    bot.setStatus('drinking an Antifire potion');
    // Why: the flask count holds steady from (4) to (1), so the sip is proved by the dose form's own count dropping; summing them drank a flask in one go and started the clock on the last dose.
    const before = Inventory.count(name);
    const drunk = (await dose.interact('Drink')) && (await Execution.delayUntil(() => Inventory.count(name) < before, 3000));
    bot.setStatus(status);
    if (!drunk) {
        return false;
    }
    antifire.until = Game.tick() + ANTIFIRE_TICKS;
    antifire.warned = false;
    bot.log(`drank ${name}, the next dose in ${Math.round(((ANTIFIRE_TICKS - ANTIFIRE_MARGIN_TICKS) * 0.6) / 60)} minutes (holding ${ANTIFIRE_DOSES.map(n => `${Inventory.count(n)}x ${n}`).filter(t => !t.startsWith('0x')).join(', ') || 'none'})`);
    return true;
}

function potionsHeld(plan: PotionPlan): number {
    return plan.potion.doses.reduce((n, dose) => n + Inventory.count(dose), 0);
}
/** Every dose form the run carries, so the deposit keeps a part-used flask. */
function potionDoseNames(): string[] {
    return POTIONS.flatMap(plan => [...plan.potion.doses]);
}
function sipDue(): PotionPlan | null {
    return potionToSip({
        plans: POTIONS,
        held: potionsHeld,
        levels: skill => ({ base: Skills.level(skill), effective: Skills.effective(skill) })
    });
}

// Why: a drop we keep failing to take qualifies forever, and with the walk back to the safespot in between the bot and the item trade places until a dragon reaches it.
const lootSkip = new Map<string, number>();

function lootKey(g: GroundItem): string {
    return `${g.name ?? ''}@${g.tile().x},${g.tile().z}`;
}

function lootFilter() {
    return { loot: LOOT_SET, bankCommon: BANK_COMMON, solveClues: SOLVE_CLUES, buryBones: BURY_BONES, boneName: SITE.bones };
}

function findLoot(): GroundItem | null {
    const now = performance.now();
    return GroundItems.query()
        .where(g => SITE.inArea(g.tile()) && (lootSkip.get(lootKey(g)) ?? 0) < now && wantsDrop({ id: g.id, name: g.name }, lootFilter()))
        .within(lootReach(SITE.fireAtRange === true))
        .nearest();
}

/** Loot merging into a stack already held needs no slot. */
function lootStacksIntoPack(name: string | null): boolean {
    if (name === null || name.length === 0) {
        return false;
    }
    const held = Inventory.first(name);
    return held !== null && held.count > 1;
}

type SlotAction = 'eat' | 'drop' | 'none';

// Why: eating wins while the heal is not wasted and at full hp the food is dropped instead, so a full pack buys a loot slot rather than the walk to Falador.
// Why: the reserve is never dug into, below it the caller falls through to its bank run.

/** Trade a food slot for a loot slot. */
function slotAction(drop: GroundItem | null): SlotAction {
    if (drop === null || !Inventory.isFull() || lootStacksIntoPack(drop.name)) {
        return 'none';
    }
    if (foodCount() <= FOOD_RESERVE) {
        return 'none';
    }
    return hpFrac() < 1 ? 'eat' : 'drop';
}

async function eatOnce(bot: JiveDragons): Promise<boolean> {
    const forms = foodForms(FOOD_NAME);
    const food = Inventory.items().find(i => forms.includes((i.name ?? '').toLowerCase()));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Math.round(hpFrac() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    if (!(await food.interact('Eat'))) {
        return false;
    }
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

// Why: a Take click walks on the scene's own collision and never opens a door, so a drop behind one dies silently on the click and the skip list swallows the pile behind it. The Heroes' Guild dragon drops inside its pen, on the far side of the gate.

/** Walk a drop the Take click cannot path to into reach, opening whatever is in the way. */
async function reachDrop(bot: JiveDragons, drop: GroundItem): Promise<void> {
    const tile = drop.tile();
    if (Reachability.canReach(tile)) {
        return;
    }
    bot.vlog(`${drop.name ?? 'loot'} at ${tile} is behind something the Take click cannot open. Walking to it.`);
    await Traversal.walkResilient(tile, { radius: 1, attempts: 3, timeoutMs: LOOT_WALK_MS, log: m => bot.vlog(`  ${m}`) });
}

async function lootOnce(bot: JiveDragons): Promise<boolean> {
    const drop = findLoot();
    if (drop === null) {
        return false;
    }
    const name = drop.name ?? '';
    bot.setStatus(`looting ${name}`);
    await reachDrop(bot, drop);
    const usedBefore = Inventory.used();
    const countBefore = Inventory.count(name);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    // Why: a stackable drop merges into a slot already held, so used() alone never moves for the coins, runes and arrows that are most of this table.
    if (await Execution.delayUntil(() => Inventory.used() > usedBefore || Inventory.count(name) > countBefore, LOOT_WAIT_MS)) {
        bot.countLoot(name);
        bot.log(`looted ${name}`);
        return true;
    }
    lootSkip.set(lootKey(drop), performance.now() + LOOT_SKIP_MS);
    bot.log(`could not pick up ${name} at ${drop.tile()}. Ignoring it for ${LOOT_SKIP_MS / 1000}s.`);
    return false;
}

function tooHurtToLoot(): boolean {
    return lootHalts({ hpFrac: hpFrac(), panicHp: PANIC_HP, retreatHp: RETREAT_HP });
}

/** Clear the drop pile in one pass rather than one item per task hop. */
async function lootBurst(bot: JiveDragons): Promise<void> {
    for (let i = 0; i < LOOT_BURST_MAX; i++) {
        if (EventSignal.pending() || bot.died || Inventory.isFull() || needEat() || tooHurtToLoot() || findLoot() === null) {
            return;
        }
        await lootOnce(bot);
    }
}

async function freeSlot(bot: JiveDragons): Promise<void> {
    const drop = findLoot();
    const action = slotAction(drop);
    const want = drop?.name ?? 'loot';
    bot.vlog(`slot check: ${Inventory.used()} used, ${FOOD_NAME} x${foodCount()} (reserve ${FOOD_RESERVE}), hp ${Math.round(hpFrac() * 100)}%, ground '${want}' -> ${action}`);
    if (action === 'eat') {
        bot.log(`pack full. Eating ${FOOD_NAME} to make room for ${want}`);
        await eatOnce(bot);
        return;
    }
    if (action !== 'drop') {
        return;
    }
    const food = Inventory.items().find(i => isFoodItem(i.name, FOOD_NAME));
    if (!food) {
        return;
    }
    bot.setStatus(`dropping ${food.name} for pack space`);
    bot.log(`pack full at full hp. Dropping ${food.name} to make room for ${want}`);
    const before = Inventory.used();
    if (await food.interact('Drop')) {
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
}

async function dropVial(bot: JiveDragons): Promise<boolean> {
    const vial = Inventory.first(EMPTY_VIAL);
    if (!vial) {
        return false;
    }
    bot.setStatus(`dropping an empty ${EMPTY_VIAL}`);
    const before = Inventory.used();
    if (!(await vial.interact('Drop'))) {
        return false;
    }
    return Execution.delayUntilTicks(() => Inventory.used() < before, 3);
}

class Parked implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return this.bot.parked;
    }
    async execute(): Promise<void> {
        await Execution.delayTicks(PARK_TICKS);
    }
}

// Why: the poison varp never reaches the client and poison_player prints its line once per fresh poisoning, so the line is the only signal and the mark moves past it whether or not a dose was there to answer it.

class CurePoison implements Task {
    private mark = GameMessages.mark();
    private warned = false;
    constructor(private bot: JiveDragons) {}
    validate(): boolean {
        return ANTIPOISON_WANT > 0 && GameMessages.sawSince(this.mark, POISONED);
    }
    async execute(): Promise<void> {
        this.mark = GameMessages.mark();
        this.bot.setStatus('poisoned, drinking an antipoison');
        if (await drinkAntipoison()) {
            this.bot.log('poisoned. Drank a Superantipoison');
            this.warned = false;
            return;
        }
        if (!this.warned) {
            this.bot.log('WARNING: poisoned with no Superantipoison in the pack. The food covers it until the bank run.');
            this.warned = true;
        }
    }
}

// Why: a due dose with nothing to drink is the state the operator has to hear about, so the empty pack warns once and then leaves the loop alone for a minute rather than validating every pass.
class SipAntifire implements Task {
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return ANTIFIRE_WANT > 0 && Date.now() >= this.retryAt && antifire.due();
    }
    async execute(): Promise<void> {
        if (antifireHeld() === 0) {
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            if (!antifire.warned) {
                this.bot.log('WARNING: an Antifire dose is due and the pack holds no flask. The shield holds the breaths to 5 until the bank run.');
                antifire.warned = true;
            }
            return;
        }
        // Why: a sip sent mid-walk can miss its three-second window, and a minute without a dose is five a breath; a held flask is retried in a few seconds instead.
        if (!(await sipAntifire(this.bot))) {
            this.retryAt = Date.now() + SIP_RETRY_MS;
            this.bot.vlog('the Antifire sip did not land, trying again shortly');
        }
    }
}

// Why: the overhead spends points every tick it is up, so it goes on when a dragon is in the field and comes off outside the lair, where the bank trip would drain a flask for nothing.
class PrayMelee implements Task {
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        if (PRAYER === null || Date.now() < this.retryAt) {
            return false;
        }
        const want = prayerWanted(this.bot);
        return Prayer.active(PRAYER) !== want && (!want || Prayer.available(PRAYER));
    }
    async execute(): Promise<void> {
        if (!(await setOverhead(this.bot, prayerWanted(this.bot)))) {
            this.retryAt = Date.now() + SIP_RETRY_MS;
        }
    }
}

class SipPrayer implements Task {
    private retryAt = 0;
    private warned = false;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return PRAYER_WANT > 0 && Date.now() >= this.retryAt && prayerDue();
    }
    async execute(): Promise<void> {
        if (prayerHeld() === 0) {
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            if (!this.warned) {
                this.bot.log('WARNING: prayer is low and the pack holds no Prayer potion. The overhead drops when it hits 0 and the headbutts land full until the bank run.');
                this.warned = true;
            }
            return;
        }
        this.warned = false;
        if (!(await sipPrayer(this.bot))) {
            this.retryAt = Date.now() + SIP_RETRY_MS;
        }
    }
}

class Eat implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return needEat();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

class GearEquip implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    private missing(): string | null {
        const wear = [...(needsShield(SITE, STYLE) ? [SHIELD] : []), WEAPON, STYLE === 'range' ? AMMO : ''];
        return wear.find(n => n !== '' && !Equipment.contains(n) && Inventory.first(n) !== null) ?? null;
    }
    validate(): boolean {
        return Date.now() >= this.retryAt && this.missing() !== null;
    }
    async execute(): Promise<void> {
        const item = this.missing();
        if (item === null) {
            return;
        }
        this.bot.setStatus(`equipping ${item}`);
        if (await Equipment.equip(item)) {
            this.bot.log(`equipped ${item}`);
            this.fails = 0;
            return;
        }
        if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            // Why: a wield the engine refuses is a level or a quest short, and a picked weapon has a next best behind it; a pinned one only has the retry.
            if (WEAPON_PICKED && item === WEAPON) {
                unusableWeapons.add(item);
                WEAPON = '';
                this.bot.log(`${item} will not go on, a level or a quest short. Picking another at the bank.`);
                return;
            }
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not equip ${item}. Retrying in ${ASSERT_RETRY_MS / 1000}s.`);
        }
    }
}

class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    private selected(): boolean {
        return STYLE === 'range' ? Game.combatMode() === RANGE_MODE : Game.hasCombatStyle(MELEE_STYLE);
    }
    validate(): boolean {
        return STYLE !== 'mage' && !this.selected() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting the combat style');
        if (STYLE === 'range') {
            Game.setCombatMode(RANGE_MODE);
        } else {
            Game.setCombatStyle(MELEE_STYLE);
        }
        if (await Execution.delayUntil(() => this.selected(), 3000)) {
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not set the ${STYLE} attack style. Retrying in ${ASSERT_RETRY_MS / 1000}s.`);
        }
    }
}

// Why: two metal dragons breathe at the stand at once and losing either one's aggro is harder than killing it, so auto-retaliate stays on and the fight loop follows whatever it is hitting.
// Why: a chase stands beside the dragon it was sent at, and retaliating to a bite from ten tiles away walked it off that dragon to one it could not reach; the breath it answers is 0 under the shield and a dose.
function retaliateWanted(): boolean {
    return SITE.fireAtRange === true && !chaseMode(STYLE, true);
}

class SetRetaliate implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return SITE.fireAtRange === true && Game.autoRetaliateOn() !== retaliateWanted() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        const want = retaliateWanted();
        this.bot.setStatus(`turning auto-retaliate ${want ? 'on' : 'off'}`);
        Game.setAutoRetaliate(want);
        if (await Execution.delayUntil(() => Game.autoRetaliateOn() === want, 3000)) {
            this.bot.log(want
                ? 'auto-retaliate on, so whichever dragon bites gets the casts and the fight follows it'
                : 'auto-retaliate off, so the chase stays on the dragon it was sent at');
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not turn auto-retaliate ${want ? 'on' : 'off'}. Retrying in ${ASSERT_RETRY_MS / 1000}s.`);
        }
    }
}

class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        if (STYLE !== 'mage' || Autocast.armed() || Date.now() < this.retryAt || castsLeft() < 1) {
            return false;
        }
        return Autocast.staffTabAttached() || (WEAPON !== '' && Equipment.contains(WEAPON));
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`arming autocast: ${SPELL}`);
        await Execution.delayTicks(3);
        if (await Autocast.arm(SPELL, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`WARNING: could not arm autocast for '${SPELL}'. Retrying in ${ASSERT_RETRY_MS / 1000}s.`);
        }
    }
}

// Why: Fight owns the bot for the length of a kill, so a sibling task only lands between kills and on the walks, which is often enough for a boost that decays over minutes.

class SipPotion implements Task {
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return POTIONS.length > 0 && Date.now() >= this.retryAt && (Inventory.contains(EMPTY_VIAL) || sipDue() !== null);
    }
    async execute(): Promise<void> {
        if (await dropVial(this.bot) || await this.sip()) {
            return;
        }
        // Why: a vial that refuses to drop keeps this validating forever, and it sits above the bank run and the panic retreat.
        this.retryAt = Date.now() + ASSERT_RETRY_MS;
    }
    private async sip(): Promise<boolean> {
        const plan = sipDue();
        const dose = plan === null ? undefined : plan.potion.doses.map(name => Inventory.first(name)).find(item => item !== null);
        if (plan === null || !dose) {
            return false;
        }
        const skill = plan.potion.skill;
        const name = dose.name ?? plan.flask;
        const before = Skills.effective(skill);
        this.bot.setStatus(`drinking ${name}`);
        if (!(await dose.interact('Drink')) || !(await Execution.delayUntilTicks(() => Skills.effective(skill) > before, 3))) {
            return false;
        }
        this.bot.countSip();
        this.bot.log(`drank ${name}, ${skill} ${before} to ${Skills.effective(skill)}`);
        return true;
    }
}

class PanicBank implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return !this.bot.parked && !this.bot.bankKnownEmpty() && hpFrac() < PANIC_HP && !hasFood();
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('panicking, retreating to the bank');
        this.bot.log(`panic at ${Math.round(hpFrac() * 100)}% hp with no food. Banking.`);
        await bankTrip(this.bot);
    }
}

class BuryBones implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return BURY_BONES && Date.now() >= this.retryAt && Inventory.contains(SITE.bones);
    }
    async execute(): Promise<void> {
        const bones = Inventory.first(SITE.bones);
        if (!bones) {
            return;
        }
        this.bot.setStatus(`burying ${SITE.bones}`);
        const before = Inventory.used();
        if (await bones.interact('Bury') && await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.bot.countBurial();
            this.fails = 0;
            return;
        }
        await Execution.delayTicks(2);
        if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not bury ${SITE.bones}. Pausing burial for ${ASSERT_RETRY_MS / 1000}s.`);
        }
    }
}

class FreeSlot implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return slotAction(findLoot()) !== 'none';
    }
    async execute(): Promise<void> {
        await freeSlot(this.bot);
    }
}

class BankRun implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        if (this.bot.parked) {
            return false;
        }
        if (!hasFood() && !this.bot.bankKnownEmpty()) {
            return true;
        }
        if (needStyleSupplies() && !this.bot.supplyKnownEmpty()) {
            return true;
        }
        // Why: the fee is spent on the way in, so a pack short of it outside the dungeon has nowhere to go but the booth.
        if (needCoins() && !SITE.inArea(Game.tile()) && !this.bot.supplyKnownEmpty()) {
            return true;
        }
        // Why: food is a resource the run spends and FreeSlot turns it into room, so a pack full of food is no reason to walk to Falador.
        return Inventory.isFull() && foodCount() <= FOOD_RESERVE;
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking, restocking');
        this.bot.log(`banking (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : ''}${STYLE === 'range' ? `, ammo ${ammoLeft()}` : ''}${SITE.coins === undefined ? '' : `, coins ${Inventory.count(COINS)}`})`);
        await bankTrip(this.bot);
    }
}

class LootCorpse implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return !tooHurtToLoot() && !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootBurst(this.bot);
    }
}

// Why: fetchFromVelrak returns got && out, so a key that arrives behind a cell door that will not open ends the retry loop with the bot sealed in a dead end, and nothing in supply.ts walks it back out.

class AcquireKey implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        const item = SITE.keyItem;
        if (item === null || this.bot.parked) {
            return false;
        }
        return inCell() || keyStatus(Inventory.countById(item.id), Bank.countById(item.id)) !== 'held';
    }
    async execute(): Promise<void> {
        if (inCell()) {
            this.bot.setStatus('leaving the jail cell');
            if (!(await leaveCell(this.bot))) {
                this.bot.log('the cell door would not open from the inside. Retrying.');
                return;
            }
            this.bot.log('out of the cell');
        }
        this.bot.keyState = await acquireKey(this.bot, SITE);
        this.bot.vlog(`key state: ${this.bot.keyState}`);
    }
}

class EnterLair implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        if (this.bot.parked || SITE.inArea(Game.tile()) || hpFrac() < PANIC_HP || needCoins()) {
            return false;
        }
        return SITE.keyItem === null || Inventory.countById(SITE.keyItem.id) > 0;
    }
    async execute(): Promise<void> {
        await enterLair(this.bot, SITE);
    }
}

export default class JiveDragons extends TaskBot implements CombatHost {
    override loopDelay = 600;

    status = 'starting';
    startedAt = Date.now();
    xp = new XpTracker(COMBAT_SKILLS, Skills);
    killsTotal = 0;
    bankTrips = 0;
    looted = 0;
    readonly lootCounts = new Map<string, number>();
    cluesSolved = 0;
    safespotIdx = 0;
    keyState: KeyState = 'fetch';
    buried = 0;
    sips = 0;
    specials = 0;
    parked = false;
    parkReason = '';
    died = false;
    targetIdx: number | null = null;

    private bankEmpty = false;
    private supplyEmpty = false;
    solveClue: SolveClue | undefined;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const base = siteFor(this.settings.str('site', 'taverley-blue'));
        const stand = standFor(base, this.settings.num('stand', 1));
        SITE = {
            ...base,
            safespots: stand.tiles.map((spot, i) => siteTile(this.settings, SPOT_KEYS[i], spot)),
            meleeAnchor: siteTile(this.settings, 'meleeTile', stand.anchor),
            bank: siteTile(this.settings, 'bankTile', base.bank)
        };
        if ((base.stands?.length ?? 0) > 1) {
            this.log(`standing at ${stand.label}, stand ${this.settings.num('stand', 1)} of ${base.stands!.length}`);
        }
        STYLE = this.settings.str('combatStyle', 'range') as Style;
        MELEE_STYLE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        SPELL = this.settings.str('spell', 'Fire Strike');
        AMMO = this.settings.str('ammo', 'Iron arrow');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of fire')
            : STYLE === 'range' ? this.settings.str('bow', 'Maple shortbow')
                : this.settings.str('weapon', BEST_WEAPON);
        WEAPON_PICKED = STYLE === 'melee' && WEAPON === BEST_WEAPON;
        unusableWeapons.clear();
        if (WEAPON_PICKED) {
            WEAPON = meleeWeaponHeld() ?? '';
        }
        FOOD_NAME = scriptFood(this.settings, SITE.food ?? 'Lobster');
        LEAVE_WALK = this.settings.str('leaveVia', 'teleport') === 'walk';
        ESCAPE_LABEL = LEAVE_WALK ? 'walk out' : escapeRunesFor(SITE.escapeTeleportId).label;
        BURY_BONES = this.settings.bool('buryBones', false);
        SOLVE_CLUES = this.settings.bool('solveClues', true);

        PANIC_HP = this.settings.num('panicHp', 30) / 100;
        RETREAT_HP = this.settings.num('retreatHp', 50) / 100;
        RUNE_CASTS = this.settings.num('runesWithdraw', 150);
        RUNE_BUFFER = this.settings.num('runeBuffer', 300);
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        // Why: the panel knob is one for every site, so a site with its own figure takes it only while the knob sits on the schema default.
        const foodKnob = this.settings.num('foodWithdraw', 20);
        FOOD_WITHDRAW = SITE.foodPerTrip !== undefined && foodKnob === SETTINGS.foodWithdraw!.default ? SITE.foodPerTrip : foodKnob;
        FOOD_RESERVE = this.settings.num('foodReserve', 4);
        ESCAPE_STOCK = this.settings.num('teleStock', 2);
        HEAL_TO = this.settings.num('healTo', 90) / 100;
        // Why: each site names the loot setting whose chips are its own drop table, and the schema default is that list, so neither is written down twice.
        const lootSetting = SITE.lootSetting ?? 'loot';
        const lootDefault = (SETTINGS[lootSetting]?.default as string[] | undefined) ?? DEFAULT_LOOT;
        LOOT_SET = new Set(this.settings.list(lootSetting, lootDefault).map(s => s.toLowerCase()));
        // Why: fired arrows land where the dragon dies and sit on no drop table, so the 500 a trip withdraws come home only if the loot set names them.
        if (STYLE === 'range') {
            LOOT_SET.add(AMMO.toLowerCase());
        }
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        VERBOSE = this.settings.str('logDetail', 'Normal') === 'Verbose';
        USE_SPECIAL = this.settings.bool('useSpecial', true);
        const carry = suppliesOf(selectedLoadout(this.settings));
        POTIONS = STYLE === 'melee' && this.settings.bool('usePotions', true) ? plannedPotions(carry)
            : STYLE === 'range' && this.settings.bool('rangingPotion', false) ? [rangingPlan(carry)]
                : [];
        ANTIPOISON_WANT = SITE.antipoison === true ? this.settings.num('antipoisonDoses', 1) : 0;
        ANTIFIRE_WANT = SITE.antifire === true ? this.settings.num('antifireDoses', 1) : 0;
        PRAYER = this.settings.bool('prayMelee', true) ? prayerFor(STYLE, SITE.fireAtRange === true) : null;
        PRAYER_WANT = PRAYER === null ? 0 : this.settings.num('prayerDoses', 3);
        if (PRAYER !== null && !Prayer.known(PRAYER)) {
            PRAYER = null;
        }
        AXE = SITE.axe === true ? this.settings.str('axe', 'Rune axe') : '';
        antifire.reset();

        this.startedAt = Date.now();
        this.xp.begin();
        this.safespotIdx = 0;
        lootSkip.clear();
        this.keyState = SITE.keyItem === null ? 'held' : keyStatus(Inventory.countById(SITE.keyItem.id), Bank.countById(SITE.keyItem.id));

        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.cluesSolved++;
                }
                this.setStatus(s);
            },
            isFood: n => isFoodItem(n, FOOD_NAME),
            foodName: () => FOOD_NAME,
            foodWithdraw: () => FOOD_WITHDRAW,
            weaponName: () => WEAPON,
            enabled: () => SOLVE_CLUES
        });

        // Why: Bank.count reads the last snapshot and the bank has never been open at this point, so this only catches a shield that is nowhere, and supply.ts repeats the check with the booth open.
        const gate = styleGate(STYLE, SITE.fireAtRange === true) ?? shieldGate(STYLE, SITE.fireAtRange === true, Equipment.contains(SHIELD) || Inventory.count(SHIELD) > 0 || Bank.count(SHIELD) > 0);
        if (gate !== null) {
            this.parkFor(gate);
        }

        this.log(`JiveDragons: ${SITE.label}, style ${STYLE}${WEAPON === '' ? '' : ` w/ ${WEAPON}`}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (retreat<${Math.round(RETREAT_HP * 100)}%, panic<${Math.round(PANIC_HP * 100)}%), escape ${ESCAPE_LABEL}, clues ${SOLVE_CLUES ? 'on' : 'off'}${BURY_BONES ? `, burying ${SITE.bones}` : ''}, bank ${SITE.bank}`);
        this.vlog(`safespots [${SITE.safespots.join(' ')}], melee anchor ${SITE.meleeAnchor}, loot [${[...LOOT_SET].join(', ')}]`);
        if (PRAYER !== null) {
            this.log(Prayer.max() >= 43
                ? `melee here chases the dragon from ${SITE.meleeAnchor} and prays ${PRAYER}, ${PRAYER_WANT} Prayer flask(s) a trip`
                : `WARNING: ${PRAYER} needs 43 Prayer and this character has ${Prayer.max()}, so the headbutts land; melee here chases the dragon and eats through them`);
        }

        // Why: waitFed, Fight.idle and every walkResilient in this script pump Sustain, and with no hook set all of them stood in dragonfire without taking a bite.
        Sustain.set(async () => {
            if (needEat()) {
                await eatOnce(this);
            }
            if (ANTIFIRE_WANT > 0 && antifireHeld() > 0 && antifire.due()) {
                await sipAntifire(this);
            }
            // Why: a fight holds the loop for two minutes and a walk out holds it longer, so the pool is topped up and the overhead put back or taken down from inside them.
            if (PRAYER !== null) {
                if (PRAYER_WANT > 0 && prayerHeld() > 0 && prayerDue()) {
                    await sipPrayer(this);
                }
                await setOverhead(this, prayerWanted(this));
            }
        });

        this.add(
            new Parked(this),
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: SITE.bank,
                radius: 6,
                onDeath: () => {
                    this.died = true;
                    this.setStatus('died, recovering');
                    this.solveClue?.noteDeath();
                    this.log('died! recovering');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new Retreat(this, SITE),
            new Eat(this),
            new CurePoison(this),
            new SipAntifire(this),
            new SipPrayer(this),
            new PrayMelee(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new SetRetaliate(this),
            new ArmAutocast(this),
            new SipPotion(this),
            new PanicBank(this),
            new BuryBones(this),
            this.solveClue,
            new FreeSlot(this),
            new BankRun(this),
            new LootCorpse(this),
            new AcquireKey(this),
            new EnterLair(this),
            new WalkToSpot(this, SITE),
            new HoldSafespot(this, SITE),
            new Fight(this, SITE)
        );
    }

    override recoveryAnchor(): Tile | null {
        // Why: the wedge guard walks to this anchor, and from a fee-gated camp the bank is out through the dungeon end to end and another payment; inside, the stand is the anchor, so a wedge there restarts the loop in place.
        return SITE.inArea(Game.tile()) ? (SITE.safespots[0] ?? SITE.bank) : SITE.bank;
    }
    override grindTargets(): string[] {
        return huntNames(SITE).map(n => n.toLowerCase());
    }

    setStatus(s: string): void {
        this.status = s;
    }
    /** Suppressed unless logDetail is Verbose, so the log ring keeps what matters. */
    vlog(msg: string): void {
        if (VERBOSE) {
            this.log(msg);
        }
    }
    parkFor(reason: string): void {
        if (this.parked) {
            return;
        }
        this.parked = true;
        this.parkReason = reason;
        this.setStatus('parked');
        this.log(`PARKED: ${reason}`);
    }
    style(): Style {
        return STYLE;
    }
    foodName(): string {
        return FOOD_NAME;
    }
    foodWithdraw(): number {
        return FOOD_WITHDRAW;
    }
    pickWeapon(available: readonly string[]): void {
        if (!WEAPON_PICKED) {
            return;
        }
        const attack = Skills.level('attack');
        const chosen = bestMeleeWeapon(available, { attack, preferStab: SITE.fireAtRange === true, unusable: unusableWeapons });
        if (chosen === null) {
            this.parkFor(`no melee weapon the character can wield at ${attack} Attack is in the bank, the pack or worn. Deposit one and resume.`);
            return;
        }
        if (chosen !== WEAPON) {
            this.log(`weapon: ${chosen}, the best on hand at ${attack} Attack${SITE.fireAtRange === true ? ', stab first for the metal dragons' : ''}`);
            WEAPON = chosen;
        }
    }
    weaponName(): string {
        return WEAPON;
    }
    ammoName(): string {
        return AMMO;
    }
    spellName(): string {
        return SPELL;
    }
    keepExtra(): string[] {
        return [...keepDoses(potionDoseNames(), ANTIPOISON_DOSES, ANTIPOISON_WANT > 0), ...(ANTIFIRE_WANT > 0 ? ANTIFIRE_DOSES : []), ...(PRAYER_WANT > 0 ? PRAYER_DOSES : []), ...(AXE === '' ? [] : [AXE])];
    }
    leaveByWalk(): boolean {
        return LEAVE_WALK;
    }
    hpFraction(): number {
        return hpFrac();
    }
    panicHp(): number {
        return PANIC_HP;
    }
    retreatHp(): number {
        return RETREAT_HP;
    }
    hasFood(): boolean {
        return hasFood();
    }
    needEat(): boolean {
        return needEat();
    }
    eatOnce(): Promise<boolean> {
        return eatOnce(this);
    }
    /** Mage and range never reach a dragon to spend it on, and a weapon with no specwep param has no bar to click. */
    async armSpecial(): Promise<void> {
        if (!USE_SPECIAL || STYLE !== 'melee' || Special.armed()) {
            return;
        }
        if (!Special.ready(WEAPON) || !Equipment.contains(WEAPON)) {
            return;
        }
        if (await Special.arm()) {
            this.specials++;
            this.vlog(`special armed (${Special.energy()} energy left)`);
        }
    }
    buryBones(): boolean {
        return BURY_BONES;
    }
    boneName(): string {
        return SITE.bones;
    }
    safespotIndex(): number {
        return this.safespotIdx;
    }
    setSafespotIndex(n: number): void {
        this.safespotIdx = n;
    }
    countKill(): void {
        this.killsTotal++;
    }
    countBurial(): void {
        this.buried++;
    }
    countSip(): void {
        this.sips++;
    }
    countLoot(name?: string | null): void {
        this.looted++;
        if (name) {
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + 1);
        }
    }
    countBankTrip(): void {
        this.bankTrips++;
    }

    // Why: a completed trip with no food is the one state the run cannot fix from inside, so it stops at the booth instead of walking back unable to heal.
    // Why: a supply latch is survivable by comparison, and a full pack forces the next trip, which is where that one clears.

    /** What the last bank trip came back with. */
    noteTrip(food: boolean, supplies: boolean): void {
        this.bankEmpty = !food;
        this.supplyEmpty = !supplies;
        if (!food) {
            this.parkFor(`no '${FOOD_NAME}' left in the bank after a full trip. The run stopped at the booth rather than walk back to the dragons with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.`);
        }
    }
    bankKnownEmpty(): boolean {
        return this.bankEmpty;
    }
    supplyKnownEmpty(): boolean {
        return this.supplyEmpty;
    }

    /** The wireframe box around whatever the fight loop is watching. */
    outlineTarget(ctx: CanvasRenderingContext2D): void {
        if (this.targetIdx === null) {
            return;
        }
        const box = reader.npcBox(this.targetIdx);
        if (!box) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 224, 64, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        const edge = (a: number, b: number): void => {
            ctx.beginPath();
            ctx.moveTo(box[a].x, box[a].y);
            ctx.lineTo(box[b].x, box[b].y);
            ctx.stroke();
        };
        for (let i = 0; i < 4; i++) {
            edge(i, (i + 1) % 4);
            edge(4 + i, 4 + ((i + 1) % 4));
            edge(i, 4 + i);
        }
        ctx.restore();
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        this.outlineTarget(ctx);
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveDragons',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: SOLVE_CLUES ? ['Overview', 'Combat', 'Levels', 'Loot', 'Clue'] : ['Overview', 'Combat', 'Levels', 'Loot']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;

        if (page === 'Options') {
            // Why: the site name runs past a half-width cell, so it takes a row of its own.
            p.statGrid([[{ text: `Site: ${SITE.label}` }]], 1);
            p.statGrid([
                [{ text: `Style: ${STYLE}` }, { text: `Weapon: ${WEAPON}` }],
                [{ text: `Food: ${FOOD_NAME}` }, { text: `Escape: ${ESCAPE_LABEL}` }],
                [{ text: `Bury bones: ${BURY_BONES ? 'on' : 'off'}` }, { text: `Clues: ${SOLVE_CLUES ? 'on' : 'off'}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Kills: ${this.killsTotal}` }],
                [{ text: `Kills/hr: ${mins > 0.5 ? Math.round((this.killsTotal / mins) * 60) : 'n/a'}` }, { text: `Trips: ${this.bankTrips}` }],
                // Why: a site with no key item never leaves 'held', so the cell would read as a key the run does not carry.
                [{ text: `Spot: ${anchorFor(SITE, STYLE, this.safespotIdx)}` }, ...(SITE.keyItem === null ? [] : [{ text: `Key: ${this.keyState}` }])]
            ]);
            p.bar('HP', this.hpFraction());
        } else if (section === 'Combat') {
            const supply = STYLE === 'mage' ? `Casts: ${castsLeft()}`
                : STYLE === 'range' ? `Ammo: ${ammoLeft()}`
                    : `Shield: ${Equipment.contains(SHIELD) ? 'on' : 'off!'}`;
            const spec = USE_SPECIAL && STYLE === 'melee' ? `${Math.round(Special.energy() / 10)}% (${this.specials})` : 'off';
            const boost = (plan: PotionPlan): { text: string } => {
                const sk = plan.potion.skill;
                return { text: `${plan.potion.short} +${Math.max(0, Skills.effective(sk) - Skills.level(sk))} (${potionsHeld(plan)})` };
            };
            p.statGrid([
                [{ text: `Style: ${STYLE}` }, { text: `Weapon: ${WEAPON}` }],
                [{ text: supply }, { text: `Spec: ${spec}` }],
                [{ text: `Food: ${foodCount()}` }, { text: `Sips: ${this.sips}` }],
                ...(POTIONS.length > 0 ? [POTIONS.map(boost)] : []),
                ...(ANTIFIRE_WANT > 0 ? [[{ text: `Antifire: ${antifire.ticksLeft() > 0 ? `${Math.round(antifire.ticksLeft() * 0.6)}s` : 'lapsed'}` }, { text: `Doses: ${antifireHeld()}` }]] : [])
            ]);
        } else if (section === 'Levels') {
            paintLevels(p, this.xp.gains(), mins, CONTROL_ROWS);
        } else if (section === 'Loot') {
            // Why: a p.list would draw from the panel edge and paint over the rail labels, so the drops go through the grid like every other row.
            const top = [...this.lootCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, LOOT_SHOWN)
                .map(([name, n]) => ({ text: `${n}x ${name}` }));
            p.statGrid([[{ text: `Looted: ${this.looted}` }, { text: `Buried: ${this.buried}` }], ...inPairs(top)]);
        } else if (section === 'Clue') {
            p.statGrid([[{ text: `Solved: ${this.cluesSolved}` }, { text: `Clue: ${this.solveClue?.clueStatus() ?? 'idle'}` }]]);
            paintClueProgress(p, 'no clue in progress, grinding');
        }

        if (this.parked) {
            // Why: the controls are drawn after this, so the reason takes only the rows that still leave them inside the panel.
            const room = Math.max(0, Math.min(PARK_ROWS, p.rowsLeft() - CONTROL_ROWS));
            const lines = wrapText(this.parkReason, p.cols(), 2);
            for (const [i, line] of lines.slice(0, room).entries()) {
                p.text(i === room - 1 && lines.length > room ? `${line}…` : line, PARK_FG);
            }
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
