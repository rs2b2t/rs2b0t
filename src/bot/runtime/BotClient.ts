import { Client } from '#/client/shell/Client.js';
import { WorkerClock } from '#/bot/runtime/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { BotDiag } from './diag/BotDiag.js';
import { paintNavPathInGame } from '../event/webwalk/pathScenePaint.js';
import { RenderGate } from './RenderGate.js';

// Why: the era client runs its logic loop at 50/sec for smooth animation and instant input, but the server ticks every 600ms and a bot reads state rather than pixels, so 20/sec is still 12 logic ticks per server tick.
// Why: on a wall, every iframe spends that budget on one shared main thread.
// Why: deltime also gates frameDelay and so caps the draw rate — at 20Hz the focused client falls to ~13 FPS and walk animations visibly crawl, so the one client being looked at keeps the era rate and the rest stay cheap.
// Why: title and logged-out backgrounds have no world simulation that scripts care about, so 10 Hz covers AutoRelogin plus UI and halves steady-state CPU on a login wall.
const FOCUSED_LOGIC_HZ = 50;
const BACKGROUND_INGAME_LOGIC_HZ = 20;
const BACKGROUND_TITLE_LOGIC_HZ = 10;

export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean) {
        super(nodeid, lowmem, members);
        this.syncLogicRate();
        BotDiag.attach(this);
        BotHost.attach(this);
    }

    /** Cycle-stamped state (combat) is read against deltime, so switching rates can
     *  misread a stamp made at the old rate for up to one combat window. */
    private syncLogicRate(): void {
        let hz = FOCUSED_LOGIC_HZ;
        if (RenderGate.mode !== 'focused') {
            // Prefer the adapter once attached; fall back to Client.ingame during boot.
            const live = this.ingame;
            hz = live ? BACKGROUND_INGAME_LOGIC_HZ : BACKGROUND_TITLE_LOGIC_HZ;
        }
        const want = Math.trunc(1000 / hz);
        if (this.deltime !== want) {
            this.setFramerate(hz);
        }
    }

    protected override async frameDelay(ms: number): Promise<void> {
        await WorkerClock.sleep(ms, !RenderGate.enabled);
    }

    override async mainloop(): Promise<void> {
        this.syncLogicRate();
        await super.mainloop();
        // Why: only the host frame is timed — it is synchronous and it is where the cost lives, since script plus producer work dwarfs the client's own loop.
        // Why: super.mainloop() is async, so timing it would measure yields to other bots rather than occupancy.
        BotDiag.measure('logic', () => BotHost.onFrame());
    }

    override async mainredraw(): Promise<void> {
        const now = performance.now();
        // Measured outside the gate on purpose: a skipped draw costs nothing, and
        // counting it would make an idle background bot look like it is drawing.
        if (!RenderGate.shouldDraw(now)) {
            return;
        }
        await super.mainredraw();
        RenderGate.markDrawn(now);
        BotDiag.measure('draw', () => BotHost.onDraw());
    }

    /** Path tile quads + loc rings into areaGame (after 3D world, before name plates). */
    protected override onAfterWorldRender(): void {
        try {
            paintNavPathInGame(this);
        } catch (err) {
            console.error('[rs2b0t] path scene paint error', err);
        }
    }
}
