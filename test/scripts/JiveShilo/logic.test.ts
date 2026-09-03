import { describe, expect, test } from 'bun:test';
import { decide, featherAsk, sellPlan, tripLine, type PackState } from '#/bot/scripts/JiveShilo/logic.js';

const ready: PackState = { rod: true, feathers: 40, fish: 5, coins: 12, free: 20 };

describe('decide', () => {
    test('fishes while the rod, the feathers and the room are all there', () => {
        expect(decide(ready, 0)).toEqual({ kind: 'fish' });
    });

    test('a full pack with fish aboard goes to the counter', () => {
        expect(decide({ ...ready, free: 0 }, 0)).toEqual({ kind: 'sell' });
    });

    test('an empty feather stack with fish aboard sells before it buys', () => {
        expect(decide({ ...ready, feathers: 0 }, 0)).toEqual({ kind: 'sell' });
    });

    test('a lost rod with fish aboard sells first too, since the fish pay for the rod', () => {
        expect(decide({ ...ready, rod: false }, 0)).toEqual({ kind: 'sell' });
    });

    test('no rod and no fish is a shop trip on coins', () => {
        expect(decide({ ...ready, rod: false, fish: 0 }, 0)).toEqual({ kind: 'gear' });
        expect(decide({ ...ready, feathers: 0, fish: 0 }, 0)).toEqual({ kind: 'gear' });
    });

    test('no rod, no fish and no coins stops with the reason', () => {
        const step = decide({ ...ready, rod: false, fish: 0, coins: 0 }, 0);
        expect(step.kind).toBe('stop');
        expect(step.kind === 'stop' && step.reason).toContain('no fly fishing rod');
    });

    test('no feathers, no fish and no coins names the feathers', () => {
        const step = decide({ ...ready, feathers: 0, fish: 0, coins: 0 }, 0);
        expect(step.kind === 'stop' && step.reason).toContain('no feathers');
    });

    test('a pack full of things that are not fish stops rather than casting into no room', () => {
        const step = decide({ ...ready, fish: 0, free: 0 }, 0);
        expect(step.kind).toBe('stop');
    });

    test('a feather target ends the run once it is held, whatever else the pack says', () => {
        expect(decide({ ...ready, feathers: 500, free: 0 }, 500).kind).toBe('stop');
        expect(decide({ ...ready, feathers: 499, free: 0 }, 500)).toEqual({ kind: 'sell' });
        expect(decide({ ...ready, feathers: 5000 }, 0)).toEqual({ kind: 'fish' });
    });
});

describe('sellPlan', () => {
    test('lists trout then salmon and skips an empty line', () => {
        const counts: Record<string, number> = { 'Raw trout': 18, 'Raw salmon': 7 };
        expect(sellPlan(name => counts[name] ?? 0)).toEqual([
            { name: 'Raw trout', count: 18 },
            { name: 'Raw salmon', count: 7 }
        ]);
        expect(sellPlan(name => (name === 'Raw salmon' ? 3 : 0))).toEqual([{ name: 'Raw salmon', count: 3 }]);
        expect(sellPlan(() => 0)).toEqual([]);
    });
});

describe('featherAsk', () => {
    test('asks for the whole stock and lets the coins decide how much lands', () => {
        expect(featherAsk(800, 50)).toBe(800);
    });

    test('asks for nothing with no coins or no stock', () => {
        expect(featherAsk(800, 0)).toBe(0);
        expect(featherAsk(0, 50)).toBe(0);
    });
});

describe('tripLine', () => {
    test('names the fish in plain words', () => {
        expect(tripLine([{ name: 'Raw trout', count: 18 }, { name: 'Raw salmon', count: 7 }], 214, 95, 210, 412))
            .toBe('sold 18 trout + 7 salmon for 214gp, bought 95 feathers for 210gp (holding 412)');
    });

    test('says so when nothing was sold', () => {
        expect(tripLine([], 0, 25, 50, 25)).toBe('sold nothing for 0gp, bought 25 feathers for 50gp (holding 25)');
    });
});
