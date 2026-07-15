import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank, withdrawOp } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { walkOpening } from '../api/walkOpening.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { countRaw, lastRawIndex } from './CookBotLogic.js';

const DEFAULT_BANK_STAND = new Tile(2809, 3441, 0);
const DEFAULT_RANGE_STAND = new Tile(2817, 3443, 0);
const BOOTH = { op: 'Use-quickly' };

/** minutes → h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const SETTINGS: SettingsSchema = {
    fish: { type: 'string', default: 'Raw salmon', label: 'Raw fish to cook (contains)', help: 'e.g. Raw salmon / Raw shark / Raw lobster' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    rangeStand: { type: 'tile', default: DEFAULT_RANGE_STAND, label: 'Range stand tile (x,z)' },
    rangeName: { type: 'string', default: 'Range', label: 'Range loc name' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'the range door closes — open it en route' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 20, label: 'Range search radius (tiles)' }
};

/**
 * Catherby cook-and-bank loop. Withdraw a full pack of raw fish, cross to the
 * range (opening the closing door), cook every raw fish by using the LAST one on
 * the range one at a time, then return and bank the whole pack (cooked + burnt +
 * junk), and repeat. Start it at the Catherby bank.
 */
export default class CookBot extends TaskBot {
    override loopDelay = 600;

    private cooked = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private fish = 'Raw salmon';
    private bankStand = DEFAULT_BANK_STAND;
    private rangeStand = DEFAULT_RANGE_STAND;
    private rangeName = 'Range';
    private boothName = 'Bank booth';
    private obstacle: string[] = ['door', 'gate'];
    private leash = 8;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.fish = this.settings.str('fish', 'Raw salmon');
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.rangeStand = this.settings.tile('rangeStand', DEFAULT_RANGE_STAND);
        this.rangeName = this.settings.str('rangeName', 'Range');
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.obstacle = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 8);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('cooking');

        this.log(`CookBot cooking '${this.fish}' — bank ${this.bankStand}, range ${this.rangeStand}`);
        this.add(new ContinueDialog(), new CookDialog(this), new BankTrip(this), new CookTrip(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffd479' });
        p.title(`CookBot — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('cooking') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Cooked: ${this.cooked}`, `XP/hr: ${xph}`);
        p.row(`Cooking: ${this.fish}`, `Raw left: ${this.rawCount()}`, `Bank trips: ${this.trips}`);

        p.gap();
        // processing bot — switching food mid-pack would strand a half-cooked
        // batch, so Pause/Stop only (no live selector)
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordCook(n: number): void { this.cooked += n; }
    countTrip(): void { this.trips++; }
    fishName(): string { return this.fish; }
    rangeLocName(): string { return this.rangeName; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }
    bankTile(): Tile { return this.bankStand; }
    rangeTile(): Tile { return this.rangeStand; }
    boothLocName(): string { return this.boothName; }
    rawCount(): number { return countRaw(Inventory.items(), this.fish); }
    /** The LAST raw-fish InvItem in the pack (the cook target), or null. */
    lastRaw() {
        const items = Inventory.items();
        const idx = lastRawIndex(items, this.fish);
        return idx >= 0 ? items[idx] : null;
    }
}

/** Standard fish don't prompt, but karambwan (and future picks) open a make-X
 *  menu — pick the fish product and let the cook proceed. */
class CookDialog implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return ChatDialog.isMakeMenu(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing product');
        if (!(await ChatDialog.make(this.bot.fishName()))) {
            await ChatDialog.make(); // fall back to the first product
        }
        await Execution.delayTicks(1);
    }
}

/** No raw fish in the pack → cross to the bank, deposit EVERYTHING, withdraw a
 *  full pack of raw fish. */
class BankTrip implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return this.bot.rawCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositInventory(); // cooked + burnt + junk — the whole pack
        await Execution.delayTicks(1);
        // Find the fish bank item by substring (the `fish` setting may be partial)
        // — Bank.withdraw/count match names EXACTLY, so resolve the real name first.
        const pat = this.bot.fishName().toLowerCase();
        const fishItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(pat));
        this.bot.countTrip();
        if (!fishItem || fishItem.name === null) {
            this.bot.log(`no '${this.bot.fishName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const bankName = fishItem.name;
        const allOp = withdrawOp(fishItem.ops, 'all');
        if (allOp) {
            this.bot.log(`withdrawing all ${bankName} ('${allOp}')`);
            await Bank.withdraw(bankName, allOp);
            await Execution.delayUntil(() => this.bot.rawCount() > 0 || Bank.count(bankName) === 0, 4000);
        } else {
            const tenOp = withdrawOp(fishItem.ops, '10') ?? withdrawOp(fishItem.ops, 'any') ?? 'Withdraw-10';
            this.bot.log(`withdrawing ${bankName} 10 at a time ('${tenOp}')`);
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(bankName) > 0; n++) {
                const before = this.bot.rawCount();
                await Bank.withdraw(bankName, tenOp);
                if (!(await Execution.delayUntil(() => this.bot.rawCount() > before || Inventory.isFull(), 3000))) { break; }
            }
        }
        // walking closes the bank; CookTrip crosses to the range next tick
    }
}

/** Raw fish in the pack → cross to the range and cook the LAST raw fish, one at
 *  a time, until none remain. */
class CookTrip implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return this.bot.rawCount() > 0 && !ChatDialog.isOpen(); }
    async execute(): Promise<void> {
        const range = () => Locs.query().name(this.bot.rangeLocName()).where(l => l.tile().distanceTo(this.bot.rangeTile()) <= this.bot.leashRadius()).nearest();
        const here = Game.tile();
        if (!here || this.bot.rangeTile().distanceTo(here) > 1 || !range()) {
            this.bot.setStatus('crossing to the range');
            await walkOpening(this.bot.rangeTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        }
        // cook the last raw fish repeatedly until none remain (bounded)
        for (let n = 0; n < 30 && this.bot.rawCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const raw = this.bot.lastRaw();
            const oven = range();
            if (!raw || !oven) { await Execution.delayTicks(2); return; }
            this.bot.setStatus(`cooking ${raw.name}`);
            const before = this.bot.rawCount();
            if (!(await raw.useOn(oven))) { await Execution.delayTicks(2); continue; }
            // wait for the fish to cook (raw count drops), a menu, or a dialog
            if (await Execution.delayUntil(() => this.bot.rawCount() < before || ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 6000)) {
                if (this.bot.rawCount() < before) { this.bot.recordCook(before - this.bot.rawCount()); }
            }
        }
    }
}
