import { expect, test } from 'bun:test';
import { Occupancy, type OccupancyChannel } from '../../src/bot/scripts/JiveTT/occupancy.js';

function network() {
    const ports: OccupancyChannel[] = [];
    return () => {
        const port: OccupancyChannel = {
            onmessage: null,
            postMessage: data => { for (const other of ports) if (other !== port) other.onmessage?.(new MessageEvent('message', { data })); },
            close: () => { const i = ports.indexOf(port); if (i >= 0) ports.splice(i, 1); }
        };
        ports.push(port);
        return port;
    };
}
test('occupancy partitions worlds and releases departed accounts', () => {
    const channel = network();
    const alice = new Occupancy('alice', { channel: channel(), heartbeat: false });
    const bob = new Occupancy('bob', { channel: channel(), heartbeat: false });
    alice.claim(1, 'enclave', 'north');
    bob.claim(1, 'enclave', 'south');
    expect(alice.count(1, 'enclave')).toBe(1);
    expect(alice.count(2, 'enclave')).toBe(0);
    expect(alice.snapshot()[0].subarea).toBe('north');
    bob.release();
    expect(alice.count(1, 'enclave')).toBe(0);
    alice.close(); bob.close();
});
test('crashed client claims expire rather than retaining capacity', () => {
    const channel = network();
    let now = 1000;
    const alice = new Occupancy('alice', { channel: channel(), now: () => now, heartbeat: false });
    const bob = new Occupancy('bob', { channel: channel(), now: () => now, heartbeat: false });
    alice.claim(1, 'camp', 'a');
    expect(bob.count(1, 'camp')).toBe(1);
    now += 31000;
    expect(bob.count(1, 'camp')).toBe(0);
    alice.close(); bob.close();
});

import { AdvisoryMarketQueue, marketStaggerMs } from '../../src/bot/scripts/JiveTT/marketQueue.js';
test('market queue is FIFO and crashed holders expire', () => {
    const channel = network();
    let now = 1000;
    const first = new AdvisoryMarketQueue('alice', channel(), () => now);
    now++;
    const second = new AdvisoryMarketQueue('bob', channel(), () => now);
    expect(first.turn()).toBe(true);
    expect(second.turn()).toBe(false);
    now += 31000;
    second.touch();
    expect(second.turn()).toBe(true);
    first.close(); second.close();
});


test('independent account starts spread market requests over a bounded interval', () => {
    const delays = Array.from({ length: 50 }, (_, i) => marketStaggerMs(`account${i}`));
    expect(delays.every(delay => delay >= 0 && delay <= 30000)).toBe(true);
    expect(new Set(delays).size).toBeGreaterThan(20);
    expect(marketStaggerMs('Alice')).toBe(marketStaggerMs('alice'));
});
