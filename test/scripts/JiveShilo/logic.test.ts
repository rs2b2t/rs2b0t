import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { COINS, FEATHER_BUYOUT_GP, coinsToDraw, decide, featherAsk, inArea, nearestFishable, nextScan, sellPlan, standEntry, standFor, tripLine, type PackState } from '#/bot/scripts/JiveShilo/logic.js';
import { SEARCH_AREA, SPOT_STANDS, SWEEP } from '#/bot/scripts/JiveShilo/river.js';

const ready: PackState = { rod: true, feathers: 40, fish: 5, coins: 12, free: 20, inVillage: true, tellerSeen: true, hutDue: false };

describe('decide', () => {
    test('fishes while the rod, the feathers and the room are all there', () => {
        expect(decide(ready, 0)).toEqual({ kind: 'fish' });
    });

    test('a full pack with fish aboard goes to the teller', () => {
        expect(decide({ ...ready, free: 0, tellerSeen: false }, 0)).toEqual({ kind: 'bank' });
    });

    // Why: a catch re-arms the teller for the next full pack, and a stop on every fish is what made the run walk the village between casts.
    test('a catch on its own is not a trip, however much room the teller has not seen', () => {
        expect(decide({ ...ready, fish: 3, tellerSeen: false }, 0)).toEqual({ kind: 'fish' });
    });

    test('an empty feather stack goes to the teller for the coins', () => {
        expect(decide({ ...ready, feathers: 0, tellerSeen: false }, 0)).toEqual({ kind: 'bank' });
    });

    test('a lost rod goes to the teller too, since a banked rod is free', () => {
        expect(decide({ ...ready, rod: false, tellerSeen: false }, 0)).toEqual({ kind: 'bank' });
    });

    test('the counter follows the teller every trip, selling what is still held', () => {
        expect(decide({ ...ready, hutDue: true, fish: 0 }, 0)).toEqual({ kind: 'gear' });
        expect(decide({ ...ready, hutDue: true, fish: 8 }, 0)).toEqual({ kind: 'sell' });
    });

    test('a full pack the teller has already seen still sells at the counter', () => {
        expect(decide({ ...ready, free: 0 }, 0)).toEqual({ kind: 'sell' });
    });

    test('no rod and no fish is a shop trip on coins, once the teller has been seen', () => {
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

    test('a far-bank tile maps to the stand across the water, marked as such', () => {
        expect(standFor({ x: 2855, z: 2977 })).toEqual(new Tile(2855, 2978, 0));
        expect(standEntry({ x: 2860, z: 2976 })?.far).toBe(true);
        expect(standEntry({ x: 2862, z: 2972 })?.far).toBeUndefined();
    });

    test('open water the spot never lands on has no stand', () => {
        expect(standFor({ x: 2850, z: 2975 })).toBeNull();
        expect(standEntry({ x: 2850, z: 2975 })).toBeNull();
    });

    test('every tile the enum and the map can put a spot on is baked', () => {
        expect(SPOT_STANDS.length).toBe(13);
        expect(SPOT_STANDS.filter(s => s.far).length).toBe(4);
    });

    test('every baked stand is orthogonally beside its spot', () => {
        for (const { spot, stand } of SPOT_STANDS) {
            expect(Math.abs(spot.x - stand.x) + Math.abs(spot.z - stand.z)).toBe(1);
        }
    });
});

describe('inArea', () => {
    test('covers both banks from the west end to the east end', () => {
        expect(inArea({ x: SEARCH_AREA.minX, z: SEARCH_AREA.minZ })).toBe(true);
        expect(inArea({ x: SEARCH_AREA.maxX, z: SEARCH_AREA.maxZ })).toBe(true);
        expect(inArea({ x: 2869, z: 2977 })).toBe(true);
        expect(inArea({ x: 2822, z: 2969 })).toBe(true);
    });

    test('and nothing past the ends, so the query stays on the river', () => {
        expect(inArea({ x: 2900, z: 2970 })).toBe(false);
        expect(inArea({ x: 2840, z: 2950 })).toBe(false);
    });

    test('every baked spot tile lies inside it', () => {
        expect(SPOT_STANDS.every(s => inArea(s.spot))).toBe(true);
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

    test('takes a far-bank spot when it is all there is, rather than sweeping past it', () => {
        const pick = nearestFishable([at(2855, 2977), at(2869, 2977)], { x: 2857, z: 2972 });
        expect(pick?.spot.x).toBe(2855);
        expect(pick?.far).toBe(true);
        expect(pick?.stand).toEqual(new Tile(2855, 2978, 0));
    });

    test('is null with nothing in view at all', () => {
        expect(nearestFishable([], { x: 2857, z: 2972 })).toBeNull();
        expect(nearestFishable([at(2850, 2975)], { x: 2857, z: 2972 })).toBeNull();
    });

    test('a spot on this bank beats one across the water that is closer in a straight line', () => {
        const pick = nearestFishable([at(2860, 2976), at(2822, 2969)], { x: 2857, z: 2972 });
        expect(pick?.spot.x).toBe(2822);
        expect(pick?.far).toBe(false);
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
        expect(SWEEP[nextScan({ x: 2863, z: 2971 }, null)]).toEqual(SWEEP[0]!);
        expect(SWEEP[nextScan({ x: 2823, z: 2968 }, null)]).toEqual(SWEEP[4]!);
    });

    test('then follows the sweep east to west and back, turning at both ends', () => {
        const here = { x: 2857, z: 2972 };
        for (let i = 0; i < SWEEP.length - 1; i++) {
            expect(nextScan(here, i)).toBe(i + 1);
        }
        expect(nextScan(here, SWEEP.length - 1)).toBe(0);
        expect(SWEEP[0]).not.toEqual(SWEEP[SWEEP.length - 1]!);
    });

    // Why: the stops are a view apart, so a scan step is a few tiles rather than the length of the river, which is what made a spot one tile out of view look like the bot running around.
    test('no two stops in a row are more than a view apart', () => {
        for (let i = 1; i < SWEEP.length; i++) {
            const a = SWEEP[i - 1]!;
            const b = SWEEP[i]!;
            expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeLessThanOrEqual(15);
        }
    });

    test('the sweep covers the whole area within npc view range', () => {
        for (const { stand } of SPOT_STANDS) {
            expect(SWEEP.some(s => Math.max(Math.abs(s.x - stand.x), Math.abs(s.z - stand.z)) <= 15)).toBe(true);
        }
    });
});

// Why: the run is started from wherever the operator happens to be, and every tile it works is inside the village, so the walk in comes before any of it.
describe('reaching the village', () => {
    test('walks there first, whatever the pack holds', () => {
        expect(decide({ ...ready, inVillage: false }, 0)).toEqual({ kind: 'travel' });
        expect(decide({ ...ready, inVillage: false, rod: false, coins: 0, fish: 0 }, 0)).toEqual({ kind: 'travel' });
    });

    test('inside the village it gets on with the fishing', () => {
        expect(decide(ready, 0)).toEqual({ kind: 'fish' });
    });

    test('a met feather target still ends the run rather than walking anywhere', () => {
        expect(decide({ ...ready, inVillage: false, feathers: 500 }, 500).kind).toBe('stop');
    });
});

// Why: a banked rod is free and the counter's costs coins, so the bank is looked in once before anything is bought, and the miss is remembered so the trip does not walk back and forth.
describe('the rod', () => {
    const noRod = { ...ready, rod: false, fish: 0, tellerSeen: false };

    test('comes out of the bank before it is bought', () => {
        expect(decide(noRod, 0)).toEqual({ kind: 'bank' });
    });

    test('is bought once the teller has been seen and had none', () => {
        expect(decide({ ...noRod, tellerSeen: true }, 0)).toEqual({ kind: 'gear' });
    });

    test('with no rod in the bank and no coins the run stops and says which', () => {
        const step = decide({ ...noRod, tellerSeen: true, coins: 0 }, 0);
        expect(step.kind).toBe('stop');
        expect(step.kind === 'stop' && step.reason).toContain('no fly fishing rod');
    });

    test('fish aboard go to the teller first, since the catch is banked rather than sold', () => {
        expect(decide({ ...noRod, fish: 5 }, 0)).toEqual({ kind: 'bank' });
    });

    test('an empty feather stack is the counter\'s business, not the bank\'s', () => {
        expect(decide({ ...ready, feathers: 0, fish: 0 }, 0)).toEqual({ kind: 'gear' });
    });
});

// Why: Fernahei's shelf is 800 feathers at a delta of 20, so a buyout runs to 8,225gp and a trip that drew every coin banked would carry the lot around the village for nothing.
describe('drawing coins at the teller', () => {
    test("a shelf of Fernahei's feathers is 8,225gp", () => {
        expect(FEATHER_BUYOUT_GP).toBe(8225);
        expect(COINS).toBe('Coins');
    });

    test('takes a shelf out of a bank that holds more', () => {
        expect(coinsToDraw(0, 3_000_000)).toBe(FEATHER_BUYOUT_GP);
    });

    test('takes all of a bank that holds less', () => {
        expect(coinsToDraw(0, 500)).toBe(500);
    });

    test('counts what the pack already holds against the budget', () => {
        expect(coinsToDraw(225, 3_000_000)).toBe(FEATHER_BUYOUT_GP - 225);
        expect(coinsToDraw(FEATHER_BUYOUT_GP, 3_000_000)).toBe(0);
    });

    test('an empty bank asks for nothing, which is what sends the catch to the counter', () => {
        expect(coinsToDraw(0, 0)).toBe(0);
    });
});
