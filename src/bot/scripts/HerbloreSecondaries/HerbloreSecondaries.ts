import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { Shop } from '../../api/shop/Shop.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { foodCount as foodCountIn, foodForms } from '../../api/combat/food.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    FOOD_DEFAULT,
    FOOD_DEFAULT_COUNT,
    SECONDARIES,
    SECONDARY_OPTIONS,
    SHIELD_NAME,
    SHOP_COIN_CAP,
    foodHealAmount,
    keepOnDeposit,
    needsRestock,
    secondaryByName,
    shouldEat,
    shopCoinsToWithdraw,
    type SecondaryDef
} from './HerbloreSecondariesLogic.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

export const HERBLORE_SECONDARIES_SETTINGS: SettingsSchema = {
    secondary: {
        type: 'string',
        default: "Red spiders' eggs",
        options: SECONDARY_OPTIONS,
        label: 'Secondary',
        help: 'which herblore secondary to collect this session'
    },
    loadout: LOADOUT_SETTING,
    foodWithdraw: {
        type: 'number',
        default: FOOD_DEFAULT_COUNT,
        min: 0,
        max: 27,
        label: 'Food to withdraw',
        help: '0 = never withdraw food'
    }
};

export default class HerbloreSecondaries extends TaskBot {
    override loopDelay = 400;

    private def: SecondaryDef = SECONDARIES[0];
    private foodName = FOOD_DEFAULT;
    private foodWant = FOOD_DEFAULT_COUNT;

    private gathered = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const pick = this.settings.str('secondary', "Red spiders' eggs");
        const def = secondaryByName(pick);
        if (!def) {
            ScriptRunner.stop(`unknown secondary '${pick}'`);
            return;
        }
        this.def = def;
        this.foodName = scriptFood(this.settings, FOOD_DEFAULT);
        this.foodWant = this.settings.num('foodWithdraw', FOOD_DEFAULT_COUNT);
        this.startedAt = Date.now();

        this.log(
            `HerbloreSecondaries — ${def.name} (${def.mode}) bank ${def.bankName}, food '${this.foodName}' x${this.foodWant}${def.needShield ? `, shield '${SHIELD_NAME}'` : ''}`
        );

        // Why: ProcessSource sits before BankTrip so swamp toads become legs before the deposit.
        // Why: Eat sits before BankTrip because a full pack with food left is one free slot away from more loot, and BankTrip would otherwise win and bank the food.
        this.add(
            new ContinueDialog(),
            new GearUp(this),
            new ProcessSource(this),
            new Eat(this),
            new BankTrip(this),
            new BuyTool(this),
            new BuyGoods(this),
            new Grind(this),
            new Loot(this),
            new Travel(this)
        );
    }

    setStatus(s: string): void {
        this.status = s;
    }
    cfg() {
        return { def: this.def, food: this.foodName, foodWant: this.foodWant };
    }
    foodInPack(): number {
        return foodCountIn(Inventory.items(), this.foodName);
    }
    productCount(): number {
        return Inventory.count(this.def.name);
    }
    sourceCount(): number {
        return this.def.sourceName ? Inventory.count(this.def.sourceName) : 0;
    }
    coinCount(): number {
        return Inventory.count('Coins');
    }
    hasShield(): boolean {
        return Equipment.contains(SHIELD_NAME) || Inventory.contains(SHIELD_NAME);
    }
    hasTool(): boolean {
        return !this.def.toolName || Inventory.contains(this.def.toolName) || Equipment.contains(this.def.toolName);
    }
    countGathered(n: number): void {
        this.gathered += n;
    }
    countTrip(): void {
        this.trips++;
    }

    near(tile: { x: number; z: number; level: number }, r: number): boolean {
        const t = Game.tile();
        return t !== null && t.level === tile.level && Math.max(Math.abs(t.x - tile.x), Math.abs(t.z - tile.z)) <= r;
    }

    async walkTo(dest: { x: number; z: number; level: number }, what: string): Promise<boolean> {
        if (this.near(dest, 3)) {
            return true;
        }
        this.setStatus(`walking to ${what}`);
        return Traversal.walkResilient(new Tile(dest.x, dest.z, dest.level), {
            radius: 3,
            attempts: 3,
            timeoutMs: 180_000,
            log: m => this.log(`  ${m}`)
        });
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#6bbf4a' });
        p.title(`Herbs — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Got: ${this.gathered}`, `Trips: ${this.trips}`);
        p.row(`Target: ${this.def.name}`, `Held: ${this.productCount()}`, `Food: ${this.foodInPack()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

class Eat implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def, food } = this.bot.cfg();
        return shouldEat({
            hp: Skills.effective('hitpoints'),
            maxHp: Skills.level('hitpoints'),
            heal: foodHealAmount(food),
            foodCount: this.bot.foodInPack(),
            freeSlots: Inventory.free(),
            // Eating for a slot only pays off where there is loot to pick up —
            // same gate as Loot, or a bot at the bank would burn its stack.
            collecting:
                (def.mode === 'loot' || def.mode === 'loot_process')
                && this.bot.near(def.anchor, def.searchRadius + 4)
        });
    }
    async execute(): Promise<void> {
        const { food } = this.bot.cfg();
        const item = Inventory.items().find(i => foodForms(food).includes((i.name ?? '').toLowerCase()));
        if (!item) {
            return;
        }
        this.bot.setStatus(`eating ${item.name}`);
        const before = Inventory.used();
        await item.interact('Eat');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
}

class GearUp implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def } = this.bot.cfg();
        return def.needShield && Inventory.contains(SHIELD_NAME) && !Equipment.contains(SHIELD_NAME);
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`wielding ${SHIELD_NAME}`);
        await Equipment.equip(SHIELD_NAME);
    }
}

class BankTrip implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def, foodWant } = this.bot.cfg();
        return needsRestock({
            def,
            foodCount: this.bot.foodInPack(),
            foodWant,
            coins: this.bot.coinCount(),
            hasShield: this.bot.hasShield(),
            hasTool: this.bot.hasTool(),
            packFull: Inventory.isFull() && this.bot.productCount() + this.bot.sourceCount() > 0
        });
    }
    async execute(): Promise<void> {
        const { def, food, foodWant } = this.bot.cfg();
        this.bot.setStatus(`banking at ${def.bankName}`);
        if (!(await this.bot.walkTo(def.bank, `${def.bankName} bank`))) {
            return;
        }
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)))) {
            // Grand Tree / chests
            if (!(await Bank.openNearest('Bank booth', 'Bank', m => this.bot.log(`  ${m}`)))) {
                this.bot.log('could not open bank');
                return;
            }
        }

        const keep = new Set(keepOnDeposit(def, food).map(n => n.toLowerCase()));
        await Bank.depositAllMatching(name => !keep.has(name.toLowerCase()));

        if (def.needShield && !this.bot.hasShield()) {
            if (Bank.count(SHIELD_NAME) < 1) {
                await Bank.close();
                ScriptRunner.stop(`no ${SHIELD_NAME} banked for white berries`);
                return;
            }
            await Bank.withdrawX(SHIELD_NAME, 1);
        }

        if (def.takeFood && foodWant > 0) {
            const have = this.bot.foodInPack();
            if (have < foodWant) {
                if (Bank.count(food) < 1 && have < 1) {
                    await Bank.close();
                    ScriptRunner.stop(`out of ${food} in the bank`);
                    return;
                }
                await Bank.withdrawX(food, foodWant - have);
            }
        }

        if (def.mode === 'buy' || def.mode === 'buy_grind') {
            const need = shopCoinsToWithdraw(this.bot.coinCount(), Bank.count('Coins'));
            if (need > 0) {
                if (Bank.count('Coins') < need && this.bot.coinCount() < 50) {
                    await Bank.close();
                    ScriptRunner.stop('not enough coins in the bank for shopping');
                    return;
                }
                await Bank.withdrawX('Coins', need);
            }
            // never leave with more than the cap
            if (this.bot.coinCount() > SHOP_COIN_CAP) {
                await Bank.depositAllMatching(name => name.toLowerCase() === 'coins');
                await Bank.withdrawX('Coins', SHOP_COIN_CAP);
            }
        }

        if (def.mode === 'buy_grind' && def.toolName && !Inventory.contains(def.toolName)) {
            if (Bank.count(def.toolName) > 0) {
                await Bank.withdrawX(def.toolName, 1);
            }
        }

        await Bank.close();
        this.bot.countTrip();
        this.bot.log(`restocked @ ${def.bankName}: food ${this.bot.foodInPack()}, coins ${this.bot.coinCount()}`);
    }
}

class BuyTool implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def } = this.bot.cfg();
        return def.mode === 'buy_grind' && !!def.toolName && !this.bot.hasTool() && this.bot.coinCount() > 0;
    }
    async execute(): Promise<void> {
        const { def } = this.bot.cfg();
        if (!def.toolShopStand || !def.toolShopNpc || !def.toolName) {
            return;
        }
        this.bot.setStatus(`buying ${def.toolName}`);
        if (!(await this.bot.walkTo(def.toolShopStand, def.toolShopNpc))) {
            return;
        }
        if (!(await Shop.open(def.toolShopNpc))) {
            this.bot.log(`could not open ${def.toolShopNpc}'s shop`);
            return;
        }
        const bought = await Shop.buy(def.toolName, 1);
        await Shop.close();
        this.bot.log(bought > 0 ? `bought ${def.toolName}` : `${def.toolName} not in stock`);
    }
}

class BuyGoods implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def } = this.bot.cfg();
        if (def.mode === 'buy') {
            return this.bot.coinCount() > 0 && !Inventory.isFull();
        }
        if (def.mode === 'buy_grind') {
            // grind existing bars first before buying more
            if (def.grindFrom && Inventory.count(def.grindFrom) > 0 && this.bot.hasTool()) {
                return false;
            }
            return this.bot.hasTool() && this.bot.coinCount() > 0 && !Inventory.isFull() && Inventory.count(def.grindFrom ?? '') + this.bot.productCount() < 27;
        }
        return false;
    }
    async execute(): Promise<void> {
        const { def } = this.bot.cfg();
        if (!def.shopStand || !def.shopNpc) {
            return;
        }
        const buyName = def.mode === 'buy_grind' ? (def.grindFrom ?? def.name) : def.name;
        this.bot.setStatus(`buying ${buyName}`);
        if (!(await this.bot.walkTo(def.shopStand, def.shopNpc))) {
            return;
        }
        if (!(await Shop.open(def.shopNpc))) {
            this.bot.log(`could not open ${def.shopNpc}'s shop`);
            return;
        }
        const room = Math.max(0, Inventory.free() - (def.mode === 'buy_grind' ? 1 : 0));
        const bought = await Shop.buy(buyName, Math.min(room, 50));
        await Shop.close();
        if (bought > 0) {
            this.bot.log(`bought ${bought}× ${buyName}`);
            if (def.mode === 'buy') {
                this.bot.countGathered(bought);
            }
        } else {
            this.bot.log(`${buyName} out of stock — waiting`);
            await Execution.delayTicks(20);
        }
    }
}

class Grind implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def } = this.bot.cfg();
        return (
            def.mode === 'buy_grind' &&
            !!def.grindFrom &&
            !!def.toolName &&
            Inventory.contains(def.grindFrom) &&
            Inventory.contains(def.toolName)
        );
    }
    async execute(): Promise<void> {
        const { def } = this.bot.cfg();
        const bar = Inventory.first(def.grindFrom!);
        const pestle = Inventory.first(def.toolName!);
        if (!bar || !pestle) {
            return;
        }
        this.bot.setStatus(`grinding ${def.grindFrom}`);
        const before = this.bot.productCount();
        // content handles either order; try bar→pestle then pestle→bar
        await bar.useOn(pestle);
        if (!(await Execution.delayUntil(() => this.bot.productCount() > before, 8000))) {
            await pestle.useOn(bar);
            await Execution.delayUntil(() => this.bot.productCount() > before, 8000);
        }
        const got = this.bot.productCount() - before;
        if (got > 0) {
            this.bot.countGathered(got);
            this.bot.log(`ground ${got}× ${def.name}`);
        }
    }
}

class ProcessSource implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def } = this.bot.cfg();
        return def.mode === 'loot_process' && this.bot.sourceCount() > 0;
    }
    async execute(): Promise<void> {
        const { def } = this.bot.cfg();
        const toad = Inventory.first(def.sourceName!);
        if (!toad) {
            return;
        }
        this.bot.setStatus('pulling toad legs');
        const before = this.bot.productCount();
        const op = toad.actions().find(a => /remove-legs|remove legs/i.test(a)) ?? toad.actions()[0];
        if (!op) {
            return;
        }
        await toad.interact(op);
        if (await Execution.delayUntil(() => this.bot.productCount() > before || this.bot.sourceCount() === 0, 3000)) {
            this.bot.countGathered(Math.max(0, this.bot.productCount() - before));
        }
    }
}

class Loot implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    private find() {
        const { def } = this.bot.cfg();
        const name = def.sourceName ?? def.name;
        return GroundItems.query().name(name).within(def.searchRadius).nearest();
    }
    validate(): boolean {
        const { def } = this.bot.cfg();
        if (def.mode !== 'loot' && def.mode !== 'loot_process') {
            return false;
        }
        if (Inventory.isFull()) {
            return false;
        }
        if (!this.bot.near(def.anchor, def.searchRadius + 4)) {
            return false;
        }
        return this.find() !== null;
    }
    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        this.bot.setStatus(`taking ${drop.name}`);
        const before = Inventory.used();
        await drop.interact('Take');
        if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
            if (this.bot.cfg().def.mode === 'loot') {
                this.bot.countGathered(1);
            }
            this.bot.log(`looted ${drop.name}`);
        }
    }
}

class Travel implements Task {
    constructor(private bot: HerbloreSecondaries) {}
    validate(): boolean {
        const { def } = this.bot.cfg();
        // go to field/shop when not already near and pack not forcing bank
        if (Inventory.isFull() && (this.bot.productCount() > 0 || this.bot.sourceCount() > 0)) {
            return false;
        }
        const dest = def.shopStand ?? def.anchor;
        return !this.bot.near(dest, def.searchRadius);
    }
    async execute(): Promise<void> {
        const { def } = this.bot.cfg();
        const dest = def.shopStand ?? def.anchor;
        await this.bot.walkTo(dest, def.name);
    }
}
