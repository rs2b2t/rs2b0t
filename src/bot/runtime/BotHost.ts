import { ServerProt } from '#/client/io/ServerProt.js';

import { attach as adapterAttach, invalidateLocSnapshots, reader, setPacketListener } from '../adapter/ClientAdapter.js';
import { GameMessages } from '../api/chatbox/gameMessages.js';
import { noteProducerPacket, pumpProducers } from './producers.js';

type FrameListener = () => void;

class BotHostImpl {
    selfTestMissing: string[] = [];

    private attached = false;

    tickCount = 0;

    private lastTickAt = 0;
    private tickIntervals: number[] = [];

    private frameListeners = new Set<FrameListener>();
    private drawListeners = new Set<FrameListener>();
    /** Fires after each processed PLAYER_INFO (server tick / player block). */
    private tickListeners = new Set<FrameListener>();

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
        // Mark producer caches stale after the client has applied the packet (the listener runs post-process); the frame pump rescans only dirty families.
        noteProducerPacket(ptype);

        // Why: UPDATE_ZONE_PARTIAL_ENCLOSED wraps LOC_* opcodes that never surface here, so the enclosing types are listed too and PLAYER_INFO backstops the set.
        // Why: enumerating zone opcodes is fragile, and a missed one would leave scripts acting on a stale scene.
        // Why: bounding the memo to one server tick keeps that impossible and still collapses the roughly 24 per-frame rebuilds within a tick to one.
        if (
            ptype === ServerProt.PLAYER_INFO ||
            ptype === ServerProt.UPDATE_ZONE_PARTIAL_ENCLOSED ||
            ptype === ServerProt.UPDATE_ZONE_PARTIAL_FOLLOWS ||
            ptype === ServerProt.UPDATE_ZONE_FULL_FOLLOWS ||
            ptype === ServerProt.LOC_ADD_CHANGE ||
            ptype === ServerProt.LOC_DEL ||
            ptype === ServerProt.LOC_ANIM
        ) {
            invalidateLocSnapshots();
        }

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

        // After the client has applied player movement for this packet.
        this.fire(this.tickListeners);
    }

    addFrameListener(cb: FrameListener): () => void {
        this.frameListeners.add(cb);
        return () => this.frameListeners.delete(cb);
    }

    addDrawListener(cb: FrameListener): () => void {
        this.drawListeners.add(cb);
        return () => this.drawListeners.delete(cb);
    }

    /** Subscribe to PLAYER_INFO (post-process); prefer it to polling for stand-tile updates while UI is open. Returns the unsubscribe. */
    addTickListener(cb: FrameListener): () => void {
        this.tickListeners.add(cb);
        return () => this.tickListeners.delete(cb);
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
