import { reader } from '../../adapter/ClientAdapter.js';
import { SolveClue } from '../../api/ai/clues/SolveClue.js';
import { Bank } from '../../api/bank/Bank.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EMPTY_VIAL, plannedPotions, potionToSip, type PotionPlan } from '../../api/combat/boostPotions.js';
import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS, parseCombatStyle, parseRangeStyle, type MeleeCombatStyle } from '../../api/combat/CombatStyle.js';
import { castsAvailable } from '../../api/combat/CombatStyleLogic.js';
import { Special } from '../../api/combat/Special.js';
import { ARROWS, BOWS, MELEE_WEAPONS, STAFFS } from '../../api/combat/equipment.js';
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
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { DROP_DB } from '../../data/dropdb.js';
import { SPELL_DB } from '../../data/spelldb.js';
import type Tile from '../../geometry/Tile.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { Fight, HoldSafespot, WalkToSpot, type CombatHost } from './combat.js';
import { keyStatus, meleeShieldGate, wantsDrop, type Style } from './logic.js';
import { SITE_OPTIONS, TAVERLEY_BLUE, siteFor, type DragonSite } from './sites.js';
import { acquireKey, bankRoutine, enterLair, escapeRunesFor, inCell, leaveCell, type BankOpts, type KeyState } from './supply.js';

const SHIELD = 'Dragonfire shield';

const LOOT_RADIUS = 10;
const LOOT_BURST_MAX = 8;
const LOOT_SKIP_MS = 30_000;
const LOOT_WAIT_MS = 4000;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;
const PARK_TICKS = 10;

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };
const SHOW_SAFESPOT = { key: 'combatStyle', anyOf: ['mage', 'range'] };

const DROPS: string[] = DROP_DB[TAVERLEY_BLUE.target] ?? [];
// Why: Bass is food the run never eats, so a slot spent on it is a slot the hides do not get.
const DEFAULT_LOOT = DROPS.filter(n => n.toLowerCase() !== 'bass');

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'range', options: ['melee', 'mage', 'range'], label: 'Combat style', help: 'mage and range fight from a tile no dragon can path to. Melee stands in the dragonfire and needs the Dragonfire shield' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE },
    weapon: { type: 'string', default: 'Rune scimitar', options: MELEE_WEAPONS, label: 'Weapon', group: 'Combat', showIf: SHOW_MELEE, help: '1-handed, so the shield slot stays free for the Dragonfire shield' },
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

    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    panicHp: { type: 'number', default: 30, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'out of food and this low, the run leaves the lair for the bank' },
    foodReserve: { type: 'number', default: 4, min: 0, max: 27, label: 'Food kept back from slot-freeing', group: 'Food & healing', help: 'a full pack spends food to make room for loot instead of banking, never below this many' },
    healTo: { type: 'number', default: 90, min: 10, max: 100, label: 'Heal to HP% before heading back', group: 'Food & healing', help: 'the walk in is long, so the trip eats up at the booth and tops the food back up after' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the blue dragon table. Everything picked up is banked' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury dragon bones', group: 'Banking & loot', help: 'bury Dragon bones for Prayer xp instead of banking them (always looted when on). They are the best drop here, so this trades gold for xp' },

    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues', help: 'blue dragons drop hard clues. The trail leaves the dungeon and comes back' },

    site: { type: 'string', default: 'taverley-blue', options: SITE_OPTIONS, label: 'Dragon site', group: 'Location', help: 'below combat 97 the baby blues aggress on the walk in, above it they never do' },
    safespot1: { type: 'tile', default: TAVERLEY_BLUE.safespots[0], label: 'Safespot 1', group: 'Location', showIf: SHOW_SAFESPOT, help: 'derived off the collision pack as melee-proof with line of sight on an adult' },
    safespot2: { type: 'tile', default: TAVERLEY_BLUE.safespots[1], label: 'Safespot 2', group: 'Location', showIf: SHOW_SAFESPOT, help: 'the ladder rotates here when a hit lands, or when nothing is in range for 20s' },
    safespot3: { type: 'tile', default: TAVERLEY_BLUE.safespots[2], label: 'Safespot 3', group: 'Location', showIf: SHOW_SAFESPOT },
    meleeTile: { type: 'tile', default: TAVERLEY_BLUE.meleeAnchor, label: 'Melee anchor tile', group: 'Location', showIf: SHOW_MELEE, help: 'derived adjacent to three adult footprints, so an attack click from it moves nobody' },
    bankTile: { type: 'tile', default: TAVERLEY_BLUE.bank, label: 'Bank stand tile', group: 'Location' },
    teleStock: { type: 'number', default: 2, min: 0, max: 10, label: 'Spare escape casts', group: 'Location', help: 'casts carried on top of the one needed to leave' },
    logDetail: { type: 'string', default: 'Normal', options: ['Normal', 'Verbose'], label: 'Log detail', group: 'Diagnostics', help: 'Verbose adds the loot, slot-freeing and key-state traces' }
};

let SITE: DragonSite = TAVERLEY_BLUE;
let STYLE: Style = 'range';
let MELEE_STYLE: MeleeCombatStyle = 'strength';
let RANGE_MODE = 1;
let WEAPON = '';
let SPELL = 'Fire Strike';
let AMMO = 'Iron arrow';
let FOOD_NAME = 'Lobster';
let ESCAPE_LABEL = escapeRunesFor(TAVERLEY_BLUE.escapeTeleportId).label;
let BURY_BONES = false;
let SOLVE_CLUES = true;

let PANIC_HP = 0.3;
let RUNE_CASTS = 150;
let RUNE_BUFFER = 300;
let AMMO_WITHDRAW = 500;
let FOOD_WITHDRAW = 20;
let FOOD_RESERVE = 4;
let ESCAPE_STOCK = 2;
let HEAL_TO = 0.9;
let LOOT_SET = new Set<string>();
let BANK_COMMON = true;
let VERBOSE = false;
let USE_SPECIAL = true;
/** Empty in mage and range mode: an attack or strength boost does nothing for a spell or a bow. */
let POTIONS: PotionPlan[] = [];

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
    return STYLE === 'range' && ammoLeft() === 0;
}

// Why: every optional field falls back to a supply.ts module default, so a knob left out of this object is one the panel offers and the run ignores.

/** Every setting bankRoutine reads. */
function bankOpts(): BankOpts {
    return { withdrawFood: true, runeCasts: RUNE_CASTS, runeBuffer: RUNE_BUFFER, ammo: AMMO_WITHDRAW, escapeStock: ESCAPE_STOCK, healTo: HEAL_TO, potions: POTIONS };
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
        .within(LOOT_RADIUS)
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

async function lootOnce(bot: JiveDragons): Promise<boolean> {
    const drop = findLoot();
    if (drop === null) {
        return false;
    }
    const name = drop.name ?? '';
    bot.setStatus(`looting ${name}`);
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

/** Clear the drop pile in one pass rather than one item per task hop. */
async function lootBurst(bot: JiveDragons): Promise<void> {
    for (let i = 0; i < LOOT_BURST_MAX; i++) {
        if (EventSignal.pending() || bot.died || Inventory.isFull() || needEat() || findLoot() === null) {
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
        const wear = STYLE === 'melee' ? [SHIELD, WEAPON] : [WEAPON, STYLE === 'range' ? AMMO : ''];
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
        // Why: food is a resource the run spends and FreeSlot turns it into room, so a pack full of food is no reason to walk to Falador.
        return Inventory.isFull() && foodCount() <= FOOD_RESERVE;
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking, restocking');
        this.bot.log(`banking (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : ''}${STYLE === 'range' ? `, ammo ${ammoLeft()}` : ''})`);
        await bankTrip(this.bot);
    }
}

class LootCorpse implements Task {
    constructor(private readonly bot: JiveDragons) {}
    validate(): boolean {
        return hpFrac() >= PANIC_HP && !Inventory.isFull() && findLoot() !== null;
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
        if (this.bot.parked || SITE.inArea(Game.tile()) || hpFrac() < PANIC_HP) {
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
        SITE = {
            ...base,
            safespots: ['safespot1', 'safespot2', 'safespot3']
                .map((key, i) => (base.safespots[i] === undefined ? null : this.settings.tile(key, base.safespots[i])))
                .filter((t): t is Tile => t !== null),
            meleeAnchor: this.settings.tile('meleeTile', base.meleeAnchor),
            bank: this.settings.tile('bankTile', base.bank)
        };
        STYLE = this.settings.str('combatStyle', 'range') as Style;
        MELEE_STYLE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        SPELL = this.settings.str('spell', 'Fire Strike');
        AMMO = this.settings.str('ammo', 'Iron arrow');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of fire')
            : STYLE === 'range' ? this.settings.str('bow', 'Maple shortbow')
                : this.settings.str('weapon', 'Rune scimitar');
        FOOD_NAME = scriptFood(this.settings, 'Lobster');
        ESCAPE_LABEL = escapeRunesFor(SITE.escapeTeleportId).label;
        BURY_BONES = this.settings.bool('buryBones', false);
        SOLVE_CLUES = this.settings.bool('solveClues', true);

        PANIC_HP = this.settings.num('panicHp', 30) / 100;
        RUNE_CASTS = this.settings.num('runesWithdraw', 150);
        RUNE_BUFFER = this.settings.num('runeBuffer', 300);
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        FOOD_RESERVE = this.settings.num('foodReserve', 4);
        ESCAPE_STOCK = this.settings.num('teleStock', 2);
        HEAL_TO = this.settings.num('healTo', 90) / 100;
        LOOT_SET = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        VERBOSE = this.settings.str('logDetail', 'Normal') === 'Verbose';
        USE_SPECIAL = this.settings.bool('useSpecial', true);
        POTIONS = STYLE === 'melee' && this.settings.bool('usePotions', true)
            ? plannedPotions(suppliesOf(selectedLoadout(this.settings)))
            : [];

        this.startedAt = Date.now();
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
        const gate = meleeShieldGate(STYLE, Equipment.contains(SHIELD) || Inventory.count(SHIELD) > 0 || Bank.count(SHIELD) > 0);
        if (gate !== null) {
            this.parkFor(gate);
        }

        this.log(`JiveDragons: ${SITE.label}, style ${STYLE}${WEAPON === '' ? '' : ` w/ ${WEAPON}`}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (panic<${Math.round(PANIC_HP * 100)}%), escape ${ESCAPE_LABEL}, clues ${SOLVE_CLUES ? 'on' : 'off'}${BURY_BONES ? `, burying ${SITE.bones}` : ''}, bank ${SITE.bank}`);
        this.vlog(`safespots [${SITE.safespots.join(' ')}], melee anchor ${SITE.meleeAnchor}, loot [${[...LOOT_SET].join(', ')}]`);

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
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
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
        return SITE.bank;
    }
    override grindTargets(): string[] {
        return [SITE.target.toLowerCase()];
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
        return potionDoseNames();
    }
    hpFraction(): number {
        return hpFrac();
    }
    panicHp(): number {
        return PANIC_HP;
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
}
