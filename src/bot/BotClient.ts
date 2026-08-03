import { Client } from '#/client/Client.js';
import { WorkerClock } from '#/util/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { paintNavPathInGame } from './nav/pathScenePaint.js';
import { RenderGate } from './runtime/RenderGate.js';

export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean) {
        super(nodeid, lowmem, members);
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
