import { openTrafficChannel, publisherTrafficChannel, type TrafficChannelOptions } from './TrafficChannel.js';

export interface TrafficTotals {
    receivedBytes: number;
    sentBytes: number;
}

export type TrafficMessage =
    | ({ type: 'rs2b0t:traffic'; status: 'available' } & TrafficTotals)
    | { type: 'rs2b0t:traffic'; status: 'unavailable'; reason: string };

type TimerHandle = ReturnType<typeof setTimeout>;

export interface TrafficMeterOptions extends TrafficChannelOptions {
    intervalMs?: number;
    setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
    clearTimeout?: (timer: TimerHandle) => void;
}

const PUBLISH_INTERVAL_MS = 1000;

function validBytes(bytes: number): boolean {
    return Number.isSafeInteger(bytes) && bytes >= 0;
}

/** Publishes actual WebSocket payload deltas from one browser or worker realm. */
export class TrafficMeter {
    private readonly channel: BroadcastChannel | null;
    private readonly intervalMs: number;
    private readonly scheduleTimeout: (callback: () => void, delayMs: number) => TimerHandle;
    private readonly cancelTimeout: (timer: TimerHandle) => void;
    private receivedBytes = 0;
    private sentBytes = 0;
    private timer: TimerHandle | null = null;
    private unavailableReason: string | null = null;
    private closed = false;

    constructor(options: TrafficMeterOptions = {}) {
        this.intervalMs = options.intervalMs ?? PUBLISH_INTERVAL_MS;
        if (!Number.isFinite(this.intervalMs) || this.intervalMs <= 0) {
            throw new RangeError('traffic publish interval must be positive');
        }
        this.scheduleTimeout = options.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
        this.cancelTimeout = options.clearTimeout ?? (timer => globalThis.clearTimeout(timer));

        this.channel = openTrafficChannel({ channelName: options.channelName ?? publisherTrafficChannel(), channelFactory: options.channelFactory });
        this.scheduleHeartbeat();
    }

    addReceived(bytes: number): void {
        this.addBytes('received', bytes);
    }

    addSent(bytes: number): void {
        this.addBytes('sent', bytes);
    }

    publish(): void {
        if (this.closed || !this.channel) {
            return;
        }
        const message: TrafficMessage = this.unavailableReason === null
            ? {
                type: 'rs2b0t:traffic',
                status: 'available',
                receivedBytes: this.receivedBytes,
                sentBytes: this.sentBytes
            }
            : { type: 'rs2b0t:traffic', status: 'unavailable', reason: this.unavailableReason };
        try {
            this.channel.postMessage(message);
            if (message.status === 'available') {
                this.receivedBytes = 0;
                this.sentBytes = 0;
            }
        } catch {
            // The collector reports a timed-out publisher if delivery keeps failing.
        }
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        if (this.timer !== null) {
            this.cancelTimeout(this.timer);
            this.timer = null;
        }
        this.channel?.close();
    }

    private addBytes(direction: 'received' | 'sent', bytes: number): void {
        if (this.closed || this.unavailableReason !== null) {
            return;
        }
        const current = direction === 'received' ? this.receivedBytes : this.sentBytes;
        if (!validBytes(bytes) || !Number.isSafeInteger(current + bytes)) {
            this.unavailableReason = 'browser traffic counter received an invalid byte count';
            this.publish();
            return;
        }
        if (direction === 'received') {
            this.receivedBytes += bytes;
        } else {
            this.sentBytes += bytes;
        }
    }

    private scheduleHeartbeat(): void {
        if (this.closed || !this.channel || this.timer !== null) {
            return;
        }
        this.timer = this.scheduleTimeout(() => {
            this.timer = null;
            this.publish();
            this.scheduleHeartbeat();
        }, this.intervalMs);
        (this.timer as unknown as { unref?: () => void }).unref?.();
    }
}

export const trafficMeter = new TrafficMeter();
