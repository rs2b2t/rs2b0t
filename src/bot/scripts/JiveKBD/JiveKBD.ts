import { reader } from '../../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { castsAvailable } from '../../api/combat/CombatStyleLogic.js';
import { STAFFS } from '../../api/combat/equipment.js';
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
import { lootHalts, siteTileOf, wantsDrop, type Style } from '../JiveDragons/logic.js';
import type { DragonSite } from '../JiveDragons/sites.js';
import { SHIELD, bankRoutine, escapeRunesFor, type BankOpts } from '../JiveDragons/supply.js';
import { LOOT_GUARD, guarded } from '../JiveDemons/logic.js';
import { enterKbdLair, leaveKbdLair, type EntryHost } from './entry.js';
import { ANTIPOISON_DOSES, POISONED, antipoisonPlan, doseToDrink } from './logic.js';
import { KBD_LAIR, KBD_ROUTE, SITE_OPTIONS, siteFor } from './sites.js';

/** The body is five wide and the drop lands on its south-west corner, so the pile can sit a few tiles past the fight range. */
const LOOT_RADIUS = 12;
const LOOT_BURST_MAX = 8;
const LOOT_SKIP_MS = 30_000;
const LOOT_WAIT_MS = 4000;
const DRINK_MS = 4000;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;
const PARK_TICKS = 10;

const LOOT_SHOWN = 6;
const PARK_ROWS = 2;
const PARK_FG = '#e0705a';
/** The gap and the button row that follow every section. */
const CONTROL_ROWS = 2;

const STYLE: Style = 'mage';

/** Cells laid out two across, the shape statGrid draws. */
function inPairs<T>(cells: T[]): T[][] {
    return Array.from({ length: Math.ceil(cells.length / 2) }, (_, i) => cells.slice(i * 2, i * 2 + 2));
}

const DROPS: string[] = DROP_DB[KBD_LAIR.target] ?? [];

export const SETTINGS: SettingsSchema = {
    staff: { type: 'string', default: 'Staff of fire', options: STAFFS, label: 'Staff', group: 'Combat', help: 'one-handed, so the Dragonfire shield goes in the other hand. The shield caps the far fire at 15 and the run wears it every trip' },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat' },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 2000, label: 'Casts of runes per bank trip', group: 'Combat', help: 'the dragon has 240 hitpoints, so a kill is thirty to sixty casts' },
    runeBuffer: { type: 'number', default: 300, min: 0, max: 2000, label: 'Spare runes per type', group: 'Combat', help: 'withdrawn on top of the cast budget. The dragon drops air, fire, blood, law and death runes' },

    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing', help: 'the far fire lands about once every fourteen ticks under sustained casting, for up to 15 through the shield' },
    dosesWithdraw: { type: 'number', default: 1, min: 1, max: 4, label: 'Superantipoison flasks per trip', group: 'Food & healing', help: 'one dose goes down on the surface before the ladder, since the poison spiders spawn on the lever tiles, and another whenever the poison line prints. A four-dose flask covers four trips' },
    panicHp: { type: 'number', default: 30, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'out of food and this low, the run teleports out for the bank' },
    retreatHp: { type: 'number', default: 50, min: 0, max: 99, label: 'Retreat to a safespot below HP%', group: 'Food & healing', help: 'off the safespot and this hurt, the run walks back to the alcove and heals there. An empty pack sends it back whatever the HP. 0 turns off both' },
    foodReserve: { type: 'number', default: 4, min: 0, max: 27, label: 'Food kept back from slot-freeing', group: 'Food & healing', help: 'a full pack spends food to make room for loot instead of banking, never below this many' },
    healTo: { type: 'number', default: 90, min: 10, max: 100, label: 'Heal to HP% before heading back', group: 'Food & healing', help: 'the wilderness walk is long, so the trip eats up at the booth and tops the food back up after' },

    loot: { type: 'string[]', default: DROPS, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the King Black Dragon table. Everything picked up is banked' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },

    site: { type: 'string', default: 'kbd-lair', options: SITE_OPTIONS, label: 'Lair', group: 'Location', help: 'the lever in the Lava Maze dungeon, reached by the ladder at level 42 wilderness. The lair itself is not wilderness, so the Varrock teleport fires from inside it' },
    safespot1: { type: 'tile', default: KBD_LAIR.safespots[0], label: 'Safespot 1', group: 'Location', help: 'the alcove south of the arrival tile: walled on the south, open north, and too narrow a row for the five-wide body to stand beside. The dragon still breathes at it from range' },
    safespot2: { type: 'tile', default: KBD_LAIR.safespots[1], label: 'Safespot 2', group: 'Location', help: 'the other alcove tile, taken when nothing is in range for 20s' },
    bankTile: { type: 'tile', default: KBD_LAIR.bank, label: 'Bank stand tile', group: 'Location' },
    teleStock: { type: 'number', default: 2, min: 0, max: 10, label: 'Spare escape casts', group: 'Location', help: 'Varrock casts carried on top of the one needed to leave. When none will fire the run pulls the exit lever and walks out through the wilderness' },
    logDetail: { type: 'string', default: 'Normal', options: ['Normal', 'Verbose'], label: 'Log detail', group: 'Diagnostics', help: 'Verbose adds the loot and slot-freeing traces' }
};

const SPOT_KEYS = ['safespot1', 'safespot2'];

/** The site's own tile, unless the panel setting has been moved off its schema default. */
export function siteTile(bag: SettingsBag, key: string | undefined, site: Tile): Tile {
    return siteTileOf(SETTINGS, bag, key, site);
}

let SITE: DragonSite = KBD_LAIR;
let WEAPON = 'Staff of fire';
let SPELL = 'Fire Strike';
let FOOD_NAME = 'Lobster';
let ESCAPE_LABEL = escapeRunesFor(KBD_LAIR.escapeTeleportId).label;

let PANIC_HP = 0.3;
let RETREAT_HP = 0.5;
let RUNE_CASTS = 150;
let RUNE_BUFFER = 300;
let FOOD_WITHDRAW = 20;
let FOOD_RESERVE = 4;
let DOSES = 1;
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
function dosesHeld(): number {
    return ANTIPOISON_DOSES.reduce((n, name) => n + Inventory.count(name), 0);
}

/** Every setting bankRoutine reads. */
function bankOpts(bot: JiveKBD): BankOpts {
    return {
        withdrawFood: true,
        runeCasts: RUNE_CASTS,
        runeBuffer: RUNE_BUFFER,
        escapeStock: ESCAPE_STOCK,
        healTo: HEAL_TO,
        potions: [],
        flasks: [antipoisonPlan(DOSES)],
        wear: [SHIELD],
        leave: (_h, site) => leaveKbdLair(bot, site, KBD_ROUTE)
    };
}

/** Take the trip, and latch what it came back with when it finished. */
async function bankTrip(bot: JiveKBD): Promise<void> {
    const before = bot.bankTrips;
    await bankRoutine(bot, SITE, bankOpts(bot));
    if (bot.bankTrips > before) {
        bot.noteTrip(hasFood(), castsLeft() > 0);
    }
}

const lootSkip = new Map<string, number>();

function lootKey(g: GroundItem): string {
    return `${g.name ?? ''}@${g.tile().x},${g.tile().z}`;
}

function lootFilter() {
    return { loot: LOOT_SET, bankCommon: BANK_COMMON, solveClues: false, buryBones: false, boneName: '' };
}

// Why: the pile lands where the dragon died and it respawns ninety seconds later on the same floor, so a drop beside a live body is a walk into its melee.

function findLoot(): GroundItem | null {
    const now = performance.now();
    const bodies = Npcs.query().name(SITE.target).within(LOOT_RADIUS + LOOT_GUARD).results().map(n => ({ tile: n.tile(), size: n.size }));
    return GroundItems.query()
        .where(g => SITE.inArea(g.tile()) && (lootSkip.get(lootKey(g)) ?? 0) < now && !guarded(g.tile(), bodies) && wantsDrop({ id: g.id, name: g.name }, lootFilter()))
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

async function eatOnce(bot: JiveKBD): Promise<boolean> {
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

async function lootOnce(bot: JiveKBD): Promise<boolean> {
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
async function lootBurst(bot: JiveKBD): Promise<void> {
    for (let i = 0; i < LOOT_BURST_MAX; i++) {
        if (EventSignal.pending() || bot.died || Inventory.isFull() || needEat() || tooHurtToLoot() || findLoot() === null) {
            return;
        }
        await lootOnce(bot);
    }
}

async function freeSlot(bot: JiveKBD): Promise<void> {
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
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        return this.bot.parked;
    }
    async execute(): Promise<void> {
        await Execution.delayTicks(PARK_TICKS);
    }
}

class Eat implements Task {
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        return needEat();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

// Why: the poison varp never reaches the client, and poison_player prints its line once per fresh poisoning, so the line is the only signal and the mark moves past it whether or not a dose was there to answer it.

class CurePoison implements Task {
    private mark = GameMessages.mark();
    private warned = false;
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        return GameMessages.sawSince(this.mark, POISONED);
    }
    async execute(): Promise<void> {
        this.mark = GameMessages.mark();
        this.bot.setStatus('poisoned, drinking an antipoison');
        if (await this.bot.drinkAntipoison()) {
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

class GearEquip implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveKBD) {}
    private missing(): string | null {
        return [WEAPON, SHIELD].find(n => n !== '' && !Equipment.contains(n) && Inventory.first(n) !== null) ?? null;
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

class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        if (Autocast.armed() || Date.now() < this.retryAt || castsLeft() < 1) {
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
    constructor(private readonly bot: JiveKBD) {}
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
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        return slotAction(findLoot()) !== 'none';
    }
    async execute(): Promise<void> {
        await freeSlot(this.bot);
    }
}

class BankRun implements Task {
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        if (this.bot.parked) {
            return false;
        }
        if (!hasFood() && !this.bot.bankKnownEmpty()) {
            return true;
        }
        if (castsLeft() < 1 && !this.bot.supplyKnownEmpty()) {
            return true;
        }
        return Inventory.isFull() && foodCount() <= FOOD_RESERVE;
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking, restocking');
        this.bot.log(`banking (food ${foodCount()}, casts ${castsLeft()}, doses ${dosesHeld()})`);
        await bankTrip(this.bot);
    }
}

class LootCorpse implements Task {
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        return !tooHurtToLoot() && !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootBurst(this.bot);
    }
}

class EnterLair implements Task {
    constructor(private readonly bot: JiveKBD) {}
    validate(): boolean {
        return !this.bot.parked && !SITE.inArea(Game.tile()) && hpFrac() >= PANIC_HP;
    }
    async execute(): Promise<void> {
        await enterKbdLair(this.bot, SITE, KBD_ROUTE);
    }
}

export default class JiveKBD extends TaskBot implements CombatHost, EntryHost {
    override loopDelay = 600;

    status = 'starting';
    startedAt = Date.now();
    killsTotal = 0;
    bankTrips = 0;
    looted = 0;
    dosesDrunk = 0;
    lastDoseTick: number | null = null;
    readonly lootCounts = new Map<string, number>();
    safespotIdx = 0;
    parked = false;
    parkReason = '';
    died = false;
    targetIdx: number | null = null;

    private bankEmpty = false;
    private supplyEmpty = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const base = siteFor(this.settings.str('site', 'kbd-lair'));
        SITE = {
            ...base,
            safespots: base.safespots.map((spot, i) => siteTile(this.settings, SPOT_KEYS[i], spot)),
            bank: siteTile(this.settings, 'bankTile', base.bank)
        };
        WEAPON = this.settings.str('staff', 'Staff of fire');
        SPELL = this.settings.str('spell', 'Fire Strike');
        FOOD_NAME = scriptFood(this.settings, 'Lobster');
        ESCAPE_LABEL = escapeRunesFor(SITE.escapeTeleportId).label;

        PANIC_HP = this.settings.num('panicHp', 30) / 100;
        RETREAT_HP = this.settings.num('retreatHp', 50) / 100;
        RUNE_CASTS = this.settings.num('runesWithdraw', 150);
        RUNE_BUFFER = this.settings.num('runeBuffer', 300);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        FOOD_RESERVE = this.settings.num('foodReserve', 4);
        DOSES = this.settings.num('dosesWithdraw', 1);
        ESCAPE_STOCK = this.settings.num('teleStock', 2);
        HEAL_TO = this.settings.num('healTo', 90) / 100;
        LOOT_SET = new Set(this.settings.list('loot', DROPS).map(s => s.toLowerCase()));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        VERBOSE = this.settings.str('logDetail', 'Normal') === 'Verbose';

        this.startedAt = Date.now();
        this.safespotIdx = 0;
        this.lastDoseTick = null;
        lootSkip.clear();

        this.log(`JiveKBD: ${SITE.label}, ${WEAPON} (${SPELL}) with the ${SHIELD}, food '${FOOD_NAME}' (retreat<${Math.round(RETREAT_HP * 100)}%, panic<${Math.round(PANIC_HP * 100)}%), ${DOSES} Superantipoison flask(s) a trip, escape ${ESCAPE_LABEL}, bank ${SITE.bank}`);
        this.vlog(`safespots [${SITE.safespots.join(' ')}], loot [${[...LOOT_SET].join(', ')}]`);

        // Why: waitFed, Fight.idle and every walkResilient in the shared engine pump Sustain, and with no hook set all of them stand in the fire without taking a bite.
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
            new CurePoison(this),
            new GearEquip(this),
            new ArmAutocast(this),
            new PanicBank(this),
            new FreeSlot(this),
            new BankRun(this),
            new LootCorpse(this),
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
        return '';
    }
    spellName(): string {
        return SPELL;
    }
    keepExtra(): string[] {
        return [SHIELD, ...ANTIPOISON_DOSES];
    }
    leaveByWalk(): boolean {
        return false;
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
    /** The bones are banked with the rest of the pile, never buried in the fight. */
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

    /** Drink the smallest antipoison flask held. False with none in the pack. */
    async drinkAntipoison(): Promise<boolean> {
        const name = doseToDrink(n => Inventory.count(n));
        const dose = name === null ? null : Inventory.first(name);
        if (name === null || dose === null) {
            return false;
        }
        const before = dosesHeld() * 10 + Inventory.count(name);
        if (!(await dose.interact('Drink'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => dosesHeld() * 10 + Inventory.count(name) !== before, DRINK_MS))) {
            return false;
        }
        this.lastDoseTick = Game.tick();
        this.dosesDrunk++;
        return true;
    }

    /** What the last bank trip came back with. */
    noteTrip(food: boolean, supplies: boolean): void {
        this.bankEmpty = !food;
        this.supplyEmpty = !supplies;
        if (!food) {
            this.parkFor(`no '${FOOD_NAME}' left in the bank after a full trip. The run stopped at the booth rather than walk the wilderness with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.`);
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
            script: 'JiveKBD',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Combat', 'Loot']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;

        if (page === 'Options') {
            p.statGrid([[{ text: `Site: ${SITE.label}` }]], 1);
            p.statGrid([
                [{ text: `Staff: ${WEAPON}` }, { text: `Spell: ${SPELL}` }],
                [{ text: `Food: ${FOOD_NAME}` }, { text: `Escape: ${ESCAPE_LABEL}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Kills: ${this.killsTotal}` }],
                [{ text: `Kills/hr: ${mins > 0.5 ? Math.round((this.killsTotal / mins) * 60) : 'n/a'}` }, { text: `Trips: ${this.bankTrips}` }],
                [{ text: `Spot: ${anchorFor(SITE, STYLE, this.safespotIdx)}` }, { text: `Doses: ${dosesHeld()} (${this.dosesDrunk} drunk)` }]
            ]);
            p.bar('HP', this.hpFraction());
        } else if (section === 'Combat') {
            p.statGrid([
                [{ text: `Staff: ${WEAPON}` }, { text: `Spell: ${SPELL}` }],
                [{ text: `Casts: ${castsLeft()}` }, { text: `Food: ${foodCount()}` }]
            ]);
        } else if (section === 'Loot') {
            const top = [...this.lootCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, LOOT_SHOWN)
                .map(([name, n]) => ({ text: `${n}x ${name}` }));
            p.statGrid([[{ text: `Looted: ${this.looted}` }], ...inPairs(top)]);
        }

        if (this.parked) {
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
