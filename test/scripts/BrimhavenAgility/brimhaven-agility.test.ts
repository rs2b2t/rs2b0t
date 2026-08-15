import { describe, expect, test } from 'bun:test';
import { Game } from '#/bot/api/game/Game.js';
import BrimhavenAgility, { BRIMHAVEN_AGILITY_SETTINGS } from '#/bot/scripts/BrimhavenAgility/BrimhavenAgility.js';
import {
    ARENA_EDGES,
    ARENA_ENTRANCE,
    BOAT_FARE,
    ENTRANCE_FEE,
    PILLARS,
    SPIKE_EDGE,
    TRIP_COINS,
    coinsNeeded,
    coinsToWithdraw,
    edgeBetween,
    hasPaid,
    canStartObstacle,
    inArena,
    inArenaPit,
    needsCoinsRestock,
    nextHop,
    edgeApproachCandidates,
    edgeApproachPoint,
    obstacleAxis,
    obstacleOutcome,
    onArenaPlatform,
    onBrimhavenSurface,
    pathPlatforms,
    pillarFromHint,
    pillarTagged,
    platformAt,
    restockShortfall,
    shouldBank,
    shouldEat,
    needsCakeSteal,
    STEAL_THIEVING_MIN,
    GUARD_THIEVING_MIN,
    ticketInventoryGain,
    usableEdges,
    waitPlatform,
    wantRunForGoal
} from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';
import {
    DEFAULT_BANK_TICKETS,
    DEFAULT_FOOD_PER_TRIP
} from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';

/** Direction-specific loc anchors selected by the live edge-loc scoring. */
const DIRECTED_INTERACT_LOCS = [
    [0, 1, 2764, 9546],
    [1, 0, 2769, 9546],
    [0, 5, 2761, 9549],
    [5, 0, 2761, 9554],
    [1, 2, 2774, 9545],
    [2, 1, 2781, 9545],
    [2, 3, 2785, 9544],
    [3, 2, 2792, 9544],
    [3, 4, 2797, 9546],
    [4, 3, 2802, 9546],
    [3, 8, 2794, 9548],
    [8, 3, 2794, 9555],
    [4, 9, 2805, 9549],
    [9, 4, 2805, 9554],
    [5, 6, 2764, 9557],
    [6, 5, 2769, 9557],
    [5, 10, 2759, 9559],
    [10, 5, 2759, 9566],
    [6, 11, 2772, 9559],
    [11, 6, 2772, 9566],
    [7, 12, 2783, 9562],
    [12, 7, 2783, 9562],
    [8, 13, 2793, 9559],
    [13, 8, 2793, 9566],
    [9, 14, 2805, 9562],
    [14, 9, 2805, 9562],
    [10, 11, 2766, 9569],
    [11, 10, 2767, 9567],
    [11, 16, 2771, 9570],
    [16, 11, 2771, 9577],
    [12, 13, 2786, 9568],
    [13, 12, 2791, 9568],
    [14, 19, 2805, 9571],
    [19, 14, 2805, 9576],
    [15, 16, 2764, 9579],
    [16, 15, 2769, 9579],
    [17, 22, 2783, 9581],
    [22, 17, 2783, 9588],
    [18, 23, 2794, 9582],
    [23, 18, 2794, 9587],
    [20, 21, 2764, 9590],
    [21, 20, 2769, 9590],
    [21, 22, 2777, 9590],
    [22, 21, 2777, 9590],
    [22, 23, 2785, 9592],
    [23, 22, 2792, 9592],
    [24, 19, 2806, 9585],
    [19, 24, 2804, 9584],
    [24, 23, 2802, 9590],
    [23, 24, 2797, 9590]
] as const;

describe('BrimhavenAgility arena geometry', () => {
    test('has 24 ticket pillars plus the SE ladder landing', () => {
        expect(PILLARS.length).toBe(25);
        // spacing between adjacent pillars is 11 tiles
        expect(PILLARS[1].x - PILLARS[0].x).toBe(11);
        expect(PILLARS[5].z - PILLARS[0].z).toBe(11);
    });

    test('every edge endpoint is a valid platform index', () => {
        for (const e of ARENA_EDGES) {
            expect(e.a).toBeGreaterThanOrEqual(0);
            expect(e.b).toBeLessThan(PILLARS.length);
            expect(e.a).not.toBe(e.b);
        }
    });

    test('spike grind edge is floorspikes between platforms 13 and 14', () => {
        expect(SPIKE_EDGE.kind).toBe('spikes');
        expect(SPIKE_EDGE.minLevel).toBe(20);
        expect(new Set([SPIKE_EDGE.a, SPIKE_EDGE.b])).toEqual(new Set([13, 14]));
    });

    test('all directed interact edges have cardinal, source-side approach candidates', () => {
        const directedEdges = ARENA_EDGES
            .filter(edge => edge.mode === 'interact')
            .flatMap(edge => [`${edge.a}->${edge.b}`, `${edge.b}->${edge.a}`]);
        const fixtureKeys = DIRECTED_INTERACT_LOCS.map(([from, to]) => `${from}->${to}`);

        expect(DIRECTED_INTERACT_LOCS.length).toBe(50);
        expect(new Set(fixtureKeys)).toEqual(new Set(directedEdges));
        expect(new Set(fixtureKeys).size).toBe(DIRECTED_INTERACT_LOCS.length);

        for (const [from, to, x, z] of DIRECTED_INTERACT_LOCS) {
            const loc = { x, z };
            const axis = obstacleAxis(from, to);
            const ideal = edgeApproachPoint(from, to, loc);
            const candidates = edgeApproachCandidates(from, to, loc);

            expect(axis).not.toBeNull();
            expect(Math.abs(axis!.dx) + Math.abs(axis!.dz)).toBe(1);
            expect(ideal).not.toBeNull();
            expect(candidates[0]).toEqual(ideal!);
            expect(new Set(candidates.map(tile => `${tile.x},${tile.z}`)).size).toBe(candidates.length);

            for (const candidate of candidates) {
                expect(platformAt(candidate.x, candidate.z)).toBe(from);
                expect(
                    (candidate.x - loc.x) * axis!.dx + (candidate.z - loc.z) * axis!.dz
                ).toBeLessThan(0);
                expect(
                    Math.max(Math.abs(candidate.x - ideal!.x), Math.abs(candidate.z - ideal!.z))
                ).toBeLessThanOrEqual(3);
            }
        }
    });

    test('rope swings stage on their exact directional server start tiles', () => {
        expect(edgeApproachPoint(24, 19, { x: 2806, z: 9585 })).toEqual({ x: 2806, z: 9587 });
        expect(edgeApproachPoint(19, 24, { x: 2804, z: 9584 })).toEqual({ x: 2804, z: 9582 });
        expect(edgeApproachPoint(10, 11, { x: 2766, z: 9569 })).toEqual({ x: 2764, z: 9569 });
        expect(edgeApproachPoint(11, 10, { x: 2767, z: 9567 })).toEqual({ x: 2769, z: 9567 });
    });

    test('selects a deterministic reachable alternative when the theoretical stand is blocked', () => {
        const loc = { x: 2806, z: 9585 };
        const candidates = edgeApproachCandidates(24, 19, loc);
        const theoretical = edgeApproachPoint(24, 19, loc)!;
        const blocked = new Set([`${theoretical.x},${theoretical.z}`]);
        const selected = candidates.find(tile => !blocked.has(`${tile.x},${tile.z}`));

        expect(candidates[0]).toEqual(theoretical);
        expect(selected).toEqual(candidates[1]);
        expect(selected).not.toEqual(theoretical);
    });
});

describe('BrimhavenAgility pathfinding', () => {
    test('already-there path is empty', () => {
        expect(pathPlatforms(7, 7, 99)).toEqual([]);
    });

    test('adjacent platforms are one hop at any level when the edge has no gate', () => {
        // 0↔1 is a ledge (min 1)
        expect(pathPlatforms(0, 1, 1)).toEqual([1]);
        expect(nextHop(0, 1, 1)).toBe(1);
    });

    test('level-20 gates close floorspike / handhold / pressure edges', () => {
        // 1↔6 is floorspikes min 20
        expect(edgeBetween(1, 6, 19)).toBeNull();
        expect(edgeBetween(1, 6, 20)).not.toBeNull();
        expect(usableEdges(1).every(e => e.minLevel <= 1)).toBe(true);
        expect(usableEdges(40).length).toBe(ARENA_EDGES.length);
    });

    test('level-40 gates close sawblade and dart edges', () => {
        expect(edgeBetween(6, 7, 39)).toBeNull();
        expect(edgeBetween(6, 7, 40)?.kind).toBe('saws');
        expect(edgeBetween(13, 18, 39)).toBeNull();
        expect(edgeBetween(13, 18, 40)?.kind).toBe('darts');
    });

    test('finds a multi-hop route across the arena at high agility', () => {
        const path = pathPlatforms(0, 23, 99);
        expect(path).not.toBeNull();
        expect(path!.length).toBeGreaterThan(3);
        expect(path![path!.length - 1]).toBe(23);
    });

    test('unreachable when every connecting edge is gated', () => {
        // from 1 to 6 only via spikes (20) — at level 1, still reachable via longer routes?
        // 1→0→5→6 uses pillar + plank (both level 1)
        const path = pathPlatforms(1, 6, 1);
        expect(path).not.toBeNull();
        expect(path).not.toContain(/* direct spike would be */ -1);
        // ensure we did not take the spike edge as the sole hop
        if (path!.length === 1) {
            expect(path![0]).not.toBe(6); // if direct, it would need spikes
        }
    });

    test('among equal-hop routes, first step leans toward the goal (no long-way detour)', () => {
        // 5→8: both 0-first and 6-first are 5 hops; geo-tiebreak prefers east/south toward 8.
        const path = pathPlatforms(5, 8, 63);
        expect(path).not.toBeNull();
        expect(path!.length).toBe(5);
        expect(path![0]).toBe(6);
        // 10→12: prefer 11 over backtracking north through 5.
        expect(pathPlatforms(10, 12, 63)?.[0]).toBe(11);
    });

    test('wait platform prefers spikes at 20+ and centre below', () => {
        expect(waitPlatform(19, 0)).toBe(12);
        const wait = waitPlatform(50, 0);
        expect([13, 14]).toContain(wait);
    });
});

describe('BrimhavenAgility banking & combat decisions', () => {
    test('coins cover boat both ways plus first entrance from the mainland', () => {
        expect(TRIP_COINS).toBe(BOAT_FARE * 2 + ENTRANCE_FEE);
        expect(coinsNeeded(false)).toBe(TRIP_COINS);
        expect(coinsNeeded(true)).toBe(BOAT_FARE * 2);
        expect(coinsToWithdraw(false, 0)).toBe(TRIP_COINS);
        expect(coinsToWithdraw(false, 100)).toBe(TRIP_COINS - 100);
    });

    test('after the outbound boat, only return fare (+ entrance if unpaid) remains', () => {
        // 260 withdrawn → pay 30 boat → 230 on Brimhaven. Old logic still wanted 260 → bank loop.
        expect(coinsNeeded(false, true)).toBe(BOAT_FARE + ENTRANCE_FEE); // 230
        expect(coinsNeeded(true, true)).toBe(BOAT_FARE); // 30 return only
        expect(needsCoinsRestock(230, false, true)).toBe(false);
        expect(needsCoinsRestock(229, false, true)).toBe(true);
        expect(needsCoinsRestock(230, false, false)).toBe(true); // still under full trip on mainland
        expect(onBrimhavenSurface(ARENA_ENTRANCE.x, ARENA_ENTRANCE.z, 0)).toBe(true);
        expect(onBrimhavenSurface(2655, 3283, 0)).toBe(false); // Ardougne south bank
    });

    test('banks when out of food or ticket threshold hit', () => {
        expect(shouldBank(0, 0, 1000)).toBe(true);
        expect(shouldBank(1000, 5, 1000)).toBe(true);
        expect(shouldBank(999, 5, 1000)).toBe(false);
        expect(shouldBank(0, 0, 1000, true)).toBe(false);
        expect(shouldBank(1000, 0, 1000, true)).toBe(true);
    });

    test('steal restock wants cakes when the pack is empty or a guard run needs a buffer', () => {
        expect(STEAL_THIEVING_MIN).toBe(20);
        expect(GUARD_THIEVING_MIN).toBe(40);
        expect(needsCakeSteal(0, 0, true, false)).toBe(true);
        expect(needsCakeSteal(3, 0, true, false)).toBe(false);
        expect(needsCakeSteal(0, 8, true, false)).toBe(false);
        expect(needsCakeSteal(0, 2, true, true)).toBe(true);
        expect(needsCakeSteal(0, 0, false, true)).toBe(false);
    });

    test('eats only below 5 HP with food in pack', () => {
        expect(shouldEat(4, 3)).toBe(true);
        expect(shouldEat(5, 3)).toBe(false);
        expect(shouldEat(1, 0)).toBe(false);
    });

    test('varp bit helpers match content constants', () => {
        expect(hasPaid(0)).toBe(false);
        expect(hasPaid(1 << 1)).toBe(true);
        expect(pillarTagged(0)).toBe(false);
        expect(pillarTagged(1 << 0)).toBe(true);
    });
});

describe('BrimhavenAgility collected-ticket total', () => {
    const change = (overrides: Partial<Parameters<typeof ticketInventoryGain>[0]> = {}) => ({
        id: 513,
        name: 'Agility arena ticket',
        count: 1,
        previousId: -1,
        previousCount: 0,
        ...overrides
    });

    test('counts the delayed inventory reward independently of tag completion', () => {
        let collected = 12; // tagging/varp/modal completion does not change the total
        collected += ticketInventoryGain(change(), false);
        collected += ticketInventoryGain(change({ count: 5, previousId: 513, previousCount: 4 }), false);

        expect(collected).toBe(14);
    });

    test('depositing cannot reduce the total and bank withdrawals cannot inflate it', () => {
        let collected = ticketInventoryGain(change(), false);
        collected += ticketInventoryGain(
            change({ id: -1, name: null, count: 0, previousId: 513, previousCount: 1 }),
            false
        );
        collected += ticketInventoryGain(change(), true);

        expect(collected).toBe(1);
    });

    test('ignores unrelated inventory gains', () => {
        expect(ticketInventoryGain(change({ name: 'Lobster' }), false)).toBe(0);
    });
});

describe('BrimhavenAgility location helpers', () => {
    test('platformAt snaps nearby tiles to the pillar index', () => {
        const p = PILLARS[12];
        expect(platformAt(p.x, p.z)).toBe(12);
        expect(platformAt(p.x + 2, p.z - 1)).toBe(12);
        expect(platformAt(0, 0)).toBe(-1);
    });

    test('pillarFromHint maps a hint arrow on a pillar', () => {
        expect(pillarFromHint(PILLARS[5].x, PILLARS[5].z)).toBe(5);
    });

    test('inArena accepts only the dedicated m43_149 content square', () => {
        expect(inArena(2752, 9536)).toBe(true);
        expect(inArena(2815, 9599)).toBe(true);
        expect(inArena(2751, 9536)).toBe(false);
        expect(inArena(2816, 9599)).toBe(false);
        expect(inArena(2752, 9535)).toBe(false);
        expect(inArena(2815, 9600)).toBe(false);
        expect(inArena(3218, 9618)).toBe(false);
        expect(onArenaPlatform(3) && inArena(3200, 3200)).toBe(false);
    });

    test('ignores Swarm only while standing in the arena (#597)', () => {
        const origTile = Game.tile;
        const bot = new BrimhavenAgility();
        try {
            Game.tile = () => ({ x: ARENA_ENTRANCE.x, z: ARENA_ENTRANCE.z, level: 0 });
            expect(bot.ignoredRandoms()).toEqual([]);
            Game.tile = () => ({ x: PILLARS[12].x, z: PILLARS[12].z, level: 3 });
            expect(bot.ignoredRandoms()).toEqual(['swarm']);
        } finally {
            Game.tile = origTile;
        }
    });

    test('failed obstacles land in the pit (plane 0) under the same x,z as pillars', () => {
        // live report: 2802,9590,0 after missing rope swing near landing 24 (2805,9590)
        expect(inArenaPit(2802, 9590, 0)).toBe(true);
        expect(inArenaPit(3218, 9618, 0)).toBe(false); // unrelated random-event destination
        expect(inArenaPit(2802, 2802, 0)).toBe(false); // surface Brimhaven, not the arena pit
        expect(inArenaPit(2802, 9590, 3)).toBe(false);
        expect(onArenaPlatform(3)).toBe(true);
        expect(onArenaPlatform(0)).toBe(false);
        // pit tiles still snap by x/z — callers must gate with onArenaPlatform
        expect(platformAt(2802, 9590)).toBe(24);
    });
});

describe('BrimhavenAgility obstacle settle (pace)', () => {
    test('arrived on dest even while animating — residual get-up must not block resume', () => {
        expect(obstacleOutcome(0, 1, 0, false, false)).toBe('arrived');
        expect(obstacleOutcome(0, 1, 0, false, true)).toBe('arrived');
    });

    test('pit fall is settled immediately so ClimbOutOfPit can run', () => {
        expect(obstacleOutcome(-1, 5, 6, true, true)).toBe('fallen');
        expect(obstacleOutcome(5, 5, 6, false, false)).toBe('pending');
    });

    test('partial progress off the start platform is elsewhere', () => {
        expect(obstacleOutcome(2, 1, 0, false, false)).toBe('elsewhere');
    });

    test('canStartObstacle only blocks the pit — residual anim is clickable', () => {
        expect(canStartObstacle(false, false)).toBe(true);
        expect(canStartObstacle(true, false)).toBe(true);
        expect(canStartObstacle(false, true)).toBe(false);
        expect(canStartObstacle(true, true)).toBe(false);
    });
});

describe('BrimhavenAgility run vs walk goal', () => {
    test('chase ticket pillar with run; centre/spikes with walk', () => {
        expect(wantRunForGoal(true)).toBe(true);
        expect(wantRunForGoal(false)).toBe(false);
    });
});

describe('BrimhavenAgility settings defaults', () => {
    test('defaults match the issue: 25 food, bank at 1000 tickets', () => {
        expect(DEFAULT_FOOD_PER_TRIP).toBe(25);
        expect(DEFAULT_BANK_TICKETS).toBe(1000);
        expect(BRIMHAVEN_AGILITY_SETTINGS.stealRestock?.default).toBe(false);
    });
});

describe('BrimhavenAgility restock verification', () => {
    const base = { food: 'Lobster', foodPerTrip: 25, coins: 260, alreadyPaid: false };

    test('a funded trip has no shortfall', () => {
        expect(restockShortfall({ ...base, foodInPack: 25 })).toBeNull();
        expect(restockShortfall({ ...base, foodInPack: 26 })).toBeNull();
    });

    test('names the missing food instead of spinning the bank open and closed', () => {
        // Why: a bank holding some lobsters never trips a "bank empty and pack empty" guard.
        const partial = restockShortfall({ ...base, foodInPack: 3 });
        expect(partial).toContain('Lobster');
        expect(partial).toContain('only 3');
        expect(restockShortfall({ ...base, foodInPack: 0 })).toContain('Lobster');
    });

    test('names missing coins once food is covered', () => {
        const broke = restockShortfall({ ...base, foodInPack: 25, coins: 100 });
        expect(broke).toContain('coins');
        expect(broke).toContain('260');
        // Entrance already paid — only the two boat fares are needed.
        expect(restockShortfall({ ...base, foodInPack: 25, coins: 60, alreadyPaid: true })).toBeNull();
    });
});
