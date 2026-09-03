import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { decide, featherAsk, inArea, nearestFishable, nextScan, sellPlan, standFor, tripLine, type PackState } from '#/bot/scripts/JiveShilo/logic.js';
import { SEARCH_AREA, SPOT_STANDS, SWEEP } from '#/bot/scripts/JiveShilo/river.js';

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

describe('standFor', () => {
    test('maps a known river tile to the bank tile beside it', () => {
        expect(standFor({ x: 2855, z: 2973 })).toEqual(new Tile(2855, 2972, 0));
        expect(standFor({ x: 2834, z: 2974 })).toEqual(new Tile(2834, 2975, 0));
    });

    test('a far-bank tile and open water have no stand', () => {
        expect(standFor({ x: 2855, z: 2977 })).toBeNull();
        expect(standFor({ x: 2860, z: 2976 })).toBeNull();
        expect(standFor({ x: 2850, z: 2975 })).toBeNull();
    });

    test('every baked stand is orthogonally beside its spot', () => {
        for (const { spot, stand } of SPOT_STANDS) {
            expect(Math.abs(spot.x - stand.x) + Math.abs(spot.z - stand.z)).toBe(1);
        }
    });
});

describe('inArea', () => {
    test('covers the river from the west end to the east end of the village', () => {
        expect(inArea({ x: SEARCH_AREA.minX, z: SEARCH_AREA.minZ })).toBe(true);
        expect(inArea({ x: SEARCH_AREA.maxX, z: SEARCH_AREA.maxZ })).toBe(true);
        expect(inArea({ x: 2869, z: 2977 })).toBe(false);
        expect(inArea({ x: 2822, z: 2969 })).toBe(false);
    });

    test('every baked spot tile but the westmost lies inside it', () => {
        expect(SPOT_STANDS.filter(s => inArea(s.spot)).length).toBe(SPOT_STANDS.length - 1);
    });
});

describe('nearestFishable', () => {
    const at = (x: number, z: number) => ({ tile: () => ({ x, z }), x, z });

    test('picks the spot whose stand is the shortest walk and skips the far bank', () => {
        const spots = [at(2855, 2977), at(2862, 2972), at(2836, 2971)];
        const pick = nearestFishable(spots, { x: 2857, z: 2972 });
        expect(pick?.spot.x).toBe(2862);
        expect(pick?.stand).toEqual(new Tile(2862, 2971, 0));
    });

    test('is null when every spot in view sits where no bank reaches', () => {
        expect(nearestFishable([at(2855, 2977), at(2869, 2977)], { x: 2857, z: 2972 })).toBeNull();
        expect(nearestFishable([], { x: 2857, z: 2972 })).toBeNull();
    });

    test('asks the fallback for a spot tile the table does not know and ignores one outside the area', () => {
        const fallback = (spot: { x: number; z: number }) => new Tile(spot.x, spot.z - 1, 0);
        const pick = nearestFishable([at(2850, 2973), at(2870, 2975)], { x: 2857, z: 2972 }, fallback);
        expect(pick?.spot.x).toBe(2850);
        expect(pick?.stand).toEqual(new Tile(2850, 2972, 0));
    });
});

describe('nextScan', () => {
    test('starts at the nearest sweep stop', () => {
        expect(SWEEP[nextScan({ x: 2860, z: 2972 }, null)]).toEqual(SWEEP[0]!);
        expect(SWEEP[nextScan({ x: 2825, z: 2969 }, null)]).toEqual(SWEEP[2]!);
    });

    test('then follows the sweep east to west and back, turning at both ends', () => {
        const here = { x: 2857, z: 2972 };
        expect(nextScan(here, 0)).toBe(1);
        expect(nextScan(here, 1)).toBe(2);
        expect(nextScan(here, 2)).toBe(3);
        expect(nextScan(here, 3)).toBe(0);
        expect(SWEEP[1]).toEqual(SWEEP[3]);
    });

    test('the sweep covers the whole area within npc view range', () => {
        for (const { stand } of SPOT_STANDS) {
            expect(SWEEP.some(s => Math.max(Math.abs(s.x - stand.x), Math.abs(s.z - stand.z)) <= 15)).toBe(true);
        }
    });
});
