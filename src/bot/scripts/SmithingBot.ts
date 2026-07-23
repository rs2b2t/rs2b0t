import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory, InvItem } from '../api/hud/Inventory.js';
import { Bank, withdrawOp } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { walkOpening } from '../api/walkOpening.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const DEFAULT_ANVIL_STAND = new Tile(3188, 3425, 0);
const DEFAULT_BANK_STAND = new Tile(3185, 3440, 0);
const BOOTH = { op: 'Use-quickly' };
const BAR_OPTIONS = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'];

const PRODUCT_OPTIONS = ['Dagger', 'Sword', 'Scimitar', 'Longsword', '2h sword', 'Axe', 'Mace', 'Warhammer', 'Battleaxe', 'Chainbody', 'Platelegs', 'Plateskirt', 'Platebody', 'Med helm', 'Full helm', 'Sq shield', 'Kiteshield', 'Nails', 'Dart tip', 'Arrowtips', 'Knife', 'Wire', 'Claws'];

export const SETTINGS: SettingsSchema = {
    bar: { type: 'string', default: 'Bronze', options: BAR_OPTIONS, label: 'Bar tier' },
    product: { type: 'string', default: 'Dagger', options: PRODUCT_OPTIONS, label: 'Item to smith', help: 'matched against the anvil panel by keyword (the panel names are tier-specific, e.g. "Bronze dagger")' },
    hammer: { type: 'string', default: 'Hammer', label: 'Tool (contains)', help: 'lives in the bank between cycles' },
    anvilName: { type: 'string', default: 'Anvil', label: 'Anvil loc name' },
    anvilStand: { type: 'tile', default: DEFAULT_ANVIL_STAND, label: 'Anvil stand tile (x,z)' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'the anvil building has a door' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Anvil search radius (tiles)' }
};

export default class SmithingBot extends TaskBot {
    override loopDelay = 600;

    private made = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private bar = 'Bronze';
    private product = 'Dagger';
    private hammer = 'Hammer';
    private anvilName = 'Anvil';
    private anvilStand = DEFAULT_ANVIL_STAND;
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';
    private obstacle: string[] = ['door', 'gate'];
    private leash = 6;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.bar = this.settings.str('bar', 'Bronze');
        this.product = this.settings.str('product', 'Dagger');
        this.hammer = this.settings.str('hammer', 'Hammer');
        this.anvilName = this.settings.str('anvilName', 'Anvil');
        this.anvilStand = this.settings.tile('anvilStand', DEFAULT_ANVIL_STAND);
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.obstacle = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 6);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('smithing');

        this.log(`SmithingBot smithing ${this.bar} → ${this.product} — anvil ${this.anvilStand}, bank ${this.bankStand}`);
        this.add(new ContinueDialog(), new SmithPanel(this), new BankTrip(this), new Smith(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffb066' });
        p.title(`SmithingBot — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('smithing') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Bars used: ${this.made}`, `XP/hr: ${xph}`);
        p.row(`${this.bar} ${this.product}`, `Bars left: ${this.barCount()}`, `Bank trips: ${this.trips}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordMade(n: number): void { this.made += n; }
    countTrip(): void { this.trips++; }
    productName(): string { return this.product; }
    hammerName(): string { return this.hammer; }
    barItemName(): string { return `${this.bar} bar`; }
    anvilLocName(): string { return this.anvilName; }
    anvilTile(): Tile { return this.anvilStand; }
    bankTile(): Tile { return this.bankStand; }
    boothLocName(): string { return this.boothName; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }

    barCount(): number {
        const pat = this.barItemName().toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    lastBar(): InvItem | null {
        const pat = this.barItemName().toLowerCase();
        const items = Inventory.items();
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].name?.toLowerCase().includes(pat)) {
                return items[i];
            }
        }
        return null;
    }

    hammerItem(): InvItem | null {
        const pat = this.hammer.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }
}

class SmithPanel implements Task {
    constructor(private bot: SmithingBot) {}
    validate(): boolean { return ChatDialog.isMainMakePanel(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing item');
        const start = this.bot.barCount();
        if (!(await ChatDialog.makeFromPanelMax(this.bot.productName()))) {
            const products = ChatDialog.mainMakeProducts().filter(Boolean);
            if (products.length === 0) { await Execution.delayTicks(1); return; }
            this.bot.log(`'${this.bot.productName()}' isn't on the ${this.bot.barItemName()} anvil panel — available: [${products.join(', ')}]. Stopping (pick a listed item).`);
            this.bot.setStatus(`'${this.bot.productName()}' not available — stopped`);
            ScriptRunner.stop();
            return;
        }
        await Execution.delayUntil(() => Game.animating() || this.bot.barCount() < start || ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), 3000);
        let mark = this.bot.barCount();
        for (let guard = 0; guard < 200; guard++) {
            if (this.bot.barCount() === 0 || ChatDialog.isMainMakePanel() || ChatDialog.canContinue()) { return; }
            const progressed = await Execution.delayUntil(() => this.bot.barCount() < mark || ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), 4000);
            const now = this.bot.barCount();
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
    constructor(private bot: SmithingBot) {}
    validate(): boolean { return this.bot.barCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        const hammerPat = this.bot.hammerName().toLowerCase();
        await Bank.depositAllMatching(name => !name.toLowerCase().includes(hammerPat));
        await Execution.delayTicks(1);
        this.bot.countTrip();

        if (!this.bot.hammerItem()) {
            const hammerBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(hammerPat));
            if (!hammerBank || hammerBank.name === null) {
                this.bot.log(`no '${this.bot.hammerName()}' carried or in the bank — idling`);
                await Execution.delayTicks(5);
                return;
            }
            const hammerName = hammerBank.name;
            const hOps = hammerBank.ops.filter((o): o is string => o !== null);
            const oneOp = withdrawOp(hOps, '1') ?? withdrawOp(hOps, 'any') ?? 'Withdraw-1';
            await Bank.withdraw(hammerName, oneOp);
            await Execution.delayUntil(() => this.bot.hammerItem() !== null, 3000);
        }

        const barBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(this.bot.barItemName().toLowerCase()));
        if (!barBank || barBank.name === null) {
            this.bot.log(`no '${this.bot.barItemName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const barName = barBank.name;
        const allOp = withdrawOp(barBank.ops, 'all');
        if (allOp) {
            this.bot.log(`withdrawing all ${barName} ('${allOp}')`);
            await Bank.withdraw(barName, allOp);
            await Execution.delayUntil(() => this.bot.barCount() > 0 || Bank.count(barName) === 0, 4000);
        } else {
            const tenOp = withdrawOp(barBank.ops, '10') ?? withdrawOp(barBank.ops, 'any') ?? 'Withdraw-10';
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(barName) > 0; n++) {
                const before = this.bot.barCount();
                await Bank.withdraw(barName, tenOp);
                if (!(await Execution.delayUntil(() => this.bot.barCount() > before || Inventory.isFull(), 3000))) { break; }
            }
        }
    }
}

class Smith implements Task {
    constructor(private bot: SmithingBot) {}
    validate(): boolean { return this.bot.barCount() > 0 && !ChatDialog.isOpen() && !ChatDialog.isMainMakePanel(); }
    async execute(): Promise<void> {
        const anvil = () => Locs.query().name(this.bot.anvilLocName()).where(l => l.tile().distanceTo(this.bot.anvilTile()) <= this.bot.leashRadius()).nearest();
        const here = Game.tile();
        if (!here || this.bot.anvilTile().distanceTo(here) > 1 || !anvil()) {
            this.bot.setStatus('walking to the anvil');
            await walkOpening(this.bot.anvilTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        }
        if (!this.bot.hammerItem()) {
            this.bot.log('no hammer in the pack — idling (need a hammer to smith)');
            await Execution.delayTicks(5);
            return;
        }
        const bar = this.bot.lastBar();
        const av = anvil();
        if (!bar || !av) { await Execution.delayTicks(2); return; }
        this.bot.setStatus(`smithing ${this.bot.productName()}`);
        if (!(await bar.useOn(av))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => ChatDialog.isMainMakePanel() || ChatDialog.canContinue() || this.bot.barCount() === 0, 6000);
    }
}
