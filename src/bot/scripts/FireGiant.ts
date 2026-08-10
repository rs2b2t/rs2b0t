import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { buryOneInFight } from '../api/combat/fightUpkeep.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS, parseCombatStyle, parseRangeStyle, type MeleeCombatStyle } from '../api/CombatStyle.js';
import { Autocast } from '../api/combat/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../api/combat/data/spelldb.js';
import { DROP_DB } from '../api/combat/data/dropdb.js';
import { BOWS, STAFFS } from '../api/combat/equipment.js';
import { FOOD_OPTIONS, foodForms, foodCount as foodCountIn, foodHealAmount, shouldEatToUseFood } from '../api/combat/food.js';
import { combatKeepNames } from '../api/combat/keepList.js';
import { depositAllExcept, matchesCommonBankLoot } from '../api/Banking.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Quests } from '../api/hud/Quests.js';
import { Locs } from '../api/queries/Locs.js';
import {
    AMULET, BARREL_BANK, BARREL_EXIT, BARREL_LOC, BARREL_OP, DEFAULT_MELEE_TILE, DEFAULT_SAFESPOT, DEFAULT_SAFESPOT_FALLBACK, DUNGEON_MIN_Z, EXIT_DOOR, EXIT_DOOR_LOC, EXIT_OPTIONS, ESCAPE_TELES,
    LEDGE_DOOR, LEDGE_LOC, LEDGE_OP, legFor, RAFT_LOC, RAFT_OP, RAFT_STAND,
    attackRangeFor, eastFirst, lootWaitMs, ROCK_LOC, sameRoom, takenByAnother, ROPE, ROPE_THROW_STAND, TREE_LOC, TREE_STAND, type EscapeTele
} from './FireGiantLogic.js';

const TARGET = 'Fire giant';
const FIELD_RADIUS = 10;

const BANK_HEAL_TO = 0.9;

const RE_ENGAGE_MS = 4000;
const TAKEN_SKIP_MS = 15_000;

const LOOT_BURST_MAX = 8;
const LOOT_SKIP_MS = 30_000;

const LEASH_WAIT_MS = 15_000;
const LEASH_SKIP_MS = 20_000;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;

const XP_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'];

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };
const SHOW_SAFESPOT = { key: 'combatStyle', anyOf: ['mage', 'range'] };

const DROPS: string[] = DROP_DB[TARGET] ?? [];
// MossGiant strips arrows as junk; the fire giant table's only arrows are Rune (12
// from the main roll, 42 from the rare) and Steel (150), so nothing here is junk
const DEFAULT_LOOT = DROPS;

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'melee', options: ['melee', 'mage', 'range'], label: 'Combat style' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE, help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    staff: { type: 'string', default: 'Staff of air', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE, help: 'wielded staff, withdrawn from bank when missing' },
    spell: { type: 'string', default: 'Wind Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 2000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    runeBuffer: { type: 'number', default: 500, min: 0, max: 2000, label: 'Spare runes per type', group: 'Combat', showIf: SHOW_MAGE, help: 'withdrawn on top of the cast budget. Looted runes (fire giants drop chaos) let the trip cast past its planned count and drain whichever rune is scarcest — if that rune is also the escape teleport\'s, the bot cannot leave. Runes stack, so this costs no extra slots' },
    bow: { type: 'string', default: 'Maple shortbow', options: BOWS, label: 'Bow', group: 'Combat', showIf: SHOW_RANGE, help: 'wielded bow, withdrawn from bank when missing' },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Iron arrow', options: ['Bronze arrow', 'Iron arrow', 'Steel arrow', 'Mithril arrow', 'Adamant arrow', 'Rune arrow'], label: 'Ammo', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },

    food: { type: 'string', default: 'Lobster', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },

    panicHp: { type: 'number', default: 25, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'retreat to the bank when HP drops this low (out of food, or damage outpacing eating)' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the fire giant drop table; ticked drops get grabbed. Everything picked up is banked — the bank keeps only food/runes/ammo/weapon plus the amulet, rope, and escape runes.' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury big bones', group: 'Banking & loot', help: 'bury Big bones for Prayer xp instead of banking them (always looted when on)' },
    safespotTile: { type: 'tile', default: DEFAULT_SAFESPOT, label: 'Safespot tile (west room)', group: 'Location', showIf: SHOW_SAFESPOT, help: 'preferred spot in the west room — sees two giants. If one reaches it the bot drops to the fallback tile for a minute' },
    safespotFallbackTile: { type: 'tile', default: DEFAULT_SAFESPOT_FALLBACK, label: 'Safespot fallback tile', group: 'Location', showIf: SHOW_SAFESPOT, help: 'retreat tile used for a minute whenever a giant reaches the main safespot; must be somewhere no giant can path to' },
    meleeTile: { type: 'tile', default: DEFAULT_MELEE_TILE, label: 'Melee anchor tile (centre room)', group: 'Location', showIf: SHOW_MELEE, help: 'centre of the east chamber — 7 giants within 6 tiles' },
    escapeTele: { type: 'string', default: BARREL_EXIT, options: EXIT_OPTIONS, label: 'Way out', group: 'Location', help: 'Barrel walks out through the dungeon door and rides the barrel off the ledge to 2527,3413 — free, no runes or magic level, 118 tiles from Ardougne West. A teleport only saves the walk back to the exit door' },
    teleStock: { type: 'number', default: 2, min: 1, max: 10, label: 'Spare escape casts', group: 'Location', help: 'casts carried on top of the one needed to leave' },
    bankTile: { type: 'tile', default: ESCAPE_TELES.Camelot.bank, label: 'Bank stand tile', group: 'Location', help: 'left at the Seers default, this follows the escape teleport' }
};

let STYLE: 'melee' | 'mage' | 'range' = 'melee';
let MELEE_STYLE: MeleeCombatStyle = 'strength';
let RANGE_MODE = 1;
let WEAPON = '';
let SPELL = 'Wind Strike';
let AMMO = 'Iron arrow';
let FOOD_NAME = 'Lobster';

let PANIC_HP = 0.25;
let RUNES_WITHDRAW = 150;
let RUNE_BUFFER = 500;
let AMMO_WITHDRAW = 500;
let FOOD_WITHDRAW = 20;
let LOOT_SET = new Set<string>();
let BANK_COMMON = true;
let BURY_BONES = false;
let SAFESPOT = DEFAULT_SAFESPOT;
let SAFESPOT_FALLBACK = DEFAULT_SAFESPOT_FALLBACK;
let engagedIdx: number | null = null;
let retreated = false;
let lastHp = -1;
let MELEE_TILE = DEFAULT_MELEE_TILE;
let BANK_TILE = ESCAPE_TELES.Camelot.bank;
let TELE: EscapeTele = ESCAPE_TELES.Camelot;
let TELE_STOCK = 2;
let USE_BARREL = true;

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

function needEat(): boolean {
    if (!hasFood()) {
        return false;
    }
    return shouldEatToUseFood({
        hp: Skills.effective('hitpoints'),
        maxHp: Skills.level('hitpoints'),
        heal: foodHealAmount(FOOD_NAME),
        foodCount: 1
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
    if (STYLE === 'range') {
        return ammoLeft() === 0;
    }
    return false;
}

function usesSafespot(): boolean {
    return STYLE === 'mage' || STYLE === 'range';
}
function activeSafespot(): Tile {
    return retreated ? SAFESPOT_FALLBACK : SAFESPOT;
}
function anchor(): Tile {
    return usesSafespot() ? activeSafespot() : MELEE_TILE;
}
// The forward spot trades safety for a second giant in view, so taking a hit there is
// expected rather than a fault. Damage is the honest trigger — a giant walking past
// is harmless, and only something actually connecting means the tile has failed.
function checkRetreat(bot: FireGiant): boolean {
    const hp = Skills.effective('hitpoints');
    const hurt = lastHp >= 0 && hp < lastHp;
    lastHp = hp;
    if (!usesSafespot() || retreated || !hurt) {
        return false;
    }
    retreated = true;
    bot.log(`took a hit at ${SAFESPOT} — falling back to ${SAFESPOT_FALLBACK} until the next kill`);
    return true;
}

// A kill means whatever reached us is gone, so the forward spot is worth retrying.
function clearRetreat(bot: FireGiant): void {
    if (retreated) {
        retreated = false;
        bot.log(`giant down — back to ${SAFESPOT}`);
    }
}
function inField(tile: Tile): boolean {
    return anchor().distanceTo(tile) <= FIELD_RADIUS;
}
function atSafespot(): boolean {
    const here = Game.tile();
    const spot = activeSafespot();
    return here !== null && spot.x === here.x && spot.z === here.z && spot.level === here.level;
}
function inDungeon(): boolean {
    const here = Game.tile();
    return here !== null && here.z > DUNGEON_MIN_Z;
}
function hasAmulet(): boolean {
    return Inventory.count(AMULET) > 0 || Equipment.contains(AMULET);
}
function hasRope(): boolean {
    return Inventory.count(ROPE) > 0;
}

// Safespotting only ever engages giants sharing the anchor's chamber: the rooms
// overlap inside FIELD_RADIUS, and the nearest east giant is closer to the west
// safespot than two of the west ones, so a radius alone drags the bot next door.
function sameRoomAsAnchor(tile: Tile): boolean {
    return sameRoom(anchor(), tile);
}

function fieldGiants(): Npc[] {
    return Npcs.query()
        .name(TARGET)
        .where(n => inField(n.tile())
            && !takenByAnother({
                isOurs: n.index === engagedIdx,
                inCombat: n.snap.inCombat,
                targetsMe: n.targetsMe(),
                targetsAnother: n.targetsAnotherPlayer()
            })
            && (!usesSafespot() || sameRoomAsAnchor(n.tile())))
        .results();
}

// A drop we repeatedly fail to pick up would otherwise keep qualifying, and with the
// safespot walk-back in between the bot just trades places with it forever.
const lootSkip = new Map<string, number>();

function lootKey(g: { name: string | null; tile(): Tile }): string {
    return `${g.name ?? ''}@${g.tile().x},${g.tile().z}`;
}

function findLoot() {
    const now = performance.now();
    return GroundItems.query()
        .where(g => {
            const name = (g.name ?? '').toLowerCase();
            const wanted = LOOT_SET.has(name) || (BANK_COMMON && matchesCommonBankLoot(g.name ?? ''));
            // Someone else's kills in the next chamber are not ours to collect, and the
            // rooms overlap inside FIELD_RADIUS so distance will not keep us out of them
            return wanted && sameRoomAsAnchor(g.tile()) && (lootSkip.get(lootKey(g)) ?? 0) < now;
        })
        .within(FIELD_RADIUS)
        .nearest();
}

// Everything the next trip does not need goes in the bank. Looted runes and coins
// would otherwise pile up in the pack forever, and the spell/escape runes are
// deliberately NOT kept — the withdrawals put back exactly the configured amount,
// so a trip always leaves with a known quantity instead of a growing heap.
function keepNames(): string[] {
    return combatKeepNames({ food: FOOD_NAME, style: STYLE, ammo: AMMO, weapon: WEAPON, extra: [AMULET, ROPE] });
}

async function eatOnce(bot: FireGiant): Promise<boolean> {
    const food = Inventory.items().find(i => foodForms(FOOD_NAME).includes((i.name ?? '').toLowerCase()));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Math.round(hpFrac() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    await food.interact('Eat');
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

async function quickReturnToSafespot(bot: FireGiant): Promise<boolean> {
    bot.setStatus('returning to the safespot');
    // a tier switch is a one-tile hop, so a long per-attempt window just adds
    // latency while something is hitting us — retry sooner instead
    for (let i = 0; i < 4 && !atSafespot() && !EventSignal.pending(); i++) {
        DirectNavigator.walk(activeSafespot());
        if (await Execution.delayUntil(() => atSafespot(), 2000)) {
            break;
        }
    }
    return atSafespot();
}

async function lootOnce(bot: FireGiant): Promise<boolean> {
    const drop = findLoot();
    if (drop === null) {
        return false;
    }
    const name = drop.name ?? '';
    const key = lootKey(drop);
    bot.setStatus(`looting ${name}`);
    const usedBefore = Inventory.used();
    const countBefore = Inventory.count(name);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    // a stackable drop merges into an existing slot, so used() alone never moves for
    // coins, runes or arrows — the bulk of this table — and every one of them would
    // burn the full timeout and report failure
    const took = await Execution.delayUntil(
        () => Inventory.used() > usedBefore || Inventory.count(name) > countBefore,
        lootWaitMs(drop.distance())
    );
    if (took) {
        bot.countLoot(name);
        return true;
    }
    lootSkip.set(key, performance.now() + LOOT_SKIP_MS);
    bot.log(`could not pick up ${name} at ${drop.tile().x},${drop.tile().z} — ignoring it for ${LOOT_SKIP_MS / 1000}s`);
    return false;
}

// Loot lands on the corpse tile, so collecting it means leaving the safespot and
// tanking. Drain the pile in one pass instead of one item per task hop, and break
// off to eat rather than finishing the pile at low HP.
async function lootBurst(bot: FireGiant): Promise<void> {
    for (let i = 0; i < LOOT_BURST_MAX; i++) {
        if (EventSignal.pending() || bot.died || Inventory.isFull()) {
            return;
        }
        if (needEat()) {
            return;
        }
        if (findLoot() === null) {
            return;
        }
        // a failure blacklists that drop, so carry on and clear the rest of the pile
        // instead of abandoning it over one stubborn item
        await lootOnce(bot);
    }
}

function checkPrereqs(bot: FireGiant): boolean {
    if (Quests.status('Waterfall Quest') === 'notStarted') {
        bot.parkFor('the Waterfall Quest is not started — the log raft refuses to launch. Talk to Almera at 2515,3495, then restart.');
        return false;
    }
    if (!hasAmulet() && Inventory.isFull()) {
        bot.parkFor(`no ${AMULET} and the pack is full — free a slot so it can be withdrawn.`);
        return false;
    }
    return true;
}

function ledgeDoor() {
    return Locs.query()
        .name(LEDGE_LOC)
        .action(LEDGE_OP)
        .where(l => l.tile().x === LEDGE_DOOR.x && l.tile().z === LEDGE_DOOR.z)
        .first();
}

async function useRopeOn(locName: string): Promise<boolean> {
    const rope = Inventory.first(ROPE);
    if (rope === null) {
        return false;
    }
    const target = Locs.query().name(locName).nearest();
    if (target === null) {
        return false;
    }
    return Boolean(await rope.useOn(target));
}

class Parked implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return this.bot.parked;
    }
    async execute(): Promise<void> {
        await Execution.delayTicks(10);
    }
}

class Eat implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return needEat();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: FireGiant) {}
    private needWeapon(): boolean {
        return WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) !== null;
    }
    private needQuiver(): boolean {
        return STYLE === 'range' && Inventory.count(AMMO) > 0;
    }
    validate(): boolean {
        return STYLE !== 'melee' && this.fails < 5 && (this.needWeapon() || this.needQuiver());
    }
    async execute(): Promise<void> {
        if (this.needWeapon()) {
            this.bot.setStatus(`wielding ${WEAPON}`);
            if (await Equipment.equip(WEAPON)) {
                this.bot.log(`wielded ${WEAPON}`);
                this.fails = 0;
            } else {
                this.fails++;
            }
            return;
        }
        this.bot.setStatus(`equipping ${AMMO}`);
        if (await Equipment.equip(AMMO)) {
            this.bot.log(`equipped ${AMMO}`);
            this.fails = 0;
        } else {
            this.fails++;
        }
    }
}

class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: FireGiant) {}
    private selected(): boolean {
        return STYLE === 'range' ? Game.combatMode() === RANGE_MODE : Game.hasCombatStyle(MELEE_STYLE);
    }
    validate(): boolean {
        return STYLE !== 'mage' && !this.selected() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
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
            this.bot.log(`could not set the ${STYLE} attack style (combat tab not ready?) — retrying in ${ASSERT_RETRY_MS / 1000}s`);
        }
    }
}

class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        if (STYLE !== 'mage' || Autocast.armed() || Date.now() < this.retryAt) {
            return false;
        }
        if (castsLeft() < 1) {
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
            this.bot.log(`WARNING: could not arm autocast for '${SPELL}' — retrying in ${ASSERT_RETRY_MS / 1000}s (check spell/level/staff).`);
        }
    }
}

function hasEscapeRunes(): boolean {
    return USE_BARREL || TELE.runes.every(r => Inventory.count(r.rune) >= r.count);
}

async function castEscape(bot: FireGiant): Promise<boolean> {
    if (!hasEscapeRunes()) {
        bot.log(`no ${TELE.name}-teleport runes — cannot leave the dungeon`);
        return false;
    }
    if (Skills.level('magic') < TELE.level) {
        bot.log(`magic ${Skills.level('magic')} is below the ${TELE.level} needed for the ${TELE.name} teleport`);
        return false;
    }
    bot.setStatus(`teleporting to ${TELE.name}`);
    if (!(await Game.teleport(TELE.name))) {
        return false;
    }
    return Execution.delayUntil(() => !inDungeon(), 8000);
}

// Walk out: the exit door sits on the dungeon entry tile and drops us on the ledge,
// where the barrel washes us to 2527,3413. Free, and the only route that works with
// no runes at all. The teleport modes skip the walk back to the door.
async function exitViaBarrel(bot: FireGiant): Promise<boolean> {
    if (inDungeon()) {
        bot.setStatus('walking to the dungeon door');
        await Traversal.walkResilient(EXIT_DOOR, { radius: 1, attempts: 5, timeoutMs: 180_000, log: m => bot.log(`  ${m}`) });
        const door = Locs.query().name(EXIT_DOOR_LOC).where(l => l.tile().x === EXIT_DOOR.x && l.tile().z === EXIT_DOOR.z).first();
        if (door === null) {
            bot.log('the dungeon door is not in the scene yet — retrying');
            return false;
        }
        bot.setStatus('leaving through the dungeon door');
        await door.interact('Open');
        if (!(await Execution.delayUntil(() => legFor(Game.tile()) === 'AtLedge', 12_000))) {
            bot.log('the dungeon door did not put us on the ledge — retrying');
            return false;
        }
        bot.log('out on the ledge');
    }
    if (legFor(Game.tile()) !== 'AtLedge') {
        return true;
    }
    // locs read empty for a tick after the p_teleport onto the ledge
    let barrel = Locs.query().name(BARREL_LOC).action(BARREL_OP).nearest();
    for (let i = 0; i < 5 && barrel === null; i++) {
        await Execution.delayTicks(1);
        barrel = Locs.query().name(BARREL_LOC).action(BARREL_OP).nearest();
    }
    if (barrel === null) {
        bot.log('the barrel is not in the scene yet — retrying');
        return false;
    }
    bot.setStatus('riding the barrel off the ledge');
    await barrel.interact(BARREL_OP);
    if (!(await Execution.delayUntil(() => legFor(Game.tile()) === 'WashedOut', 12_000))) {
        bot.log('the barrel did not wash us downstream — retrying');
        return false;
    }
    bot.log('washed up downstream — walking to the bank');
    return true;
}

async function leaveDungeon(bot: FireGiant): Promise<boolean> {
    if (!inDungeon() && legFor(Game.tile()) !== 'AtLedge') {
        return true;
    }
    if (USE_BARREL) {
        return exitViaBarrel(bot);
    }
    for (let i = 0; i < 3 && inDungeon(); i++) {
        if (await castEscape(bot)) {
            bot.log(`teleported out to ${TELE.name}`);
            return true;
        }
        await Execution.delayTicks(3);
    }
    if (!inDungeon()) {
        return true;
    }
    // the barrel always works, so a dud teleport is a detour rather than a dead end
    bot.log(`the ${TELE.name} teleport will not fire — walking out through the barrel instead`);
    return exitViaBarrel(bot);
}

async function bankRoutine(bot: FireGiant, withdrawFood: boolean): Promise<void> {
    if (!(await leaveDungeon(bot))) {
        return;
    }
    if (!(await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) }))) {
        bot.log('walk to the bank failed — will retry');
        return;
    }
    if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => bot.log(`  ${m}`)))) {
        bot.log('could not open the bank — will retry');
        return;
    }
    await Bank.depositAllMatching(depositAllExcept(keepNames()), m => bot.log(`  ${m}`));

    if (withdrawFood) {
        await withdrawFoodTo(bot);
    }

    await withdrawStyleSupplies(bot);
    await withdrawEscapeRunes(bot);
    await withdrawEntryKit(bot);

    await ensureEscapeRunes(bot);

    // Heal at the booth, not on the way in — the trip back is long and the first
    // giant should not meet a half-health bot. Top the food back up afterwards so
    // eating here does not come out of the trip's supplies.
    if (await healUp(bot) && withdrawFood) {
        await withdrawFoodTo(bot);
    }

    bot.countBankTrip();
    bot.setStatus('restocked — heading back to the waterfall');
}

async function withdrawFoodTo(bot: FireGiant): Promise<void> {
    bot.setStatus(`withdrawing ${FOOD_NAME}`);
    for (let guard = 0; guard < 12 && foodCount() < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
        const need = FOOD_WITHDRAW - foodCount();
        const before = foodCount();
        await Bank.withdraw(FOOD_NAME, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => foodCount() > before, 2500))) {
            break;
        }
    }
    if (foodCount() === 0) {
        bot.noteBankEmpty(true);
        bot.log(`WARNING: no '${FOOD_NAME}' in the bank — carrying on without food. Deposit food (or fix the name) to resume eating.`);
    } else {
        bot.noteBankEmpty(false);
    }
}

async function healUp(bot: FireGiant): Promise<boolean> {
    if (hpFrac() >= BANK_HEAL_TO || !hasFood()) {
        return false;
    }
    bot.setStatus('eating up before the trip back');
    const from = Math.round(hpFrac() * 100);
    for (let i = 0; i < 24 && hpFrac() < BANK_HEAL_TO && hasFood(); i++) {
        if (!(await eatOnce(bot))) {
            break;
        }
    }
    bot.log(`healed ${from}% -> ${Math.round(hpFrac() * 100)}% before heading back`);
    return true;
}

async function withdrawEscapeRunes(bot: FireGiant): Promise<void> {
    for (const { rune, count } of TELE.runes) {
        const target = count * (TELE_STOCK + 1);
        if (Inventory.count(rune) < target) {
            await withdrawTo(rune, target);
        }
    }
    if (!hasEscapeRunes()) {
        bot.log(`WARNING: bank is short of ${TELE.name}-teleport runes — the next trip cannot leave the dungeon.`);
    }
}

// Never fatal: the barrel walks out for free, so missing teleport runes cost a
// detour to the dungeon door rather than stranding anything.
async function ensureEscapeRunes(bot: FireGiant): Promise<void> {
    if (USE_BARREL) {
        return;
    }
    for (let attempt = 0; attempt < 3 && !hasEscapeRunes(); attempt++) {
        await withdrawEscapeRunes(bot);
    }
    if (hasEscapeRunes()) {
        return;
    }
    const short = TELE.runes.filter(r => Inventory.count(r.rune) + Bank.count(r.rune) < r.count);
    const why = short.length > 0 ? `the bank is out of ${short.map(r => r.rune).join(' and ')}` : 'the withdrawal would not stick';
    bot.log(`WARNING: no ${TELE.name}-teleport runes — ${why}. Walking out through the barrel instead.`);
}

async function withdrawEntryKit(bot: FireGiant): Promise<void> {
    if (!hasAmulet()) {
        await withdrawTo(AMULET, 1);
    }
    if (!hasRope()) {
        await withdrawTo(ROPE, 1);
    }
    if (!hasAmulet()) {
        bot.parkFor(`no ${AMULET} in the bank or on the player — it is required to open the ledge door and cannot be re-obtained without redoing the Waterfall Quest chain.`);
        return;
    }
    if (!hasRope()) {
        bot.parkFor('no Rope in the bank or on the player — it is required for both the rock and the dead tree. Bank a rope and restart.');
    }
}

async function withdrawStyleSupplies(bot: FireGiant): Promise<void> {
    if (STYLE !== 'melee' && WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) === null) {
        bot.setStatus(`withdrawing ${WEAPON}`);
        if ((await withdrawTo(WEAPON, 1)) > 0) {
            await Equipment.equip(WEAPON);
            bot.log(`withdrew and wielded ${WEAPON}`);
        } else {
            bot.log(`WARNING: no '${WEAPON}' in the bank — carrying on with current gear.`);
        }
    }
    if (STYLE === 'mage') {
        bot.setStatus('withdrawing runes');
        // Looted runes let the trip outrun its cast budget — fire giants drop chaos,
        // so the spell keeps firing until the scarcest rune runs dry. When that rune
        // is also the escape teleport's (Camelot burns air, so does most of the
        // standard book) the bot ends up unable to leave. Runes stack, so a spare
        // few hundred costs one slot.
        for (const { rune, count } of runeWithdrawList(SPELL, wieldedNames(), RUNES_WITHDRAW)) {
            const target = count + RUNE_BUFFER;
            if (Inventory.count(rune) < target) {
                const got = await withdrawTo(rune, target);
                bot.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${target})`);
            }
        }
        if (castsLeft() < 1) {
            bot.noteSupplyEmpty(true);
            bot.log(`WARNING: bank can't supply a single '${SPELL}' cast — deposit runes to resume.`);
        } else {
            bot.noteSupplyEmpty(false);
        }
    } else if (STYLE === 'range') {
        bot.setStatus(`withdrawing ${AMMO}`);
        const got = await withdrawTo(AMMO, AMMO_WITHDRAW);
        if (got > 0) {
            await Equipment.equip(AMMO);
            bot.log(`withdrew ${got} ${AMMO}`);
            bot.noteSupplyEmpty(false);
        } else if (ammoLeft() === 0) {
            // an empty bank is only a problem when the quiver is empty too
            bot.noteSupplyEmpty(true);
            bot.log(`WARNING: no '${AMMO}' in the bank — deposit ammo to resume.`);
        }
    }
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

class PanicBank implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return hpFrac() < PANIC_HP && !hasFood();
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('panic — retreating to the bank');
        this.bot.log(`panic at ${Math.round(hpFrac() * 100)}% hp — banking for food`);
        await bankRoutine(this.bot, true);
    }
}

class BuryBones implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return BURY_BONES && Inventory.contains('Big bones');
    }
    async execute(): Promise<void> {
        const bones = Inventory.first('Big bones');
        if (!bones) {
            return;
        }
        this.bot.setStatus('burying big bones');
        const before = Inventory.used();
        if (!(await bones.interact('Bury'))) {
            this.bot.log(`no Bury op on big bones? ops=[${bones.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.bot.countBurial();
        }
    }
}

class BankRun implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        if (needStyleSupplies() && !this.bot.supplyKnownEmpty()) {
            return true;
        }
        if (!hasFood() && !this.bot.bankKnownEmpty()) {
            return true;
        }
        return Inventory.isFull();
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking — restocking');
        this.bot.log(`banking (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : ''}${STYLE === 'range' ? `, ammo ${Inventory.count(AMMO)}` : ''})`);
        await bankRoutine(this.bot, true);
    }
}

class LootCorpse implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return inDungeon() && !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootBurst(this.bot);
        // End the excursion where it started. Leaving the walk back to
        // ReturnToSafespot lets it cancel a pickup still in flight, the loot stays on
        // the floor, and the two tasks trade places forever.
        if (usesSafespot() && !atSafespot() && hpFrac() >= PANIC_HP) {
            await quickReturnToSafespot(this.bot);
        }
    }
}

class ReturnToSafespot implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return inDungeon() && usesSafespot() && !atSafespot() && hpFrac() >= PANIC_HP;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to the safespot');
        await Traversal.walkResilient(activeSafespot(), { radius: 0, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class EnterDungeon implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return !inDungeon() && hasAmulet() && hasRope() && !this.bot.parked;
    }
    async execute(): Promise<void> {
        switch (legFor(Game.tile())) {
            case 'AtLedge':
                await this.openLedge();
                return;
            case 'PastRock':
                await this.ropeTree();
                return;
            case 'AtLanding':
                await this.ropeRock();
                return;
            case 'AtRaft':
                await this.boardRaft();
                return;
            case 'WashedOut':
                this.bot.log('washed downstream — walking back to the raft');
                await this.walkToRaft();
                return;
            default:
                await this.walkToRaft();
        }
    }

    private async walkToRaft(): Promise<void> {
        this.bot.setStatus('walking to the log raft');
        await Traversal.walkResilient(RAFT_STAND, { radius: 2, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }

    private async boardRaft(): Promise<void> {
        const raft = Locs.query().name(RAFT_LOC).action(RAFT_OP).nearest();
        if (raft === null) {
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus('boarding the log raft');
        if (!(await raft.interact(RAFT_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => legFor(Game.tile()) === 'AtLanding', 12_000)) {
            this.bot.log('rafted down to the landing');
        }
    }

    private async ropeRock(): Promise<void> {
        const here = Game.tile();
        if (here === null || here.x !== ROPE_THROW_STAND.x || here.z !== ROPE_THROW_STAND.z) {
            this.bot.setStatus('walking to the rope-throw stand');
            await Traversal.walkResilient(ROPE_THROW_STAND, { radius: 0, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
            return;
        }
        this.bot.setStatus('roping across to the rock');
        if (!(await useRopeOn(ROCK_LOC))) {
            this.bot.log(`could not use the rope on the ${ROCK_LOC} — retrying`);
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => legFor(Game.tile()) === 'PastRock', 12_000)) {
            this.bot.log('crossed to the rock');
            return;
        }
        this.bot.log('rope throw did not cross — retrying');
    }

    private async ropeTree(): Promise<void> {
        const here = Game.tile();
        if (here === null || here.x !== TREE_STAND.x || here.z !== TREE_STAND.z) {
            this.bot.setStatus('walking to the dead tree');
            await Traversal.walkResilient(TREE_STAND, { radius: 0, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
            return;
        }
        this.bot.setStatus('roping down the dead tree');
        if (!(await useRopeOn(TREE_LOC))) {
            this.bot.log(`could not use the rope on the ${TREE_LOC} — retrying`);
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => legFor(Game.tile()) === 'AtLedge', 12_000)) {
            this.bot.log('down on the ledge');
            return;
        }
        this.bot.log('rope-down did not land on the ledge — retrying');
    }

    private async openLedge(): Promise<void> {
        if (!hasAmulet()) {
            return;
        }
        // locs read empty for a tick after the p_teleport onto the ledge
        let door = ledgeDoor();
        for (let i = 0; i < 5 && door === null; i++) {
            await Execution.delayTicks(1);
            door = ledgeDoor();
        }
        if (door === null) {
            this.bot.log('the ledge door is not in the scene yet — retrying');
            return;
        }
        this.bot.setStatus('opening the ledge door');
        if (!(await door.interact(LEDGE_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => inDungeon(), 12_000)) {
            this.bot.log('inside the Waterfall Dungeon');
            return;
        }
        this.bot.log('the ledge door did not let us through — retrying');
    }
}

class WalkToSpot implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        const here = Game.tile();
        return inDungeon() && here !== null && anchor().distanceTo(here) > FIELD_RADIUS;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to the fight spot');
        await Traversal.walkResilient(anchor(), { radius: usesSafespot() ? 0 : 3, attempts: 6, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class Fight implements Task {
    private targetIdx: number | null = null;
    private engagedAt = 0;
    private engagedHealth = -1;
    private skip = new Map<number, number>();
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        if (!inDungeon() || hpFrac() < PANIC_HP) {
            return false;
        }
        if (usesSafespot() && !atSafespot()) {
            return false;
        }
        return fieldGiants().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('fighting fire giants');
        const deadline = performance.now() + 120_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue()) {
                return;
            }
            if (needEat()) {
                await eatOnce(this.bot);
                continue;
            }
            if (hpFrac() < PANIC_HP) {
                return;
            }
            if (checkRetreat(this.bot)) {
                // reposition on the spot: falling through would loot or re-attack
                // first, and hopping out to ReturnToSafespot costs another task hop
                await quickReturnToSafespot(this.bot);
                continue;
            }

            const giants = fieldGiants();
            if (this.targetIdx !== null && !giants.some(g => g.index === this.targetIdx)) {
                this.bot.countKill();
                this.bot.log(`fire giant down — ${this.bot.kills()} kills`);
                this.targetIdx = null;
                this.bot.targetIdx = null;
                engagedIdx = null;
                clearRetreat(this.bot);
            }

            if (usesSafespot() && !atSafespot()) {
                if (!(await quickReturnToSafespot(this.bot))) {
                    return;
                }
                continue;
            }
            if (!Inventory.isFull() && findLoot() !== null) {
                await lootBurst(this.bot);
                continue;
            }

            // You stay in combat with a giant until one of you dies, so re-clicking a
            // live target is pure noise. Game.inCombat() reads our OWN combat bar,
            // which never lights up while safespotting, so it is useless here — hold
            // the target instead. The hold breaks early on anything that means the
            // situation moved: a random event, a hit landing on us, or the giant's
            // health changing (which proves we are connecting and resets the clock).
            const live = this.targetIdx === null ? undefined : giants.find(g => g.index === this.targetIdx);
            if (live && live.targetsAnotherPlayer()) {
                this.bot.log(`giant ${live.index} was taken by another player — finding another`);
                this.skip.set(live.index, performance.now() + TAKEN_SKIP_MS);
                this.targetIdx = null;
                this.bot.targetIdx = null;
                engagedIdx = null;
                continue;
            }
            if (live) {
                if (live.snap.health !== this.engagedHealth) {
                    this.engagedHealth = live.snap.health;
                    this.engagedAt = performance.now();
                }
                if (performance.now() - this.engagedAt < RE_ENGAGE_MS) {
                    // Inline, not the sibling task: this loop owns the bot for the
                    // whole fight, so BuryBones above it only ran in whatever gaps
                    // the loop happened to leave. This hold is the idle stretch
                    // while the giant is being worn down — the tick is free here.
                    if (BURY_BONES && (await buryOneInFight('Big bones'))) {
                        this.bot.countBurial();
                        continue;
                    }
                    await Execution.delayTicks(1);
                    continue;
                }
            }

            const now = performance.now();
            const candidates = giants.filter(g => !usesSafespot() || (this.skip.get(g.index) ?? 0) < now);
            const target = usesSafespot()
                ? candidates.sort((a, b) => eastFirst({ x: a.tile().x, distance: a.distance() }, { x: b.tile().x, distance: b.distance() }))[0]
                : candidates.sort((a, b) => a.distance() - b.distance())[0];
            if (!target) {
                await Execution.delayTicks(2);
                return;
            }

            if (usesSafespot() && target.distance() > attackRangeFor(STYLE)) {
                if (!(await this.leash(target.index))) {
                    this.skip.set(target.index, performance.now() + LEASH_SKIP_MS);
                }
                continue;
            }

            const tierBefore = retreated;
            if (target.index !== this.targetIdx) {
                this.bot.log(`engaging fire giant ${target.index} at ${target.tile().x},${target.tile().z} (d=${target.distance()})`);
            } else {
                this.bot.log(`giant ${target.index} stalled — re-issuing the attack`);
            }
            await target.interact('Attack');
            this.targetIdx = target.index;
            this.bot.targetIdx = target.index;
            engagedIdx = target.index;
            this.engagedAt = performance.now();
            this.engagedHealth = -1;
            await Execution.delayUntil(() => (usesSafespot() && !atSafespot()) || fieldGiants().length === 0, 1200);
            if (usesSafespot() && !atSafespot()) {
                // A tier switch moves us one tile on purpose; that is not the giant
                // dragging us, and dropping the target here is what looked like the
                // bot losing aggro and running mid-fight.
                if (retreated !== tierBefore) {
                    this.bot.log(`safespot tier changed mid-fight — keeping giant ${target.index}`);
                    continue;
                }
                this.skip.set(target.index, now + 8000);
                this.bot.log(`giant ${target.index} pulled us off the safespot — skipping it for 8s`);
                this.targetIdx = null;
                this.bot.targetIdx = null;
                engagedIdx = null;
                continue;
            }
        }
    }

    // Hold the tile while the giant closes. Clicking it from here would make the
    // server walk us into range and ReturnToSafespot would drag us back before the
    // shot leaves, which is the back-and-forth this replaces. False = it never came.
    private async leash(idx: number): Promise<boolean> {
        this.bot.setStatus('leashing fire giant');
        this.bot.targetIdx = idx;
        const deadline = performance.now() + LEASH_WAIT_MS;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue()) {
                return true;
            }
            if (needEat()) {
                await eatOnce(this.bot);
                continue;
            }
            if (checkRetreat(this.bot)) {
                return true;
            }
            if (!atSafespot()) {
                if (!(await quickReturnToSafespot(this.bot))) {
                    return true;
                }
                continue;
            }
            const giant = fieldGiants().find(g => g.index === idx);
            if (!giant) {
                return true;
            }
            if (giant.distance() <= attackRangeFor(STYLE)) {
                return true;
            }
            await Execution.delayTicks(1);
        }
        return false;
    }
}

export default class FireGiant extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private killsTotal = 0;
    private looted = 0;
    private buriedTotal = 0;
    private bankTrips = 0;
    private startedAt = Date.now();
    private xpAtStart = 0;
    private lootCounts = new Map<string, number>();
    private supplyEmpty = false;
    private bankEmpty = false;

    died = false;
    parked = false;
    targetIdx: number | null = null;
    private parkReason = '';

    parkFor(reason: string): void {
        if (this.parked) {
            return;
        }
        this.parked = true;
        this.parkReason = reason;
        this.setStatus('parked');
        this.log(`PARKED: ${reason}`);
    }

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        STYLE = (this.settings.str('combatStyle', 'melee') as 'melee' | 'mage' | 'range');
        MELEE_STYLE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        SPELL = this.settings.str('spell', 'Wind Strike');
        AMMO = this.settings.str('ammo', 'Iron arrow');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of air')
            : STYLE === 'range' ? this.settings.str('bow', 'Maple shortbow') : '';
        FOOD_NAME = this.settings.str('food', 'Lobster');

        PANIC_HP = this.settings.num('panicHp', 25) / 100;
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        RUNE_BUFFER = this.settings.num('runeBuffer', 500);
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        LOOT_SET = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        BURY_BONES = this.settings.bool('buryBones', false);
        if (BURY_BONES) {
            LOOT_SET.add('big bones');
        }
        SAFESPOT = this.settings.tile('safespotTile', DEFAULT_SAFESPOT);
        SAFESPOT_FALLBACK = this.settings.tile('safespotFallbackTile', DEFAULT_SAFESPOT_FALLBACK);
        retreated = false;
        lastHp = -1;
        MELEE_TILE = this.settings.tile('meleeTile', DEFAULT_MELEE_TILE);
        const exit = this.settings.str('escapeTele', BARREL_EXIT);
        USE_BARREL = exit === BARREL_EXIT;
        TELE = ESCAPE_TELES[exit] ?? ESCAPE_TELES.Camelot;
        TELE_STOCK = this.settings.num('teleStock', 2);
        const chosenBank = this.settings.tile('bankTile', ESCAPE_TELES.Camelot.bank);
        const bankIsDefault = chosenBank.x === ESCAPE_TELES.Camelot.bank.x && chosenBank.z === ESCAPE_TELES.Camelot.bank.z;
        BANK_TILE = bankIsDefault ? (USE_BARREL ? BARREL_BANK : TELE.bank) : chosenBank;

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
                const where = Game.tile();
                this.parkFor(`died${where ? ` at ${where.x},${where.z}` : ''}. Gear is on the death pile in the Waterfall Dungeon and ${AMULET} may be with it — re-entry is impossible without it, so the bot stopped rather than burn bank stock.`);
            }
        });

        this.startedAt = Date.now();
        this.xpAtStart = XP_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);

        this.log(`FireGiant — style ${STYLE}${STYLE !== 'melee' ? ` w/ ${WEAPON}` : ''}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (smart-eat, panic<${Math.round(PANIC_HP * 100)}%), spot ${anchor()}, escape ${TELE.name} tele, bank ${BANK_TILE}${BURY_BONES ? ', burying big bones' : ''}`);

        this.add(
            new Parked(this),
            new ContinueDialog(),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new PanicBank(this),
            new BuryBones(this),
            new BankRun(this),
            new LootCorpse(this),
            new EnterDungeon(this),
            new WalkToSpot(this),
            new ReturnToSafespot(this),
            new Fight(this)
        );

        checkPrereqs(this);
    }

    override recoveryAnchor(): Tile | null {
        return anchor();
    }
    override grindTargets(): string[] {
        return [TARGET.toLowerCase()];
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.killsTotal++;
    }
    kills(): number {
        return this.killsTotal;
    }
    countLoot(name?: string | null): void {
        this.looted++;
        if (name) {
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + 1);
        }
    }
    countBurial(): void {
        this.buriedTotal++;
    }
    countBankTrip(): void {
        this.bankTrips++;
    }
    noteSupplyEmpty(v: boolean): void {
        this.supplyEmpty = v;
    }
    supplyKnownEmpty(): boolean {
        return this.supplyEmpty;
    }
    noteBankEmpty(v: boolean): void {
        this.bankEmpty = v;
    }
    bankKnownEmpty(): boolean {
        return this.bankEmpty;
    }

    private outlineTarget(ctx: CanvasRenderingContext2D): void {
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e08b5a' });
        p.title(`FireGiant — ${this.status}`);
        if (this.parked) {
            p.text(this.parkReason, '#e0705a');
        }

        const tab = p.tabs('fg', ['Overview', 'Loot']);
        if (tab === 'Overview') {
            const mins = (Date.now() - this.startedAt) / 60_000;
            const xpGained = XP_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - this.xpAtStart;
            const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.killsTotal}`, `XP/hr: ${xph}`);
            p.row(`Style: ${STYLE}`, STYLE === 'mage' ? `Casts: ${castsLeft()}${Autocast.armed() ? '' : ' (OFF)'}` : STYLE === 'range' ? `Ammo: ${ammoLeft()}` : `Food: ${foodCount()}`, `Bank trips: ${this.bankTrips}`);
            p.bar('HP', hpFrac());
        } else {
            p.row(`Looted: ${this.looted}`, ...(BURY_BONES ? [`Buried: ${this.buriedTotal}`] : []), `Bank trips: ${this.bankTrips}`);
            const top = [...this.lootCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
            if (top.length === 0) {
                p.text('nothing yet', '#8a919a');
            }
            for (let i = 0; i < top.length; i += 2) {
                p.row(...top.slice(i, i + 2).map(([name, n]) => `${name} × ${n}`));
            }
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
