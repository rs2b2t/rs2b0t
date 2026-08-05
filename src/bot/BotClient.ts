import { Client } from '#/client/Client.js';
import { WorkerClock } from '#/util/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { paintNavPathInGame } from './nav/pathScenePaint.js';
import { RenderGate } from './runtime/RenderGate.js';

// The era client runs its logic loop at 50/sec so a human sees smooth animation and
// instant input. The server ticks every 600ms and a bot reads state, not pixels, so 20/sec
// is still 12 logic ticks per server tick -- and on a wall, every iframe is spending that
// budget on one shared main thread.
//
// deltime also gates frameDelay, so it caps the draw rate: at 20Hz the focused client
// falls to ~13 FPS and walk animations visibly crawl. Exactly one client is ever being
// looked at, so that one keeps the era rate and the rest stay cheap.
//
// Title / logged-out backgrounds have no world simulation that scripts care about;
// 10 Hz is enough for AutoRelogin + UI and halves steady-state CPU on a login wall.
const FOCUSED_LOGIC_HZ = 50;
const BACKGROUND_INGAME_LOGIC_HZ = 20;
const BACKGROUND_TITLE_LOGIC_HZ = 10;

export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean) {
        super(nodeid, lowmem, members);
        this.syncLogicRate();
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
        BotHost.onFrame();
    }

    override async mainredraw(): Promise<void> {
        const now = performance.now();
        if (!RenderGate.shouldDraw(now)) {
            return;
        }
        await super.mainredraw();
        RenderGate.markDrawn(now);
        BotHost.onDraw();
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
