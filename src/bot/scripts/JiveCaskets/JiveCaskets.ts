import { TaskBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking, RANDOM_EVENT_CASKET_ID } from '../../api/bank/Banking.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';

export default class JiveCaskets extends TaskBot {
    override loopDelay = 100;

    private opened = 0;
    private failures = 0;
    private done = false;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        this.startedAt = Date.now();
        this.log('JiveCaskets: opening ordinary caskets and banking all loot');
        this.add({ label: 'Open caskets', validate: () => !this.done && Game.ingame(), execute: () => this.run() });
    }

    private finish(reason: string): void {
        this.done = true;
        this.status = reason;
        this.log(`${reason}; opened ${this.opened} caskets`);
        this.requestFinish(reason);
    }

    private async run(): Promise<void> {
        const caskets = Inventory.items().filter(i => i.id === RANDOM_EVENT_CASKET_ID && !i.noted).slice(0, 5);
        if (caskets.length > 0) {
            if (Bank.isOpen()) {
                this.status = 'closing bank';
                await Bank.close();
                return;
            }
            this.status = 'opening caskets';
            const before = Inventory.countById(RANDOM_EVENT_CASKET_ID);
            let sent = 0;
            for (const casket of caskets) {
                if (await casket.interact('Open')) sent++;
            }
            if (sent > 0) {
                await Execution.delayUntilTicks(() => Inventory.countById(RANDOM_EVENT_CASKET_ID) <= before - sent, 3);
            }
            const opened = before - Inventory.countById(RANDOM_EVENT_CASKET_ID);
            if (opened > 0) {
                this.opened += opened;
                this.failures = 0;
            } else if (++this.failures >= 3) {
                this.finish('could not open a casket after three attempts');
            }
            return;
        }

        this.status = 'banking loot';
        if (!(await Banking.open({ log: m => this.log(m) }))
            || !(await Bank.waitReady()) || !(await Bank.backpackReady())) return;
        await Bank.depositInventory();
        if (Inventory.used() > 0) return;

        if (Bank.countById(RANDOM_EVENT_CASKET_ID) === 0) {
            if (await Bank.close()) this.finish('bank has no more caskets');
            return;
        }

        this.status = 'withdrawing caskets';
        await Bank.setNoteMode(false);
        if (!(await Bank.withdrawLoad(RANDOM_EVENT_CASKET_ID))) return;
        await Bank.close();
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#d4af37' });
        const minutes = (Date.now() - this.startedAt) / 60_000;
        p.title(`JiveCaskets - ${this.status}`);
        p.row(`Runtime: ${fmtDuration(minutes)}`, `Opened: ${this.opened}`);
        p.row(`Caskets/hr: ${minutes > 0 ? Math.round(this.opened * 60 / minutes) : 0}`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
