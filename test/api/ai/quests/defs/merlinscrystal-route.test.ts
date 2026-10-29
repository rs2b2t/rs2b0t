import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { decide } from '#/bot/api/ai/quests/defs/merlinscrystal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Locs, Loc } from '#/bot/api/locs/Locs.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal, type WalkResilientOptions } from '#/bot/api/walking/Traversal.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { resolveDangerZones, tileInDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const ALTAR = new Tile(3239, 3607, 0);
const SYMBOL = new Tile(2780, 3515, 0);
const TOWER = new Tile(2769, 3493, 0);

for (const scenario of ['round trip', 'blocked outbound', 'blocked return', 'retry at altar']) {
    test(`Merlin's altar route stays safe: ${scenario}`, async () => {
        let tile = scenario === 'retry at altar' ? ALTAR : new Tile(2767, 3494, 2);
        const walks: { from: Tile; dest: Tile; options?: WalkResilientOptions }[] = [];
        const walk: typeof Traversal.walkResilient = async (dest, options) => {
            walks.push({ from: tile, dest: Tile.from(dest), options });
            if (scenario === 'blocked outbound' && ALTAR.equals(dest)) return false;
            if (scenario === 'blocked return' && SYMBOL.equals(dest)) return false;
            tile = Tile.from(dest);
            return true;
        };
        const locQuery = Locs.query();
        const item = new InvItem({ id: 35, name: 'Excalibur', count: 1, slot: 0, comId: 3214, ops: [] });
        const loc = new Loc({ typecode: 0, id: 62, name: 'Giant crystal', tile, ops: [], distance: 1 });
        const restores = [
            stubProps(item, { useOn: async () => true, interact: async () => true }),
            stubProps(loc, { interact: async op => {
                if (op === 'Climb-down') tile = new Tile(tile.x, tile.z, tile.level - 1);
                if (op === 'Climb-up') tile = new Tile(tile.x, tile.z, tile.level + 1);
                return true;
            } }),
            stubProps(Game, { tile: () => tile }),
            stubProps(Inventory, { contains: () => true, first: () => item }),
            stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() }),
            stubProps(Locs, { query: () => locQuery }),
            stubProps(locQuery, { name: () => locQuery, action: () => locQuery, within: () => locQuery, nearest: () => loc }),
            stubProps(Traversal, {
                walkResilient: (dest, options) => {
                    expect([ALTAR, SYMBOL, TOWER].some(tile => tile.equals(dest))).toBe(false);
                    return walk(dest, options);
                },
                walkTo: (dest, options) => walk(dest, { radius: 0, ...options })
            })
        ];
        try {
            const step = decide({ journal: 'inProgress', inv: new Map([['excalibur', 1], ['lit black candle', 1], ['bat bones', 1]]), worn: new Set(), noProgress: 0, bankCoins: 0 });
            if (step.kind !== 'custom') throw new Error('expected summoning step');
            await step.run(() => {});
            const journeys = walks.filter(walk => [ALTAR, SYMBOL, TOWER].some(tile => tile.equals(walk.dest)));
            expect(journeys.length).toBe(scenario === 'blocked outbound' ? 1 : scenario === 'retry at altar' ? 3 : 2);
            const pack = 'out/collision.lcnav.gz';
            const finder = existsSync(pack) ? new PathFinder(gunzipSync(readFileSync(pack))) : null;
            if (finder) loadDefaultNavEdges(finder);
            for (const journey of journeys) {
                const zones = resolveDangerZones(journey.options?.avoidZones);
                expect(tileInDangerZones(3154, 3924, 0, zones)).toBe(true);
                expect(tileInDangerZones(3239, 3607, 0, zones)).toBe(false);
                if (!finder) continue;
                const route = finder.findPath(journey.from, journey.dest, {
                    avoidZones: zones,
                    state: { ...emptyWorldStateData(), canSlashWeb: true },
                    maxExpansions: 1_200_000
                });
                if (!route.ok) throw new Error(JSON.stringify({ ...route, from: journey.from, to: journey.dest }));
                expect(journey.options?.timeoutMs).toBeGreaterThan(route.cost * 600 + 30_000);
                expect(route.hops.some(hop => hop.action === 'Pull' && hop.locName === 'Lever')).toBe(false);
                expect(route.waypoints.some(tile => tile.z >= 3648 && tile.z < 6400)).toBe(false);
            }
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}
