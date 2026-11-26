import { describe, expect, test } from 'bun:test';
import { installWallTrafficChannel, publisherTrafficChannel } from '#/client/io/TrafficChannel.js';
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

function flushChannel(channel: BroadcastChannel): Promise<void> {
    const sender = new BroadcastChannel(channel.name);
    return new Promise(resolve => {
        function onMessage(event: MessageEvent): void {
            if (event.data !== 'flush') return;
            channel.removeEventListener('message', onMessage);
            sender.close();
            resolve();
        }
        channel.addEventListener('message', onMessage);
        sender.postMessage('flush');
    });
}

describe('TrafficCollector', () => {
    test('counts only the frame and cache worker publishers on each wall', async () => {
        let now = 0;
        const channels: BroadcastChannel[] = [];
        const walls = Array.from({ length: 3 }, () => document.implementation.createHTMLDocument());
        const collectors = walls.map(wall => new TrafficCollector({
            channelName: installWallTrafficChannel(wall),
            channelFactory: name => {
                const channel = new BroadcastChannel(name);
                channels.push(channel);
                return channel;
            },
            now: () => now,
            publisherTimeoutMs: 1000
        }));
        const meters: TrafficMeter[] = [];
        try {
            for (const [wall, count, received, sent] of [[walls[0], 30, 100, 3], [walls[1], 31, 200, 7]] as const) {
                for (let i = 0; i < count; i++) {
                    const name = publisherTrafficChannel({ frameElement: wall.createElement('iframe') });
                    const frame = new TrafficMeter({ channelName: name });
                    const worker = new TrafficMeter({ channelName: publisherTrafficChannel({ name }) });
                    frame.addReceived(received);
                    worker.addSent(sent);
                    meters.push(frame, worker);
                }
            }
            for (const meter of meters) meter.publish();
            await Promise.all(channels.map(flushChannel));
            now = 1001;
            for (const meter of meters) meter.publish();
            await Promise.all(channels.map(flushChannel));
            expect(collectors.map(collector => collector.snapshot())).toEqual([
                { status: 'available', receivedBytes: 3000, sentBytes: 90 },
                { status: 'available', receivedBytes: 6200, sentBytes: 217 },
                { status: 'unavailable', reason: 'browser traffic publisher did not appear' }
            ]);
        } finally {
            for (const meter of meters) meter.close();
            for (const collector of collectors) collector.close();
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
