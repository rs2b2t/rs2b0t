import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { decide } from '#/bot/api/ai/quests/defs/deathplateau/index.js';
import { DP_FLAG, DP_STAGE } from '#/bot/api/ai/quests/defs/deathplateau/journal.js';
import { DEATH_ITEM, TILE } from '#/bot/api/ai/quests/defs/deathplateau/areas.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { THROWER_APPROACH } from '#/bot/api/ai/quests/defs/deathplateau/nav.js';
import { tileInDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('scouting enters the trigger zone instead of stopping south of it', async () => {
    let tile = TILE.TENZING_BACK;
    const walks: { dest: { x: number; z: number; level: number }; avoid: boolean }[] = [];
    const restores = [
        stubProps(Game, { tile: () => tile }),
        stubProps(reader, { locs: () => [], modals: () => ({ main: -1, chat: -1, side: -1 }) }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() }),
        stubProps(Traversal, {
            walkResilient: async (dest, options) => {
                walks.push({ dest, avoid: false });
                tile = new Tile(dest.x, dest.z - (options?.radius ?? 0), dest.level);
                return true;
            },
            walkTo: async (dest, options) => {
                walks.push({ dest, avoid: (options?.avoidZones?.length ?? 0) > 0 });
                tile = new Tile(dest.x, dest.z - (options?.radius ?? 0), dest.level);
                return true;
            }
        })
    ];
    try {
        const stage = DP_STAGE.UNLOCKED_DOOR;
        const step = decide({
            journal: 'inProgress', stage,
            progress: { stage, flags: new Set([DP_FLAG.SABA, DP_FLAG.TENZING, DP_FLAG.SMITHY,
                DP_FLAG.ENTRANCE_CERT, DP_FLAG.GIVEN_CERT, DP_FLAG.SUPPLIES, DP_FLAG.GOT_MAP]) },
            inv: new Map([['secret way map', 1], ['combination', 1]]),
            invIds: new Map([[DEATH_ITEM.SECRET_MAP.id, 1], [DEATH_ITEM.COMBINATION.id, 1]]),
            worn: new Set(), bank: new Map(), bankKnown: true, bankCoins: 0, noProgress: 0, tile
        });
        expect(step.kind).toBe('custom');
        if (step.kind !== 'custom') throw new Error('expected the scout step');
        expect(await step.run(() => {})).toBe(true);
        expect(walks.every(walk => walk.avoid)).toBe(true);
        expect(walks[0]?.dest).toMatchObject({ x: 2817, z: 3564 });
        expect(tile.x).toBeGreaterThanOrEqual(2864);
        expect(tile.x).toBeLessThan(2872);
        expect(tile.z).toBeGreaterThanOrEqual(3608);
        expect(tile.z).toBeLessThan(3616);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});

const pack = 'out/collision.lcnav.gz';

test.skipIf(!existsSync(pack))('scout anchor is reachable inside the trigger through the stile', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    expect(finder.walkable(TILE.SCOUT.x, TILE.SCOUT.z, TILE.SCOUT.level)).toBe(true);
    const route = finder.findPath(TILE.TENZING_BACK, TILE.SCOUT, { avoidZones: THROWER_APPROACH, maxExpansions: 100_000 });
    expect(route.ok).toBe(true);
    if (!route.ok) throw new Error('scout route unavailable');
    expect(route.waypoints.at(-1)).toEqual({ x: TILE.SCOUT.x, z: TILE.SCOUT.z, level: TILE.SCOUT.level });
    expect(route.waypoints.every(tile => !tileInDangerZones(tile.x, tile.z, tile.level, THROWER_APPROACH))).toBe(true);
    expect(route.hops.some(hop => hop.kind === 'shortcut' && hop.locId === 3730)).toBe(true);
});

test('a blocked secret path stops without falling back to unconstrained walking', async () => {
    const { walkSecretPath } = await import('#/bot/api/ai/quests/defs/deathplateau/nav.js');
    let fallback = false;
    const restore = stubProps(Traversal, {
        walkTo: async () => false,
        walkResilient: async () => { fallback = true; return true; }
    });
    try {
        expect(await walkSecretPath(TILE.SCOUT, () => {})).toBe(false);
        expect(fallback).toBe(false);
    } finally {
        restore();
    }
});

test.skipIf(!existsSync(pack))('the return to Tenzing crosses the stile without entering the troll approach', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    const route = finder.findPath(TILE.SCOUT, TILE.STILE_SOUTH, { avoidZones: THROWER_APPROACH, maxExpansions: 100_000 });
    expect(route.ok).toBe(true);
    if (!route.ok) throw new Error('return route unavailable');
    expect(route.hops.some(hop => hop.kind === 'shortcut' && hop.locId === 3730)).toBe(true);
    expect(route.waypoints.every(tile => !tileInDangerZones(tile.x, tile.z, tile.level, THROWER_APPROACH))).toBe(true);
});

test.skipIf(!existsSync(pack))('the hand-in stays off the approach after leaving the stile', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    const route = finder.findPath(TILE.STILE_SOUTH, TILE.DENULTH, { avoidZones: THROWER_APPROACH, maxExpansions: 100_000 });
    expect(route.ok).toBe(true);
    if (!route.ok) throw new Error('hand-in route unavailable');
    expect(route.waypoints.every(tile => !tileInDangerZones(tile.x, tile.z, tile.level, THROWER_APPROACH))).toBe(true);
});
