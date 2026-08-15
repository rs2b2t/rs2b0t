import { reader } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../../runtime/BotHost.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration, fmtXpHr, paintSkillShort } from '../../paint/paintLogic.js';
import { etaHours, levelProgress } from './levelProgress.js';
import { COMBAT_STYLE_OPTIONS, parseCombatStyle, type MeleeCombatStyle } from '../../api/combat/CombatStyle.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { DROP_DB } from '../../data/dropdb.js';
import { MELEE_WEAPONS, STAFFS } from '../../api/combat/equipment.js';
import { SA_MAX_ENERGY, Special } from './Special.js';
import { AttackClock, URGENT_HP_FRACTION, shouldHoldEat } from '../../api/combat/eatTiming.js';
import { buryOneInFight } from '../../api/combat/fightUpkeep.js';
import { foodForms, isFoodItem, foodCount as foodCountIn, foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import { combatKeepNames } from '../../api/combat/keepList.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { SolveClue } from '../../api/ai/clues/SolveClue.js';
import { paintClueProgress } from '../../api/ai/clues/cluePaint.js';
import { AT_BANK_RADIUS, RETURN_HOLD_MS, escapeNeeded, gearCandidates, gearToKeep, isGrindForeign, packForcesBank, slotFreeingAction, underPlayerAttack, wantsGroundItem, type SlotAction } from './GreenDragonLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

const TARGET = 'Green dragon';
const DEFAULT_ANCHOR = new Tile(3096, 3814, 0);
const DEFAULT_BANK = new Tile(3094, 3493, 0);
const FIELD_RADIUS = 22;
const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;

const TELE_SAFE_Z = 3665;
const VARROCK_TELE_RUNES: { rune: string; count: number }[] = [
    { rune: 'Law rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Fire rune', count: 1 }
];
const TELE_STOCK = 2;

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };

const DROPS: string[] = DROP_DB[TARGET] ?? [];
const DEFAULT_LOOT = DROPS.filter(n => n.toLowerCase() !== 'bass');
const BONE_NAME = 'Dragon bones';

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'melee', options: ['melee', 'mage'], label: 'Combat style', help: 'range is unavailable — a bow blocks the anti-dragon shield slot' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE },
    useSpecial: { type: 'boolean', default: true, label: 'Use special attacks', group: 'Combat', showIf: SHOW_MELEE, help: 'arms the spec bar whenever energy allows and the wielded weapon has one (dragon dagger, dragon longsword, …); does nothing with a weapon that has no special' },
    weapon: { type: 'string', default: 'Rune scimitar', options: MELEE_WEAPONS, label: 'Weapon', group: 'Combat', showIf: SHOW_MELEE, help: '1-handed (keeps the shield slot free), withdrawn from bank when missing' },
    staff: { type: 'string', default: 'Staff of fire', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    shield: { type: 'string', default: 'Dragonfire shield', options: ['Dragonfire shield'], label: 'Anti-dragon shield', group: 'Combat', help: 'worn to absorb the dragonfire — required' },

    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },

    panicHp: { type: 'number', default: 30, min: 1, max: 98, label: 'Escape below HP%', group: 'Food & healing', help: 'when out of food and this low, escape to the bank' },
    foodReserve: { type: 'number', default: 4, min: 0, max: 27, label: 'Food kept back from slot-freeing', group: 'Food & healing', help: 'a full pack spends food to make room for loot instead of banking — never below this many' },

    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues', help: 'green dragons drop hard clues — the trail runs out of the wilderness and back' },

    escape: { type: 'string', default: 'Flee to bank', options: ['Flee to bank', 'Teleport to Varrock'], label: 'Escape mode', group: 'Wilderness', help: 'Teleport brings Varrock runes and runs south to level 20 to cast (teleports are blocked above level 20 wilderness)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'Dragon bones + Dragonhide + the rest of the green dragon table; everything picked up is banked.' },
    buryBones: { type: 'boolean', default: false, label: 'Bury dragon bones', group: 'Banking & loot', help: `bury ${BONE_NAME} for Prayer xp instead of banking them (always looted when on) — they are the most valuable drop, so this trades gold for xp` },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    anchorTile: { type: 'tile', default: DEFAULT_ANCHOR, label: 'Dragon field tile', group: 'Location' },
    bankTile: { type: 'tile', default: DEFAULT_BANK, label: 'Bank stand tile (Edgeville)', group: 'Location' },
    logDetail: { type: 'string', default: 'Normal', options: ['Normal', 'Verbose'], label: 'Log detail', group: 'Diagnostics', help: 'Verbose adds task-switch and decision traces (pack census, loot skips, slot freeing, escape reasons)' }
};

let STYLE: 'melee' | 'mage' = 'melee';
let MELEE_STYLE: MeleeCombatStyle = 'strength';
let USE_SPECIAL = true;

// Why: each skill costs a bar plus a rate row (~32px) and the panel has ~112px under the title and tabs, so three per tab fits.
// Why: seven skills in one tab push prayer off the bottom with no warning.

/** Skills a dragon grind moves, split across two tabs. */
const MELEE_SKILLS = ['attack', 'strength', 'defence'];
const SUPPORT_SKILLS = ['hitpoints', 'ranged', 'magic', 'prayer'];
const GRIND_SKILLS = [...MELEE_SKILLS, ...SUPPORT_SKILLS];
let WEAPON = '';
let SHIELD = 'Dragonfire shield';
let SPELL = 'Fire Strike';
let FOOD_NAME = 'Lobster';

let PANIC_HP = 0.3;
let RUNES_WITHDRAW = 150;
let FOOD_WITHDRAW = 20;
let LOOT_SET = new Set<string>();
/** DROP_DB names it plainly 'Dragonhide' — the headline drop for the rate line. */
const HIDE_NAME = 'Dragonhide';
let BANK_COMMON = true;
let TELE_ESCAPE = false;
let ANCHOR = DEFAULT_ANCHOR;
let BANK_TILE = DEFAULT_BANK;
let FOOD_RESERVE = 4;
let BURY_BONES = false;
let SOLVE_CLUES = true;
let VERBOSE = false;
/** Everything worn when the script started — kept at the bank and put back on. */
let TRACKED_GEAR: string[] = [];

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
function needStyleSupplies(): boolean {
    return STYLE === 'mage' && castsLeft() < 1;
}
function inField(tile: Tile): boolean {
    return ANCHOR.distanceTo(tile) <= FIELD_RADIUS;
}
function fieldDragons(): Npc[] {
    return Npcs.query().name(TARGET).where(n => inField(n.tile()) && !n.targetsAnotherPlayer()).results();
}
// Why: players standing nearby are almost all bots, so proximity alone is no signal.
// Why: auto-retaliate surfaces an attacker by pointing our own face target at them.

/** True when a player is attacking us. */
function underAttack(): boolean {
    return underPlayerAttack(Game.tile()?.z ?? null, Game.attackedByPlayer());
}

/** No retaliate, no signal — the bot would never notice a PKer. */
async function assertAutoRetaliate(bot: GreenDragon): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (Game.autoRetaliateOn()) {
            return;
        }
        Game.setAutoRetaliate(true);
        if (await Execution.delayUntil(() => Game.autoRetaliateOn(), 2000)) {
            bot.log('auto-retaliate enabled');
            return;
        }
    }
    bot.log('WARNING: auto-retaliate is OFF and would not enable — the bot cannot detect a player attacking it.');
}
function hasVarrockRunes(): boolean {
    return VARROCK_TELE_RUNES.every(r => Inventory.count(r.rune) >= r.count);
}
function findLoot() {
    return GroundItems.query()
        .where(g => wantsGroundItem({ id: g.id, name: g.name ?? null }, lootFilter()))
        .within(FIELD_RADIUS)
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

function lootFilter() {
    return { lootSet: LOOT_SET, bankCommon: BANK_COMMON, solveClues: SOLVE_CLUES, buryBones: BURY_BONES, boneName: BONE_NAME };
}

/**
 * Trail leftovers (spade, sextant, watch, chart, god page, stray runes) that a
 * finished clue leaves behind. Going back to the dragons with them wastes slots.
 */
function foreignKit(): string[] {
    const keep = new Set(keepNames().map(s => s.toLowerCase()));
    const filter = lootFilter();
    return Inventory.items()
        .filter(i => isGrindForeign({ id: i.id, name: i.name ?? null }, { keep, loot: filter }))
        .map(i => i.name ?? '?');
}

/** Out of the consumables the grind runs on — only the bank fixes this. */
function needsResupply(bot: GreenDragon): boolean {
    return (!hasFood() && !bot.bankKnownEmpty()) || (needStyleSupplies() && !bot.supplyKnownEmpty());
}

function slotDecision(): { action: SlotAction; drop: ReturnType<typeof findLoot> } {
    const drop = findLoot();
    const action = slotFreeingAction({
        packFull: Inventory.isFull(),
        lootPresent: drop !== null,
        foodCount: foodCount(),
        foodReserve: FOOD_RESERVE,
        hpFraction: hpFrac(),
        lootStacksIntoPack: lootStacksIntoPack(drop?.name ?? null)
    });
    return { action, drop };
}
function keepNames(): string[] {
    const extra = gearToKeep(gearCandidates(WEAPON, SHIELD, TRACKED_GEAR), n => Equipment.contains(n));
    if (TELE_ESCAPE) {
        extra.push(...VARROCK_TELE_RUNES.map(r => r.rune));
    }
    return combatKeepNames({ food: FOOD_NAME, style: STYLE, spell: SPELL, extra });
}

/** Shared by the Eat task and slot-freeing so both respect the swing. */
const attackClock = new AttackClock();

async function eatOnce(bot: GreenDragon): Promise<boolean> {
    const food = Inventory.items().find(i => foodForms(FOOD_NAME).includes((i.name ?? '').toLowerCase()));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Math.round(hpFrac() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    await food.interact('Eat');
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

/**
 * Trade a food slot for a loot slot rather than walking to Edgeville. Eat while
 * the heal still counts, drop at full hp. Returns true when a slot came free.
 */
async function freeSlotForLoot(bot: GreenDragon): Promise<boolean> {
    const { action, drop } = slotDecision();
    const want = drop?.name ?? 'loot';
    bot.vlogChange('slot', `slot check: pack ${Inventory.used()} used / ${Inventory.free()} free, ${FOOD_NAME} x${foodCount()} (reserve ${FOOD_RESERVE}), hp ${Math.round(hpFrac() * 100)}%, ground '${want}' -> ${action}`);
    if (action === 'none') {
        return false;
    }

    if (action === 'eat') {
        bot.log(`pack full — eating ${FOOD_NAME} to make room for ${want}`);
        if (!(await eatOnce(bot))) {
            return false;
        }
        bot.countSlotFreed();
        return true;
    }

    const food = Inventory.items().find(i => isFoodItem(i.name, FOOD_NAME));
    if (!food) {
        return false;
    }
    bot.setStatus(`dropping ${food.name} for pack space`);
    bot.log(`pack full at full hp — dropping ${food.name} to make room for ${want}`);
    const before = Inventory.used();
    await food.interact('Drop');
    if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
        bot.countSlotFreed();
        return true;
    }
    bot.log(`dropping ${food.name} did not free a slot`);
    return false;
}

async function lootOnce(bot: GreenDragon): Promise<boolean> {
    const drop = findLoot();
    if (!drop) {
        return false;
    }
    bot.setStatus(`looting ${drop.name}`);
    const before = Inventory.used();
    await drop.interact('Take');
    if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
        bot.countLoot(drop.name ?? undefined);
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
}

async function castVarrockTele(_bot: GreenDragon): Promise<boolean> {
    const before = Game.tile();
    if (!(await Game.teleport('Varrock'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && before !== null && Tile.from(t).distanceTo(Tile.from(before)) > 40;
    }, 4000);
}

class Eat implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return needEat();
    }

    // Why: eating spends the tick it lands on, so a meal on the swing costs an attack.
    // Why: low enough health makes waiting the greater risk.

    /** Holds one tick and takes the meal in the swing cooldown. */
    async execute(): Promise<void> {
        attackClock.observe(reader.selfAnim(), BotHost.tickCount);
        const hold = Game.inCombat() && shouldHoldEat({
            attackedThisTick: attackClock.attackedThisTick(BotHost.tickCount),
            hpFraction: hpFrac(),
            urgentAt: URGENT_HP_FRACTION
        });
        if (hold) {
            await Execution.delayTicks(1);
        }
        await eatOnce(this.bot);
    }
}

class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: GreenDragon) {}
    private need(name: string): boolean {
        return name !== '' && !Equipment.contains(name) && Inventory.first(name) !== null;
    }
    private missing(): string | null {
        return gearCandidates(WEAPON, SHIELD, TRACKED_GEAR).find(n => this.need(n)) ?? null;
    }
    validate(): boolean {
        return this.fails < 5 && this.missing() !== null;
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
        } else {
            this.fails++;
        }
    }
}

class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return STYLE === 'melee' && !Game.hasCombatStyle(MELEE_STYLE) && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(MELEE_STYLE);
        if (await Execution.delayUntil(() => Game.hasCombatStyle(MELEE_STYLE), 3000)) {
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not set the melee attack style — retrying in ${ASSERT_RETRY_MS / 1000}s`);
        }
    }
}

class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: GreenDragon) {}
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
            this.bot.log(`WARNING: could not arm autocast for '${SPELL}' — retrying in ${ASSERT_RETRY_MS / 1000}s.`);
        }
    }
}

function atBank(): boolean {
    const here = Game.tile();
    return here !== null && BANK_TILE.distanceTo(here) <= AT_BANK_RADIUS;
}

class Escape implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return escapeNeeded({ threat: underAttack(), hpFraction: hpFrac(), panicHp: PANIC_HP, hasFood: hasFood(), atBank: atBank() });
    }
    async execute(): Promise<void> {
        if (underAttack()) {
            this.bot.holdReturn(RETURN_HOLD_MS);
        }
        if (TELE_ESCAPE && hasVarrockRunes()) {
            const me = Game.tile();
            if (me && me.z > TELE_SAFE_Z) {
                this.bot.setStatus('escaping — running south to teleport range');
                this.bot.log(`escaping (${underAttack() ? 'under attack' : 'low hp'}) — running to <=lvl20`);
                await Traversal.walkResilient(new Tile(ANCHOR.x, TELE_SAFE_Z - 5, 0), { radius: 4, attempts: 3, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
                return;
            }
            this.bot.setStatus('escaping — Varrock teleport');
            if (await castVarrockTele(this.bot)) {
                this.bot.log('teleported to Varrock');
                return;
            }
            this.bot.log('Varrock teleport did not fire — fleeing on foot');
        }
        this.bot.setStatus('escaping — fleeing to the bank');
        this.bot.log(`escaping (${underAttack() ? 'under attack' : 'low hp'}) — fleeing to ${BANK_TILE}`);
        await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class BankRun implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        if (underAttack()) {
            return false;
        }
        if (needsResupply(this.bot)) {
            return true;
        }
        const foreign = foreignKit();
        if (foreign.length > 0) {
            this.bot.vlog(`holding trail leftovers [${foreign.join(', ')}] — banking to restock the grind kit`);
            return true;
        }
        return packForcesBank(Inventory.isFull(), foodCount(), FOOD_RESERVE);
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking — restocking');
        this.bot.log(`banking (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : ''})`);
        await bankRoutine(this.bot);
    }
}

async function bankRoutine(bot: GreenDragon): Promise<void> {
    if (!(await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => bot.log(`  ${m}`) }))) {
        bot.log('walk to the bank failed — will retry');
        return;
    }
    if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => bot.log(`  ${m}`)))) {
        bot.log('could not open the bank — will retry');
        return;
    }
    await Bank.depositAllMatching(depositAllExcept(keepNames()), m => bot.log(`  ${m}`));

    bot.setStatus(`withdrawing ${FOOD_NAME}`);
    await withdrawFood(bot);
    bot.noteBankEmpty(foodCount() === 0);
    if (foodCount() === 0) {
        bot.log(`WARNING: no '${FOOD_NAME}' in the bank — deposit food to resume eating.`);
    }

    await withdrawStyleSupplies(bot);

    // Why: eating spends the load withdrawn, so heal first and top the food back up after.
    // Why: walking back on panic hp forces another trip, or a death on the way in.
    if (await eatToFull(bot)) {
        if (await Bank.openNearest('Bank booth', 'Use-quickly', m => bot.log(`  ${m}`))) {
            await withdrawFood(bot);
        }
    }
    bot.countBankTrip();
    bot.setStatus('restocked — walking back to the dragons');
    await Traversal.walkResilient(ANCHOR, { radius: 4, attempts: 6, timeoutMs: 300_000, log: m => bot.log(`  ${m}`) });
}

/**
 * Heal up before walking back. Returning to the dragons on the hp that forced
 * the trip forces another one — or a death on the way in.
 */
async function eatToFull(bot: GreenDragon): Promise<boolean> {
    if (hpFrac() >= 1 || !hasFood()) {
        return false;
    }
    // The open bank swaps the backpack for its deposit view, whose ops are
    // Deposit-* — there is no Eat to click until the modal is shut.
    if (Bank.isOpen()) {
        await Bank.close().catch(() => undefined);
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);
    }
    bot.setStatus('eating back to full before returning');
    bot.log(`healing up before the walk back (${Math.round(hpFrac() * 100)}% hp, ${foodCount()} ${FOOD_NAME})`);
    let ate = false;
    // Eating has a cooldown, so a single failed bite is normal — only give up
    // after several in a row, or the heal stops one lobster in.
    let misses = 0;
    for (let guard = 0; guard < 40 && hpFrac() < 1 && foodCount() > 0 && misses < 3; guard++) {
        if (await eatOnce(bot)) {
            ate = true;
            misses = 0;
        } else {
            misses++;
            await Execution.delayTicks(2);
        }
    }
    bot.log(`healed to ${Math.round(hpFrac() * 100)}% hp (${foodCount()} ${FOOD_NAME} left)`);
    return ate;
}

async function withdrawFood(bot: GreenDragon): Promise<void> {
    for (let guard = 0; guard < 12 && foodCount() < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
        const before = foodCount();
        const need = FOOD_WITHDRAW - before;
        await Bank.withdraw(FOOD_NAME, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => foodCount() > before, 2500))) {
            break;
        }
    }
    bot.vlog(`food after withdrawal: ${foodCount()}/${FOOD_WITHDRAW}`);
}

async function withdrawStyleSupplies(bot: GreenDragon): Promise<void> {
    if (SHIELD !== '' && !Equipment.contains(SHIELD) && Inventory.first(SHIELD) === null) {
        if ((await withdrawTo(SHIELD, 1)) > 0) {
            await Equipment.equip(SHIELD);
            bot.log(`withdrew and equipped ${SHIELD}`);
        } else {
            bot.log(`WARNING: no '${SHIELD}' in the bank — WITHOUT it the dragonfire will kill you. Deposit one.`);
        }
    }
    if (WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) === null) {
        if ((await withdrawTo(WEAPON, 1)) > 0) {
            await Equipment.equip(WEAPON);
            bot.log(`withdrew and wielded ${WEAPON}`);
        }
    }
    if (STYLE === 'mage') {
        bot.setStatus('withdrawing runes');
        for (const { rune, count } of runeWithdrawList(SPELL, wieldedNames(), RUNES_WITHDRAW)) {
            if (Inventory.count(rune) < count) {
                const got = await withdrawTo(rune, count);
                bot.log(`withdrew ${got} ${rune}`);
            }
        }
        bot.noteSupplyEmpty(castsLeft() < 1);
    }
    if (TELE_ESCAPE) {
        for (const { rune, count } of VARROCK_TELE_RUNES) {
            const target = count * TELE_STOCK;
            if (Inventory.count(rune) < target) {
                await withdrawTo(rune, target);
            }
        }
        if (!hasVarrockRunes()) {
            bot.log('WARNING: bank is short of Varrock-teleport runes — escape falls back to fleeing on foot.');
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

class BuryBones implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return BURY_BONES && Date.now() >= this.retryAt && Inventory.contains(BONE_NAME);
    }
    async execute(): Promise<void> {
        const bones = Inventory.first(BONE_NAME);
        if (!bones) {
            return;
        }
        this.bot.setStatus(`burying ${BONE_NAME}`);
        const before = Inventory.used();
        if (!(await bones.interact('Bury'))) {
            this.bot.log(`no Bury op on ${BONE_NAME}? ops=[${bones.actions().join(', ')}]`);
            this.noteFail();
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.bot.countBurial();
            this.bot.vlog(`buried ${BONE_NAME} (${this.bot.burials()} total)`);
            this.fails = 0;
            return;
        }
        this.noteFail();
    }
    /** Never let a stuck burial starve the trail / bank tasks below it. */
    private noteFail(): void {
        if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not bury ${BONE_NAME} — pausing burial for ${ASSERT_RETRY_MS / 1000}s`);
        }
    }
}

class FreeSlot implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return !underAttack() && slotDecision().action !== 'none';
    }
    async execute(): Promise<void> {
        await freeSlotForLoot(this.bot);
    }
}

class LootCorpse implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        if (underAttack()) {
            return false;
        }
        if (findLoot() === null) {
            return false;
        }
        if (Inventory.isFull()) {
            this.bot.vlogChange('lootskip', 'loot on the ground but the pack is full and no slot could be freed — banking');
            return false;
        }
        return true;
    }
    async execute(): Promise<void> {
        await lootOnce(this.bot);
    }
}

// Why: held off briefly after a threat escape, so it does not walk straight back into the player that caused it.

/** Regains control after a clue trail ends wherever the last step left us. */
class ReturnToField implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        const here = Game.tile();
        if (here === null || Game.inCombat() || ANCHOR.distanceTo(here) <= FIELD_RADIUS + 6) {
            return false;
        }
        const hold = this.bot.returnHoldRemaining();
        if (hold > 0) {
            this.bot.vlog(`away from the field but holding ${Math.ceil(hold / 1000)}s after an escape`);
            return false;
        }
        return true;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to the dragon field');
        this.bot.log(`returning to the field at ${ANCHOR}`);
        await Traversal.walkResilient(ANCHOR, { radius: 4, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Names the winning task so Verbose can trace control flow, hand-overs included. */
class Traced implements Task {
    constructor(private readonly bot: GreenDragon, private readonly name: string, private readonly inner: Task) {}
    async validate(): Promise<boolean> {
        const ok = await this.inner.validate();
        if (ok) {
            this.bot.noteTask(this.name);
        }
        return ok;
    }
    execute(): void | Promise<void> {
        return this.inner.execute();
    }
}

class Fight implements Task {
    private targetIdx: number | null = null;
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return !underAttack() && hpFrac() >= PANIC_HP && fieldDragons().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('fighting green dragons');
        const deadline = performance.now() + 120_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue() || underAttack()) {
                return;
            }
            // Hand back to the loop so BankRun can restock — this inner cycle
            // owns the bot for up to two minutes, long enough to die foodless.
            if (needsResupply(this.bot)) {
                this.bot.vlog('out of supplies mid-fight — yielding to the bank run');
                return;
            }
            if (needEat()) {
                await eatOnce(this.bot);
                continue;
            }
            if (hpFrac() < PANIC_HP) {
                return;
            }
            const dragons = fieldDragons();
            if (this.targetIdx !== null && !dragons.some(d => d.index === this.targetIdx)) {
                this.bot.countKill();
                this.bot.log(`green dragon down — ${this.bot.kills()} kills`);
                this.targetIdx = null;
            }
            if (findLoot() !== null) {
                // Inline, not a sibling task — a 600ms task hop per item loses drops.
                if (Inventory.isFull() && (await freeSlotForLoot(this.bot))) {
                    continue;
                }
                if (!Inventory.isFull()) {
                    await lootOnce(this.bot);
                    continue;
                }
            }
            // Why: this cycle owns the bot for the kill, so a sibling SpecialAttack task above Fight never runs during combat.
            if (USE_SPECIAL && !Special.armed() && Special.ready(WEAPON) && Equipment.contains(WEAPON)) {
                if (await Special.arm()) {
                    this.bot.countSpecial();
                    this.bot.vlog(`special armed (${Special.energy()}/${SA_MAX_ENERGY} energy left)`);
                }
            }
            if (Game.inCombat()) {
                // Why: burying costs a tick like eating, so spend it in the swing cooldown rather than on the swing.
                // Why: inline, not a sibling task — a sibling only runs when Fight yields, which spaces burials out.
                if (BURY_BONES && (await buryOneInFight(BONE_NAME))) {
                    this.bot.countBurial();
                    this.bot.vlog(`buried ${BONE_NAME} (${this.bot.burials()} total)`);
                }
                await Execution.delayTicks(2);
                continue;
            }
            const dragon = dragons.sort((a, b) => a.distance() - b.distance())[0];
            if (!dragon) {
                return;
            }
            this.bot.vlog(`attacking green dragon #${dragon.index} at ${dragon.distance()} tiles`);
            await dragon.interact('Attack');
            this.targetIdx = dragon.index;
            await Execution.delayUntil(() => Game.inCombat() || fieldDragons().length === 0, 4000);
        }
    }
}

export default class GreenDragon extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private killsTotal = 0;
    private looted = 0;
    private bankTrips = 0;
    private supplyEmpty = false;
    private bankEmpty = false;
    private cluesSolved = 0;
    private slotsFreed = 0;

    private specials = 0;
    private buried = 0;

    private readonly startedAt = Date.now();

    private xpAtStart = new Map<string, number>();

    /** Items picked up, for the scrollable loot tab. */
    private readonly lootCounts = new Map<string, number>();
    private lastTask = '';
    private readonly lastVlog = new Map<string, string>();
    private holdReturnUntil = 0;
    private solveClue: SolveClue | undefined;

    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        STYLE = this.settings.str('combatStyle', 'melee') as 'melee' | 'mage';
        MELEE_STYLE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        SPELL = this.settings.str('spell', 'Fire Strike');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of fire') : this.settings.str('weapon', 'Rune scimitar');
        SHIELD = this.settings.str('shield', 'Dragonfire shield');
        USE_SPECIAL = this.settings.bool('useSpecial', true);
        this.xpAtStart = new Map(GRIND_SKILLS.map(sk => [sk, Skills.xp(sk)]));
        FOOD_NAME = scriptFood(this.settings, 'Lobster');

        PANIC_HP = this.settings.num('panicHp', 30) / 100;
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        LOOT_SET = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        TELE_ESCAPE = this.settings.str('escape', 'Flee to bank') === 'Teleport to Varrock';
        ANCHOR = this.settings.tile('anchorTile', DEFAULT_ANCHOR);
        BANK_TILE = this.settings.tile('bankTile', DEFAULT_BANK);
        FOOD_RESERVE = this.settings.num('foodReserve', 4);
        BURY_BONES = this.settings.bool('buryBones', false);
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        VERBOSE = this.settings.str('logDetail', 'Normal') === 'Verbose';
        TRACKED_GEAR = Equipment.items().map(i => i.name ?? '').filter(n => n.length > 0);

        this.on('chat.message', e => { if (/oh dear.*you are dead/i.test(e.text)) { this.died = true; } });

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

        await assertAutoRetaliate(this);

        this.log(`GreenDragon — style ${STYLE} w/ ${WEAPON} + ${SHIELD}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (reserve ${FOOD_RESERVE}), escape '${TELE_ESCAPE ? 'Varrock tele' : 'flee to bank'}', clues ${SOLVE_CLUES ? 'on' : 'off'}${BURY_BONES ? `, burying ${BONE_NAME}` : ''}, field ${ANCHOR}, bank ${BANK_TILE}`);
        this.vlog(`verbose logging on — loot set [${[...LOOT_SET].join(', ')}], common junk ${BANK_COMMON ? 'on' : 'off'}`);

        const traced = (name: string, task: Task): Task => new Traced(this, name, task);
        this.add(
            traced('ContinueDialog', new ContinueDialog()),
            traced('DeathRecovery', new DeathRecovery(this, {
                anchor: BANK_TILE,
                radius: 6,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.solveClue?.noteDeath();
                    this.log('died! recovering');
                },
                onRecovered: () => {
                    this.died = false;
                    void assertAutoRetaliate(this);
                }
            })),
            traced('Escape', new Escape(this)),
            traced('Eat', new Eat(this)),
            traced('GearEquip', new GearEquip(this)),
            traced('SetAttackStyle', new SetAttackStyle(this)),
            traced('ArmAutocast', new ArmAutocast(this)),
            // Above SolveClue: a trail's bank prep would otherwise deposit the
            // bones we were told to bury.
            traced('BuryBones', new BuryBones(this)),
            traced('SolveClue', this.solveClue),
            traced('FreeSlot', new FreeSlot(this)),
            traced('BankRun', new BankRun(this)),
            traced('LootCorpse', new LootCorpse(this)),
            traced('Fight', new Fight(this)),
            traced('ReturnToField', new ReturnToField(this))
        );
    }

    override recoveryAnchor(): Tile | null {
        return BANK_TILE;
    }
    override grindTargets(): string[] {
        return [TARGET.toLowerCase()];
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
    /** Verbose, but only when the message changes — hot loops repeat. */
    vlogChange(key: string, msg: string): void {
        if (this.lastVlog.get(key) === msg) {
            return;
        }
        this.lastVlog.set(key, msg);
        this.vlog(msg);
    }
    noteTask(name: string): void {
        if (name !== this.lastTask) {
            this.lastTask = name;
            this.vlog(`-> ${name}`);
        }
    }
    holdReturn(ms: number): void {
        this.holdReturnUntil = Date.now() + ms;
    }
    returnHoldRemaining(): number {
        return Math.max(0, this.holdReturnUntil - Date.now());
    }
    countSlotFreed(): void {
        this.slotsFreed++;
    }
    countBurial(): void {
        this.buried++;
    }
    burials(): number {
        return this.buried;
    }
    countKill(): void {
        this.killsTotal++;
    }
    kills(): number {
        return this.killsTotal;
    }
    countSpecial(): void {
        this.specials++;
    }
    countLoot(name?: string): void {
        this.looted++;
        if (name) {
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + 1);
        }
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#6fbf73' });
        p.title(`GreenDragon — ${this.status}`);

        // Why: a trail can walk most of the map, so leg and travel detail is the only sign it is progressing.
        // Why: ClueSolver paints the same block, so the two stay in sync.
        const mins = (Date.now() - this.startedAt) / 60_000;
        const names = ['Grind', 'Melee', 'Support', 'Loot'];
        if (SOLVE_CLUES) {
            names.push('Clue');
        }
        const tab = p.tabs('gd', names);

        if (tab === 'Grind') {
            const kph = mins > 0.5 ? Math.round((this.killsTotal / mins) * 60) : 0;
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.killsTotal}`, `Kills/hr: ${mins > 0.5 ? kph : '—'}`);
            p.row(`Style: ${STYLE}`, `Food: ${foodCount()}`, `Trips: ${this.bankTrips}`);
            p.row(`Shield: ${Equipment.contains(SHIELD) ? 'on' : 'OFF!'}`, `Spec: ${USE_SPECIAL ? `${Math.round(Special.energy() / 10)}% (${this.specials})` : 'off'}`, `Freed: ${this.slotsFreed}`);
            p.bar('HP', hpFrac());
        } else if (tab === 'Melee' || tab === 'Support') {
            // Prayer is always shown on Support even at zero gain: seeing it sit
            // still is the point when bone burying is meant to be running.
            const always = new Set(['hitpoints', 'prayer']);
            const shown = (tab === 'Melee' ? MELEE_SKILLS : SUPPORT_SKILLS).filter(
                sk => always.has(sk) || Skills.xp(sk) - (this.xpAtStart.get(sk) ?? Skills.xp(sk)) > 0
            );
            if (shown.length === 0) {
                p.text('no experience yet', '#8a919a');
            }
            for (const sk of shown) {
                const gained = Skills.xp(sk) - (this.xpAtStart.get(sk) ?? Skills.xp(sk));
                const prog = levelProgress(Skills.level(sk), Skills.xp(sk));
                const rate = mins > 0.5 ? (gained / mins) * 60 : 0;
                const eta = etaHours(prog.remaining, rate);
                p.bar(`${paintSkillShort(sk)} ${prog.level}`, prog.fraction);
                p.row(`${fmtXpHr(gained, mins)}/hr`, `${prog.remaining.toLocaleString()} to go`, eta === null ? 'eta —' : `eta ${fmtDuration(eta * 60)}`);
            }
        } else if (tab === 'Loot') {
            const hides = this.lootCounts.get(HIDE_NAME) ?? 0;
            p.row(`Looted: ${this.looted}`, `Hides: ${hides}`, `Hides/hr: ${mins > 0.5 ? Math.round((hides / mins) * 60) : '—'}`);
            const rows = [...this.lootCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => `${String(n).padStart(4)}  ${name}`);
            p.list('gdloot', rows, 6);
        } else {
            p.row(`Solved: ${this.cluesSolved}`, `Status: ${this.solveClue?.clueStatus() ?? 'idle'}`);
            paintClueProgress(p, 'no clue in progress — grinding');
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
