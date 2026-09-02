import { reader } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { RANGE_STYLE_OPTIONS, parseRangeStyle } from '../../api/combat/CombatStyle.js';
import { castsAvailable } from '../../api/combat/CombatStyleLogic.js';
import { ARROWS, BOWS, STAFFS } from '../../api/combat/equipment.js';
import { foodCount as foodCountIn, foodForms, foodHealAmount, isFoodItem, shouldEatToUseFood } from '../../api/combat/food.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems, type GroundItem } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { DROP_DB } from '../../data/dropdb.js';
import { SPELL_DB } from '../../data/spelldb.js';
import Tile from '../../geometry/Tile.js';
import { jiveFrame } from '../../paint/jive.js';
import { fmtDuration, wrapText } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsBag, SettingsSchema } from '../../runtime/Settings.js';
import { Fight, HoldSafespot, Retreat, WalkToSpot, anchorFor, type CombatHost } from '../JiveDragons/combat.js';
import { keyStatus, lootHalts, siteTileOf, wantsDrop, type Style } from '../JiveDragons/logic.js';
import type { DragonSite } from '../JiveDragons/sites.js';
import { acquireKey, bankRoutine, enterLair, escapeRunesFor, inCell, leaveCell, type BankOpts, type KeyState } from '../JiveDragons/supply.js';
import { LOOT_GUARD, guarded } from './logic.js';
import { SITE_OPTIONS, TAVERLEY_BLACK_DEMON, siteFor } from './sites.js';

const LOOT_RADIUS = 10;
const LOOT_BURST_MAX = 8;
const LOOT_SKIP_MS = 30_000;
const LOOT_WAIT_MS = 4000;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;
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

const DROPS: string[] = DROP_DB[TAVERLEY_BLACK_DEMON.target] ?? [];
// Why: the coin pile is the most common drop and the demons die within a few tiles of the safespot, so coins stay ticked here where the blue dragon run leaves them.
const DEFAULT_LOOT = DROPS.filter(n => n.toLowerCase() !== 'ashes');

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'range', options: ['range', 'mage'], label: 'Combat style', help: 'both fight from a tile no demon can path to. A black demon only hunts within three tiles, so the run clicks each one and waits for it to close' },
    staff: { type: 'string', default: 'Staff of fire', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 2000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    runeBuffer: { type: 'number', default: 300, min: 0, max: 2000, label: 'Spare runes per type', group: 'Combat', showIf: SHOW_MAGE, help: 'withdrawn on top of the cast budget. Black demons drop air, chaos, blood, fire and law runes, so looted runes let a trip cast past its budget and drain whichever rune is scarcest. When that is the law rune the escape teleport needs, the way home is the long walk out' },
    bow: { type: 'string', default: 'Maple shortbow', options: BOWS, label: 'Bow', group: 'Combat', showIf: SHOW_RANGE },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Iron arrow', options: ARROWS, label: 'Ammo', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },

    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    panicHp: { type: 'number', default: 30, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'out of food and this low, the run leaves the dungeon for the bank' },
    retreatHp: { type: 'number', default: 50, min: 0, max: 99, label: 'Retreat to a safespot below HP%', group: 'Food & healing', help: 'off the safespot and this hurt, the run walks back to the nearest one and heals there. An empty pack sends it back whatever the HP, since nothing in the dungeon heals. 0 turns off both' },
    foodReserve: { type: 'number', default: 4, min: 0, max: 27, label: 'Food kept back from slot-freeing', group: 'Food & healing', help: 'a full pack spends food to make room for loot instead of banking, never below this many' },
    healTo: { type: 'number', default: 90, min: 10, max: 100, label: 'Heal to HP% before heading back', group: 'Food & healing', help: 'the walk in is long, so the trip eats up at the booth and tops the food back up after' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the black demon table. Everything picked up is banked. Ashes start unticked, since nothing pays for the slot' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },

    site: { type: 'string', default: 'taverley-black-demon', options: SITE_OPTIONS, label: 'Demon site', group: 'Location', help: 'the pocket past the blue dragons, behind the dusty-key gate. The walk in crosses the blue lair, where a baby blue aggresses below combat 97 and an adult within four tiles' },
    safespot1: { type: 'tile', default: TAVERLEY_BLACK_DEMON.safespots[0], label: 'Safespot 1', group: 'Location', help: 'derived off the collision pack as melee-proof with line of sight on a demon' },
    safespot2: { type: 'tile', default: TAVERLEY_BLACK_DEMON.safespots[1], label: 'Safespot 2', group: 'Location', help: 'the ladder rotates here when a hit lands, or when nothing is in range for 20s' },
    safespot3: { type: 'tile', default: TAVERLEY_BLACK_DEMON.safespots[2], label: 'Safespot 3', group: 'Location' },
    bankTile: { type: 'tile', default: TAVERLEY_BLACK_DEMON.bank, label: 'Bank stand tile', group: 'Location' },
    leaveVia: { type: 'string', default: 'teleport', options: ['teleport', 'walk'], optionLabels: { teleport: 'Falador teleport', walk: 'Walk out through the gate' }, label: 'Leave the dungeon by', group: 'Location', help: 'the teleport falls back to the gate walk when the runes or the magic level are short. Every other spell teleport lands further from the Falador West bank, so none is offered' },
    teleStock: { type: 'number', default: 2, min: 0, max: 10, label: 'Spare escape casts', group: 'Location', help: 'casts carried on top of the one needed to leave' },
    logDetail: { type: 'string', default: 'Normal', options: ['Normal', 'Verbose'], label: 'Log detail', group: 'Diagnostics', help: 'Verbose adds the loot, slot-freeing and key-state traces' }
};

/** The panel keys the safespot ladder is offered through. A site with more tiles keeps the rest of its own. */
const SPOT_KEYS = ['safespot1', 'safespot2', 'safespot3'];

/** The site's own tile, unless the panel setting has been moved off its schema default. */
export function siteTile(bag: SettingsBag, key: string | undefined, site: Tile): Tile {
    return siteTileOf(SETTINGS, bag, key, site);
}

let SITE: DragonSite = TAVERLEY_BLACK_DEMON;
let STYLE: Style = 'range';
let RANGE_MODE = 1;
let WEAPON = '';
let SPELL = 'Fire Strike';
let AMMO = 'Iron arrow';
let FOOD_NAME = 'Lobster';
let ESCAPE_LABEL = escapeRunesFor(TAVERLEY_BLACK_DEMON.escapeTeleportId).label;
let LEAVE_WALK = false;

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
let BANK_COMMON = true;
let VERBOSE = false;

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
    return { withdrawFood: true, runeCasts: RUNE_CASTS, runeBuffer: RUNE_BUFFER, ammo: AMMO_WITHDRAW, escapeStock: ESCAPE_STOCK, healTo: HEAL_TO, potions: [] };
}

// Why: bankRoutine returns void and countBankTrip fires only where it runs to the end, so the counter moving is what separates an empty bank from a walk that never got there.

/** Take the trip, and latch what it came back with when it finished. */
async function bankTrip(bot: JiveDemons): Promise<void> {
    const before = bot.bankTrips;
    await bankRoutine(bot, SITE, bankOpts());
    if (bot.bankTrips > before) {
        bot.noteTrip(hasFood(), !needStyleSupplies());
    }
}

// Why: a drop we keep failing to take qualifies forever, and with the walk back to the safespot in between the bot and the item trade places until a demon reaches it.
const lootSkip = new Map<string, number>();

function lootKey(g: GroundItem): string {
    return `${g.name ?? ''}@${g.tile().x},${g.tile().z}`;
}

function lootFilter() {
    return { loot: LOOT_SET, bankCommon: BANK_COMMON, solveClues: false, buryBones: false, boneName: '' };
}

function findLoot(): GroundItem | null {
    const now = performance.now();
    const demons = Npcs.query().name(SITE.target).within(LOOT_RADIUS + LOOT_GUARD).results().map(n => ({ tile: n.tile(), size: n.size }));
    return GroundItems.query()
        .where(g => SITE.inArea(g.tile()) && (lootSkip.get(lootKey(g)) ?? 0) < now && !guarded(g.tile(), demons) && wantsDrop({ id: g.id, name: g.name }, lootFilter()))
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

async function eatOnce(bot: JiveDemons): Promise<boolean> {
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

async function lootOnce(bot: JiveDemons): Promise<boolean> {
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

function tooHurtToLoot(): boolean {
    return lootHalts({ hpFrac: hpFrac(), panicHp: PANIC_HP, retreatHp: RETREAT_HP });
}

/** Clear the drop pile in one pass rather than one item per task hop. */
async function lootBurst(bot: JiveDemons): Promise<void> {
    for (let i = 0; i < LOOT_BURST_MAX; i++) {
        if (EventSignal.pending() || bot.died || Inventory.isFull() || needEat() || tooHurtToLoot() || findLoot() === null) {
            return;
        }
        await lootOnce(bot);
    }
}

async function freeSlot(bot: JiveDemons): Promise<void> {
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

class Parked implements Task {
    constructor(private readonly bot: JiveDemons) {}
    validate(): boolean {
        return this.bot.parked;
    }
    async execute(): Promise<void> {
        await Execution.delayTicks(PARK_TICKS);
    }
}

class Eat implements Task {
    constructor(private readonly bot: JiveDemons) {}
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
    constructor(private readonly bot: JiveDemons) {}
    private missing(): string | null {
        const wear = [WEAPON, STYLE === 'range' ? AMMO : ''];
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
    constructor(private readonly bot: JiveDemons) {}
    validate(): boolean {
        return STYLE === 'range' && Game.combatMode() !== RANGE_MODE && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting the combat style');
        Game.setCombatMode(RANGE_MODE);
        if (await Execution.delayUntil(() => Game.combatMode() === RANGE_MODE, 3000)) {
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
    constructor(private readonly bot: JiveDemons) {}
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

class PanicBank implements Task {
    constructor(private readonly bot: JiveDemons) {}
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

class FreeSlot implements Task {
    constructor(private readonly bot: JiveDemons) {}
    validate(): boolean {
        return slotAction(findLoot()) !== 'none';
    }
    async execute(): Promise<void> {
        await freeSlot(this.bot);
    }
}

class BankRun implements Task {
    constructor(private readonly bot: JiveDemons) {}
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
        this.bot.log(`banking (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : `, ammo ${ammoLeft()}`})`);
        await bankTrip(this.bot);
    }
}

class LootCorpse implements Task {
    constructor(private readonly bot: JiveDemons) {}
    validate(): boolean {
        return !tooHurtToLoot() && !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootBurst(this.bot);
    }
}

// Why: fetchFromVelrak returns got && out, so a key that arrives behind a cell door that will not open ends the retry loop with the bot sealed in a dead end, and nothing in supply.ts walks it back out.

class AcquireKey implements Task {
    constructor(private readonly bot: JiveDemons) {}
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
    constructor(private readonly bot: JiveDemons) {}
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

export default class JiveDemons extends TaskBot implements CombatHost {
    override loopDelay = 600;

    status = 'starting';
    startedAt = Date.now();
    killsTotal = 0;
    bankTrips = 0;
    looted = 0;
    readonly lootCounts = new Map<string, number>();
    safespotIdx = 0;
    keyState: KeyState = 'fetch';
    parked = false;
    parkReason = '';
    died = false;
    targetIdx: number | null = null;

    private bankEmpty = false;
    private supplyEmpty = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const base = siteFor(this.settings.str('site', 'taverley-black-demon'));
        SITE = {
            ...base,
            safespots: base.safespots.map((spot, i) => siteTile(this.settings, SPOT_KEYS[i], spot)),
            bank: siteTile(this.settings, 'bankTile', base.bank)
        };
        STYLE = this.settings.str('combatStyle', 'range') as Style;
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        SPELL = this.settings.str('spell', 'Fire Strike');
        AMMO = this.settings.str('ammo', 'Iron arrow');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of fire') : this.settings.str('bow', 'Maple shortbow');
        FOOD_NAME = scriptFood(this.settings, 'Lobster');
        LEAVE_WALK = this.settings.str('leaveVia', 'teleport') === 'walk';
        ESCAPE_LABEL = LEAVE_WALK ? 'walk out' : escapeRunesFor(SITE.escapeTeleportId).label;

        PANIC_HP = this.settings.num('panicHp', 30) / 100;
        RETREAT_HP = this.settings.num('retreatHp', 50) / 100;
        RUNE_CASTS = this.settings.num('runesWithdraw', 150);
        RUNE_BUFFER = this.settings.num('runeBuffer', 300);
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        FOOD_RESERVE = this.settings.num('foodReserve', 4);
        ESCAPE_STOCK = this.settings.num('teleStock', 2);
        HEAL_TO = this.settings.num('healTo', 90) / 100;
        LOOT_SET = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        // Why: fired arrows land where the demon dies and sit on no drop table, so the 500 a trip withdraws come home only if the loot set names them.
        if (STYLE === 'range') {
            LOOT_SET.add(AMMO.toLowerCase());
        }
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        VERBOSE = this.settings.str('logDetail', 'Normal') === 'Verbose';

        this.startedAt = Date.now();
        this.safespotIdx = 0;
        lootSkip.clear();
        this.keyState = SITE.keyItem === null ? 'held' : keyStatus(Inventory.countById(SITE.keyItem.id), Bank.countById(SITE.keyItem.id));

        this.log(`JiveDemons: ${SITE.label}, style ${STYLE} w/ ${WEAPON}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (retreat<${Math.round(RETREAT_HP * 100)}%, panic<${Math.round(PANIC_HP * 100)}%), escape ${ESCAPE_LABEL}, bank ${SITE.bank}`);
        this.vlog(`safespots [${SITE.safespots.join(' ')}], loot [${[...LOOT_SET].join(', ')}]`);

        // Why: waitFed, Fight.idle and every walkResilient in the shared engine pump Sustain, and with no hook set all of them stand in the fight without taking a bite.
        Sustain.set(async () => {
            if (needEat()) {
                await eatOnce(this);
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
                    this.log('died! recovering');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new Retreat(this, SITE),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new PanicBank(this),
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
        return [];
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
    /** Demons drop ashes, so the fight loop never has a bone to bury. */
    buryBones(): boolean {
        return false;
    }
    boneName(): string {
        return '';
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
    countBurial(): void {}
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
            this.parkFor(`no '${FOOD_NAME}' left in the bank after a full trip. The run stopped at the booth rather than walk back to the demons with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.`);
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
            script: 'JiveDemons',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Combat', 'Loot']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;

        if (page === 'Options') {
            // Why: the site name runs past a half-width cell, so it takes a row of its own.
            p.statGrid([[{ text: `Site: ${SITE.label}` }]], 1);
            p.statGrid([
                [{ text: `Style: ${STYLE}` }, { text: `Weapon: ${WEAPON}` }],
                [{ text: `Food: ${FOOD_NAME}` }, { text: `Escape: ${ESCAPE_LABEL}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Kills: ${this.killsTotal}` }],
                [{ text: `Kills/hr: ${mins > 0.5 ? Math.round((this.killsTotal / mins) * 60) : 'n/a'}` }, { text: `Trips: ${this.bankTrips}` }],
                [{ text: `Spot: ${anchorFor(SITE, STYLE, this.safespotIdx)}` }, { text: `Key: ${this.keyState}` }]
            ]);
            p.bar('HP', this.hpFraction());
        } else if (section === 'Combat') {
            const supply = STYLE === 'mage' ? `Casts: ${castsLeft()}` : `Ammo: ${ammoLeft()}`;
            p.statGrid([
                [{ text: `Style: ${STYLE}` }, { text: `Weapon: ${WEAPON}` }],
                [{ text: supply }, { text: `Food: ${foodCount()}` }]
            ]);
        } else if (section === 'Loot') {
            // Why: a p.list would draw from the panel edge and paint over the rail labels, so the drops go through the grid like every other row.
            const top = [...this.lootCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, LOOT_SHOWN)
                .map(([name, n]) => ({ text: `${n}x ${name}` }));
            p.statGrid([[{ text: `Looted: ${this.looted}` }], ...inPairs(top)]);
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
