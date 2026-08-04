import { Client } from '#/client/Client.js';
import { WorkerClock } from '#/util/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { paintNavPathInGame } from './nav/pathScenePaint.js';
import { RenderGate } from './runtime/RenderGate.js';

// The era client runs its logic loop at 50/sec so a human sees smooth animation and
// instant input. The server ticks every 600ms and a bot reads state, not pixels, so 20/sec
// is still 12 logic ticks per server tick -- and on a wall, every iframe is spending that
// budget on one shared main thread.
const BOT_LOGIC_HZ = 20;

export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean) {
        super(nodeid, lowmem, members);
        this.setFramerate(BOT_LOGIC_HZ);
        BotHost.attach(this);
    }

    protected override async frameDelay(ms: number): Promise<void> {
        await WorkerClock.sleep(ms, !RenderGate.enabled);
    }

    override async mainloop(): Promise<void> {
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
