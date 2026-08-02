import { describe, expect, test } from 'bun:test';
import {
    buildScriptRoutes,
    difficultyScore,
    rankHardest,
    type RankedScriptRoute
} from '../../tools/nav/script-route-corpus.ts';

describe('buildScriptRoutes', () => {
    test('pulls walks, banks, bot stands, and mainland legs', () => {
        const routes = buildScriptRoutes({ maxBankPairs: 8 });
        expect(routes.length).toBeGreaterThan(50);
        const sources = new Set(routes.map(r => r.source));
        expect(sources.has('WALK_DESTINATIONS')).toBe(true);
        expect(sources.has('BANK_LOCATIONS')).toBe(true);
        expect(sources.has('NAV_TARGETS') || sources.has('NAV_TARGETS→BANK')).toBe(true);
        // no self-loops
        for (const r of routes) {
            expect(r.from.x === r.to.x && r.from.z === r.to.z && r.from.level === r.to.level).toBe(false);
        }
    });
});

describe('rankHardest', () => {
    test('orders by difficulty score descending', () => {
        const base = {
            id: 'x',
            from: { x: 0, z: 0, level: 0 },
            to: { x: 1, z: 0, level: 0 },
            note: 'n',
            source: 't',
            expanded: 1,
            hops: 0,
            cheb: 1,
            ms: 1
        };
        const rows: RankedScriptRoute[] = [
            { ...base, id: 'easy', cost: 10, difficulty: difficultyScore({ cost: 10, expanded: 1, hops: 0, cheb: 1 }) },
            { ...base, id: 'hard', cost: 900, difficulty: difficultyScore({ cost: 900, expanded: 1, hops: 0, cheb: 1 }) }
        ];
        const top = rankHardest(rows, 1);
        expect(top[0]!.id).toBe('hard');
        expect(difficultyScore({ cost: 100, expanded: 50, hops: 2, cheb: 80 })).toBeGreaterThan(
            difficultyScore({ cost: 50, expanded: 50, hops: 2, cheb: 80 })
        );
    });
});
