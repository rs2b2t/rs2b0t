import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
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
import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS, parseCombatStyle, parseRangeStyle } from '../api/CombatStyle.js';
import { Autocast } from '../api/combat/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../api/combat/data/spelldb.js';
import { DROP_DB } from '../api/combat/data/dropdb.js';
import { BOWS, STAFFS } from '../api/combat/equipment.js';
import { FOOD_OPTIONS, foodForms, foodCount as foodCountIn } from '../api/combat/food.js';
import { combatKeepNames } from '../api/combat/keepList.js';
import { depositAllExcept, matchesCommonBankLoot } from '../api/Banking.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { actions } from '../adapter/ClientAdapter.js';
import { Quests } from '../api/hud/Quests.js';
import { Locs } from '../api/queries/Locs.js';
import {
    AMULET, DEFAULT_MELEE_TILE, DEFAULT_SAFESPOT, DUNGEON_MIN_Z, ESCAPE_TELE_OPTIONS, ESCAPE_TELES,
    LEDGE_DOOR, LEDGE_LOC, LEDGE_OP, legFor, RAFT_LOC, RAFT_OP, RAFT_STAND,
    ROCK_LOC, ROPE, ROPE_THROW_STAND, TREE_LOC, TREE_STAND, type EscapeTele
} from './FireGiantLogic.js';

const TARGET = 'Fire giant';
const FIELD_RADIUS = 10;

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
    bow: { type: 'string', default: 'Maple shortbow', options: BOWS, label: 'Bow', group: 'Combat', showIf: SHOW_RANGE, help: 'wielded bow, withdrawn from bank when missing' },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Iron arrow', options: ['Bronze arrow', 'Iron arrow', 'Steel arrow', 'Mithril arrow', 'Adamant arrow', 'Rune arrow'], label: 'Ammo', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },

    food: { type: 'string', default: 'Lobster', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    eatHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%', group: 'Food & healing' },
    panicHp: { type: 'number', default: 25, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'retreat to the bank when HP drops this low (out of food, or damage outpacing eating)' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the fire giant drop table; ticked drops get grabbed. Everything picked up is banked — the bank keeps only food/runes/ammo/weapon plus the amulet, rope, and escape runes.' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury big bones', group: 'Banking & loot', help: 'bury Big bones for Prayer xp instead of banking them (always looted when on)' },
    safespotTile: { type: 'tile', default: DEFAULT_SAFESPOT, label: 'Safespot tile (west room)', group: 'Location', showIf: SHOW_SAFESPOT, help: 'north nook of the west room; giants are 2x2 and leash 5 tiles from spawn, so they cannot reach it' },
    meleeTile: { type: 'tile', default: DEFAULT_MELEE_TILE, label: 'Melee anchor tile (centre room)', group: 'Location', showIf: SHOW_MELEE, help: 'centre of the east chamber — 7 giants within 6 tiles' },
    escapeTele: { type: 'string', default: 'Camelot', options: ESCAPE_TELE_OPTIONS, label: 'Escape teleport', group: 'Location', help: 'the dungeon has no walk-out, so banking always teleports. Walk back to the raft: Camelot 352 tiles, Ardougne 274, Falador 771, Varrock 910' },
    teleStock: { type: 'number', default: 2, min: 1, max: 10, label: 'Spare escape casts', group: 'Location', help: 'casts carried on top of the one needed to leave' },
    bankTile: { type: 'tile', default: ESCAPE_TELES.Camelot.bank, label: 'Bank stand tile', group: 'Location', help: 'left at the Seers default, this follows the escape teleport' }
};

let STYLE: 'melee' | 'mage' | 'range' = 'melee';
let MELEE_MODE = 1;
let RANGE_MODE = 1;
let WEAPON = '';
let SPELL = 'Wind Strike';
let AMMO = 'Iron arrow';
let FOOD_NAME = 'Lobster';
let EAT_HP = 0.5;
let PANIC_HP = 0.25;
let RUNES_WITHDRAW = 150;
let AMMO_WITHDRAW = 500;
let FOOD_WITHDRAW = 20;
let LOOT_SET = new Set<string>();
let BANK_COMMON = true;
let BURY_BONES = false;
let SAFESPOT = DEFAULT_SAFESPOT;
let MELEE_TILE = DEFAULT_MELEE_TILE;
let BANK_TILE = ESCAPE_TELES.Camelot.bank;
let TELE: EscapeTele = ESCAPE_TELES.Camelot;
let TELE_STOCK = 2;

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
function anchor(): Tile {
    return usesSafespot() ? SAFESPOT : MELEE_TILE;
}
function inField(tile: Tile): boolean {
    return anchor().distanceTo(tile) <= FIELD_RADIUS;
}
function atSafespot(): boolean {
    const here = Game.tile();
    return here !== null && SAFESPOT.x === here.x && SAFESPOT.z === here.z && SAFESPOT.level === here.level;
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

function fieldGiants(): Npc[] {
    return Npcs.query()
        .name(TARGET)
        .where(n => inField(n.tile()) && !n.targetsAnotherPlayer())
        .results();
}

function findLoot() {
    return GroundItems.query()
        .where(g => {
            const name = (g.name ?? '').toLowerCase();
            return LOOT_SET.has(name) || (BANK_COMMON && matchesCommonBankLoot(g.name ?? ''));
        })
        .within(FIELD_RADIUS)
        .nearest();
}

function keepNames(): string[] {
    return combatKeepNames({
        food: FOOD_NAME, style: STYLE, spell: SPELL, ammo: AMMO, weapon: WEAPON,
        extra: ['Coins', AMULET, ROPE, ...TELE.runes.map(r => r.rune)]
    });
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
    for (let i = 0; i < 3 && !atSafespot() && !EventSignal.pending(); i++) {
        DirectNavigator.walk(SAFESPOT);
        if (await Execution.delayUntil(() => atSafespot(), 4000)) {
            break;
        }
    }
    return atSafespot();
}

async function lootOnce(bot: FireGiant): Promise<boolean> {
    const drop = findLoot();
    if (!drop) {
        return false;
    }
    bot.setStatus(`looting ${drop.name}`);
    const before = Inventory.used();
    await drop.interact('Take');
    if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
        bot.countLoot(drop.name);
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
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
        return hpFrac() < EAT_HP && hasFood();
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
    private target(): number {
        return STYLE === 'range' ? RANGE_MODE : MELEE_MODE;
    }
    validate(): boolean {
        return STYLE !== 'mage' && Game.combatMode() !== this.target() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        const mode = this.target();
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(mode);
        if (await Execution.delayUntil(() => Game.combatMode() === mode, 3000)) {
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

const MAGIC_TAB = 6;

function hasEscapeRunes(): boolean {
    return TELE.runes.every(r => Inventory.count(r.rune) >= r.count);
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
    if (!(await Game.openSideTab(MAGIC_TAB))) {
        return false;
    }
    actions.ifButton(TELE.com);
    return Execution.delayUntil(() => !inDungeon(), 8000);
}

async function bankRoutine(bot: FireGiant, withdrawFood: boolean): Promise<void> {
    if (inDungeon()) {
        for (let i = 0; i < 3 && inDungeon(); i++) {
            if (await castEscape(bot)) {
                bot.log(`teleported out to ${TELE.name}`);
                break;
            }
            await Execution.delayTicks(3);
        }
        if (inDungeon()) {
            bot.parkFor(`stuck in the dungeon: the ${TELE.name} teleport will not fire. Bank ${TELE.runes.map(r => `${r.count} ${r.rune}`).join(' + ')} and check magic level ${TELE.level}.`);
            return;
        }
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

    await withdrawStyleSupplies(bot);
    await withdrawEscapeRunes(bot);
    await withdrawEntryKit(bot);

    bot.countBankTrip();
    bot.setStatus('restocked — heading back to the waterfall');
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
        for (const { rune, count } of runeWithdrawList(SPELL, wieldedNames(), RUNES_WITHDRAW)) {
            if (Inventory.count(rune) < count) {
                const got = await withdrawTo(rune, count);
                bot.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${count})`);
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
        await lootOnce(this.bot);
    }
}

class ReturnToSafespot implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return inDungeon() && usesSafespot() && !atSafespot() && hpFrac() >= PANIC_HP;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to the safespot');
        await Traversal.walkResilient(SAFESPOT, { radius: 0, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
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
            if (hpFrac() < EAT_HP && hasFood()) {
                await eatOnce(this.bot);
                continue;
            }
            if (hpFrac() < PANIC_HP) {
                return;
            }

            const giants = fieldGiants();
            if (this.targetIdx !== null && !giants.some(g => g.index === this.targetIdx)) {
                this.bot.countKill();
                this.bot.log(`fire giant down — ${this.bot.kills()} kills`);
                this.targetIdx = null;
            }

            if (!Inventory.isFull() && findLoot() !== null) {
                await lootOnce(this.bot);
                continue;
            }
            if (usesSafespot() && !atSafespot()) {
                if (!(await quickReturnToSafespot(this.bot))) {
                    return;
                }
                continue;
            }

            if (Game.inCombat()) {
                await Execution.delayTicks(2);
                continue;
            }

            const now = performance.now();
            const target = giants
                .filter(g => !usesSafespot() || (this.skip.get(g.index) ?? 0) < now)
                .sort((a, b) => a.distance() - b.distance())[0];
            if (!target) {
                await Execution.delayTicks(2);
                return;
            }

            await target.interact('Attack');
            this.targetIdx = target.index;
            await Execution.delayUntil(() => Game.inCombat() || (usesSafespot() && !atSafespot()) || fieldGiants().length === 0, 3000);
            if (usesSafespot() && !atSafespot()) {
                this.skip.set(target.index, now + 8000);
                this.targetIdx = null;
                continue;
            }
        }
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
        MELEE_MODE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        SPELL = this.settings.str('spell', 'Wind Strike');
        AMMO = this.settings.str('ammo', 'Iron arrow');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of air')
            : STYLE === 'range' ? this.settings.str('bow', 'Maple shortbow') : '';
        FOOD_NAME = this.settings.str('food', 'Lobster');
        EAT_HP = this.settings.num('eatHp', 50) / 100;
        PANIC_HP = this.settings.num('panicHp', 25) / 100;
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        AMMO_WITHDRAW = this.settings.num('ammoWithdraw', 500);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        LOOT_SET = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        BURY_BONES = this.settings.bool('buryBones', false);
        if (BURY_BONES) {
            LOOT_SET.add('big bones');
        }
        SAFESPOT = this.settings.tile('safespotTile', DEFAULT_SAFESPOT);
        MELEE_TILE = this.settings.tile('meleeTile', DEFAULT_MELEE_TILE);
        TELE = ESCAPE_TELES[this.settings.str('escapeTele', 'Camelot')] ?? ESCAPE_TELES.Camelot;
        TELE_STOCK = this.settings.num('teleStock', 2);
        const chosenBank = this.settings.tile('bankTile', ESCAPE_TELES.Camelot.bank);
        const bankIsDefault = chosenBank.x === ESCAPE_TELES.Camelot.bank.x && chosenBank.z === ESCAPE_TELES.Camelot.bank.z;
        BANK_TILE = bankIsDefault ? TELE.bank : chosenBank;

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
                const where = Game.tile();
                this.parkFor(`died${where ? ` at ${where.x},${where.z}` : ''}. Gear is on the death pile in the Waterfall Dungeon and ${AMULET} may be with it — re-entry is impossible without it, so the bot stopped rather than burn bank stock.`);
            }
        });

        this.startedAt = Date.now();
        this.xpAtStart = XP_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);

        this.log(`FireGiant — style ${STYLE}${STYLE !== 'melee' ? ` w/ ${WEAPON}` : ''}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (eat<${Math.round(EAT_HP * 100)}%, panic<${Math.round(PANIC_HP * 100)}%), spot ${anchor()}, escape ${TELE.name} tele, bank ${BANK_TILE}${BURY_BONES ? ', burying big bones' : ''}`);

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

    override onPaint(ctx: CanvasRenderingContext2D): void {
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
            p.row(`Style: ${STYLE}`, STYLE === 'mage' ? `Casts: ${castsLeft()}${Autocast.armed() ? '' : ' (OFF)'}` : STYLE === 'range' ? `Ammo: ${Inventory.count(AMMO)}` : `Food: ${foodCount()}`, `Bank trips: ${this.bankTrips}`);
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
