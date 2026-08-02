import { describe, expect, test } from 'bun:test';
import {
    buildScriptRoutes,
    dedupeByCorridor,
    dedupePaths,
    difficultyScore,
    pathCorridorSignature,
    rankHardest,
    sameDirectedPath,
    sourcePriority,
    type RankedScriptRoute,
    type ScriptRoute
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

    test('path dedupe removes near-duplicate directed legs across sources', () => {
        const raw = buildScriptRoutes({ maxBankPairs: 24, pathDedupeRadius: 0 });
        const deduped = buildScriptRoutes({ maxBankPairs: 24, pathDedupeRadius: 3 });
        expect(deduped.length).toBeLessThan(raw.length);
        // No two kept routes should be the same directed path within radius 3.
        for (let i = 0; i < deduped.length; i++) {
            for (let j = i + 1; j < deduped.length; j++) {
                expect(sameDirectedPath(deduped[i]!, deduped[j]!, 3)).toBe(false);
            }
        }
    });
});

describe('dedupePaths (endpoints only)', () => {
    const leg = (
        id: string,
        source: string,
        from: { x: number; z: number; level: number },
        to: { x: number; z: number; level: number }
    ): ScriptRoute => ({ id, source, from, to, note: id });

    test('keeps higher-priority source when endpoints are near', () => {
        const a = leg('commute', 'NAV_TARGETS→BANK', { x: 100, z: 100, level: 0 }, { x: 200, z: 200, level: 0 });
        const b = leg('bot', 'NAV_TARGETS', { x: 101, z: 100, level: 0 }, { x: 200, z: 201, level: 0 });
        const out = dedupePaths([b, a], 3);
        expect(out).toHaveLength(1);
        expect(out[0]!.id).toBe('commute');
        expect(sourcePriority('NAV_TARGETS→BANK')).toBeGreaterThan(sourcePriority('NAV_TARGETS'));
    });

    test('does not collapse reverse directions', () => {
        const fwd = leg('f', 'WALK_DESTINATIONS', { x: 0, z: 0, level: 0 }, { x: 50, z: 0, level: 0 });
        const rev = leg('r', 'WALK_DESTINATIONS', { x: 50, z: 0, level: 0 }, { x: 0, z: 0, level: 0 });
        expect(dedupePaths([fwd, rev], 3)).toHaveLength(2);
    });
});

describe('pathCorridorSignature / dedupeByCorridor', () => {
    test('same hop sequence + coarse walk cells share a signature', () => {
        // Two starts a few tiles apart, same tele hop, same corridor north.
        const hops = [
            {
                kind: 'teleport',
                locName: 'Camelot teleport',
                from: { x: 3200, z: 3200, level: 0 },
                to: { x: 2757, z: 3478, level: 0 }
            }
        ];
        const a = [
            { x: 3200, z: 3200, level: 0 },
            { x: 2757, z: 3478, level: 0 },
            { x: 2757, z: 3490, level: 0 },
            { x: 2757, z: 3600, level: 0 },
            { x: 2700, z: 3700, level: 0 }
        ];
        const b = [
            { x: 3205, z: 3202, level: 0 },
            { x: 2757, z: 3478, level: 0 },
            { x: 2758, z: 3492, level: 0 },
            { x: 2756, z: 3605, level: 0 },
            { x: 2702, z: 3701, level: 0 }
        ];
        const sa = pathCorridorSignature(a, hops, { grid: 16, sampleEvery: 1 });
        const sb = pathCorridorSignature(b, hops, { grid: 16, sampleEvery: 1 });
        expect(sa).toBe(sb);
    });

    test('different tele destinations get different signatures', () => {
        const w = [{ x: 0, z: 0, level: 0 }, { x: 100, z: 100, level: 0 }];
        const camelot = pathCorridorSignature(w, [
            { kind: 'teleport', locName: 'Camelot teleport', from: { x: 0, z: 0, level: 0 }, to: { x: 2757, z: 3478, level: 0 } }
        ]);
        const varrock = pathCorridorSignature(w, [
            { kind: 'teleport', locName: 'Varrock teleport', from: { x: 0, z: 0, level: 0 }, to: { x: 3213, z: 3424, level: 0 } }
        ]);
        expect(camelot).not.toBe(varrock);
    });

    test('dedupeByCorridor keeps one row per signature', () => {
        const base = {
            from: { x: 0, z: 0, level: 0 },
            to: { x: 1, z: 0, level: 0 },
            note: 'n',
            corridor: 'walk#0:0:0;0:1:1',
            cost: 10,
            expanded: 1,
            hops: 0,
            cheb: 1,
            ms: 1,
            difficulty: 10
        };
        const rows = [
            { ...base, id: 'low', source: 'NAV_TARGETS', difficulty: 10 },
            { ...base, id: 'high', source: 'mainland-routes.json', difficulty: 5 }
        ];
        const out = dedupeByCorridor(rows);
        expect(out).toHaveLength(1);
        expect(out[0]!.id).toBe('high'); // mainland preferred
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
