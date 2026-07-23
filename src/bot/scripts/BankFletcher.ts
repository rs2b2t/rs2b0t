import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory, InvItem } from '../api/hud/Inventory.js';
import { Bank, withdrawOp } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore, type SettingsSchema } from '../runtime/Settings.js';
import { attachPlanFor, LOG_OPTIONS, logNameMatches, matchProduct, productNeedsDifferentLog } from './BankFletcherLogic.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const DEFAULT_BANK_STAND = new Tile(3185, 3440, 0);
const BOOTH = { op: 'Use-quickly' };
const PRODUCT_OPTIONS = [
    'Arrow shafts', 'Short bow', 'Long bow',
    'Headless arrows', 'Bronze arrows', 'Iron arrows', 'Steel arrows', 'Mithril arrows', 'Adamant arrows', 'Rune arrows'
];

export const SETTINGS: SettingsSchema = {
    material: { type: 'string', default: 'Logs', options: LOG_OPTIONS, label: 'Log type', help: 'the exact log to withdraw and fletch — only regular Logs make Arrow shafts; every log makes a bow. Ignored for the arrow attach products' },
    product: { type: 'string', default: 'Arrow shafts', options: PRODUCT_OPTIONS, label: 'Fletch product', help: 'which product to make — knife products open the make-menu; arrow products attach item-on-item (material/knife ignored)' },
    knife: { type: 'string', default: 'Knife', label: 'Fletching tool (contains)', help: 'the tool used on the logs; lives in the bank between cycles; ignored for the arrow attach products' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)', help: 'stand adjacent to a bank booth — start the bot here' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Booth search radius (tiles)' }
};

export default class BankFletcher extends TaskBot {
    override loopDelay = 600;

    private made = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private material = 'Logs';
    private product = 'Arrow shafts';
    private knife = 'Knife';
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';
    private leash = 6;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.material = this.settings.str('material', 'Logs');
        this.product = this.settings.str('product', 'Arrow shafts');
        this.knife = this.settings.str('knife', 'Knife');
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.leash = this.settings.num('leashRadius', 6);

        const plan = attachPlanFor(this.product);
        if (plan && Skills.level('fletching') < plan.level) {
            this.log(`BankFletcher: Fletching ${plan.level} required for ${this.product} (have ${Skills.level('fletching')}) — stopping.`);
            throw new Error('BankFletcher: fletching level too low for the chosen product');
        }
        if (!plan && productNeedsDifferentLog(this.product, this.material)) {
            this.log(`BankFletcher: Arrow shafts fletch only from regular Logs, not '${this.material}' — pick Logs or a bow product. Stopping.`);
            throw new Error('BankFletcher: arrow shafts require regular Logs');
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('fletching');

        if (plan) {
            this.log(`BankFletcher attaching '${plan.inputs[0]}' onto '${plan.inputs[1]}' → ${plan.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        } else {
            this.log(`BankFletcher fletching '${this.material}' → ${this.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        }
        this.add(new ContinueDialog(), new FletchDialog(this), new Attach(this), new BankTrip(this), new Fletch(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c9a0ff' });
        p.title(`BankFletcher — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('fletching') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `XP/hr: ${xph}`);
        p.row(`${this.product}: ${this.made}`, `Bank trips: ${this.trips}`);
        const paintPlan = this.attachPlan();
        if (paintPlan) {
            p.row(`${paintPlan.inputs[0]}: ${this.packCount(paintPlan.inputs[0])}`, `${paintPlan.inputs[1]}: ${this.packCount(paintPlan.inputs[1])}`);
        } else {
            p.row(`Logs left: ${this.logCount()}`);
        }

        p.gap();
        const picked = p.select('product', 'product', PRODUCT_OPTIONS, this.product);
        if (picked && picked !== this.product) {
            this.switchProduct(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchProduct(product: string): void {
        this.product = product;
        SettingsStore.save('BankFletcher', 'product', product);
        this.log(`fletch product switched to ${product} (from the paint)`);
    }

    setStatus(s: string): void { this.status = s; }
    recordMade(n: number): void { this.made += n; }
    countTrip(): void { this.trips++; }
    productName(): string { return this.product; }
    materialName(): string { return this.material; }
    knifeName(): string { return this.knife; }
    bankTile(): Tile { return this.bankStand; }
    boothLocName(): string { return this.boothName; }
    leashRadius(): number { return this.leash; }

    attachPlan(): ReturnType<typeof attachPlanFor> {
        return attachPlanFor(this.product);
    }

    packCount(name: string): number {
        const pat = name.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    packItem(name: string): InvItem | null {
        const pat = name.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }

    logCount(): number {
        return Inventory.items().filter(i => logNameMatches(i.name, this.material)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    lastLog(): InvItem | null {
        const items = Inventory.items();
        for (let i = items.length - 1; i >= 0; i--) {
            if (logNameMatches(items[i].name, this.material)) {
                return items[i];
            }
        }
        return null;
    }

    knifeItem(): InvItem | null {
        const pat = this.knife.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }
}

class FletchDialog implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean { return this.bot.attachPlan() === null && ChatDialog.isMakeMenu(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing product');
        const products = ChatDialog.makeProducts();
        const match = matchProduct(products, this.bot.productName());
        if (!match) {
            this.bot.log(`BankFletcher: '${this.bot.productName()}' isn't offered for '${this.bot.materialName()}' (menu: [${products.join(', ')}]) — stopping instead of making the wrong item.`);
            ScriptRunner.stop();
            return;
        }
        const start = this.bot.logCount();
        const picked = await ChatDialog.make(match);
        if (!picked) {
            this.bot.log(`make menu open but couldn't pick *${this.bot.productName()}* — products: [${products.join(', ')}]`);
            await Execution.delayTicks(1);
            return;
        }
        await Execution.delayUntil(() => Game.animating() || this.bot.logCount() < start || ChatDialog.isMakeMenu(), 3000);
        let mark = this.bot.logCount();
        for (let guard = 0; guard < 200; guard++) {
            if (this.bot.logCount() === 0 || ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const progressed = await Execution.delayUntil(() => this.bot.logCount() < mark || ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 4000);
            const now = this.bot.logCount();
            if (now < mark) {
                this.bot.recordMade(mark - now);
                mark = now;
            } else if (!progressed || !Game.animating()) {
                return;
            }
        }
    }
}

class BankTrip implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean {
        const plan = this.bot.attachPlan();
        if (plan) {
            return this.bot.packCount(plan.inputs[0]) === 0 || this.bot.packCount(plan.inputs[1]) === 0;
        }
        return this.bot.logCount() === 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        const opened = (await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositInventory();
        await Execution.delayTicks(1);
        this.bot.countTrip();

        const plan = this.bot.attachPlan();
        if (plan) {
            for (const input of plan.inputs) {
                const pat = input.toLowerCase();
                const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(pat));
                if (!bankItem || bankItem.name === null) {
                    this.bot.log(`no '${input}' in the bank — idling`);
                    await Execution.delayTicks(5);
                    return;
                }
                const bankName = bankItem.name;
                const allOp = withdrawOp(bankItem.ops, 'all') ?? withdrawOp(bankItem.ops, 'any') ?? 'Withdraw-All';
                this.bot.log(`withdrawing all ${bankName} ('${allOp}')`);
                await Bank.withdraw(bankName, allOp);
                await Execution.delayUntil(() => this.bot.packCount(input) > 0 || Bank.count(bankName) === 0, 4000);
            }
            return;
        }

        const logItem = Bank.items().find(i => logNameMatches(i.name, this.bot.materialName()));
        if (!logItem || logItem.name === null) {
            this.bot.log(`BankFletcher: bank is out of '${this.bot.materialName()}' — fletching complete, stopping.`);
            ScriptRunner.stop();
            return;
        }
        const logName = logItem.name;

        const knifePat = this.bot.knifeName().toLowerCase();
        const knifeBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(knifePat));
        if (!knifeBank || knifeBank.name === null) {
            this.bot.log(`no '${this.bot.knifeName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const knifeName = knifeBank.name;
        if (Inventory.count(knifeName) === 0) {
            const knifeOps = knifeBank.ops.filter((o): o is string => o !== null);
            const oneOp = withdrawOp(knifeOps, '1') ?? withdrawOp(knifeOps, 'any') ?? 'Withdraw-1';
            await Bank.withdraw(knifeName, oneOp);
            await Execution.delayUntil(() => Inventory.contains(knifeName), 3000);
        }

        const allOp = withdrawOp(logItem.ops, 'all');
        if (allOp) {
            this.bot.log(`withdrawing all ${logName} ('${allOp}')`);
            await Bank.withdraw(logName, allOp);
            await Execution.delayUntil(() => this.bot.logCount() > 0 || Bank.count(logName) === 0, 4000);
        } else {
            const tenOp = withdrawOp(logItem.ops, '10') ?? withdrawOp(logItem.ops, 'any') ?? 'Withdraw-10';
            this.bot.log(`withdrawing ${logName} 10 at a time ('${tenOp}')`);
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(logName) > 0; n++) {
                const before = this.bot.logCount();
                await Bank.withdraw(logName, tenOp);
                if (!(await Execution.delayUntil(() => this.bot.logCount() > before || Inventory.isFull(), 3000))) { break; }
            }
        }
    }
}

class Fletch implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean { return this.bot.attachPlan() === null && this.bot.logCount() > 0 && !ChatDialog.isOpen(); }
    async execute(): Promise<void> {
        for (let n = 0; n < 30 && this.bot.logCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const knife = this.bot.knifeItem();
            const log = this.bot.lastLog();
            if (!knife || !log) { await Execution.delayTicks(2); return; }
            this.bot.setStatus(`fletching ${this.bot.productName()}`);
            const before = this.bot.logCount();
            if (!(await knife.useOn(log))) { await Execution.delayTicks(2); continue; }
            await Execution.delayUntil(() => ChatDialog.isMakeMenu() || this.bot.logCount() < before || ChatDialog.canContinue(), 8000);
            if (ChatDialog.isMakeMenu()) { return; }
        }
    }
}

class Attach implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean {
        const plan = this.bot.attachPlan();
        return plan !== null && this.bot.packCount(plan.inputs[0]) > 0 && this.bot.packCount(plan.inputs[1]) > 0 && !ChatDialog.isOpen();
    }
    async execute(): Promise<void> {
        const plan = this.bot.attachPlan();
        if (!plan) { return; }
        this.bot.setStatus(`attaching ${plan.product}s`);
        for (let n = 0; n < 80; n++) {
            if (ChatDialog.isOpen()) { return; }
            const a = this.bot.packItem(plan.inputs[0]);
            const b = this.bot.packItem(plan.inputs[1]);
            if (!a || !b) { return; }
            const before = Inventory.count(plan.product);
            if (!(await a.useOn(b))) { await Execution.delayTicks(2); continue; }
            const progressed = await Execution.delayUntil(
                () => Inventory.count(plan.product) > before || ChatDialog.isOpen(),
                4000
            );
            const now = Inventory.count(plan.product);
            if (now > before) {
                this.bot.recordMade(now - before);
            } else if (!progressed) {
                return;
            }
        }
    }
}
