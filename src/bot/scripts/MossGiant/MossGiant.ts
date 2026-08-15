import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { buryOneInFight } from '../../api/combat/fightUpkeep.js';
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
import { fmtDuration } from '../../paint/paintLogic.js';
import { COMBAT_STYLE_OPTIONS, RANGE_STYLE_OPTIONS, parseCombatStyle, parseRangeStyle, type MeleeCombatStyle } from '../../api/combat/CombatStyle.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { castsAvailable, runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { DROP_DB } from '../../data/dropdb.js';
import { STAFFS } from '../../api/combat/equipment.js';
import { foodForms, foodCount as foodCountIn, foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import { combatKeepNames } from '../../api/combat/keepList.js';
import { depositAllExcept, matchesCommonBankLoot } from '../../api/bank/Banking.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { RANGED_WEAPONS, rangeLoadoutOf, rangeSupplyEmpty } from '../../api/combat/ranged.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

const TARGET = 'Moss giant';
const DEFAULT_SAFESPOT = new Tile(2553, 3406, 0);
const DEFAULT_BANK = new Tile(2615, 3332, 0);
const FIELD_RADIUS = 10;

const ASSERT_BATCH = 5;
const ASSERT_RETRY_MS = 60_000;

const XP_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'];

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
    bow: {
        type: 'string',
        default: 'Maple shortbow',
        options: RANGED_WEAPONS,
        label: 'Ranged weapon',
        group: 'Combat',
        showIf: SHOW_RANGE,
        help: 'bows use the selected ammo; darts are both the weapon and the projectile stack'
    },
    rangeStyle: { type: 'string', default: 'rapid', options: RANGE_STYLE_OPTIONS, label: 'Ranged style', group: 'Combat', showIf: SHOW_RANGE },
    ammo: {
        type: 'string',
        default: 'Iron arrow',
        options: ['Bronze arrow', 'Iron arrow', 'Steel arrow', 'Mithril arrow', 'Adamant arrow', 'Rune arrow'],
        label: 'Bow ammo',
        group: 'Combat',
        showIf: SHOW_RANGE,
        help: 'used by bows; ignored when the ranged weapon is a dart'
    },
    ammoWithdraw: {
        type: 'number',
        default: 500,
        min: 1,
        max: 5000,
        label: 'Projectiles per bank trip',
        group: 'Combat',
        showIf: SHOW_RANGE
    },

    loadout: { ...LOADOUT_SETTING, group: 'Food & healing' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 27, label: 'Food to withdraw per bank run', group: 'Food & healing' },

    panicHp: { type: 'number', default: 25, min: 1, max: 98, label: 'Panic-to-bank below HP%', group: 'Food & healing', help: 'retreat to the bank when HP drops this low (out of food, or damage outpacing eating)' },

    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the moss giant drop table; ticked drops get grabbed. Everything picked up is banked — the bank keeps only food/runes/ammo/weapon.' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also grab shared gems/junk', group: 'Banking & loot' },
    buryBones: { type: 'boolean', default: false, label: 'Bury big bones', group: 'Banking & loot', help: 'bury Big bones for Prayer xp instead of banking them (always looted when on)' },
    safespotTile: { type: 'tile', default: DEFAULT_SAFESPOT, label: 'Safespot / field tile', group: 'Location' },
    bankTile: { type: 'tile', default: DEFAULT_BANK, label: 'Bank stand tile (Ardougne N)', group: 'Location' }
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
let AMMO_WITHDRAW = 500;
let FOOD_WITHDRAW = 20;
let LOOT_SET = new Set<string>();
let BANK_COMMON = true;
let BURY_BONES = false;
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

/** Full pack + food + loot on the ground — free a slot instead of banking early. */
function needEatForLoot(): boolean {
    return Inventory.isFull() && hasFood() && findLoot() !== null;
}

function shouldEatNow(): boolean {
    return needEat() || needEatForLoot();
}

function castsLeft(): number {
    return castsAvailable(SPELL, wieldedNames(), rune => Inventory.count(rune));
}
function rangeLoadout() {
    return rangeLoadoutOf(WEAPON, AMMO);
}

function rangeProjectile(): string {
    return rangeLoadout().projectile;
}

function equippedProjectileCount(): number {
    const projectile = rangeProjectile().toLowerCase();
    return Equipment.items().find(i => (i.name ?? '').toLowerCase() === projectile)?.count ?? 0;
}

function needStyleSupplies(): boolean {
    if (STYLE === 'mage') {
        return castsLeft() < 1;
    }
    if (STYLE === 'range') {
        const projectile = rangeProjectile();
        return rangeSupplyEmpty(equippedProjectileCount(), Inventory.count(projectile), 0);
    }
    return false;
}

async function equipPackProjectiles(): Promise<boolean> {
    const projectile = rangeProjectile();
    const item = Inventory.first(projectile);
    if (!item) {
        return true;
    }
    const op = item.actions().find(o => /wield|wear|equip/i.test(o));
    if (!op) {
        return false;
    }
    const before = Inventory.count(projectile);
    await item.interact(op);
    return Execution.delayUntil(() => Inventory.count(projectile) < before, 3000);
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
            return LOOT_SET.has(name) || (BANK_COMMON && matchesCommonBankLoot(g.name ?? '', g.id));
        })
        .within(FIELD_RADIUS)
        .nearest();
}

function keepNames(): string[] {
    const projectile = STYLE === 'range' ? rangeProjectile() : AMMO;
    const weapon = STYLE === 'range' && rangeLoadout().thrown ? projectile : WEAPON;
    return combatKeepNames({ food: FOOD_NAME, style: STYLE, spell: SPELL, ammo: projectile, weapon, extra: ['Coins'] });
}

async function eatOnce(bot: MossGiant, forLoot = false): Promise<boolean> {
    const food = Inventory.items().find(i => foodForms(FOOD_NAME).includes((i.name ?? '').toLowerCase()));
    if (!food) {
        return false;
    }
    bot.setStatus(
        forLoot
            ? `eating ${food.name} for a free slot`
            : `eating ${food.name} (${Math.round(hpFrac() * 100)}% hp)`
    );
    const beforeHp = Skills.effective('hitpoints');
    const beforeUsed = Inventory.used();
    await food.interact('Eat');
    // HP may not rise when already full; a free inventory slot is the space-eat signal.
    return Execution.delayUntil(
        () => Skills.effective('hitpoints') > beforeHp || Inventory.used() < beforeUsed,
        3000
    );
}

async function quickReturnToSafespot(bot: MossGiant): Promise<boolean> {
    bot.setStatus('returning to the safespot');
    for (let i = 0; i < 3 && !atSafespot() && !EventSignal.pending(); i++) {
        DirectNavigator.walk(SAFESPOT);
        if (await Execution.delayUntil(() => atSafespot(), 4000)) {
            break;
        }
    }
    return atSafespot();
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
        bot.countLoot(drop.name);
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
}

class Eat implements Task {
    constructor(private bot: MossGiant) {}
    validate(): boolean {
        return shouldEatNow();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot, needEatForLoot() && !needEat());
    }
}

class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: MossGiant) {}
    private needWeapon(): boolean {
        if (STYLE === 'range' && rangeLoadout().thrown) {
            // darts are the projectile stack — handled by needQuiver
            return false;
        }
        return WEAPON !== '' && !Equipment.contains(WEAPON) && Inventory.first(WEAPON) !== null;
    }
    private needQuiver(): boolean {
        if (STYLE !== 'range') {
            return false;
        }
        const projectile = rangeProjectile();
        return Inventory.count(projectile) > 0 && equippedProjectileCount() === 0;
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
        const projectile = rangeProjectile();
        this.bot.setStatus(`equipping ${projectile}`);
        if (await equipPackProjectiles()) {
            this.bot.log(`equipped ${projectile}`);
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
    // darts are the projectile stack (not a durable weapon) — restocked below
    const needWeapon =
        STYLE !== 'melee' &&
        WEAPON !== '' &&
        !(STYLE === 'range' && rangeLoadout().thrown) &&
        !Equipment.contains(WEAPON) &&
        Inventory.first(WEAPON) === null;
    if (needWeapon) {
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
        const projectile = rangeProjectile();
        bot.setStatus(`withdrawing ${projectile}`);
        const got = await withdrawTo(projectile, AMMO_WITHDRAW);
        if (got > 0) {
            // bank modal blocks equip — same pattern as RockCrab dart restock
            if (!(await Bank.close()) || !(await equipPackProjectiles())) {
                bot.log(`WARNING: withdrew ${projectile}, but could not equip the stack — will retry from the pack`);
            }
            bot.log(`withdrew ${got} ${projectile} — ${equippedProjectileCount()} equipped`);
            bot.noteSupplyEmpty(false);
        } else if (equippedProjectileCount() === 0 && Inventory.count(projectile) === 0) {
            bot.noteSupplyEmpty(true);
            bot.log(`WARNING: no '${projectile}' in the bank — deposit projectiles to resume.`);
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

class BuryBones implements Task {
    constructor(private bot: MossGiant) {}
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
    constructor(private bot: MossGiant) {}
    validate(): boolean {
        if (needStyleSupplies() && !this.bot.supplyKnownEmpty()) {
            return true;
        }
        if (!hasFood() && !this.bot.bankKnownEmpty()) {
            return true;
        }
        // Prefer eating a food for loot space over an early bank run when drops wait.
        if (Inventory.isFull() && hasFood() && findLoot() !== null) {
            return false;
        }
        return Inventory.isFull();
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        this.bot.setStatus('banking — restocking');
        this.bot.log(
            `banking (food ${foodCount()}${STYLE === 'mage' ? `, casts ${castsLeft()}` : ''}${STYLE === 'range' ? `, projectiles ${equippedProjectileCount() + Inventory.count(rangeProjectile())}` : ''})`
        );
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
            if (shouldEatNow()) {
                await eatOnce(this.bot, needEatForLoot() && !needEat());
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
                continue;
            }
            if (usesSafespot() && !atSafespot()) {
                if (!(await quickReturnToSafespot(this.bot))) {
                    return;
                }
                continue;
            }

            // Why: this loop owns the bot for the fight, so a sibling BuryBones task only runs in whatever gaps the loop leaves.
            // Why: the burial skips the swing tick, so it costs no attack.
            if (BURY_BONES && (await buryOneInFight('Big bones'))) {
                this.bot.countBurial();
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

export default class MossGiant extends TaskBot {
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

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        STYLE = (this.settings.str('combatStyle', 'melee') as 'melee' | 'mage' | 'range');
        MELEE_STYLE = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        RANGE_MODE = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        SPELL = this.settings.str('spell', 'Wind Strike');
        AMMO = this.settings.str('ammo', 'Iron arrow');
        WEAPON = STYLE === 'mage' ? this.settings.str('staff', 'Staff of air')
            : STYLE === 'range' ? this.settings.str('bow', 'Maple shortbow') : '';
        FOOD_NAME = scriptFood(this.settings, 'Lobster');

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
        BANK_TILE = this.settings.tile('bankTile', DEFAULT_BANK);

        this.on('chat.message', e => { if (/oh dear.*you are dead/i.test(e.text)) { this.died = true; } });

        this.startedAt = Date.now();
        this.xpAtStart = XP_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);

        const loadout = rangeLoadout();
        const rangeNote =
            STYLE === 'range'
                ? loadout.thrown
                    ? ` darts '${loadout.projectile}'`
                    : ` bow '${loadout.weapon}' + '${loadout.projectile}'`
                : '';
        this.log(
            `MossGiant — style ${STYLE}${STYLE === 'mage' ? ` w/ ${WEAPON} (${SPELL})` : rangeNote}${STYLE === 'melee' ? ` (${MELEE_STYLE})` : ''}, food '${FOOD_NAME}' (smart-eat, panic<${Math.round(PANIC_HP * 100)}%), safespot ${SAFESPOT}, bank ${BANK_TILE}${BURY_BONES ? ', burying big bones' : ''}`
        );

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
            new BuryBones(this),
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7ec8a0' });
        p.title(`MossGiant — ${this.status}`);

        const tab = p.tabs('mg', ['Overview', 'Loot']);
        if (tab === 'Overview') {
            const mins = (Date.now() - this.startedAt) / 60_000;
            const xpGained = XP_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - this.xpAtStart;
            const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.killsTotal}`, `XP/hr: ${xph}`);
            const rangeAmmo =
                STYLE === 'range'
                    ? `${rangeLoadout().thrown ? 'Darts' : 'Quiver'}: ${equippedProjectileCount() + Inventory.count(rangeProjectile())}`
                    : '';
            p.row(
                `Style: ${STYLE}`,
                STYLE === 'mage' ? `Casts: ${castsLeft()}${Autocast.armed() ? '' : ' (OFF)'}` : STYLE === 'range' ? rangeAmmo : `Food: ${foodCount()}`,
                `Bank trips: ${this.bankTrips}`
            );
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
