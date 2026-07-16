import { describe, expect, test } from 'bun:test';
import { ARDOUGNE_PICKPOCKET_TARGETS } from '#/bot/scripts/PickpocketTargets.js';
import { HOSTILE_NAMES, chooseTarget, isHostileAttacker, requiredThieving, targetSpot } from '#/bot/scripts/ArdyThieverLogic.js';

// Spawn tiles decoded from the engine's packed server maps (n40_51/n41_51) —
// the source data behind the anchor table. Hero's far-SW spawn (2630,3288) is
// deliberately out of scope (spec: market-side heroes only).
const SPAWNS: Record<string, [number, number][]> = {
    'Guard': [[2651, 3307], [2659, 3309], [2660, 3309], [2661, 3309], [2663, 3301], [2665, 3300], [2664, 3318]],
    'Knight of Ardougne': [[2652, 3318], [2653, 3300], [2669, 3298], [2671, 3313]],
    'Paladin': [[2653, 3315], [2657, 3307]],
    'Hero': [[2647, 3306], [2667, 3316]]
};

// Engine maxrange per target (data/pack/server/npc.dat, opcode 201) — the hard
// cap on how far the engine lets an npc drift from ITS OWN spawn (wander dests
// are spawn±wanderrange; combat drag is bounded by maxrange). A leash that
// covers spawns but not spawn+maxrange starves the Pickpocket task whenever
// the wanderers dwell outside it — the live "stuck, knights out of leash" bug.
const MAXRANGE: Record<string, number> = {
    'Guard': 7, // ardougne_guard: wanderrange 5, maxrange 7
    'Knight of Ardougne': 17, // wanderrange 15, maxrange 17
    'Paladin': 4, // wanderrange 2, maxrange 4
    'Hero': 7 // wanderrange 5, maxrange 7
};

describe('targetSpot', () => {
    test('resolves a spot for every Ardougne dropdown target', () => {
        for (const name of ARDOUGNE_PICKPOCKET_TARGETS) {
            const spot = targetSpot(name);
            expect(spot.anchor.level).toBe(0);
            expect(spot.leash).toBeGreaterThanOrEqual(12);
        }
    });
    test('every spawn PLUS its engine roam cap sits within the target leash (Chebyshev)', () => {
        // spawn-only coverage is not enough: the npc dwells anywhere in
        // spawn±maxrange, so the leash must contain the whole roam envelope or
        // candidates() starves while the target wanders (the knights bug).
        for (const [name, spawns] of Object.entries(SPAWNS)) {
            const spot = targetSpot(name);
            for (const [x, z] of spawns) {
                expect(spot.anchor.distanceTo({ x, z, level: 0 }) + MAXRANGE[name]).toBeLessThanOrEqual(spot.leash);
            }
        }
    });
    test('unknown target falls back to the Guard spot', () => {
        expect(targetSpot('Nonexistent')).toEqual(targetSpot('Guard'));
    });
});

describe('requiredThieving', () => {
    test('per-target pickpocket requirements from the content table', () => {
        expect(requiredThieving('Guard')).toBe(40);
        expect(requiredThieving('Knight of Ardougne')).toBe(55);
        expect(requiredThieving('Paladin')).toBe(70);
        expect(requiredThieving('Hero')).toBe(80);
    });
    test('unknown target does not gate (level 1)', () => {
        expect(requiredThieving('Nonexistent')).toBe(1);
    });
});

describe('isHostileAttacker', () => {
    const guard = { name: 'Guard', inCombat: true, distance: 1, actions: ['Pickpocket', 'Attack'] };
    test('accepts an in-combat adjacent market hostile with an Attack op', () => {
        expect(isHostileAttacker(guard, 5)).toBe(true);
    });
    test('every fight-mode hostile is an Ardougne dropdown target and vice versa', () => {
        expect([...HOSTILE_NAMES].sort()).toEqual([...ARDOUGNE_PICKPOCKET_TARGETS].sort());
    });
    test('rejects a bystander not in combat', () => {
        expect(isHostileAttacker({ ...guard, inCombat: false }, 5)).toBe(false);
    });
    test('rejects a hostile beyond the engage radius', () => {
        expect(isHostileAttacker({ ...guard, distance: 6 }, 5)).toBe(false);
    });
    test('accepts a hostile at the exact engage radius (inclusive boundary)', () => {
        expect(isHostileAttacker({ ...guard, distance: 5 }, 5)).toBe(true);
    });
    test('rejects non-hostile NPCs (the Baker) and null names', () => {
        expect(isHostileAttacker({ ...guard, name: 'Baker' }, 5)).toBe(false);
        expect(isHostileAttacker({ ...guard, name: null }, 5)).toBe(false);
    });
    test('rejects a hostile with no Attack op (mid-death / op-less variant)', () => {
        expect(isHostileAttacker({ ...guard, actions: ['Pickpocket'] }, 5)).toBe(false);
    });
});

describe('chooseTarget (reachability-aware pickpocket selection)', () => {
    const reach = (set: Set<string>) => (t: string) => set.has(t);

    test('picks the nearest REACHABLE target, skipping closer unreachable ones', () => {
        // nearest-first: A (unreachable, fenced edge), B (reachable), C (reachable)
        const r = chooseTarget(['A', 'B', 'C'], reach(new Set(['B', 'C'])));
        expect(r).toEqual({ target: 'B', blocked: null });
    });

    test('nearest reachable wins when the closest IS reachable', () => {
        expect(chooseTarget(['A', 'B'], reach(new Set(['A', 'B'])))).toEqual({ target: 'A', blocked: null });
    });

    test('none reachable → no target, surfaces the nearest as blocked for a bounded clear', () => {
        expect(chooseTarget(['A', 'B'], reach(new Set()))).toEqual({ target: null, blocked: 'A' });
    });

    test('empty candidate list → nothing to do', () => {
        expect(chooseTarget([], reach(new Set()))).toEqual({ target: null, blocked: null });
    });
});
