import { describe, expect, test } from 'bun:test';
import {
    TRAVEL_SEGMENTS,
    buildTravelRoutes,
    filterTravelRoutes,
    scrapeTilesFromFile,
    travelRouteStats
} from '../../../tools/nav/script-travel-corpus.js';
import path from 'node:path';

describe('script-travel-corpus', () => {
    test('builds non-empty corpus with all segments', () => {
        const all = buildTravelRoutes();
        expect(all.length).toBeGreaterThan(100);
        const stats = travelRouteStats(all);
        expect(stats.total).toBe(all.length);
        expect(stats.clues).toBeGreaterThan(10);
        expect(stats.quests).toBeGreaterThan(10);
        expect(stats.fishing).toBeGreaterThan(5);
        expect(stats.mining).toBeGreaterThan(5);
        expect(stats.woodcutting).toBeGreaterThan(5);
        expect(stats.firemaking).toBeGreaterThan(5);
        expect(stats.cooking).toBeGreaterThan(0);
    });

    test('segment filters are disjoint subsets of gathering-all where expected', () => {
        const all = buildTravelRoutes();
        const fishing = filterTravelRoutes(all, 'fishing');
        const gathering = filterTravelRoutes(all, 'gathering-all');
        expect(fishing.every(r => r.gathering || r.segment === 'fishing')).toBe(true);
        expect(gathering.length).toBeGreaterThanOrEqual(fishing.length);
        for (const s of TRAVEL_SEGMENTS) {
            if (s === 'all') {
                continue;
            }
            const n = filterTravelRoutes(all, s).length;
            expect(n).toBeGreaterThan(0);
        }
    });

    test('scrapeTilesFromFile pulls new Tile literals', () => {
        const file = path.join(process.cwd(), 'src/bot/api/ai/quests/defs/trollstronghold/areas.ts');
        const tiles = scrapeTilesFromFile(file);
        expect(tiles.length).toBeGreaterThan(5);
        expect(tiles.every(t => Number.isFinite(t.x) && Number.isFinite(t.z))).toBe(true);
    });

    test('routes have distinct from≠to', () => {
        for (const r of buildTravelRoutes().slice(0, 200)) {
            expect(r.from.x === r.to.x && r.from.z === r.to.z && r.from.level === r.to.level).toBe(false);
        }
    });
});
