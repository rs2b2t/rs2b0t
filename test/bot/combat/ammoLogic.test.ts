import { describe, expect, test } from 'bun:test';
import { AmmoStackTracker, planAmmoCollection } from '#/bot/api/combat/AmmoLogic.js';

const OPTS = { collectAt: 20, staleMs: 90_000 };

describe('planAmmoCollection', () => {
    test('immature stacks are left to grow', () => {
        const plan = planAmmoCollection([{ key: 'a', count: 5, sinceChangeMs: 1000 }], { ...OPTS, quiverEmpty: false, leavingField: false });
        expect(plan).toEqual([]);
    });

    test('mature stack (count >= collectAt) is collected', () => {
        const plan = planAmmoCollection(
            [
                { key: 'a', count: 20, sinceChangeMs: 0 },
                { key: 'b', count: 3, sinceChangeMs: 0 }
            ],
            { ...OPTS, quiverEmpty: false, leavingField: false }
        );
        expect(plan).toEqual(['a']);
    });

    test('stale stack is collected regardless of size (despawn backstop)', () => {
        const plan = planAmmoCollection([{ key: 'a', count: 2, sinceChangeMs: 91_000 }], { ...OPTS, quiverEmpty: false, leavingField: false });
        expect(plan).toEqual(['a']);
    });

    test('empty quiver force-collects everything', () => {
        const plan = planAmmoCollection(
            [
                { key: 'a', count: 1, sinceChangeMs: 0 },
                { key: 'b', count: 2, sinceChangeMs: 0 }
            ],
            { ...OPTS, quiverEmpty: true, leavingField: false }
        );
        expect(plan).toEqual(['a', 'b']);
    });

    test('leaving the field force-collects everything', () => {
        const plan = planAmmoCollection([{ key: 'a', count: 1, sinceChangeMs: 0 }], { ...OPTS, quiverEmpty: false, leavingField: true });
        expect(plan).toEqual(['a']);
    });
});

describe('AmmoStackTracker', () => {
    test('tracks count changes per tile and reports time since last change', () => {
        const tracker = new AmmoStackTracker();
        tracker.observe([{ key: 'a', count: 1 }], 0);
        tracker.observe([{ key: 'a', count: 1 }], 10_000);
        expect(tracker.stacks(10_000)).toEqual([{ key: 'a', count: 1, sinceChangeMs: 10_000 }]);

        // a merge (count grew) resets the stale clock — mirrors the engine
        // resetting the despawn timer on merge
        tracker.observe([{ key: 'a', count: 5 }], 20_000);
        expect(tracker.stacks(21_000)).toEqual([{ key: 'a', count: 5, sinceChangeMs: 1000 }]);
    });

    test('vanished stacks are dropped (picked up / despawned)', () => {
        const tracker = new AmmoStackTracker();
        tracker.observe([{ key: 'a', count: 3 }], 0);
        tracker.observe([], 1000);
        expect(tracker.stacks(1000)).toEqual([]);
    });
});
