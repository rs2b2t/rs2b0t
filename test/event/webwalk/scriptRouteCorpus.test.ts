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
} from '../../../tools/nav/script-route-corpus.js';

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
    test('tele vs pure-walk into the same end square stay distinct', () => {
        // Seers tele-in vs Ardougne pure-walk into Grand Tree bank — different hops.
        const seersTele = [
            { x: 2716, z: 3473, level: 1 },
            { x: 2662, z: 3305, level: 0 },
            { x: 2449, z: 3482, level: 1 }
        ];
        const ardyWalk = [
            { x: 2656, z: 3322, level: 1 },
            { x: 2455, z: 3488, level: 1 }
        ];
        const teleHops = [
            {
                kind: 'teleport',
                locName: 'Ardougne teleport',
                from: { x: 2716, z: 3473, level: 1 },
                to: { x: 2662, z: 3305, level: 0 }
            }
        ];
        const sa = pathCorridorSignature(seersTele, teleHops, { grid: 64 });
        const sb = pathCorridorSignature(ardyWalk, [], { grid: 64 });
        expect(sa).not.toBe(sb);
        expect(sa).toContain('h:teleport:ardougne_teleport');
        expect(sb).toContain('h:walk');
        expect(sa).toContain('e:1:38:54');
        expect(sb).toContain('e:1:38:54');
        // No start component (would re-flood HARD with *→same dest pure-walks).
        expect(sa.startsWith('e:')).toBe(true);
        expect(sa.includes('|s:')).toBe(false);
    });

    test('different end map-squares get different signatures', () => {
        const rellekka = pathCorridorSignature(
            [{ x: 0, z: 0, level: 0 }, { x: 2668, z: 3660, level: 0 }],
            [{ kind: 'teleport', locName: 'Camelot teleport', from: { x: 0, z: 0, level: 0 }, to: { x: 2757, z: 3478, level: 0 } }],
            { grid: 64 }
        );
        const varrock = pathCorridorSignature(
            [{ x: 0, z: 0, level: 0 }, { x: 3213, z: 3424, level: 0 }],
            [{ kind: 'teleport', locName: 'Varrock teleport', from: { x: 0, z: 0, level: 0 }, to: { x: 3213, z: 3424, level: 0 } }],
            { grid: 64 }
        );
        expect(rellekka).toContain('e:0:41:57');
        expect(varrock).toContain('e:0:50:53');
        expect(rellekka).not.toBe(varrock);
    });

    test('reverse direction is a different journey (destination swaps)', () => {
        const toGt = pathCorridorSignature([{ x: 2716, z: 3473, level: 1 }, { x: 2449, z: 3482, level: 1 }], []);
        const fromGt = pathCorridorSignature([{ x: 2449, z: 3482, level: 1 }, { x: 2716, z: 3473, level: 1 }], []);
        expect(toGt).not.toBe(fromGt);
    });

    test('pure-walks from distinct starts into the same end collapse', () => {
        // The Rellekka spam case: Varrock/Lumbridge/… → same dest, hops=walk.
        const fromVarrock = pathCorridorSignature(
            [
                { x: 3213, z: 3424, level: 0 },
                { x: 2668, z: 3660, level: 0 }
            ],
            [],
            { grid: 64 }
        );
        const fromLumb = pathCorridorSignature(
            [
                { x: 3222, z: 3218, level: 0 },
                { x: 2670, z: 3662, level: 0 }
            ],
            [],
            { grid: 64 }
        );
        expect(fromVarrock).toBe(fromLumb);
        expect(fromVarrock).toBe('e:0:41:57|h:walk');
    });

    test('dungeon hop vs pure-walk to same end stay distinct', () => {
        const fromEdge = pathCorridorSignature(
            [
                { x: 3096, z: 9867, level: 0 },
                { x: 2964, z: 3378, level: 0 }
            ],
            [{ kind: 'dungeon', locName: 'Ladder', from: { x: 3096, z: 9867, level: 0 }, to: { x: 3096, z: 3468, level: 0 } }],
            { grid: 64 }
        );
        const fromDraynor = pathCorridorSignature(
            [
                { x: 3092, z: 3243, level: 0 },
                { x: 2964, z: 3378, level: 0 }
            ],
            [],
            { grid: 64 }
        );
        expect(fromEdge).not.toBe(fromDraynor);
        expect(fromEdge).toContain('e:0:46:52');
        expect(fromDraynor).toContain('e:0:46:52');
        expect(fromEdge).toContain('h:dungeon:ladder');
        expect(fromDraynor).toContain('h:walk');
    });

    test('dedupeByCorridor keeps the harder row per signature', () => {
        const base = {
            from: { x: 0, z: 0, level: 0 },
            to: { x: 1, z: 0, level: 0 },
            note: 'n',
            corridor: 'e:0:41:57|h:walk',
            cost: 10,
            expanded: 1,
            hops: 0,
            cheb: 1,
            ms: 1,
            difficulty: 10
        };
        const rows = [
            { ...base, id: 'hard', source: 'NAV_TARGETS', difficulty: 10 },
            { ...base, id: 'easy-mainland', source: 'mainland-routes.json', difficulty: 5 }
        ];
        const out = dedupeByCorridor(rows);
        expect(out).toHaveLength(1);
        expect(out[0]!.id).toBe('hard'); // difficulty beats source priority
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
