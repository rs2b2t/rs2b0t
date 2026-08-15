import { describe, expect, test } from 'bun:test';
import { AP_RANGE, attackRangeFor, lootWaitMs, BARREL_EXIT, EXIT_OPTIONS, eastFirst, takenByAnother, DEFAULT_MELEE_TILE, DEFAULT_SAFESPOT, DEFAULT_SAFESPOT_FALLBACK, ESCAPE_TELES, legFor, LEDGE, POST_ROCK, RAFT_STAND, ROCK_TILE, roomOf, ROPE_THROW_STAND, sameRoom, THROW_ZONE, WASHED_OUT } from '#/bot/scripts/FireGiant/FireGiantLogic.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('legFor', () => {
    test('anywhere underground is InDungeon', () => {
        expect(legFor(at(2575, 9861))).toBe('InDungeon');
        expect(legFor(at(2568, 9893))).toBe('InDungeon');
    });
    test('the exact ledge tile is AtLedge', () => {
        expect(legFor(at(LEDGE.x, LEDGE.z))).toBe('AtLedge');
    });
    test('the post-rock landing and the tree stand are both PastRock', () => {
        expect(legFor(at(POST_ROCK.x, POST_ROCK.z))).toBe('PastRock');
        expect(legFor(at(2512, 3466))).toBe('PastRock');
    });
    test('the engine throw zone is AtLanding, inclusive at every edge', () => {
        expect(legFor(at(2512, 3481))).toBe('AtLanding');
        expect(legFor(at(2510, 3476))).toBe('AtLanding');
        expect(legFor(at(2514, 3481))).toBe('AtLanding');
        expect(legFor(at(2509, 3478))).not.toBe('AtLanding');
        expect(legFor(at(2512, 3482))).not.toBe('AtLanding');
    });
    test('the shared failure coord is WashedOut', () => {
        expect(legFor(at(WASHED_OUT.x, WASHED_OUT.z))).toBe('WashedOut');
        expect(legFor(at(WASHED_OUT.x + 4, WASHED_OUT.z - 4))).toBe('WashedOut');
    });
    test('near the raft is AtRaft', () => {
        expect(legFor(at(RAFT_STAND.x, RAFT_STAND.z))).toBe('AtRaft');
        expect(legFor(at(RAFT_STAND.x + 3, RAFT_STAND.z + 3))).toBe('AtRaft');
    });
    test('everything else, and an unknown position, is Surface', () => {
        expect(legFor(at(2725, 3491))).toBe('Surface');
        expect(legFor(null)).toBe('Surface');
    });
    test('AtLedge wins over PastRock even though the ledge is close to the rock', () => {
        expect(legFor(at(2511, 3463))).toBe('AtLedge');
    });
});

// Why: the landing tile passes the engine's inzone check but sits 13 tiles from the rock, past aplocu range, so the throw stand must satisfy both zone and op reachability.
describe('ROPE_THROW_STAND', () => {
    test('is inside the engine throw zone', () => {
        expect(ROPE_THROW_STAND.x).toBeGreaterThanOrEqual(THROW_ZONE.minX);
        expect(ROPE_THROW_STAND.x).toBeLessThanOrEqual(THROW_ZONE.maxX);
        expect(ROPE_THROW_STAND.z).toBeGreaterThanOrEqual(THROW_ZONE.minZ);
        expect(ROPE_THROW_STAND.z).toBeLessThanOrEqual(THROW_ZONE.maxZ);
    });
    test('is north of the rock — the engine refuses coordz(you) <= coordz(rock)', () => {
        expect(ROPE_THROW_STAND.z).toBeGreaterThan(ROCK_TILE.z);
    });
    test('is within aplocu range of the rock', () => {
        const d = Math.max(Math.abs(ROPE_THROW_STAND.x - ROCK_TILE.x), Math.abs(ROPE_THROW_STAND.z - ROCK_TILE.z));
        expect(d).toBeLessThanOrEqual(AP_RANGE);
    });
    test('the raft landing is NOT a legal throw stand — it is out of ap range', () => {
        const d = Math.max(Math.abs(2512 - ROCK_TILE.x), Math.abs(3481 - ROCK_TILE.z));
        expect(d).toBeGreaterThan(AP_RANGE);
    });
    test('standing on it still resolves to the AtLanding leg', () => {
        expect(legFor({ x: ROPE_THROW_STAND.x, z: ROPE_THROW_STAND.z, level: 0 })).toBe('AtLanding');
    });
});

// Why: the nearest EAST-room giant (2573,9895, d=5) outranks two of the three WEST-room ones, so distance alone cannot keep the bot in its own room.
describe('roomOf', () => {
    const WEST_SPAWNS = [[2562, 9886], [2565, 9887], [2568, 9889]] as const;
    const EAST_SPAWNS = [[2573, 9895], [2575, 9891], [2577, 9890], [2577, 9897], [2578, 9895], [2580, 9890], [2581, 9895]] as const;

    test('the three west-room spawns are west', () => {
        for (const [x, z] of WEST_SPAWNS) {
            expect(roomOf({ x, z, level: 0 })).toBe('west');
        }
    });
    test('the seven east-room spawns are east', () => {
        for (const [x, z] of EAST_SPAWNS) {
            expect(roomOf({ x, z, level: 0 })).toBe('east');
        }
    });
    test('the default safespot is in the west room with its giants', () => {
        expect(roomOf(DEFAULT_SAFESPOT)).toBe('west');
    });
    test('the default melee anchor is in the east room', () => {
        expect(roomOf(DEFAULT_MELEE_TILE)).toBe('east');
    });
    test('tiles outside both rooms are null, so the caller falls back to radius', () => {
        expect(roomOf({ x: 2575, z: 9861, level: 0 })).toBeNull();
        expect(roomOf(null)).toBeNull();
    });
    test('no east spawn is within the safespot room, however close', () => {
        const near = EAST_SPAWNS.filter(([x, z]) => Math.max(Math.abs(x - DEFAULT_SAFESPOT.x), Math.abs(z - DEFAULT_SAFESPOT.z)) <= 10);
        expect(near.length).toBeGreaterThan(0);
        for (const [x, z] of near) {
            expect(roomOf({ x, z, level: 0 })).not.toBe(roomOf(DEFAULT_SAFESPOT));
        }
    });
});

// Why: crossing to the next chamber for another player's drop abandons the safespot for the round trip.
describe('sameRoom', () => {
    const westSpot = { x: 2568, z: 9892, level: 0 };
    const centreAnchor = { x: 2575, z: 9893, level: 0 };
    const westDrop = { x: 2565, z: 9887, level: 0 };
    const centreDrop = { x: 2578, z: 9895, level: 0 };

    test('a drop in our own chamber counts', () => {
        expect(sameRoom(westSpot, westDrop)).toBe(true);
        expect(sameRoom(centreAnchor, centreDrop)).toBe(true);
    });
    test('a drop in the other chamber does not, from either side', () => {
        expect(sameRoom(westSpot, centreDrop)).toBe(false);
        expect(sameRoom(centreAnchor, westDrop)).toBe(false);
    });
    test('a near drop across the divide is still excluded — distance cannot decide this', () => {
        const nearButOther = { x: 2573, z: 9895, level: 0 };
        expect(Math.max(Math.abs(nearButOther.x - westSpot.x), Math.abs(nearButOther.z - westSpot.z))).toBeLessThan(10);
        expect(sameRoom(westSpot, nearButOther)).toBe(false);
    });
    test('an anchor outside both chambers accepts anything, so nothing is stranded', () => {
        expect(sameRoom({ x: 2575, z: 9861, level: 0 }, westDrop)).toBe(true);
        expect(sameRoom(null, centreDrop)).toBe(true);
    });
});

// Why: 2568,9893 is melee-proof, so it is the tile to drop back to whenever a giant reaches the forward spot.
describe('safespot tiers', () => {
    test('the forward spot is 2568,9892 and the fallback is 2568,9893', () => {
        expect([DEFAULT_SAFESPOT.x, DEFAULT_SAFESPOT.z, DEFAULT_SAFESPOT.level]).toEqual([2568, 9892, 0]);
        expect([DEFAULT_SAFESPOT_FALLBACK.x, DEFAULT_SAFESPOT_FALLBACK.z, DEFAULT_SAFESPOT_FALLBACK.level]).toEqual([2568, 9893, 0]);
    });
    test('they are distinct tiles, or the retreat is a no-op', () => {
        expect(DEFAULT_SAFESPOT.x === DEFAULT_SAFESPOT_FALLBACK.x && DEFAULT_SAFESPOT.z === DEFAULT_SAFESPOT_FALLBACK.z).toBe(false);
    });
    test('both tiers sit in the west room, so room-gated targeting survives a retreat', () => {
        expect(roomOf(DEFAULT_SAFESPOT)).toBe('west');
        expect(roomOf(DEFAULT_SAFESPOT_FALLBACK)).toBe('west');
    });
    test('the fallback keeps the west giants inside bow range', () => {
        const west = [[2562, 9886], [2565, 9887], [2568, 9889]] as const;
        const inRange = west.filter(([x, z]) => Math.max(Math.abs(x - DEFAULT_SAFESPOT_FALLBACK.x), Math.abs(z - DEFAULT_SAFESPOT_FALLBACK.z)) <= attackRangeFor('range'));
        expect(inRange.length).toBeGreaterThan(0);
    });
});

// Why: a click beyond weapon range makes the server walk you off the safespot, and ReturnToSafespot drags you back before the shot leaves.
describe('attackRangeFor', () => {
    test('bow reaches 7, magic 10, melee 1', () => {
        expect(attackRangeFor('range')).toBe(7);
        expect(attackRangeFor('mage')).toBe(10);
        expect(attackRangeFor('melee')).toBe(1);
    });
    test('an unknown style falls back to adjacency rather than a long walk', () => {
        expect(attackRangeFor('sailing')).toBe(1);
    });
    test('is shorter than FIELD_RADIUS, so some in-field giants must be leashed first', () => {
        expect(attackRangeFor('range')).toBeLessThan(10);
    });
    test('the west giants sit inside bow range of the safespot', () => {
        const west = [[2562, 9886], [2565, 9887], [2568, 9889]] as const;
        const inRange = west.filter(([x, z]) => Math.max(Math.abs(x - DEFAULT_SAFESPOT.x), Math.abs(z - DEFAULT_SAFESPOT.z)) <= attackRangeFor('range'));
        expect(inRange.length).toBe(west.length);
    });
});

// The west giants wander up to 3 tiles, so the westmost can read as nearest while a
// wall blocks LoS. Distance ordering picks it, cannot hit it, and the bot dances.
describe('eastFirst', () => {
    const order = (gs: { x: number; distance: number }[]) => [...gs].sort(eastFirst).map(g => g.x);

    test('orders the three west giants east to west regardless of distance', () => {
        expect(order([
            { x: 2562, distance: 2 },
            { x: 2568, distance: 9 },
            { x: 2565, distance: 5 }
        ])).toEqual([2568, 2565, 2562]);
    });
    test('the westmost giant is never picked first even when it is closest', () => {
        expect(order([{ x: 2562, distance: 1 }, { x: 2568, distance: 8 }])[0]).toBe(2568);
    });
    test('equal x falls back to nearest', () => {
        const sorted = [{ x: 2568, distance: 7 }, { x: 2568, distance: 3 }].sort(eastFirst);
        expect(sorted[0].distance).toBe(3);
    });
    test('is a stable total order — sorting twice is idempotent', () => {
        const gs = [{ x: 2565, distance: 4 }, { x: 2568, distance: 6 }, { x: 2562, distance: 1 }];
        expect(order(order(gs).map(x => gs.find(g => g.x === x)!))).toEqual([2568, 2565, 2562]);
    });
});

// A giant another player is fighting is not ours to take: its loot and kill go to
// them, and diving on it wastes the trip.
describe('takenByAnother', () => {
    const e = (o: Partial<Parameters<typeof takenByAnother>[0]>) =>
        takenByAnother({ isOurs: false, inCombat: false, targetsMe: false, targetsAnother: false, ...o });

    test('a giant facing another player is taken', () => {
        expect(e({ targetsAnother: true })).toBe(true);
    });
    test('a giant in combat with nobody visible is taken — faceEntity clears between attacks', () => {
        expect(e({ inCombat: true })).toBe(true);
    });
    test('a giant in combat with US is not taken', () => {
        expect(e({ inCombat: true, targetsMe: true })).toBe(false);
    });
    test('an idle giant is free', () => {
        expect(e({})).toBe(false);
    });
    test('our own target is never taken, however its faceEntity flickers', () => {
        expect(e({ isOurs: true, inCombat: true, targetsAnother: true })).toBe(false);
        expect(e({ isOurs: true, inCombat: true, targetsMe: false })).toBe(false);
    });
});

// The dungeon DOES have a walk-out — exit door to the ledge, then the barrel. It
// needs no runes, magic level or quest, so it is the default.
describe('EXIT_OPTIONS', () => {
    test('the free barrel walk-out is first and is the default', () => {
        expect(EXIT_OPTIONS[0]).toBe(BARREL_EXIT);
    });
    test('the teleports remain selectable alongside it', () => {
        expect(EXIT_OPTIONS).toContain('Camelot');
        expect(EXIT_OPTIONS).toContain('Ardougne');
        expect(EXIT_OPTIONS.length).toBe(5);
    });
});

// Why: Take walks to the drop first, so a flat short wait reports failure while the pickup is still in flight.
describe('lootWaitMs', () => {
    test('an adjacent drop still gets a usable minimum', () => {
        expect(lootWaitMs(0)).toBeGreaterThanOrEqual(1000);
    });
    test('it grows with distance, so a far corpse is not called a failure', () => {
        expect(lootWaitMs(8)).toBeGreaterThan(lootWaitMs(1));
    });
    test('a drop at the edge of the field allows for the whole walk', () => {
        // 10 tiles is FIELD_RADIUS; walking that is seconds, not one tick
        expect(lootWaitMs(10)).toBeGreaterThanOrEqual(5000);
    });
    test('a negative distance cannot shorten the wait', () => {
        expect(lootWaitMs(-5)).toBe(lootWaitMs(0));
    });
});

describe('ESCAPE_TELES', () => {
    test('every entry carries a name, level, runes, and a paired bank', () => {
        for (const [key, tele] of Object.entries(ESCAPE_TELES)) {
            expect(tele.name).toBe(key);
            expect(tele.level).toBeGreaterThan(0);
            expect(tele.runes.length).toBeGreaterThan(0);
            expect(tele.bank.level).toBe(0);
        }
    });
    test('Camelot is the documented default pairing', () => {
        expect(ESCAPE_TELES.Camelot.level).toBe(45);
        expect(ESCAPE_TELES.Camelot.bank.x).toBe(2725);
        expect(ESCAPE_TELES.Camelot.bank.z).toBe(3491);
    });
    test('Ardougne costs 2 law and 2 water', () => {
        const runes = Object.fromEntries(ESCAPE_TELES.Ardougne.runes.map(r => [r.rune, r.count]));
        expect(runes['Law rune']).toBe(2);
        expect(runes['Water rune']).toBe(2);
    });
});

describe('registry', () => {
    test('FireGiant registers under Combat with its settings schema', async () => {
        const { ScriptRegistry } = await import('#/bot/runtime/ScriptRegistry.js');
        await import('#/bot/scripts/index.js');
        const entry = ScriptRegistry.get('FireGiant');
        expect(entry?.category).toBe('Combat');
        expect(entry?.settingsSchema?.escapeTele?.default).toBe(BARREL_EXIT);
        expect(entry?.settingsSchema?.combatStyle?.options).toEqual(['melee', 'mage', 'range']);
    });
});
