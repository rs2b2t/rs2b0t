import { Client } from '#/client/Client.js';

import { BotHost } from './BotHost.js';
import { RenderGate } from './runtime/RenderGate.js';

/**
 * The only place that extends or instantiates the upstream client.
 * Hooks H1-H3 (see HOOKS.md): each override is one line into BotHost after
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

    protected override mainquit(): void {
        BotHost.onShutdown();
        super.mainquit();
    }
}
