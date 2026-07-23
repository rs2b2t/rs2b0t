import { ServerProt } from '#/io/ServerProt.js';

import { attach as adapterAttach, reader, setPacketListener } from './adapter/ClientAdapter.js';
import { GameMessages } from './events/gameMessages.js';
import { pumpProducers } from './events/producers.js';

type FrameListener = () => void;

class BotHostImpl {
    selfTestMissing: string[] = [];

    private attached = false;

    tickCount = 0;

    private lastTickAt = 0;
    private tickIntervals: number[] = [];

    private frameListeners = new Set<FrameListener>();
    private drawListeners = new Set<FrameListener>();

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

    get tickMeanMs(): number {
        if (this.tickIntervals.length === 0) {
            return 0;
        }

        return this.tickIntervals.reduce((a, b) => a + b, 0) / this.tickIntervals.length;
    }

    onFrame(): void {
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
        if (ptype === ServerProt.MESSAGE_GAME) {
            const line = reader.chat(1)[0];
            if (line && line.type === 0) {
                GameMessages.record(line.text);
            }
            return;
        }

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
