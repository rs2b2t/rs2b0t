import { expect, test } from 'bun:test';
import { KqGateDelay, type GateDelaySample } from '../../e2e/lib/kqGateDelay.js';

const samples = (): GateDelaySample[] => [0, 1, 2, 3].map(i => ({ at: 1000, tick: 100, sceneReady: true, serverTile: i === 3 ? { x: 3308, z: 3120, level: 0 } : { x: 3226, z: 3108, level: 0 }, pack: i === 0 ? [{ id: 954, count: 2 }] : [], runner: 'running', stage: 'travel', restocking: false, gateDelayHeld: i === 3 }));
const crossings = [{ departedAt: 500, crossings: { surface: [] as number[], chamber: [] as number[] } }];

test('the delay starts at the physical surface gate and releases after 225 game ticks', () => {
    const p = new KqGateDelay(); const s = samples();
    s[0].serverTile = { x: 3290, z: 3110, level: 0 }; expect(p.observe(s, crossings)).toBe(false);
    s[0].serverTile = { x: 3226, z: 3108, level: 0 }; expect(p.observe(s, crossings)).toBe(false);
    s.forEach(s => { s.at += 44_800; s.tick += 224; }); expect(p.observe(s, crossings)).toBe(false);
    s.forEach(s => { s.at += 200; s.tick++; }); expect(p.observe(s, crossings)).toBe(true);
    expect(p.proof).toMatchObject({ startedAt: 1000, startTick: 100, releasedAt: 46_000, releaseTick: 325 });
    expect(p.observe(s, crossings)).toBe(false);
    const crossed = [{ departedAt: 500, crossings: { surface: [47_000, 47_200, 47_200, 47_400], chamber: [60_000, 60_200, 60_200, 60_400] } }];
    s.forEach(s => { s.at = 61_000; }); p.observe(s, crossed);
    expect(p.proof.completedAt).toBe(61_000);
});

test('a rope attached before the held member arrives fails the probe', () => {
    const p = new KqGateDelay(); const s = samples(); p.observe(s, crossings);
    s[0].pack[0].count = 1;
    expect(() => p.observe(s, crossings)).toThrow('leader consumed a rope while South was held');
});

test('held South must remain running at the bank and first three must stay at the surface', () => {
    for (const change of [(s: GateDelaySample[]) => { s[3].runner = 'paused'; }, (s: GateDelaySample[]) => { s[0].serverTile!.level = 2; }, (s: GateDelaySample[]) => { s[3].serverTile!.x = 3290; }]) {
        const p = new KqGateDelay(); const s = samples(); p.observe(s, crossings); change(s);
        expect(() => p.observe(s, crossings)).toThrow('Gate-delay fixture lost its waiting positions');
    }
});

test('expired or unsynchronized descents cannot satisfy the gate-delay probe', () => {
    const p = new KqGateDelay(); const s = samples(); p.observe(s, crossings);
    s.forEach(s => { s.at += 160_001; s.tick += 224; });
    expect(() => p.observe(s, crossings)).toThrow('Gate-delay fixture exceeded 160 seconds');
    const q = new KqGateDelay(); const t = samples(); q.observe(t, crossings);
    t.forEach(s => { s.at += 45_000; s.tick += 225; }); q.observe(t, crossings);
    expect(() => q.observe(t, [{ departedAt: 500, crossings: { surface: [47_000, 47_200, 47_200, 51_000], chamber: [60_000, 60_200, 60_200, 60_400] } }])).toThrow('Gate-delay descent was not synchronized after release');
});

test('surface descent from the held departure cannot combine with a later chamber descent', () => {
    const p = new KqGateDelay(); const s = samples(); p.observe(s, crossings);
    s.forEach(s => { s.at += 45_000; s.tick += 225; }); p.observe(s, crossings);
    const first = { departedAt: 500, crossings: { surface: [47_000, 47_200, 47_200, 47_400], chamber: [] as number[] } };
    const next = { departedAt: 80_000, crossings: { surface: [90_000, 90_200, 90_200, 90_400], chamber: [100_000, 100_200, 100_200, 100_400] } };
    s.forEach(s => { s.at = 101_000; s.serverTile = { x: 3508, z: 9493, level: 0 }; });
    expect(() => p.observe(s, [first, next])).toThrow('Gate-delay original departure aborted');
    expect(p.proof.completedAt).toBeUndefined();
});

test('a retreat before both descents fails immediately without waiting for another departure', () => {
    const p = new KqGateDelay(); const s = samples(); p.observe(s, crossings);
    s.forEach(s => { s.at += 45_000; s.tick += 225; }); p.observe(s, crossings);
    s[3].stage = 'retreat';
    expect(() => p.observe(s, crossings)).toThrow('Gate-delay original departure aborted');
    expect(p.proof.completedAt).toBeUndefined();
});
