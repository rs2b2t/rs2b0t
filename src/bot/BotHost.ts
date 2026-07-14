import { ServerProt } from '#/io/ServerProt.js';

import { attach as adapterAttach, setPacketListener } from './adapter/ClientAdapter.js';
import { pumpProducers } from './events/producers.js';

type FrameListener = () => void;

/**
 * Singleton fan-out between the BotClient hooks and everything bot-
 * side. Every listener call is wrapped in try/catch: a bot bug can never
 * crash the client.
 */
class BotHostImpl {
    /** Internal names the adapter self-test found missing after attach(). */
    selfTestMissing: string[] = [];

    private attached = false;

    /** Server ticks observed (PLAYER_INFO packets ≈ one per 600ms). */
    tickCount = 0;

    private lastTickAt = 0;
    private tickIntervals: number[] = [];

    private frameListeners = new Set<FrameListener>();
    private drawListeners = new Set<FrameListener>();

    /** Called once from the BotClient constructor. */
    attach(client: unknown): void {
        if (this.attached) {
            return;
        }

        this.attached = true;
        this.selfTestMissing = adapterAttach(client);
        setPacketListener(ptype => this.handlePacket(ptype));

        if (this.selfTestMissing.length > 0) {
            console.error(`[rs2b0t] adapter self-test: missing internals: ${this.selfTestMissing.join(', ')}`);
        } else {
            console.log('[rs2b0t] adapter self-test: all internals present');
        }
    }

    /** Mean PLAYER_INFO interval over the last ~10 ticks, ms (0 until known). */
    get tickMeanMs(): number {
        if (this.tickIntervals.length === 0) {
            return 0;
        }

        return this.tickIntervals.reduce((a, b) => a + b, 0) / this.tickIntervals.length;
    }

    // ---- hook entry points (called from BotClient overrides) ----

    onFrame(): void {
        // event producers diff state first so frame listeners (including the
        // scheduler pump) observe this frame's events
        try {
            pumpProducers(this.tickCount);
        } catch (err) {
            console.error('[rs2b0t] producer error', err);
        }

        this.fire(this.frameListeners);
    }

    onDraw(): void {
        this.fire(this.drawListeners);
    }

    private handlePacket(ptype: number): void {
        if (ptype !== ServerProt.PLAYER_INFO) {
            return;
        }

        this.tickCount++;

        const now = performance.now();
        if (this.lastTickAt > 0) {
            this.tickIntervals.push(now - this.lastTickAt);
            if (this.tickIntervals.length > 10) {
                this.tickIntervals.shift();
            }
        }
        this.lastTickAt = now;
    }

    // ---- subscriptions ----

    addFrameListener(cb: FrameListener): () => void {
        this.frameListeners.add(cb);
        return () => this.frameListeners.delete(cb);
    }

    addDrawListener(cb: FrameListener): () => void {
        this.drawListeners.add(cb);
        return () => this.drawListeners.delete(cb);
    }

    private fire(listeners: Set<FrameListener>): void {
        for (const listener of listeners) {
            try {
                listener();
            } catch (err) {
                console.error('[rs2b0t] listener error', err);
            }
        }
    }
}

export const BotHost = new BotHostImpl();
export type { BotHostImpl };
