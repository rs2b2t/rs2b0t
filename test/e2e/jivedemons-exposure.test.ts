import { expect, test } from 'bun:test';
import { demonExposure } from '../../e2e/jivedemons-exposure.js';

const spot = { x: 2856, z: 9786, level: 0 };
const swarm = { id: 411, index: 900, name: 'Swarm', distance: 1 };
const clean = { at: 0, tile: spot, adults: 4, runner: 'running', randomEvent: null, nonTargetAttackers: [] };

test('counts clean demon exposure and keeps unexplained safespot damage attributable', () => {
    const result = demonExposure(clean, { ...clean, at: 750 }, [spot], 1);
    expect(result.heldMs).toBe(750);
    expect(result.violation).toBe(true);
});

test('excludes a targeting swarm before the runner has paused', () => {
    const result = demonExposure(clean, { ...clean, at: 750, nonTargetAttackers: [swarm] }, [spot], 1);
    expect(result.heldMs).toBe(0);
    expect(result.violation).toBe(false);
    expect(result.attackers).toEqual([swarm]);
    expect(result.reasons).toContain('non-target:Swarm#900');
});

test('excludes the final contaminated interval after the attacker disappears', () => {
    const result = demonExposure({ ...clean, nonTargetAttackers: [swarm] }, { ...clean, at: 750 }, [spot]);
    expect(result.heldMs).toBe(0);
    expect(result.clean).toBe(false);
});

test.each([
    { ...clean, runner: 'paused' },
    { ...clean, randomEvent: 'random event: evade: swarm' }
])('excludes active guardian and paused intervals even without an attacker snapshot', interrupted => {
    const result = demonExposure(interrupted, { ...clean, at: 750 }, [spot]);
    expect(result.heldMs).toBe(0);
    expect(result.clean).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
});

test('requires 120 seconds of clean exposure in addition to a contaminated minute', () => {
    const samples = [clean,
        { ...clean, at: 60_000 },
        { ...clean, at: 90_000, nonTargetAttackers: [swarm] },
        { ...clean, at: 120_000 },
        { ...clean, at: 180_000 }];
    const held = samples.slice(1).map((sample, i) => demonExposure(samples[i]!, sample, [spot]).heldMs);
    expect(held).toEqual([60_000, 0, 0, 60_000]);
    expect(held.reduce((sum, ms) => sum + ms, 0)).toBe(120_000);
});

test('does not count movement or a missing demon as clean soak time', () => {
    expect(demonExposure(clean, { ...clean, at: 750, tile: { ...spot, x: spot.x + 1 } }, [spot]).heldMs).toBe(0);
    expect(demonExposure(clean, { ...clean, at: 750, adults: 0 }, [spot]).heldMs).toBe(0);
});
