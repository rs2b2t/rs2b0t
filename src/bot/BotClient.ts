import { Client } from '#/client/Client.js';
import { WorkerClock } from '#/util/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { RenderGate } from './runtime/RenderGate.js';

/**
 * The only place that extends or instantiates the upstream client.
 * The client hook points: each override is one line into BotHost after
 * deferring to the real implementation, so game behavior is untouched.
 */
export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean) {
        // super() kicks off the async run() loop; nothing in it executes past
        // its first await until this constructor returns, so attach() below
        // always beats the first frame.
        super(nodeid, lowmem, members);
        BotHost.attach(this);
    }

    // Pace frames on a Web Worker timer so a minimized/occluded tab keeps
    // ticking (setTimeout is throttled to ~1/min in the background, which
    // stalled the loop and dropped the connection). Falls back to setTimeout
    // when a worker can't be created.
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
            return; // logic already ran in mainloop; skip only the pixel draw
        }
        await super.mainredraw();
        RenderGate.markDrawn(now);
        BotHost.onDraw();
    }
}
