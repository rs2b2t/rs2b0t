import { openTrafficChannel, type TrafficChannelOptions } from '#/client/io/TrafficChannel.js';
import type { TrafficTotals } from '#/client/io/TrafficMeter.js';

export type { TrafficTotals } from '#/client/io/TrafficMeter.js';

export type TrafficSnapshot =
    | { status: 'measuring' }
    | ({ status: 'available' } & TrafficTotals)
    | { status: 'unavailable'; reason: string };

interface TrafficCollectorOptions extends TrafficChannelOptions {
    now?: () => number;
    publisherTimeoutMs?: number;
}

const DEFAULT_PUBLISHER_TIMEOUT_MS = 3000;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBytes(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Aggregates payload deltas published by every bot frame and cache worker. */
export class TrafficCollector {
    private readonly channel: BroadcastChannel | null;
    private readonly now: () => number;
    private readonly publisherTimeoutMs: number;
    private readonly startedAt: number | null;
    private snapshotState: TrafficSnapshot;
    private lastHeartbeatAt: number | null = null;
    private receivedBytes = 0;
    private sentBytes = 0;
    private closed = false;

    constructor(options: TrafficCollectorOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.publisherTimeoutMs = options.publisherTimeoutMs ?? DEFAULT_PUBLISHER_TIMEOUT_MS;
        if (!Number.isFinite(this.publisherTimeoutMs) || this.publisherTimeoutMs <= 0) {
            throw new RangeError('traffic publisher timeout must be positive');
        }
        this.startedAt = this.readNow();

        const channel = openTrafficChannel(options);
        this.channel = channel;

        if (!channel) {
            this.snapshotState = { status: 'unavailable', reason: 'BroadcastChannel is unavailable' };
        } else if (this.startedAt === null) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic clock is unavailable' };
            channel.onmessage = event => this.receive(event.data);
        } else {
            this.snapshotState = { status: 'measuring' };
            channel.onmessage = event => this.receive(event.data);
        }
    }

    snapshot(): TrafficSnapshot {
        if (this.closed) {
            return { status: 'unavailable', reason: 'browser traffic collector is closed' };
        }
        const now = this.readNow();
        if (this.channel && now === null) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic clock is unavailable' };
        } else if (now !== null && this.snapshotState.status === 'measuring' && this.startedAt !== null && now - this.startedAt >= this.publisherTimeoutMs) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic publisher did not appear' };
        } else if (now !== null && this.snapshotState.status === 'available' && this.lastHeartbeatAt !== null && now - this.lastHeartbeatAt >= this.publisherTimeoutMs) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic publisher timed out' };
        }
        return { ...this.snapshotState };
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        if (this.channel) {
            this.channel.onmessage = null;
            this.channel.close();
        }
    }

    private receive(value: unknown): void {
        if (this.closed || !isObject(value) || value.type !== 'rs2b0t:traffic') {
            return;
        }
        if (value.status === 'unavailable' && typeof value.reason === 'string' && value.reason.trim().length > 0) {
            this.snapshotState = { status: 'unavailable', reason: value.reason };
            return;
        }
        if (value.status !== 'available' || !validBytes(value.receivedBytes) || !validBytes(value.sentBytes)) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic publisher sent an invalid message' };
            return;
        }

        const receivedBytes = this.receivedBytes + value.receivedBytes;
        const sentBytes = this.sentBytes + value.sentBytes;
        const now = this.readNow();
        if (!Number.isSafeInteger(receivedBytes) || !Number.isSafeInteger(sentBytes)) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic counters exceeded the safe integer range' };
            return;
        }
        if (now === null) {
            this.snapshotState = { status: 'unavailable', reason: 'browser traffic clock is unavailable' };
            return;
        }

        this.receivedBytes = receivedBytes;
        this.sentBytes = sentBytes;
        this.lastHeartbeatAt = now;
        this.snapshotState = { status: 'available', receivedBytes, sentBytes };
    }

    private readNow(): number | null {
        try {
            const now = this.now();
            return Number.isFinite(now) ? now : null;
        } catch {
            return null;
        }
    }
}
