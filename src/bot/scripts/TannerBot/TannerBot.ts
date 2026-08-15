import { reader, actions, type WorldTile } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Shop } from '../../api/shop/Shop.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Input } from '../../input/Input.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';

const TANNER_NAME = 'Tanner';
const TANNER_STAND = new Tile(3277, 3191, 0);
const BANK_STAND = new Tile(3269, 3167, 0);
const DOMMIK_NAME = 'Dommik';
// a verified-walkable tile on the street outside the shop; the shop interaction
// walks the last few tiles itself, so we never path onto an indoor/blocked tile
const DOMMIK_STAND = new Tile(3316, 3192, 0);

// tanner interface id + its "tan ALL" button per hide, read off the engine's
// interface.pack (the com_N names are not the runtime component ids)
const TANNER_IF = 679;
const COINS = 'Coins';

interface TanMode {
    hideId: number;
    hideLabel: string;
    productId: number;
    productLabel: string;
    tanAllComId: number;
}

// every dragonhide shares the display name "Dragonhide", so this bot keys off
// object ids throughout and only uses names for logging
const TAN_MODES: Record<string, TanMode> = {
    'Soft leather': { hideId: 1739, hideLabel: 'Cow hide', productId: 1741, productLabel: 'Leather', tanAllComId: 8686 },
    'Hard leather': { hideId: 1739, hideLabel: 'Cow hide', productId: 1743, productLabel: 'Hard leather', tanAllComId: 8690 },
    'Green dragonhide': { hideId: 1753, hideLabel: 'Green dragonhide', productId: 1745, productLabel: 'Green d-leather', tanAllComId: 8695 },
    'Blue dragonhide': { hideId: 1751, hideLabel: 'Blue dragonhide', productId: 2505, productLabel: 'Blue d-leather', tanAllComId: 8700 },
    'Red dragonhide': { hideId: 1749, hideLabel: 'Red dragonhide', productId: 2507, productLabel: 'Red d-leather', tanAllComId: 8705 },
    'Black dragonhide': { hideId: 1747, hideLabel: 'Black dragonhide', productId: 2509, productLabel: 'Black d-leather', tanAllComId: 8710 }
};

export const TANNER_SETTINGS: SettingsSchema = {
    hideType: {
        type: 'string',
        default: 'Soft leather',
        options: Object.keys(TAN_MODES),
        label: 'What to tan',
        help: 'soft/hard leather come from cowhides; the dragonhide rows tan that colour of hide'
    },
    buyThread: { type: 'boolean', default: true, label: 'Buy thread at Dommik?', help: "every Nth run, keep a slot free and buy out Dommik's thread on the way back" },
    threadEveryRuns: { type: 'number', default: 5, min: 1, max: 50, label: 'Thread run every N trips' },
    threadQty: { type: 'number', default: 100, min: 1, max: 1000, label: 'Thread to buy (stacks)' },
    coinsPerTrip: { type: 'number', default: 2000, min: 1, max: 100000, label: 'Coins to top up to', help: 'tanning is charged per hide, so the bot keeps a coin float in the pack' }
};

function bankItemById(id: number) {
    return Bank.items().find(i => i.id === id) ?? null;
}

function opIndex(ops: readonly (string | null)[], pattern: RegExp): number {
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op !== null && pattern.test(op)) {
            return i + 1;
        }
    }
    return -1;
}

// Bank.withdrawX is name-keyed, which cannot tell the four dragonhides apart
async function withdrawXById(id: number, count: number): Promise<boolean> {
    if (count <= 0) {
        return true;
    }
    const item = bankItemById(id);
    if (!item) {
        return false;
    }
    const op = opIndex(item.ops, /withdraw[\s-]*x/i);
    if (op === -1) {
        return false;
    }
    const before = Inventory.used();
    Input.invButton(item.id, item.slot, item.comId, op);
    if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
        return false;
    }
    actions.answerCountDialog(count);
    return Execution.delayUntil(() => Inventory.used() > before, 4000);
}

function invCountById(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
}

export default class TannerBot extends LoopingBot {
    override loopDelay = 600;

    private mode: TanMode = TAN_MODES['Soft leather'];
    private modeLabel = 'Soft leather';
    private buyThread = true;
    private threadEvery = 5;
    private threadQty = 100;
    private coinFloat = 2000;

    private runs = 0;
    private tanned = 0;
    private thread = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.modeLabel = this.settings.str('hideType', 'Soft leather');
        this.mode = TAN_MODES[this.modeLabel] ?? TAN_MODES['Soft leather'];
        this.buyThread = this.settings.bool('buyThread', true);
        this.threadEvery = this.settings.num('threadEveryRuns', 5);
        this.threadQty = this.settings.num('threadQty', 100);
        this.coinFloat = this.settings.num('coinsPerTrip', 2000);
        this.startedAt = Date.now();

        this.log(`TannerBot — ${this.modeLabel}: ${this.mode.hideLabel} -> ${this.mode.productLabel}${this.buyThread ? `, thread every ${this.threadEvery} runs` : ''}`);
    }

    async loop(): Promise<void> {
        const threadRun = this.buyThread && this.runs > 0 && this.runs % this.threadEvery === 0;

        if (!(await this.bankLeg(threadRun))) {
            return;
        }
        if (!(await this.tanLeg())) {
            return;
        }
        if (threadRun) {
            await this.threadLeg();
        }
        this.runs++;
    }

    private async walkTo(dest: WorldTile, what: string): Promise<boolean> {
        const here = Game.tile();
        if (here && Math.max(Math.abs(here.x - dest.x), Math.abs(here.z - dest.z)) <= 4) {
            return true;
        }
        this.setStatus(`walking to ${what}`);
        return Traversal.walkResilient(dest, { radius: 3, attempts: 2, timeoutMs: 45_000, log: m => this.log(`  ${m}`) });
    }

    private async bankLeg(threadRun: boolean): Promise<boolean> {
        if (!(await this.walkTo(BANK_STAND, 'the bank'))) {
            return false;
        }
        this.setStatus('banking');
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return false;
        }

        await Bank.depositAllMatching(name => name.toLowerCase() !== COINS.toLowerCase());

        if (Inventory.count(COINS) < this.coinFloat / 2 && Bank.count(COINS) > 0) {
            await Bank.withdrawX(COINS, this.coinFloat);
        }
        if (Inventory.count(COINS) === 0) {
            ScriptRunner.stop('out of coins — the tanner charges per hide');
            return false;
        }

        // one slot is held back on a thread run so the stack has somewhere to land
        const free = reader.inventorySize() - Inventory.used() - (threadRun ? 1 : 0);
        if (!(await withdrawXById(this.mode.hideId, free))) {
            const banked = bankItemById(this.mode.hideId)?.count ?? 0;
            this.log(banked > 0
                ? `${banked} ${this.mode.hideLabel} still in the bank — withdrawal failed, retrying.`
                : `${this.mode.hideLabel} not currently visible in the bank — waiting.`);
            return false;
        }

        actions.closeModal();
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);
        return invCountById(this.mode.hideId) > 0;
    }

    private async tanLeg(): Promise<boolean> {
        if (!(await this.walkTo(TANNER_STAND, 'the tanner'))) {
            return false;
        }

        const tanner = Npcs.query().name(TANNER_NAME).nearest();
        if (!tanner) {
            this.log(`no ${TANNER_NAME} nearby`);
            return false;
        }

        const hides = invCountById(this.mode.hideId);
        this.setStatus(`tanning ${hides} ${this.mode.hideLabel}`);
        // "Trade" is opnpc3, which opens the tan interface with no dialogue to click through
        if (!(await tanner.interact('Trade'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => reader.modals().main === TANNER_IF, 5000))) {
            this.log('tanner interface did not open — retrying');
            return false;
        }

        actions.ifButton(this.mode.tanAllComId);
        const done = await Execution.delayUntil(() => invCountById(this.mode.hideId) === 0, 6000);
        const made = invCountById(this.mode.productId);
        actions.closeModal();
        await Execution.delayUntil(() => reader.modals().main !== TANNER_IF, 3000);

        if (!done) {
            this.log(`only part of the load tanned (${invCountById(this.mode.hideId)} ${this.mode.hideLabel} left) — check coins`);
        }
        this.tanned += made;
        this.log(`tanned ${made} ${this.mode.productLabel}`);
        return true;
    }

    private async threadLeg(): Promise<void> {
        if (!(await this.walkTo(DOMMIK_STAND, 'Dommik'))) {
            return;
        }
        this.setStatus('buying thread');
        if (!(await Shop.open(DOMMIK_NAME))) {
            this.log('could not open Dommik\'s shop — skipping the thread run');
            return;
        }
        const bought = await Shop.buy('Thread', this.threadQty);
        this.thread += bought;
        this.log(`bought ${bought} thread`);
        await Shop.close();
    }

    private setStatus(s: string): void {
        this.status = s;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c9a227' });
        p.title(`Tanner — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const perHr = mins > 0.5 ? Math.round((this.tanned / mins) * 60) : 0;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Runs: ${this.runs}`, `${this.mode.productLabel}/hr: ${perHr}`);
        p.row(`Tanned: ${this.tanned}`, `Thread: ${this.thread}`, `Coins: ${Inventory.count(COINS)}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
