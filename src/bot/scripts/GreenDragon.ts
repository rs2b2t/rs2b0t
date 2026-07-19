import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { COMBAT_STYLE_OPTIONS, parseCombatStyle } from '../api/CombatStyle.js';
import { Autocast } from '../api/combat/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../api/combat/data/spelldb.js';
import { DROP_DB } from '../api/combat/data/dropdb.js';
import { MELEE_WEAPONS, STAFFS } from '../api/combat/equipment.js';
import { FOOD_OPTIONS, foodForms, foodCount as foodCountIn } from '../api/combat/food.js';
import { combatKeepNames } from '../api/combat/keepList.js';
import { depositAllExcept, matchesCommonBankLoot } from '../api/Banking.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Players } from '../api/queries/Players.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { actions } from '../adapter/ClientAdapter.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// Green dragons in the deep wilderness N of Edgeville (cluster ~3081-3122,
// 3810-3824, wildy level ~37). Fought in proximity — the anti-dragon shield
// blocks the fire and their melee is weak. Bank south at Edgeville. Escape when a
// PKer shows or HP craters: flee to bank, or run to <=lvl20 and Varrock-teleport.
const TARGET = 'Green dragon';
const DEFAULT_ANCHOR = new Tile(3096, 3814, 0);
const DEFAULT_BANK = new Tile(3094, 3493, 0); // Edgeville
const FIELD_RADIUS = 22;
const LOCAL_PLAYER_SLOT = 2047;
const THREAT_RADIUS = 6; // any non-local player this close in the deep wildy = flee
const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;

// Varrock teleport (magic tab): needs <= wildy level 20 (z <~ 3672) to fire.
const MAGIC_TAB = 6;
const VARROCK_TELE_COM = 1164;
const TELE_SAFE_Z = 3665; // comfortably level <=19
const VARROCK_TELE_RUNES: { rune: string; count: number }[] = [
    { rune: 'Law rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Fire rune', count: 1 }
];
const TELE_STOCK = 20; // casts of Varrock-tele runes to withdraw per bank trip

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };

const DROPS: string[] = DROP_DB[TARGET] ?? [];
const DEFAULT_LOOT = DROPS.filter(n => n.toLowerCase() !== 'bass'); // everything but the low-value food

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'melee', options: ['melee', 'mage'], label: 'Combat style', help: 'range is unavailable — a bow blocks the anti-dragon shield slot' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE },
    weapon: { type: 'string', default: 'Rune scimitar', options: MELEE_WEAPONS, label: 'Weapon', group: 'Combat', showIf: SHOW_MELEE, help: '1-handed (keeps the shield slot free), withdrawn from bank when missing' },
    staff: { type: 'string', default: 'Staff of fire', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE },
    spell: { type: 'string', default: 'Fire Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    shield: { type: 'string', default: 'Dragonfire shield', options: ['Dragonfire shield'], label: 'Anti-dragon shield', group: 'Combat', help: 'worn to absorb the dragonfire — required' },

    food: { type: 'string', default: 'Lobster', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    eatHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%', group: 'Food & healing' },
    panicHp: { type: 'number', default: 30, min: 1, max: 98, label: 'Escape below HP%', group: 'Food & healing', help: 'when out of food and this low, escape to the bank' },

    escape: { type: 'string', default: 'Flee to bank', options: ['Flee to bank', 'Teleport to Varrock'], label: 'Escape mode', group: 'Wilderness', help: 'Teleport brings Varrock runes and runs south to level 20 to cast (teleports are blocked above level 20 wilderness)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'Dragon bones + Dragonhide + the rest of the green dragon table; everything picked up is banked.' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    anchorTile: { type: 'tile', default: DEFAULT_ANCHOR, label: 'Dragon field tile', group: 'Location' },
    bankTile: { type: 'tile', default: DEFAULT_BANK, label: 'Bank stand tile (Edgeville)', group: 'Location' }
};

// --- settings mirror ---
let STYLE: 'melee' | 'mage' = 'melee';
let MELEE_MODE = 1;
let WEAPON = '';
let SHIELD = 'Dragonfire shield';
let SPELL = 'Fire Strike';
let FOOD_NAME = 'Lobster';
let EAT_HP = 0.5;
let PANIC_HP = 0.3;
let RUNES_WITHDRAW = 150;
let FOOD_WITHDRAW = 20;
let LOOT_SET = new Set<string>();
let BANK_COMMON = true;
let TELE_ESCAPE = false;
let ANCHOR = DEFAULT_ANCHOR;
let BANK_TILE = DEFAULT_BANK;

// --- helpers ---
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
function needStyleSupplies(): boolean {
    return STYLE === 'mage' && castsLeft() < 1;
}
function inField(tile: Tile): boolean {
    return ANCHOR.distanceTo(tile) <= FIELD_RADIUS;
}
/** Alive, attackable dragons in the field not locked onto another player. */
function fieldDragons(): Npc[] {
    return Npcs.query().name(TARGET).where(n => inField(n.tile()) && !n.targetsAnotherPlayer()).results();
}
/** Any non-local player close enough to be a PKer threat. */
function nearbyThreat(): boolean {
    return Players.query().where(p => p.index !== LOCAL_PLAYER_SLOT && p.distance() <= THREAT_RADIUS).results().length > 0;
}
function hasVarrockRunes(): boolean {
    return VARROCK_TELE_RUNES.every(r => Inventory.count(r.rune) >= r.count);
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
/** Items to KEEP on a bank run — everything else (all loot + random loot) banks. */
function keepNames(): string[] {
    const extra = ['Coins', SHIELD];
    if (TELE_ESCAPE) {
        extra.push(...VARROCK_TELE_RUNES.map(r => r.rune));
    }
    return combatKeepNames({ food: FOOD_NAME, style: STYLE, spell: SPELL, weapon: WEAPON, extra });
}

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

async function lootOnce(bot: GreenDragon): Promise<boolean> {
    const drop = findLoot();
    if (!drop) {
        return false;
    }
    bot.setStatus(`looting ${drop.name}`);
    const before = Inventory.used();
    await drop.interact('Take');
    if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
        bot.countLoot();
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
}

/** Open the magic tab and cast Varrock teleport (com 1164); true once we jump. */
async function castVarrockTele(bot: GreenDragon): Promise<boolean> {
    const before = Game.tile();
    if (!(await Game.openSideTab(MAGIC_TAB))) {
        return false;
    }
    actions.ifButton(VARROCK_TELE_COM);
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && before !== null && Tile.from(t).distanceTo(Tile.from(before)) > 40;
    }, 4000);
}

// ============================ tasks ============================

class Eat implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return hpFrac() < EAT_HP && hasFood();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

/** Wield the weapon/staff AND equip the anti-dragon shield when loose in the pack. */
class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: GreenDragon) {}
    private need(name: string): boolean {
        return name !== '' && !Equipment.contains(name) && Inventory.first(name) !== null;
    }
    validate(): boolean {
        return this.fails < 5 && (this.need(WEAPON) || this.need(SHIELD));
    }
    async execute(): Promise<void> {
        const item = this.need(WEAPON) ? WEAPON : SHIELD;
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
        return STYLE === 'melee' && Game.combatMode() !== MELEE_MODE && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(MELEE_MODE);
        if (await Execution.delayUntil(() => Game.combatMode() === MELEE_MODE, 3000)) {
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
            return false; // no runes yet — BankRun stocks them first
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

/** Wilderness escape: a nearby player (PKer) or critical HP with no food. Flee
 *  south to the bank, or (tele mode) run to <=lvl20 and Varrock-teleport. */
class Escape implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return nearbyThreat() || (hpFrac() < PANIC_HP && !hasFood());
    }
    async execute(): Promise<void> {
        if (TELE_ESCAPE && hasVarrockRunes()) {
            const me = Game.tile();
            if (me && me.z > TELE_SAFE_Z) {
                this.bot.setStatus('escaping — running south to teleport range');
                this.bot.log(`escaping (${nearbyThreat() ? 'player near' : 'low hp'}) — running to <=lvl20`);
                await Traversal.walkResilient(new Tile(ANCHOR.x, TELE_SAFE_Z - 5, 0), { radius: 4, attempts: 3, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
                return; // loop re-checks; keep running until safe, then cast
            }
            this.bot.setStatus('escaping — Varrock teleport');
            if (await castVarrockTele(this.bot)) {
                this.bot.log('teleported to Varrock');
                return;
            }
            this.bot.log('Varrock teleport did not fire — fleeing on foot');
        }
        this.bot.setStatus('escaping — fleeing to the bank');
        this.bot.log(`escaping (${nearbyThreat() ? 'player near' : 'low hp'}) — fleeing to ${BANK_TILE}`);
        await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Bank at Edgeville: deposit all loot, restock food + supplies, walk back. */
class BankRun implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        if (nearbyThreat()) {
            return false; // Escape owns danger
        }
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
    for (let guard = 0; guard < 12 && foodCount() < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
        const before = foodCount();
        const need = FOOD_WITHDRAW - before;
        await Bank.withdraw(FOOD_NAME, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => foodCount() > before, 2500))) {
            break;
        }
    }
    bot.noteBankEmpty(foodCount() === 0);
    if (foodCount() === 0) {
        bot.log(`WARNING: no '${FOOD_NAME}' in the bank — deposit food to resume eating.`);
    }

    await withdrawStyleSupplies(bot);
    bot.countBankTrip();
    bot.setStatus('restocked — walking back to the dragons');
    await Traversal.walkResilient(ANCHOR, { radius: 4, attempts: 6, timeoutMs: 300_000, log: m => bot.log(`  ${m}`) });
}

async function withdrawStyleSupplies(bot: GreenDragon): Promise<void> {
    // shield first — dragonfire protection is non-negotiable
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

class LootCorpse implements Task {
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return !nearbyThreat() && !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootOnce(this.bot);
    }
}

/** Attack green dragons in proximity (the shield tanks the fire). */
class Fight implements Task {
    private targetIdx: number | null = null;
    constructor(private bot: GreenDragon) {}
    validate(): boolean {
        return !nearbyThreat() && hpFrac() >= PANIC_HP && fieldDragons().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('fighting green dragons');
        const deadline = performance.now() + 120_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue() || nearbyThreat()) {
                return;
            }
            if (hpFrac() < EAT_HP && hasFood()) {
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
            if (!Inventory.isFull() && findLoot() !== null) {
                await lootOnce(this.bot);
                continue;
            }
            if (Game.inCombat()) {
                await Execution.delayTicks(2);
                continue;
            }
            const dragon = dragons.sort((a, b) => a.distance() - b.distance())[0];
            if (!dragon) {
                return;
            }
            await dragon.interact('Attack');
            this.targetIdx = dragon.index;
            await Execution.delayUntil(() => Game.inCombat() || fieldDragons().length === 0, 4000);
        }
    }
}

// ============================ bot ============================

export default class GreenDragon extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private killsTotal = 0;
    private looted = 0;
    private bankTrips = 0;
    private supplyEmpty = false;
    private bankEmpty = false;

    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        STYLE = this.settings.str('combatStyle', 'melee') as 'melee' | 'mage';
        MELEE_MODE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        SPELL = this.settings.str('spell', 'Fire Strike');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of fire') : this.settings.str('weapon', 'Rune scimitar');
        SHIELD = this.settings.str('shield', 'Dragonfire shield');
        FOOD_NAME = this.settings.str('food', 'Lobster');
        EAT_HP = this.settings.num('eatHp', 50) / 100;
        PANIC_HP = this.settings.num('panicHp', 30) / 100;
        RUNES_WITHDRAW = this.settings.num('runesWithdraw', 150);
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        LOOT_SET = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        TELE_ESCAPE = this.settings.str('escape', 'Flee to bank') === 'Teleport to Varrock';
        ANCHOR = this.settings.tile('anchorTile', DEFAULT_ANCHOR);
        BANK_TILE = this.settings.tile('bankTile', DEFAULT_BANK);

        this.on('chat.message', e => { if (/oh dear.*you are dead/i.test(e.text)) { this.died = true; } });

        this.log(`GreenDragon — style ${STYLE} w/ ${WEAPON} + ${SHIELD}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}', escape '${TELE_ESCAPE ? 'Varrock tele' : 'flee to bank'}', field ${ANCHOR}, bank ${BANK_TILE}`);

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: BANK_TILE, // recover at the bank (safe, out of the wildy)
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            new Escape(this),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new BankRun(this),
            new LootCorpse(this),
            new Fight(this)
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
    countKill(): void {
        this.killsTotal++;
    }
    kills(): number {
        return this.killsTotal;
    }
    countLoot(): void {
        this.looted++;
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
        p.row(`Style: ${STYLE}`, `HP: ${Math.round(hpFrac() * 100)}%`);
        p.row(`Kills: ${this.killsTotal}`, `Looted: ${this.looted}`);
        p.row(`Shield: ${Equipment.contains(SHIELD) ? 'on' : 'OFF!'}`, `Bank trips: ${this.bankTrips}`);
        p.gap();
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') { ScriptRunner.resume(); } else { ScriptRunner.pause(); }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }
}
