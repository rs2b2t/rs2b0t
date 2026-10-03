import { expect, test } from 'bun:test';
import { botFrameUrl, resolveNodeId, resolveWorldNumber, worldSwitchUrl } from '#/client/config/worlds.js';

test('hosted node identity follows the actual host despite conflicting or invalid overrides', () => {
    for (const query of ['', '?nodeid=10', '?nodeid=11', '?nodeid=NaN', '?nodeid=11junk', '?nodeid=0']) {
        expect(resolveNodeId('w1.rs2b2t.com', new URLSearchParams(query))).toBe(10);
        expect(resolveNodeId('w2.rs2b2t.com:443', new URLSearchParams(query))).toBe(11);
    }
});

test('local test worlds accept only complete valid node IDs', () => {
    expect(resolveNodeId('localhost:8890', new URLSearchParams())).toBe(10);
    expect(resolveNodeId('localhost:8890', new URLSearchParams('nodeid=42'))).toBe(42);
    for (const value of ['', '0', '-1', '256', '11junk', '1.5', 'NaN']) {
        expect(() => resolveNodeId('localhost:8890', new URLSearchParams({ nodeid: value }))).toThrow();
    }
});

test('switches preserve mode and memory, with only approved origins and safe query fields', () => {
    const from = new URL('https://w1.rs2b2t.com/rs2b0t/wall?lowmem=0&members=1&nodeid=10&box=alice&password=secret&autologin=1&next=https://evil.test');
    expect(worldSwitchUrl(2, 'wall', from).href).toBe('https://w1.rs2b2t.com/rs2b0t/wall?lowmem=0&members=1&world=2');
    expect(() => worldSwitchUrl(3, 'wall', from)).toThrow();
    expect(worldSwitchUrl(1, 'single', from).href).toBe('https://w1.rs2b2t.com/rs2b0t/?lowmem=0&members=1&world=1&box=alice');
    expect(() => worldSwitchUrl(4, 'wall', from)).toThrow();
});

test('every wall child stays on its wall origin and inherits its true node and memory', () => {
    const from = new URL('https://w2.rs2b2t.com/rs2b0t/wall?nodeid=10&lowmem=0&members=0&password=secret');
    for (const username of ['alice', 'bob']) {
        const child = botFrameUrl(from, username);
        expect(child.origin).toBe(from.origin);
        expect(child.pathname).toBe('/rs2b0t/bot.html');
        expect(child.searchParams.get('nodeid')).toBe('11');
        expect(child.searchParams.get('box')).toBe(username);
        expect(child.searchParams.get('lowmem')).toBe('0');
        expect(child.searchParams.has('password')).toBe(false);
    }
});

test('explicit frame worlds bind node identity even on a conflicting hosted origin', () => {
    for (const host of ['localhost:8081', 'w1.rs2b2t.com', 'w2.rs2b2t.com']) {
        expect(resolveNodeId(host, new URLSearchParams('world=1&nodeid=11'))).toBe(10);
        expect(resolveNodeId(host, new URLSearchParams('world=2&nodeid=NaN'))).toBe(11);
        expect(() => resolveNodeId(host, new URLSearchParams('world=3&nodeid=10'))).toThrow();
        expect(() => resolveNodeId(host, new URLSearchParams('world=4'))).toThrow();
    }
});

test('one wall can create same-origin frames for every world without copying credentials', () => {
    const wall = new URL('http://localhost:8081/multibox.html?lowmem=0&password=secret');
    for (const number of [1, 2] as const) {
        const frame = botFrameUrl(wall, 'alice', number);
        expect(frame.origin).toBe(wall.origin);
        expect(frame.searchParams.get('world')).toBe(String(number));
        expect(frame.searchParams.get('nodeid')).toBe(String(number + 9));
        expect(frame.searchParams.has('password')).toBe(false);
    }
});

test('world resolution rejects malformed explicit choices and otherwise follows the host', () => {
    expect(resolveWorldNumber('w2.rs2b2t.com', new URLSearchParams())).toBe(2);
    expect(resolveWorldNumber('localhost:8081', new URLSearchParams('nodeid=42'))).toBe(1);
    for (const query of ['world=', 'world=0', 'world=3', 'world=4', 'world=01', 'world=1.0', 'world=1&world=2']) {
        expect(() => resolveWorldNumber('w2.rs2b2t.com', new URLSearchParams(query))).toThrow();
    }
    const frame = botFrameUrl(new URL('http://localhost:8081/multibox.html?world=2'), 'alice');
    expect(frame.searchParams.get('world')).toBe('2');
    expect(frame.searchParams.get('nodeid')).toBe('11');
});

test('desktop switches keep the local origin, entrypoint and account namespace', () => {
    const from = new URL('http://localhost:8081/bot.html?box=alice&world=1');
    const next = worldSwitchUrl(2, 'single', from);
    expect(next.href).toBe('http://localhost:8081/bot.html?world=2&box=alice');
});
