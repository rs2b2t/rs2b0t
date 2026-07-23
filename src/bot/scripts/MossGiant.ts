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
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

const TARGET = 'Moss giant';
const DEFAULT_SAFESPOT = new Tile(2553, 3406, 0);
const DEFAULT_BANK = new Tile(2615, 3332, 0);
const FIELD_RADIUS = 10;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;

const SHOW_MAGE = { key: 'combatStyle', anyOf: ['mage'] };
const SHOW_RANGE = { key: 'combatStyle', anyOf: ['range'] };
const SHOW_MELEE = { key: 'combatStyle', anyOf: ['melee'] };

const DROPS: string[] = DROP_DB[TARGET] ?? [];
const DEFAULT_LOOT = DROPS.filter(n => !/\barrow\b|^coal$|spinach roll/i.test(n));

export const SETTINGS: SettingsSchema = {
    combatStyle: { type: 'string', default: 'melee', options: ['melee', 'mage', 'range'], label: 'Combat style' },
    meleeStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Melee style', group: 'Combat', showIf: SHOW_MELEE, help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    staff: { type: 'string', default: 'Staff of air', options: STAFFS, label: 'Staff', group: 'Combat', showIf: SHOW_MAGE, help: 'wielded staff, withdrawn from bank when missing' },
    spell: { type: 'string', default: 'Wind Strike', options: Object.keys(SPELL_DB), label: 'Autocast spell', group: 'Combat', showIf: SHOW_MAGE },
    runesWithdraw: { type: 'number', default: 150, min: 1, max: 1000, label: 'Casts of runes per bank trip', group: 'Combat', showIf: SHOW_MAGE },
    bow: { type: 'string', default: 'Maple shortbow', options: BOWS, label: 'Bow', group: 'Combat', showIf: SHOW_RANGE, help: 'wielded bow, withdrawn from bank when missing' },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: { type: 'string', default: 'Iron arrow', options: ['Bronze arrow', 'Iron arrow', 'Steel arrow', 'Mithril arrow', 'Adamant arrow', 'Rune arrow'], label: 'Ammo', group: 'Combat', showIf: SHOW_RANGE },
    ammoWithdraw: { type: 'number', default: 500, min: 1, max: 5000, label: 'Ammo per bank trip', group: 'Combat', showIf: SHOW_RANGE },

    food: { type: 'string', default: 'Lobster', options: FOOD_OPTIONS, label: 'Food', group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },
    eatHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%', group: 'Food & healing' },
    panicHp: { type: 'number', default: 25, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'retreat to the bank when HP drops this low (out of food, or damage outpacing eating)' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the moss giant drop table; ticked drops get grabbed. Everything picked up is banked — the bank keeps only food/runes/ammo/weapon.' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    safespotTile: { type: 'tile', default: DEFAULT_SAFESPOT, label: 'Safespot / field tile', group: 'Location' },
    bankTile: { type: 'tile', default: DEFAULT_BANK, label: 'Bank stand tile (Ardougne N)', group: 'Location' }
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
let SAFESPOT = DEFAULT_SAFESPOT;
let BANK_TILE = DEFAULT_BANK;

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
    if (STYLE === 'mage') {
        return castsLeft() < 1;
    }
    if (STYLE === 'range') {
        const quiver = Equipment.items().find(i => (i.name ?? '').toLowerCase() === AMMO.toLowerCase())?.count ?? 0;
        return quiver === 0 && Inventory.count(AMMO) === 0;
    }
    return false;
}

function inField(tile: Tile): boolean {
    return SAFESPOT.distanceTo(tile) <= FIELD_RADIUS;
}
function atSafespot(): boolean {
    const here = Game.tile();
    return here !== null && SAFESPOT.x === here.x && SAFESPOT.z === here.z && SAFESPOT.level === here.level;
}
function usesSafespot(): boolean {
    return STYLE === 'mage' || STYLE === 'range';
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
    return combatKeepNames({ food: FOOD_NAME, style: STYLE, spell: SPELL, ammo: AMMO, weapon: WEAPON, extra: ['Coins'] });
}

async function eatOnce(bot: MossGiant): Promise<boolean> {
    const food = Inventory.items().find(i => foodForms(FOOD_NAME).includes((i.name ?? '').toLowerCase()));
    if (!food) {
        return false;
    }
    bot.setStatus(`eating ${food.name} (${Math.round(hpFrac() * 100)}% hp)`);
    const before = Skills.effective('hitpoints');
    await food.interact('Eat');
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

async function lootOnce(bot: MossGiant): Promise<boolean> {
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

class Eat implements Task {
    constructor(private bot: MossGiant) {}
    validate(): boolean {
        return hpFrac() < EAT_HP && hasFood();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot);
    }
}

class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: MossGiant) {}
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
    constructor(private bot: MossGiant) {}
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
    constructor(private bot: MossGiant) {}
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

async function bankRoutine(bot: MossGiant, withdrawFood: boolean): Promise<void> {
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

    bot.countBankTrip();
    bot.setStatus('restocked — walking back to the safespot');
    await Traversal.walkResilient(SAFESPOT, { radius: usesSafespot() ? 0 : 3, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) });
}

async function withdrawStyleSupplies(bot: MossGiant): Promise<void> {
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
        } else if (Inventory.count(AMMO) === 0) {
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
    constructor(private bot: MossGiant) {}
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

class BankRun implements Task {
    constructor(private bot: MossGiant) {}
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
    constructor(private bot: MossGiant) {}
    validate(): boolean {
        return !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootOnce(this.bot);
    }
}

class ReturnToSafespot implements Task {
    constructor(private bot: MossGiant) {}
    validate(): boolean {
        return usesSafespot() && !atSafespot() && hpFrac() >= PANIC_HP;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to the safespot');
        await Traversal.walkResilient(SAFESPOT, { radius: 0, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class Fight implements Task {
    private targetIdx: number | null = null;
    private skip = new Map<number, number>();
    constructor(private bot: MossGiant) {}
    validate(): boolean {
        if (hpFrac() < PANIC_HP) {
            return false;
        }
        if (usesSafespot() && !atSafespot()) {
            return false;
        }
        return fieldGiants().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('fighting moss giants');
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
                this.bot.log(`moss giant down — ${this.bot.kills()} kills`);
                this.targetIdx = null;
            }

            if (!Inventory.isFull() && findLoot() !== null) {
                await lootOnce(this.bot);
                if (usesSafespot() && !atSafespot()) {
                    return;
                }
                continue;
            }
            if (usesSafespot() && !atSafespot()) {
                return;
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
                return;
            }
        }
    }
}

export default class MossGiant extends TaskBot {
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
        SAFESPOT = this.settings.tile('safespotTile', DEFAULT_SAFESPOT);
        BANK_TILE = this.settings.tile('bankTile', DEFAULT_BANK);

        this.on('chat.message', e => { if (/oh dear.*you are dead/i.test(e.text)) { this.died = true; } });

        this.log(`MossGiant — style ${STYLE}${STYLE !== 'melee' ? ` w/ ${WEAPON}` : ''}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (eat<${Math.round(EAT_HP * 100)}%, panic<${Math.round(PANIC_HP * 100)}%), safespot ${SAFESPOT}, bank ${BANK_TILE}`);

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: SAFESPOT,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new PanicBank(this),
            new BankRun(this),
            new LootCorpse(this),
            new ReturnToSafespot(this),
            new Fight(this)
        );
    }

    override recoveryAnchor(): Tile | null {
        return SAFESPOT;
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7ec8a0' });
        p.title(`MossGiant — ${this.status}`);
        p.row(`Style: ${STYLE}`, `HP: ${Math.round(hpFrac() * 100)}%`);
        p.row(`Kills: ${this.killsTotal}`, `Looted: ${this.looted}`);
        p.row(STYLE === 'mage' ? `Casts: ${castsLeft()}${Autocast.armed() ? '' : ' (OFF)'}` : STYLE === 'range' ? `Ammo: ${Inventory.count(AMMO)}` : `Food: ${foodCount()}`, `Bank trips: ${this.bankTrips}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
