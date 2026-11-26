import { configuredLootNames } from '../../api/bank/bankRules.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game, waitForPlayerTile } from '../../api/game/Game.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import {
    COMBAT_STYLE_OPTIONS,
    RANGE_STYLE_OPTIONS,
    describeCombatStyle,
    parseRangeStyle,
    resolveSplitCombatSettings,
    tryParseCombatStyle,
    type MeleeCombatStyle
} from '../../api/combat/CombatStyle.js';
import { attackRangeFor, bodyOrigin, gapTo } from '../../api/combat/hunting/logic.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { foodHealAmount } from '../../api/combat/food.js';
import { Special } from '../../api/combat/Special.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Skills } from '../../api/skills/Skills.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { BankTeleport, BANK_TELEPORT_OPTIONS, bankTeleportSupplies } from '../../api/bank/BankTeleport.js';
import { dragonMeleeStyle } from '../../api/combat/dragonStyle.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { nearestBankReachable, BANK_LOCATIONS, bankUnlocked, type BankLocation } from '../../api/bank/BankLocations.js';
import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { GroundItems, type GroundItem } from '../../api/grounditems/GroundItems.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { matchesEntityName } from '../../api/query/Query.js';
import { SettingsStore, type SettingsSchema } from '../../runtime/Settings.js';
import { restockTravelSupplies, type TravelSupply } from './travelSupplies.js';
import Tile from '../../geometry/Tile.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic } from '../../api/inventory/packRules.js';
import {
    autoBankEnabled,
    BANKING_OPTIONS,
    BANK_LOCATION_OPTIONS,
    shouldBankAfterMinutes,
    BURIAL_BONE_NAME,
    LEVELER_REGULAR_BONE_LIMIT,
    CUSTOM_COORDINATES,
    DEFAULT_CUSTOM_SPOT,
    DEFAULT_LOOT,
    isBurialBone,
    resolveKillingSpot,
    shouldBuryRegularBones,
    autoRetaliateShouldEnable,
    assertAutoRetaliateOn,
    shouldArmSpecial,
    specialAvailable,
    SPOT_OPTIONS,
    START_POSITION,
    wantsAutoFighterLoot
} from './AutoFighterData.js';
import { clueRequirements, missingClueRequirements } from '../../api/ai/clues/requirements.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { SolveClue } from '../../api/ai/clues/SolveClue.js';
import { paintClueProgress } from '../../api/ai/clues/cluePaint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { Reach } from '../../api/walking/Reach.js';
import { RANDOM_EVENT_CASKET_ID } from '../../api/bank/Banking.js';
import { scriptFood, suppliesOf } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING, selectedLoadout } from '../../api/loadout/loadoutSetting.js';
import { HERBS, HERB_OPTIONS } from '../../data/herbs.js';
import { FighterPotions, fighterPotionPlans } from './potions.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const KIT = ['spade', 'sextant', 'watch', 'chart'];
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'];
const STALL_REATTACK_MS = 12_000;
export const SPELL_RESUPPLY = 'Insufficient runes for spell training';
// Why: a drop the server never lets us take would otherwise pin the loot task forever; only give up after the same item and tile have failed this long.
const LOOT_STUCK_MS = 30_000;
// Why: a cooldown lets the drop return later (another bot may have moved it) without spinning on it now.
const LOOT_SKIP_MS = 30 * 60_000;

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };
const SHOW_MAGE_RANGE = { key: 'combatStyle', anyOf: ['mage', 'range'] };
const SHOW_MELEE_RANGE = { key: 'combatStyle', anyOf: ['melee', 'range'] };
const POTION_HELP = 'Drink in combat when the boost falls to 10% above base. Restock the selected bottle count on bank trips using any dose size.';

export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Guard', label: 'Target NPC name(s)', help: 'comma-separated exact in-game names to fight, e.g. Guard, Knight, Moss giant' },
    spot: { type: 'string', default: START_POSITION, options: SPOT_OPTIONS, label: 'Killing spot', help: 'use the tile where the script starts, or walk to custom coordinates' },
    coordinates: { type: 'tile', default: DEFAULT_CUSTOM_SPOT, label: 'Killing coordinates (x,z)', showIf: { key: 'spot', anyOf: [CUSTOM_COORDINATES] } },
    leashRadius: { type: 'number', default: 8, min: 2, max: 30, label: 'Leash radius (tiles)' },
    combatStyle: {
        type: 'string',
        default: 'melee',
        options: ['melee', 'mage', 'range'],
        label: 'Combat style',
        help:
            'melee / mage / range. Older saves that stored attack/strength/controlled/defence under this key are migrated to Melee style.'
    },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE, help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    useSpecial: { type: 'boolean', default: true, label: 'Use special attacks', group: 'Combat', showIf: SHOW_MELEE_RANGE, help: 'arms the spec bar whenever energy covers the wielded weapon\'s special (dragon dagger, dragon longsword, magic shortbow, …); does nothing with a weapon that has no special' },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE, help: 'kept armed via autocast — a staff must be wielded' },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE, help: 'the bot tops runes up to this many casts of the selected spell; runes the wielded staff provides free are skipped' },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Bronze arrow', label: 'Ammo (withdrawn from bank)', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },
    ammoRestockBelow: { type: 'number', default: 25, min: 0, max: 100, label: 'Bank for ammo below %', group: 'Combat', showIf: SHOW_MAGE_RANGE, help: 'when not banking for food, go bank once magic casts / ranged ammo drop below this percentage of a full trip' },
    useSuperAttack: { type: 'boolean', default: false, label: 'Use super attack', group: 'Combat', showIf: SHOW_MELEE, help: POTION_HELP },
    superAttackCount: { type: 'number', default: 1, min: 1, max: 27, label: 'Super attack bottles per trip', group: 'Combat', showIf: { key: 'useSuperAttack', anyOf: ['true'] }, help: 'Total bottles to carry, including partial bottles. Overrides the loadout quantity; limited by food and inventory space.' },
    useSuperStrength: { type: 'boolean', default: false, label: 'Use super strength', group: 'Combat', showIf: SHOW_MELEE, help: POTION_HELP },
    superStrengthCount: { type: 'number', default: 1, min: 1, max: 27, label: 'Super strength bottles per trip', group: 'Combat', showIf: { key: 'useSuperStrength', anyOf: ['true'] }, help: 'Total bottles to carry, including partial bottles. Overrides the loadout quantity; limited by food and inventory space.' },
    useSuperDefence: { type: 'boolean', default: false, label: 'Use super defence', group: 'Combat', help: POTION_HELP },
    superDefenceCount: { type: 'number', default: 1, min: 1, max: 27, label: 'Super defence bottles per trip', group: 'Combat', showIf: { key: 'useSuperDefence', anyOf: ['true'] }, help: 'Total bottles to carry, including partial bottles. Overrides the loadout quantity; limited by food and inventory space.' },
    loadout: LOADOUT_SETTING,
    food: { type: 'string', default: '', label: 'Food to eat', help: 'exact item name to eat (e.g. Shark, Monkfish, Trout). Leave blank to use the loadout’s food, falling back to Trout' },
    foodWithdraw: { type: 'number', default: 10, min: 0, max: 27, label: 'Food to carry' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, label: 'Loot item names (exact)', help: 'exact item names, case-insensitive; defaults to gem-table items + clue scrolls, nothing else', csvToggle: 'lootMode' },
    lootMode: {
        type: 'string',
        default: 'list',
        options: ['list', 'csv'],
        optionLabels: { list: 'List (chips)', csv: 'CSV (text + copy/paste)' },
        label: 'Loot entry mode',
        help: 'List = add items one at a time (current). CSV = paste a comma-separated list with copy/paste buttons.'
    },
    avoidHerbs: { type: 'string[]', default: [], options: HERB_OPTIONS, label: 'Herbs to avoid', group: 'Banking & loot', help: 'pick herbs to never pick up; matched by item id for grimy and cleaned forms, since every grimy herb reads as "Herb"' },
    buryBones: { type: 'boolean', default: false, label: 'Bury regular bones', group: 'Banking & loot', help: 'pick up and bury regular Bones for Prayer XP (always looted when on)' },
    buryBigBones: { type: 'boolean', default: false, label: 'Bury big bones', group: 'Banking & loot', help: 'pick up and bury Big bones for Prayer XP, independently of regular bones (always looted when on)' },
    buryBabyDragonBones: { type: 'boolean', default: false, label: 'Bury baby dragon bones', group: 'Banking & loot', help: 'pick up and bury Babydragon bones for Prayer XP (always looted when on)' },
    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues' },
    banking: { type: 'string', default: 'Auto', options: BANKING_OPTIONS, label: 'Banking', help: 'Auto = bank loot at the nearest bank and return; None = no loot-only bank trips' },
    bankLocation: { type: 'string', default: 'Nearest', options: BANK_LOCATION_OPTIONS, label: 'Bank location', group: 'Banking & loot', help: 'Nearest = closest reachable unlocked bank; a named bank forces that stand (locked banks fall back to nearest). Used for loot, food, supplies, and panic retreats.' },
    bankTeleport: { type: 'string', default: 'Off', options: BANK_TELEPORT_OPTIONS, label: 'Bank teleport', group: 'Banking & loot', help: 'Keep and restock one escape cast for banking and retreats. Walk when the spell or runes are unavailable.' },
    travelCoins: { type: 'number', default: 0, min: 0, max: 200000, label: 'Travel coins per trip', group: 'Banking & loot', help: 'Restore this many coins at each bank visit for fares and entrance fees.' },
    travelItems: { type: 'string[]', default: [], label: 'Travel items', group: 'Banking & loot', help: 'Keep one of each item and replace it from the bank before returning to camp.' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots', showIf: { key: 'banking', anyOf: ['Auto'] } },
    bankEveryMinutes: {
        type: 'number',
        default: 0,
        min: 0,
        max: 120,
        label: 'Bank every N minutes',
        help: '0 = never. Same idea as CowKiller: walk loot to the bank after this many minutes so a death does not wipe a long session.',
        showIf: { key: 'banking', anyOf: ['Auto'] },
        group: 'Banking & loot'
    },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank common junk too' }
};

let TARGET = 'Guard';

function targetNames(): string[] {
    return TARGET.split(',').map(s => s.trim()).filter(Boolean);
}
let ANCHOR = DEFAULT_CUSTOM_SPOT;
let LEASH = 8;
let FOOD = 'Trout';
let FOOD_WITHDRAW = 10;
let PANIC_AT = 0.25;
let LOOT = DEFAULT_LOOT;
let BURY_BONES = false;
let BURY_BONES_BELOW = 0;
let BURY_BIG_BONES = false;
let BURY_BABY_DRAGON_BONES = false;
let SOLVE_CLUES = true;
let BANK_AT = 12;
let BANK_EVERY_MINUTES = 0;
let AUTO_BANK = true;
let BANK_COMMON = true;
let BANK_LOCATION = 'Nearest';
let STYLE: 'melee' | 'mage' | 'range' = 'melee';
let MELEE_STYLE: MeleeCombatStyle = 'strength';
let BANK_TELEPORT = 'Off';
let USE_SPECIAL = true;
let RANGE_MODE = 1;
let SPELL = 'Fire Strike';
let RUNES_WITHDRAW = 150;
let AMMO = 'Bronze arrow';
let AMMO_WITHDRAW = 500;
let AMMO_RESTOCK_BELOW = 0.25;
let TRACKED_GEAR: string[] = [];
let AVOID_HERB_IDS = new Set<number>();

/** The forced bank named by AutoFighter.bankLocation, or null for Nearest. */
function forcedBank(): BankLocation | null {
    return BANK_LOCATION === 'Nearest' ? null : (BANK_LOCATIONS.find(b => b.name === BANK_LOCATION) ?? null);
}

/** Bank this bank trip uses: the forced named bank when unlocked, else nearest. */
async function pickBank(here: WorldTile | null): Promise<BankLocation | null> {
    const forced = forcedBank();
    if (here && forced && bankUnlocked(forced)) {
        return forced;
    }
    return here ? nearestBankReachable(here, Navigator) : null;
}

/**
 * Open whichever bank the bot just walked to: a teller behind a conversation
 * (Mage Arena), a chest (Shantay / Duel Arena), or a plain Bank booth.
 */
async function openBank(bank: BankLocation, log: (m: string) => void): Promise<boolean> {
    if (bank.npcAccess) {
        return Bank.openNpcAccess(bank.npcAccess, log);
    }
    if (bank.access) {
        return Bank.openNearestAccess(bank.access, log);
    }
    return Bank.openNearest(BOOTH.name, BOOTH.op, log);
}

function isAvoidedHerb(id: number): boolean {
    return AVOID_HERB_IDS.has(id);
}

function foodCount(): number {
    return countMatching(Inventory.items(), [FOOD]);
}
function needEat(): boolean {
    return shouldEat(Skills.effective('hitpoints'), Skills.level('hitpoints'), foodHealAmount(FOOD), foodCount());
}
function buryRegularBones(): boolean {
    return BURY_BONES && (!BURY_BONES_BELOW || Skills.level('prayer') < BURY_BONES_BELOW);
}
function isLoot(name: string | null): boolean {
    return wantsAutoFighterLoot(name, LOOT, buryRegularBones(), BURY_BIG_BONES, BURY_BABY_DRAGON_BONES);
}
function burialBones() {
    return Inventory.items().filter(item => !item.noted && isBurialBone(item.name, buryRegularBones(), BURY_BIG_BONES, BURY_BABY_DRAGON_BONES)
        && item.actions().some(action => action.toLowerCase() === 'bury'));
}
/** The wielded weapon when it carries a special this bot may arm, else ''. */
function specWeapon(): string {
    const weapon = Special.wielded();
    return specialAvailable(USE_SPECIAL, STYLE, Special.cost(weapon)) ? weapon : '';
}
function specialNeedsAmmo(): boolean {
    return Special.wielded().toLowerCase() === 'magic shortbow' && (Equipment.items().find(item => item.slot === 13)?.count ?? 0) < 2;
}
function specialDue(): boolean {
    if (specialNeedsAmmo()) return Special.armed();
    return shouldArmSpecial(USE_SPECIAL, STYLE, Special.cost(Special.wielded()), Special.energy(), Special.armed());
}
// Why: arming is one-shot, the next attack spends it and the engine clears the flag, so it is re-armed per special.
async function armSpecial(bot: AutoFighter): Promise<boolean> {
    if (specialNeedsAmmo()) {
        if (!Special.armed() || !(await Special.disarm())) return false;
        bot.resumeAttack = true;
        return true;
    }
    const weapon = Special.wielded();
    if (!specialDue() || !(await Special.arm())) {
        return false;
    }
    bot.countSpecial();
    bot.log(`special armed with ${weapon} (bar at ${Math.round(Special.energy() / 10)}%, spent on the next hit)`);
    return true;
}
function wieldedNames(): string[] {
    return Equipment.items().map(i => i.name ?? '');
}
function castsLeft(): number {
    const escape = bankTeleportSupplies(BANK_TELEPORT);
    return castsAvailable(SPELL, wieldedNames(), rune => Math.max(0, Inventory.count(rune) - (escape.find(need => need.item === rune)?.count ?? 0)));
}
function wieldedAmmo(): number {
    return Equipment.items().find(i => (i.name ?? '').toLowerCase() === AMMO.toLowerCase())?.count ?? 0;
}
function totalAmmo(): number {
    return Inventory.count(AMMO) + wieldedAmmo();
}
function restockThreshold(): number {
    return Math.max(1, Math.floor(AMMO_RESTOCK_BELOW * (STYLE === 'mage' ? RUNES_WITHDRAW : AMMO_WITHDRAW)));
}
function supplyMetric(): number {
    return STYLE === 'mage' ? castsLeft() : totalAmmo();
}
function needStyleSupplies(): boolean {
    return STYLE !== 'melee' && supplyMetric() < restockThreshold();
}
function fullyOutOfSupplies(): boolean {
    if (STYLE === 'melee') {
        return false;
    }
    return supplyMetric() === 0;
}

export function shouldKeepBankItem(name: string, id: number, food: string, bankCommon: boolean, ammo: string[] = [], gear: string[] = [], buryBones = false, buryBigBones = false, buryBabyDragonBones = false): boolean {
    const n = name.toLowerCase();
    const genericCasket = id === RANDOM_EVENT_CASKET_ID;
    const ammoMatch = ammo.some(a => a.toLowerCase() === n);
    const gearMatch = gear.some(g => g.toLowerCase() === n);
    return matchesAny(name, [food]) || n === 'coins' || KIT.includes(n) || n.includes('clue')
        || (n.includes('casket') && !genericCasket) || (genericCasket && !bankCommon)
        || ammoMatch || gearMatch || isBurialBone(name, buryBones && id === 526, buryBigBones && id === 532, buryBabyDragonBones && id === 534);
}

export default class AutoFighter extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private betweenFights = false;
    private opponent: { index: number; id: number } | null = null;
    private looted = 0;
    private buried = 0;
    private specials = 0;
    private eats = 0;
    private trips = 0;
    private deaths = 0;
    private cluesSolved = 0;
    private solveClue: SolveClue | undefined;
    bankAfterSolve = false;
    bankFoodEmpty = false;
    private supplyEmpty = false;
    travelSupplies: TravelSupply[] = [];
    potions = new FighterPotions([], message => this.log(message));
    private status = 'starting';
    private readonly fight = new Fight(this);
    private startedAt = Date.now();
    private lastBankAt = Date.now();
    private xpAtStart = 0;
    private combatXpLast = 0;
    private combatXpGainAt = 0;
    died = false;
    resumeAttack = true;

    override async onStart(): Promise<void> {
        await waitForPlayerTile();

        TARGET = this.settings.str('target', 'Guard').trim() || 'Guard';
        const spotMode = this.settings.str('spot', START_POSITION);
        ANCHOR = resolveKillingSpot(spotMode, Tile.from(Game.tile()!), this.settings.tile('coordinates', DEFAULT_CUSTOM_SPOT));
        LEASH = this.settings.num('leashRadius', 8);
        FOOD = this.settings.str('food', '').trim() || scriptFood(this.settings, 'Trout');
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 10);
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        LOOT = configuredLootNames(this.settings.list('loot', DEFAULT_LOOT));
        AVOID_HERB_IDS = new Set(
            HERBS
                .filter(h => this.settings.list('avoidHerbs', []).includes(h.name))
                .flatMap(h => [h.id, h.unidId])
        );
        BURY_BONES = this.settings.bool('buryBones', false);
        BURY_BONES_BELOW = this.delegated ? LEVELER_REGULAR_BONE_LIMIT : 0;
        BURY_BIG_BONES = this.settings.bool('buryBigBones', false);
        BURY_BABY_DRAGON_BONES = this.settings.bool('buryBabyDragonBones', false);
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        BANK_EVERY_MINUTES = this.settings.num('bankEveryMinutes', 0);
        AUTO_BANK = autoBankEnabled(this.settings.str('banking', 'Auto'));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        BANK_LOCATION = this.settings.str('bankLocation', 'Nearest');
        const forced = forcedBank();
        if (forced) {
            if (bankUnlocked(forced)) {
                this.log(`bank location: ${forced.name} (forced)`);
            } else {
                this.log(`bank location: ${forced.name} is locked — falling back to the nearest bank`);
            }
        } else {
            this.log('bank location: nearest unlocked bank');
        }
        // Why: pre-#195 saves stored attack/strength/controlled/defence in combatStyle.
        // Why: settings option validation coerces those to the default "melee" and leaves meleeStyle at strength, so Defence and the rest are ignored (#461).
        const rawCombatStyle = this.delegated ? this.settings.str('combatStyle', 'melee') : SettingsStore.displayString('AutoFighter', 'combatStyle', SETTINGS.combatStyle!);
        const rawMeleeStyle = this.delegated ? this.settings.str('meleeStyle', 'strength') : SettingsStore.saved('AutoFighter', 'meleeStyle');
        const split = resolveSplitCombatSettings(rawCombatStyle, rawMeleeStyle);
        STYLE = split.kind;
        MELEE_STYLE = split.meleeStyle;
        BANK_TELEPORT = this.settings.str('bankTeleport', 'Off');
        if (!this.delegated && split.legacyMigrated !== null) {
            SettingsStore.save('AutoFighter', 'combatStyle', 'melee');
            SettingsStore.save('AutoFighter', 'meleeStyle', split.legacyMigrated);
            this.log(`migrated legacy combatStyle='${rawCombatStyle.trim()}' → meleeStyle='${split.legacyMigrated}'`);
        } else if (!this.delegated && tryParseCombatStyle(rawCombatStyle) !== null) {
            // storage still has a training-style value but meleeStyle already set, rewrite combatStyle only
            SettingsStore.save('AutoFighter', 'combatStyle', 'melee');
        }
        USE_SPECIAL = this.settings.bool('useSpecial', true);
        SPELL = this.settings.str('spell', 'Fire Strike');
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        AMMO = this.settings.str('ammo', 'Bronze arrow');
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        AMMO_RESTOCK_BELOW = this.settings.num('ammoRestockBelow', 25) / 100;
        this.potions = new FighterPotions(fighterPotionPlans(this.settings, STYLE, suppliesOf(selectedLoadout(this.settings))), message => this.log(message));
        TRACKED_GEAR = Equipment.items().map(i => i.name ?? '').filter(n => n.length > 0);
        const coins = Math.max(0, Math.floor(this.settings.num('travelCoins')));
        this.travelSupplies = [...(coins ? [{ item: 'Coins', count: coins }] : []),
            ...this.settings.list('travelItems').filter(item => item.trim().length > 0 && item.toLowerCase() !== 'coins').map(item => ({ item, count: 1 }))];

        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.cluesSolved++;
                }
                if (s === 'clue solved' || s === 'clue abandoned') this.bankAfterSolve = true;
                if (s === 'clue requirements needed' && this.delegated) this.requestFinish('Clue retained for prerequisite training');
                this.setStatus(s);
            },
            beforeStep: id => {
                if (!this.delegated || !this.settings.bool('prepareClueRequirements', false)) return undefined;
                if (this.settings.num('abandonClueId', -1) === id || !this.settings.bool('allowClueWilderness', true) && clueRequirements(id).wilderness) return 'abandon';
                const requirements = missingClueRequirements(id, {
                    levels: Object.fromEntries(Object.keys(clueRequirements(id).skills).map(skill => [skill, Skills.level(skill)])),
                    quests: Object.fromEntries(Quests.all().map(quest => [quest.name, quest.status === 'complete']))
                });
                return requirements.quests.length || Object.keys(requirements.skills).length ? 'prepare' : undefined;
            },
            isFood: n => matchesAny(n, [FOOD]),
            foodName: () => FOOD,
            foodWithdraw: () => FOOD_WITHDRAW,
            enabled: () => SOLVE_CLUES,
            retryAbandoned: this.delegated,
            discardAbandoned: this.delegated
        });

        Sustain.set(async () => {
            // Why: while the bank is open Inventory exposes the bank-side items (Deposit ops),
            // so 'Eat' fails and the sustain loop spins instead of healing. Eat after banking.
            if (Bank.isOpen()) {
                return;
            }
            if (needEat()) {
                const food = Inventory.items().find(i => matchesAny(i.name, [FOOD]));
                if (food) {
                    const before = Skills.effective('hitpoints');
                    if (await food.interact('Eat')) {
                        this.resumeAttack = true;
                        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
                    }
                }
            }
        });

        this.setStatus(`looking for ${TARGET}`);
        this.startedAt = Date.now();
        this.lastBankAt = this.startedAt;
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);
        this.combatXpLast = this.combatXpTotal();
        this.combatXpGainAt = Date.now();
        this.log(`AutoFighter starting — '${targetNames().join(', ')}' at ${spotMode} ${ANCHOR} r${LEASH}, style ${STYLE}${STYLE === 'mage' ? ` (${SPELL}, ${RUNES_WITHDRAW} casts)` : STYLE === 'range' ? ` (${RANGE_MODE === 0 ? 'accurate' : RANGE_MODE === 1 ? 'rapid' : 'longrange'}, ${AMMO}x${AMMO_WITHDRAW})` : ` (${MELEE_STYLE})`}, banking ${AUTO_BANK ? 'auto' : 'none'}${BANK_EVERY_MINUTES > 0 ? ` every ${BANK_EVERY_MINUTES}m` : ''} at ${BANK_LOCATION}, food '${FOOD}'x${FOOD_WITHDRAW}, loot [${LOOT.join(', ')}]${buryRegularBones() ? `, burying ${BURIAL_BONE_NAME}` : ''}${BURY_BIG_BONES ? ', burying Big bones' : ''}${BURY_BABY_DRAGON_BONES ? ', burying Babydragon bones' : ''}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(() => this.setStatus('continuing dialogue')),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.deaths++;
                    this.solveClue?.noteDeath();
                    this.log('died! waiting for respawn, then walking back to the spot');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new EnableAutoRetaliate(this),
            new EatFood(this),
            new PanicRetreat(this),
            new DrinkPotions(this),
            new BuryBones(this),
            new LootDrops(this),
            new ReequipGear(this),
            this.solveClue!,
            new BankRun(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new ArmSpecial(this),
            this.fight,
            new ReturnToAnchor(this)
        );
    }

    override async loop(): Promise<number | void> {
        const kills = this.kills;
        await super.loop();
        if (this.kills > kills) return 0;
    }

    override grindTargets(): string[] {
        return targetNames().map(s => s.toLowerCase());
    }
    override recoveryAnchor(): Tile | null {
        return ANCHOR;
    }

    override stallDetails(): string {
        return `${this.status}, camp ${ANCHOR} r${LEASH}, ${this.fight.targetDetails()}`;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fd07f' });
        p.title(`AutoFighter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0) - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';
        if (p.tabs('afg', ['Overview', 'Clue']) === 'Clue') {
            p.row(`Solved: ${this.cluesSolved}`, `Status: ${this.solveClue?.clueStatus() ?? 'idle'}`);
            paintClueProgress(p, 'watching the pack for clues');
        } else {
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
            p.row(STYLE === 'mage' ? `Casts: ${castsLeft()}` : STYLE === 'range' ? `Ammo: ${totalAmmo()}` : `Style: ${MELEE_STYLE}`, `Food: ${foodCount()}`, this.deaths ? `Deaths: ${this.deaths}` : `Trips: ${this.trips}`);
            p.row(`Clues: ${this.cluesSolved}`, `Clue: ${this.solveClue?.clueStatus() ?? 'idle'}`, `Bones: ${this.buried}`);
            if (specWeapon() !== '') {
                p.row(`Spec: ${Math.round(Special.energy() / 10)}%`, `Specials: ${this.specials}`);
            }
            p.bar('HP', Skills.hpFraction());
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    clueInProgress(): boolean {
        return this.bankAfterSolve || !!this.solveClue && (this.solveClue.ownsEquipment() || this.solveClue.validate());
    }
    canLoot(id: number, tile: Tile): boolean {
        return this.solveClue?.canLoot(id, tile) ?? true;
    }
    countKill(): void {
        if (!this.opponent) return;
        this.opponent = null;
        this.resumeAttack = true;
        this.kills++;
        this.betweenFights = true;
    }
    beginFight(npc?: Npc): void {
        this.betweenFights = false;
        this.opponent = npc ? { index: npc.index, id: npc.id } : null;
    }

    combatActive(): boolean {
        const here = Game.tile();
        const npcs = Npcs.all();
        const alive = (npc: Npc): boolean => !(npc.health === 0 && npc.snap.totalHealth > 0);
        if (!this.died && !EventSignal.pending() && Game.sceneReady() && here && ANCHOR.distanceTo(here) <= LEASH + 4) {
            if (this.opponent) {
                const { index, id } = this.opponent;
                const current = npcs.find(npc => npc.index === index && npc.id === id);
                if (!current || !alive(current)) this.countKill();
            }
            if (!this.opponent && Game.inCombat()) {
                const attacker = npcs.find(npc => alive(npc) && npc.inCombat && npc.targetsMe());
                if (attacker) this.beginFight(attacker);
            }
        }
        if (!Game.inCombat()) return false;
        if (!this.betweenFights) return true;
        const facing = reader.selfFaceEntity();
        if (npcs.some(npc => alive(npc) && npc.targetsMe())) return true;
        const self = reader.selfSlot();
        return self >= 0 && reader.players().some(player => player.index !== self && (player.faceEntity === 32768 + self || facing === 32768 + player.index));
    }

    countLoot(): void { this.looted++; }
    countBurial(): void { this.buried++; }
    countSpecial(): void { this.specials++; }
    countEat(): void { this.eats++; }
    countTrip(): void {
        this.trips++;
        this.lastBankAt = Date.now();
    }
    needsBankBeforeTravel(): boolean {
        return new BankRun(this).reason() !== null;
    }
    minutesSinceBank(): number {
        return (Date.now() - this.lastBankAt) / 60_000;
    }
    noteSupplyEmpty(v: boolean): void { this.supplyEmpty = v; }
    potionDue(): boolean {
        const here = Game.tile();
        return !this.died && !needEat() && Skills.hpFraction() >= PANIC_AT && !ChatDialog.isOpen()
            && this.combatActive() && !!here && Tile.from(here).distanceTo(ANCHOR) <= LEASH && this.potions.due() !== null;
    }

    async sipPotions(): Promise<boolean> {
        if (!this.potionDue()) return false;
        if (!(await this.potions.sip())) return false;
        this.resumeAttack = true;
        return true;
    }

    async restockTravel(): Promise<boolean> {
        const missing = await restockTravelSupplies(this.travelSupplies, {
            count: item => Inventory.count(item),
            withdraw: async (item, target) => { await withdrawTo(item, target); }
        });
        if (!missing) { await BankTeleport.stock(BANK_TELEPORT); return true; }
        await Bank.close();
        this.requestFinish(`Missing travel supply: ${missing}`);
        return false;
    }
    supplyKnownEmpty(): boolean { return this.supplyEmpty; }
    private combatXpTotal(): number {
        return COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);
    }
    markCombatXp(): void {
        const xp = this.combatXpTotal();
        if (xp > this.combatXpLast) {
            this.combatXpLast = xp;
            this.combatXpGainAt = Date.now();
        }
    }
    combatStalled(ms: number): boolean {
        this.markCombatXp();
        return Date.now() - this.combatXpGainAt > ms;
    }
}

class EnableAutoRetaliate implements Task {
    readonly label = 'Enable auto retaliate';
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return autoRetaliateShouldEnable(Game.autoRetaliateOn());
    }
    async execute(): Promise<void> {
        this.bot.setStatus('enabling auto retaliate');
        await Game.openSideTab(0);
        for (let i = 0; i < 5 && !Game.autoRetaliateOn(); i++) {
            Game.setAutoRetaliate(true);
            if (await Execution.delayUntil(() => Game.autoRetaliateOn(), 1500)) {
                break;
            }
        }
        assertAutoRetaliateOn(Game.autoRetaliateOn());
        this.bot.log('Auto Retaliate on');
    }
}

class LootDrops implements Task {
    readonly label = 'Loot drops';
    private skipped = new Map<string, number>();
    private stuck = new Map<string, { first: number; last: number }>();
    constructor(private bot: AutoFighter) {}
    private key(drop: GroundItem): string {
        return `${drop.id}:${drop.tile()}`;
    }
    private find() {
        const now = Date.now();
        for (const [key, until] of this.skipped) {
            if (until <= now) this.skipped.delete(key);
        }
        return GroundItems.query()
            .action('Take')
            .where(g => isLoot(g.name) && !isAvoidedHerb(g.id))
            .where(g => this.bot.canLoot(g.id, g.tile()))
            .where(g => g.tile().distanceTo(ANCHOR) <= LEASH + 4)
            .within(LEASH + 4)
            .where(g => !this.skipped.has(this.key(g)))
            .where(g => Reachability.walkable(g.tile()))
            .nearest();
    }
    validate(): boolean {
        return !this.bot.combatActive() && !Inventory.isFull() && this.find() !== null;
    }
    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        this.bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
        const id = drop.id;
        const tile = drop.tile();
        const key = this.key(drop);
        const find = () => GroundItems.query()
            .where(item => item.id === id && item.tile().equals(tile))
            .nearest();
        const count = () => Inventory.items().reduce((sum, item) => sum + (item.id === id ? item.count : 0), 0);
        const before = count();
        const status = await Reach.entityOp({
            find,
            op: 'Take',
            expect: () => count() > before,
            expectMs: 5000,
            what: drop.name ?? 'loot',
            log: message => this.bot.log(message)
        });
        if (status === 'done' && count() > before) {
            this.skipped.delete(key);
            this.stuck.delete(key);
            this.bot.countLoot();
            return;
        }
        const now = Date.now();
        if (status === 'unreachable') {
            this.stuck.delete(key);
            this.skipped.set(key, now + LOOT_SKIP_MS);
            this.bot.log(`blacklisting unreachable loot '${drop.name}' id=${id} at ${tile} for ${LOOT_SKIP_MS / 1000}s`);
            return;
        }
        const prev = this.stuck.get(key);
        const started = prev && now - prev.last <= LOOT_STUCK_MS ? prev.first : now;
        this.stuck.set(key, { first: started, last: now });
        if (now - started < LOOT_STUCK_MS) {
            this.bot.log(`loot '${drop.name}' id=${id} at ${tile} did not complete (${status}); still trying`);
            return;
        }
        this.stuck.delete(key);
        this.skipped.set(key, now + LOOT_SKIP_MS);
        this.bot.log(
            `blacklisting loot '${drop.name}' id=${id} at ${tile} for ${LOOT_SKIP_MS / 1000}s after ${LOOT_STUCK_MS / 1000}s stuck (${status})`
        );
    }
}

class EatFood implements Task {
    readonly label = 'Eat food';
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        // Why: the bank side shows Deposit ops rather than Eat, so eating with the bank open spins forever and blocks BankRun. Wait for the bank to close.
        return needEat() && !Bank.isOpen();
    }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return;
            }
            if (!needEat()) {
                return;
            }
            const food = Inventory.items().find(i => matchesAny(i.name, [FOOD]));
            if (!food) {
                return;
            }
            this.bot.setStatus(`eating ${food.name} (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
            const before = Skills.effective('hitpoints');
            if (!(await food.interact('Eat'))) {
                return;
            }
            this.bot.resumeAttack = true;
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before || foodCount() === 0, 3000);
            if (Skills.effective('hitpoints') > before) {
                this.bot.countEat();
            }
        }
    }
}

class DrinkPotions implements Task {
    readonly label = 'Drink combat potion';
    constructor(private bot: AutoFighter) {}
    validate(): boolean { return this.bot.potionDue(); }
    async execute(): Promise<void> {
        this.bot.setStatus('drinking combat potion');
        await this.bot.sipPotions();
    }
}

class PanicRetreat implements Task {
    readonly label = 'Panic retreat';
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return shouldPanic(Skills.hpFraction(), PANIC_AT, foodCount());
    }
    async execute(): Promise<void> {
        await BankTeleport.cast(BANK_TELEPORT, message => this.bot.log(message));
        const here = Game.tile();
        const bank = await pickBank(here);
        if (!bank) {
            return;
        }
        this.bot.setStatus('panic: no food — retreating to the bank');
        this.bot.log(`panic retreat at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
        const forced = forcedBank();
        if (forced && bank !== forced) {
            this.bot.log(`bank: ${forced.name} is locked — using ${bank.name} instead`);
        }
        await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) });
        if (await openBank(bank, m => this.bot.log(`  ${m}`))) {
            if (!(await this.bot.restockTravel())) return;
            await restockFood();
        }
        if (foodCount() === 0) {
            this.bot.setStatus('panic: bank empty — waiting for regen');
            await Execution.delayUntil(() => Skills.hpFraction() >= 0.9 || Game.inCombat() || ChatDialog.canContinue() || EventSignal.pending(), 300_000);
        }
        await Bank.close();
    }
}

class BuryBones implements Task {
    readonly label = 'Bury bones';
    constructor(private bot: AutoFighter) {}

    validate(): boolean {
        return (
            !EventSignal.pending() &&
            shouldBuryRegularBones({
                enabled: buryRegularBones() || BURY_BIG_BONES || BURY_BABY_DRAGON_BONES,
                inCombat: this.bot.combatActive(),
                bankOpen: Bank.isOpen(),
                boneCount: burialBones().length,
                inventoryFull: Inventory.isFull()
            })
        );
    }

    async execute(): Promise<void> {
        const bones = burialBones()[0];
        if (!bones) {
            return;
        }
        this.bot.setStatus(`burying ${bones.name?.toLowerCase()}`);
        const before = Inventory.countById(bones.id);
        if (!(await bones.interact('Bury'))) {
            this.bot.log(`could not bury ${bones.name}`);
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.countById(bones.id) < before, 3000)) {
            this.bot.countBurial();
            this.bot.log(`buried ${bones.name}`);
        }
    }
}

class BankRun implements Task {
    readonly label = 'Bank run';
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        const outOfSupplies = fullyOutOfSupplies();
        if (this.bot.combatActive() && !outOfSupplies) {
            return false;
        }
        if (foodCount() > 0) {
            this.bot.bankFoodEmpty = false;
        }
        if (STYLE !== 'melee' && supplyMetric() >= restockThreshold()) {
            this.bot.noteSupplyEmpty(false);
        }
        return this.reason() !== null;
    }

    private keepItems(): (name: string, id: number) => boolean {
        const supplies = [...TRACKED_GEAR, ...this.bot.travelSupplies.map(need => need.item), ...bankTeleportSupplies(BANK_TELEPORT).map(need => need.item), ...this.bot.potions.keepNames()];
        if (STYLE === 'mage') supplies.push(...runeWithdrawList(SPELL, wieldedNames(), 1).map(cost => cost.rune));
        const ammo = STYLE === 'range' ? [AMMO] : [];
        const regular = buryRegularBones();
        return (name, id) => shouldKeepBankItem(name, id, FOOD, BANK_COMMON, ammo, supplies, regular, BURY_BIG_BONES, BURY_BABY_DRAGON_BONES);
    }

    reason(): string | null {
        if (this.bot.bankAfterSolve) return 'clue finished';
        if (STYLE === 'mage' && fullyOutOfSupplies()) return `no casts left for ${SPELL}`;
        if (foodCount() === 0 && FOOD_WITHDRAW > 0 && !this.bot.bankFoodEmpty) return 'out of food';
        if (STYLE !== 'melee' && needStyleSupplies() && !this.bot.supplyKnownEmpty()) return `supplies below threshold (${supplyMetric()} < ${restockThreshold()})`;
        if (!AUTO_BANK) return null;
        const keep = this.keepItems();
        const lootSlots = Inventory.items().filter(item => item.name && isLoot(item.name) && !keep(item.name, item.id)).length;
        if (shouldBank(lootSlots, BANK_AT, Inventory.isFull())) return `${lootSlots} depositable loot slots (${Inventory.isFull() ? 'pack full' : 'loot threshold reached'})`;
        const minutes = this.bot.minutesSinceBank();
        return shouldBankAfterMinutes(AUTO_BANK, BANK_EVERY_MINUTES, minutes, lootSlots)
            ? `time ${minutes.toFixed(1)}m/${BANK_EVERY_MINUTES}m with loot` : null;
    }

    async execute(): Promise<void> {
        const reason = this.reason();
        if (!reason) return;
        this.bot.log(`BankRun triggered: ${reason}`);
        await BankTeleport.cast(BANK_TELEPORT, message => this.bot.log(message));
        const here = Game.tile();
        const bank = await pickBank(here);
        if (!bank) {
            this.bot.bankAfterSolve = false;
            return;
        }
        this.bot.setStatus(this.bot.bankAfterSolve ? 'banking after clue' : 'banking');
        this.bot.log(`banking at the ${bank.name} bank (${bank.tile})`);
        const forced = forcedBank();
        if (forced && bank !== forced) {
            this.bot.log(`bank: ${forced.name} is locked — using ${bank.name} instead`);
        }
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            return;
        }
        if (!(await openBank(bank, m => this.bot.log(`  ${m}`)))) {
            return;
        }
        const keep = this.keepItems();
        await Bank.depositAllMatching((name, id) => !keep(name, id), m => this.bot.log(`  ${m}`));
        if (!(await this.bot.restockTravel())) return;
        await this.bot.potions.restock(Math.max(0, FOOD_WITHDRAW - foodCount()));
        await restockFood();
        if (foodCount() === 0 && FOOD_WITHDRAW > 0) {
            this.bot.bankFoodEmpty = true;
            this.bot.log(`no '${FOOD}' in the bank — fighting on without food (foodless safety disarmed)`);
        }
        await this.restockStyleSupplies();
        this.bot.bankAfterSolve = false;
        this.bot.countTrip();
        if (STYLE === 'mage' && needStyleSupplies() && (this.bot.delegated || fullyOutOfSupplies())) {
            this.bot.setStatus(SPELL_RESUPPLY);
            this.bot.requestFinish(SPELL_RESUPPLY);
            return;
        }
        this.bot.setStatus('heading back to the spot');
        // Why: an open bank left behind blocks eating and fighting at the anchor.
        await Bank.close();
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }

    private async restockStyleSupplies(): Promise<void> {
        if (STYLE === 'melee') {
            this.bot.noteSupplyEmpty(false);
            return;
        }
        if (STYLE === 'mage') {
            this.bot.setStatus('withdrawing runes');
            for (const { rune, count } of runeWithdrawList(SPELL, wieldedNames(), RUNES_WITHDRAW)) {
                const target = count + (bankTeleportSupplies(BANK_TELEPORT).find(need => need.item === rune)?.count ?? 0);
                if (Inventory.count(rune) < target) {
                    const got = await withdrawTo(rune, target);
                    this.bot.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${target})`);
                }
            }
            const after = castsLeft();
            this.bot.log(`runes restocked: ${after} casts left (re-bank threshold ${restockThreshold()})`);
            if (after < restockThreshold()) {
                this.bot.noteSupplyEmpty(true);
                this.bot.log(`Bank has runes for ${after} of the ${restockThreshold()} casts needed for a refill`);
            } else {
                this.bot.noteSupplyEmpty(false);
            }
            return;
        }
        this.bot.setStatus(`restocking ${AMMO}`);
        const got = await withdrawTo(AMMO, AMMO_WITHDRAW);
        if (got > 0) {
            this.bot.log(`withdrew ${got} ${AMMO} (${totalAmmo()} total in quiver + inventory)`);
        }
        if (Inventory.count(AMMO) > 0 && wieldedAmmo() === 0) {
            if (await Equipment.equip(AMMO)) {
                this.bot.log(`equipped ${AMMO} (${wieldedAmmo()} in quiver)`);
            } else {
                this.bot.log(`WARNING: could not equip ${AMMO} — will retry from inventory`);
            }
        }
        const after = totalAmmo();
        if (after < restockThreshold()) {
            this.bot.noteSupplyEmpty(true);
            this.bot.log(`WARNING: bank can't supply ${AMMO} up to ${restockThreshold()} — pausing ammo bank runs (have ${after})`);
        } else {
            this.bot.noteSupplyEmpty(false);
            this.bot.log(`ammo ready: ${after} total (${wieldedAmmo()} quiver, ${Inventory.count(AMMO)} inventory)`);
        }
    }
}

async function restockFood(): Promise<void> {
    const count = Math.min(FOOD_WITHDRAW - foodCount(), Inventory.free());
    if (count <= 0 || EventSignal.pending()) return;
    await Bank.setNoteMode(false);
    await Bank.withdrawX(FOOD, count);
}

async function withdrawTo(name: string, target: number): Promise<number> {
    const start = Inventory.count(name);
    for (let guard = 0; guard < 40 && Inventory.count(name) < target && !Inventory.isFull(); guard++) {
        const before = Inventory.count(name);
        const need = target - before;
        if (need > 10 && (await Bank.withdrawX(name, need))) {
            if (Inventory.count(name) > before) {
                continue;
            }
            break;
        }
        await Bank.withdraw(name, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
            break;
        }
    }
    return Inventory.count(name) - start;
}

class SetAttackStyle implements Task {
    readonly label = 'Set attack style';
    private fails = 0;
    private retryAt = 0;
    private announced = false;
    constructor(private bot: AutoFighter) {}
    private style(): MeleeCombatStyle {
        return dragonMeleeStyle(MELEE_STYLE, Equipment.contains('Dragon longsword') ? 'Dragon longsword' : null, targetNames());
    }
    private selected(): boolean {
        return STYLE === 'range' ? Game.combatMode() === RANGE_MODE : Game.hasCombatStyle(this.style());
    }
    validate(): boolean {
        // Why: com_mode is not persisted, so it is re-asserted whenever it disagrees.
        // Why: style clicks are legal mid-fight, so this does not gate on !inCombat, continuous combat starves an out-of-combat-only assert after DCs or failed first clicks.
        return STYLE !== 'mage' && !this.selected() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        if (STYLE === 'range') {
            Game.setCombatMode(RANGE_MODE);
        } else {
            Game.setCombatStyle(this.style());
        }
        if (await Execution.delayUntil(() => this.selected(), 3000)) {
            this.fails = 0;
            if (!this.announced) {
                this.announced = true;
                if (STYLE === 'range') {
                    this.bot.log(`ranged style set to ${RANGE_MODE === 0 ? 'accurate' : RANGE_MODE === 1 ? 'rapid' : 'longrange'}`);
                } else {
                    const resolution = Game.combatStyleResolution(this.style());
                    this.bot.log(`combat style: ${resolution ? describeCombatStyle(resolution) : this.style()}`);
                }
            }
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`could not set the ${STYLE} attack style (combat tab not ready?) — retrying in 60s`);
        }
    }
}

class ArmAutocast implements Task {
    readonly label = 'Arm autocast';
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        if (STYLE !== 'mage' || Autocast.armed() || Date.now() < this.retryAt) {
            return false;
        }
        if (castsLeft() < 1) {
            return false;
        }
        return Autocast.staffTabAttached();
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`arming autocast: ${SPELL}`);
        if (await Autocast.arm(SPELL, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`WARNING: could not arm autocast for '${SPELL}' — retrying in 60s (check spell/level, and that a staff is wielded).`);
        }
    }
}

// Why: Fight.validate is false while already in combat, so a retaliation fight would never reach the inline arm.
class ArmSpecial implements Task {
    readonly label = 'Arm special';
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return Date.now() >= this.retryAt && specialDue() && (specialNeedsAmmo() || this.bot.combatActive() && !this.bot.resumeAttack);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('arming the special attack');
        if (await armSpecial(this.bot)) {
            this.bot.setStatus(this.bot.resumeAttack ? 'resuming attack' : 'fighting');
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(`WARNING: could not arm the ${Special.wielded()} special (combat tab not ready?) — retrying in 60s`);
        }
    }
}

class ReequipGear implements Task {
    readonly label = 'Reequip gear';
    private lastFailLogAt = 0;
    constructor(private bot: AutoFighter) {}
    private candidates(): string[] {
        const gear = [...TRACKED_GEAR];
        if (STYLE === 'range' && !gear.some(g => g.toLowerCase() === AMMO.toLowerCase())) {
            gear.push(AMMO);
        }
        return gear;
    }
    validate(): boolean {
        if (this.bot.clueInProgress()) return false;
        return this.candidates().some(g => !Equipment.contains(g) && Inventory.first(g) !== null);
    }
    async execute(): Promise<void> {
        for (const item of this.candidates()) {
            if (Equipment.contains(item)) {
                continue;
            }
            const inv = Inventory.first(item);
            if (!inv) {
                continue;
            }
            this.bot.setStatus(`re-equipping ${item}`);
            if (await Equipment.equip(item)) {
                this.bot.log(`equipped ${item}`);
            } else if (Date.now() > this.lastFailLogAt) {
                this.lastFailLogAt = Date.now() + 30_000;
                this.bot.log(`WARNING: could not equip ${item} (not wieldable / no weapon slot?) — retrying`);
            }
        }
    }
}

class Fight implements Task {
    readonly label = 'Fight';
    private skipped = new Map<string, number>();
    private lastAttackAt = -Infinity;
    constructor(private bot: AutoFighter) {}
    private stalled(): boolean {
        return this.bot.combatStalled(STALL_REATTACK_MS) && Date.now() - this.lastAttackAt >= STALL_REATTACK_MS;
    }
    private key(npc: Npc): string { return `${npc.index}:${npc.id}`; }
    private blocked(npc: Npc): string | null {
        if (npc.health === 0 && npc.snap.totalHealth > 0) return 'dead';
        if (npc.targetsAnotherPlayer()) return 'targets another player';
        if (npc.inCombat && !npc.targetsMe()) return 'already in combat';
        if (npc.tile().distanceTo(ANCHOR) > LEASH) return 'outside camp';
        return null;
    }
    targetDetails(): string {
        const query = Npcs.query();
        const names = targetNames();
        if (names.length) query.name(...names);
        const nearest = query.nearest();
        if (!nearest) return `no matching NPC loaded (${TARGET})`;
        let reason = this.blocked(nearest) ?? 'eligible';
        if (!nearest.actions().some(op => op.toLowerCase() === 'attack')) reason = 'no Attack action';
        else if (reason === 'eligible' && !nearest.targetsMe() && (this.skipped.get(this.key(nearest)) ?? 0) > Date.now()) reason = 'temporarily skipped';
        return `nearest ${nearest.name} at ${nearest.tile()} (${reason})`;
    }
    private reachable(npc: Npc): boolean {
        const tile = npc.tile(), here = Game.tile();
        if (!Reachability.probeable(tile)) return true;
        if (STYLE !== 'melee' && here && gapTo(here, npc.networkTile(), npc.size) <= attackRangeFor(STYLE)) {
            const origin = bodyOrigin(npc.networkTile(), npc.size);
            if (Reachability.lineOfSight(here, { ...origin, level: tile.level }, npc.size)) return true;
        }
        return Reachability.canReach(tile, { maxSteps: 2048, adjacentOk: true });
    }
    private skip(npc: Npc, reason: string): void {
        this.skipped.set(this.key(npc), Date.now() + 30_000);
        this.bot.log(`skipping ${npc.name} at ${npc.tile()} for 30s (${reason})`);
    }
    private findTarget() {
        for (const [key, until] of this.skipped) {
            if (until <= Date.now()) this.skipped.delete(key);
        }
        const q = Npcs.query()
            .action('Attack')
            .where(n => !this.blocked(n) && (n.targetsMe() || !this.skipped.has(this.key(n))));
        const names = targetNames();
        if (names.length > 0) {
            q.name(...names);
        }
        const targets = q.results().sort((a, b) => a.distance() - b.distance());
        return targets.find(n => n.targetsMe()) ?? targets.find(n => this.reachable(n)) ?? targets[0] ?? null;
    }
    private track(engaged: Npc): Npc | null {
        const names = targetNames();
        return Npcs.all().find(n => n.index === engaged.index && n.id === engaged.id && names.some(name => matchesEntityName(n.name, name))) ?? null;
    }
    validate(): boolean {
        if (needEat() || Skills.hpFraction() < PANIC_AT || STYLE === 'mage' && fullyOutOfSupplies()) {
            return false;
        }
        const target = this.findTarget();
        const stalled = this.stalled();
        if (!target) {
            this.bot.setStatus(`waiting for ${TARGET}`);
            return false;
        }
        if (stalled || !this.bot.combatActive() || (this.bot.resumeAttack && target.targetsMe())) return true;
        this.bot.setStatus('in combat');
        return false;
    }
    async execute(): Promise<void> {
        const target = this.findTarget();
        if (!target) {
            return;
        }
        if (!this.bot.combatActive() && !this.reachable(target)) {
            this.bot.setStatus(`approaching ${target.name} through obstacles`);
            const arrived = await Traversal.walkTo(target.tile(), { radius: 1, timeoutMs: 20_000, log: message => this.bot.log(message) });
            if (EventSignal.pending() || this.bot.died || needEat() || Skills.hpFraction() < PANIC_AT || ChatDialog.canContinue()) return;
            const current = this.track(target);
            if (!current || this.blocked(current)) return;
            if (!arrived || !this.reachable(current)) {
                this.skip(current, 'approach blocked');
                return;
            }
        }
        this.bot.beginFight(target);
        this.bot.setStatus(`attacking ${target.name} at ${target.tile()}`);
        const stalled = this.stalled();
        const verifyAttack = this.bot.resumeAttack && reader.selfFaceEntity() !== target.index;
        this.lastAttackAt = Date.now();
        if (target.targetsMe() && (this.bot.resumeAttack || stalled)) {
            if (!(await target.interact('Attack'))) return;
            this.bot.resumeAttack = false;
            if (stalled) this.bot.log(`combat XP stalled; re-sent Attack to ${target.name}`);
        }
        const status = await Reach.entityOp({
            find: () => {
                const current = this.track(target);
                return current && !this.blocked(current) ? current : null;
            },
            op: 'Attack',
            expect: () => {
                const current = this.track(target);
                return ChatDialog.canContinue() || !current || current.targetsMe() && current.inCombat || current.health === 0 && current.snap.totalHealth > 0
                    || STYLE === 'mage' && fullyOutOfSupplies();
            },
            // a wandering target postpones the server's can't-reach verdict forever,
            // so probe the scene and open the blocking door ourselves (#293)
            openWhenUnreachable: true,
            expectMs: 5000,
            what: target.name ?? undefined,
            log: message => this.bot.log(message)
        });
        if (status !== 'done' || ChatDialog.canContinue()) {
            if (status !== 'done' && !EventSignal.pending() && !ChatDialog.canContinue() && !this.bot.died) this.skip(target, status);
            return;
        }
        this.bot.resumeAttack = false;
        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90_000;
        let updates = 0;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died || !Game.sceneReady()) {
                return;
            }
            if (needEat() || Skills.hpFraction() < PANIC_AT) {
                return;
            }
            const cur = this.track(target);
            if (!cur || (cur.health === 0 && cur.snap.totalHealth > 0)) {
                this.bot.countKill();
                return;
            }
            if (fullyOutOfSupplies()) {
                this.bot.log(`out of ${STYLE === 'mage' ? 'runes' : 'ammo'} — breaking off to restock`);
                return;
            }
            if (verifyAttack && updates === 1 && cur.targetsMe() && reader.selfFaceEntity() !== cur.index) {
                const here = Game.tile();
                if (here && gapTo(here, cur.networkTile(), cur.size) <= attackRangeFor(STYLE)) await cur.interact('Attack');
            }
            if (await this.bot.sipPotions()) return;
            if (STYLE === 'range' && wieldedAmmo() < restockThreshold() && Inventory.count(AMMO) > 0) {
                this.bot.log(`ammo in quiver below ${restockThreshold()} — reloading from inventory`);
                return;
            }
            if (this.stalled() || (!Game.inCombat() && !cur.inCombat)) {
                return;
            }
            // Why: inline, not left to the sibling task, this loop owns the bot until the target dies.
            await armSpecial(this.bot);
            if (this.bot.resumeAttack) return;
            await Execution.delayTicks(1);
            updates++;
        }
    }
}

class ReturnToAnchor implements Task {
    readonly label = 'Return to anchor';
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6 && !this.bot.combatActive();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the spot');
        const log = (message: string) => this.bot.log(`  ${message}`);
        if (this.bot.delegated) {
            const arrived = await Traversal.walkTo(ANCHOR, { radius: 3, timeoutMs: 90000, log });
            const here = Game.tile();
            if ((!arrived || !here || ANCHOR.distanceTo(here) > 3) && !EventSignal.pending()) {
                this.bot.requestFinish(`Could not return to combat camp at ${ANCHOR}`);
            }
        } else {
            await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 6, timeoutMs: 300_000, log });
        }
    }
}
