import { describe, expect, mock, test } from 'bun:test';
import { openFrameTrafficPort } from '#/client/io/TrafficChannel.js';
import { TrafficMeter } from '#/client/io/TrafficMeter.js';
import { TrafficCollector } from '#/bot/adapter/TrafficAdapter.js';

class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    emit(data: unknown): void {
        this.onmessage?.({ data } as MessageEvent);
    }

    close(): void {
        this.closed = true;
    }
}

function frameFor(wall: Document) {
    return Object.assign(new EventTarget(), { frameElement: wall.createElement('iframe') }) as unknown as Window;
}

describe('TrafficCollector', () => {
    test('delivers one heartbeat per publisher only to its wall, including idle rounds', async () => {
        let now = 0;
        const walls = Array.from({ length: 3 }, () => document.implementation.createHTMLDocument());
        const clocks = walls.map(() => mock(() => now));
        const collectors = walls.map((wall, i) => new TrafficCollector({ wall, now: clocks[i] }));
        const frames: Window[] = [];
        const meters: TrafficMeter[] = [];
        const ticks: ((active: boolean) => Promise<void>)[] = [];
        let peers = 0;
        try {
            for (const [wall, profiles, received, sent] of [[0, 30, 100, 3], [1, 31, 200, 7]]) {
                for (let i = 0; i < profiles; i++) {
                    const frame = frameFor(walls[wall]);
                    frames.push(frame);
                    for (const worker of [false, true]) {
                        const { port } = openFrameTrafficPort(frame)!;
                        const channel = worker ? structuredClone(port, { transfer: [port] }) : port;
                        channel.onmessage = () => { peers++; };
                        let heartbeat: () => void;
                        const meter = new TrafficMeter({
                            channel,
                            setTimeout(callback) {
                                heartbeat = callback;
                                return 1 as unknown as ReturnType<typeof setTimeout>;
                            },
                            clearTimeout: () => {}
                        });
                        meters.push(meter);
                        ticks.push(async active => {
                            if (active) {
                                if (worker) meter.addSent(sent);
                                else meter.addReceived(received);
                            }
                            const deliveries = clocks[wall].mock.calls.length;
                            heartbeat();
                            await new Promise<void>(resolve => setImmediate(resolve));
                            expect(clocks[wall].mock.calls.length - deliveries).toBe(1);
                        });
                    }
                }
            }
            for (let round = 1; round <= 6; round++) {
                now += 1000;
                for (const tick of ticks) await tick(round === 1 || round === 4);
                const batches = round < 4 ? 1 : 2;
                expect(collectors.map(c => c.snapshot())).toEqual([
                    { status: 'available', receivedBytes: 3000 * batches, sentBytes: 90 * batches },
                    { status: 'available', receivedBytes: 6200 * batches, sentBytes: 217 * batches },
                    round < 3 ? { status: 'measuring' } : { status: 'unavailable', reason: 'browser traffic publisher did not appear' }
                ]);
                expect(peers).toBe(0);
            }
            now += 3000;
            expect(collectors[0].snapshot()).toEqual({ status: 'unavailable', reason: 'browser traffic publisher timed out' });
        } finally {
            meters.forEach(meter => meter.close());
            frames.forEach(frame => frame.dispatchEvent(new Event('pagehide')));
            collectors.forEach(collector => collector.close());
        }
    });

    test('a reload drains the queued delta and counts its replacement once', async () => {
        const wall = document.implementation.createHTMLDocument();
        const collector = new TrafficCollector({ wall });
        const frame = frameFor(wall);
        const originalSelf = globalThis.self;
        Reflect.set(globalThis, 'self', frame);
        const original = new TrafficMeter();
        let replacement: TrafficMeter | undefined;
        try {
            original.addReceived(11);
            original.publish();
            frame.dispatchEvent(new Event('pagehide'));
            original.addReceived(100);
            original.publish();
            replacement = new TrafficMeter();
            replacement.addReceived(7);
            replacement.publish();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(collector.snapshot()).toEqual({ status: 'available', receivedBytes: 18, sentBytes: 0 });
            collector.close();
            expect(openFrameTrafficPort(frame)).toBeNull();
            expect(collector.snapshot()).toEqual({ status: 'unavailable', reason: 'browser traffic collector is closed' });
        } finally {
            original.close();
            replacement?.close();
            collector.close();
            Reflect.set(globalThis, 'self', originalSelf);
        }
    });

    test('aggregates delta heartbeats from every browser realm', () => {
        const channel = new FakeChannel();
        let now = 1000;
        const collector = new TrafficCollector({
            channelFactory: () => channel as unknown as BroadcastChannel,
            now: () => now,
            publisherTimeoutMs: 3000
        });

        expect(collector.snapshot()).toEqual({ status: 'measuring' });
        channel.emit({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: 100, sentBytes: 20 });
        channel.emit({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: 50, sentBytes: 5 });
        expect(collector.snapshot()).toEqual({ status: 'available', receivedBytes: 150, sentBytes: 25 });

        now = 2000;
        channel.emit({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: 10, sentBytes: 2 });
        expect(collector.snapshot()).toEqual({ status: 'available', receivedBytes: 160, sentBytes: 27 });
        collector.close();
        expect(channel.closed).toBe(true);
    });

    test('distinguishes a missing publisher from idle zero-byte heartbeats', () => {
        const missingChannel = new FakeChannel();
        let now = 0;
        const missing = new TrafficCollector({
            channelFactory: () => missingChannel as unknown as BroadcastChannel,
            now: () => now,
            publisherTimeoutMs: 1000
        });
        now = 1000;
        expect(missing.snapshot()).toEqual({ status: 'unavailable', reason: 'browser traffic publisher did not appear' });

        const idleChannel = new FakeChannel();
        now = 0;
        const idle = new TrafficCollector({
            channelFactory: () => idleChannel as unknown as BroadcastChannel,
            now: () => now,
            publisherTimeoutMs: 1000
        });
        idleChannel.emit({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: 0, sentBytes: 0 });
        now = 999;
        expect(idle.snapshot()).toEqual({ status: 'available', receivedBytes: 0, sentBytes: 0 });
        now = 1000;
        expect(idle.snapshot()).toEqual({ status: 'unavailable', reason: 'browser traffic publisher timed out' });
    });

    test('rejects malformed publisher messages and unavailable clocks', () => {
        const channel = new FakeChannel();
        const collector = new TrafficCollector({
            channelFactory: () => channel as unknown as BroadcastChannel,
            now: () => 1
        });
        channel.emit({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: -1, sentBytes: 0 });
        expect(collector.snapshot()).toEqual({
            status: 'unavailable',
            reason: 'browser traffic publisher sent an invalid message'
        });

        const badClock = new TrafficCollector({
            channelFactory: () => new FakeChannel() as unknown as BroadcastChannel,
            now: () => Number.NaN
        });
        expect(badClock.snapshot()).toEqual({ status: 'unavailable', reason: 'browser traffic clock is unavailable' });
    });
});
