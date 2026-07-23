import { Client } from '#/client/Client.js';
import { WorkerClock } from '#/util/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { RenderGate } from './runtime/RenderGate.js';

export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean) {
        super(nodeid, lowmem, members);
        BotHost.attach(this);
    }

    protected override async frameDelay(ms: number): Promise<void> {
        await WorkerClock.sleep(ms);
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
}
