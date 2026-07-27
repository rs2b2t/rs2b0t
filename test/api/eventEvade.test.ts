import { describe, expect, test } from 'bun:test';
import { fleeCandidates } from '#/bot/api/eventEvade.js';

const HERE = { x: 100, z: 100, level: 0 };
const WEST_THREAT = { x: 98, z: 100 };
const ring = (c: { x: number; z: number }[], d: number) =>
    c.filter(t => Math.max(Math.abs(t.x - 100), Math.abs(t.z - 100)) === d);

describe('fleeCandidates', () => {
    test('offers the full compass at the requested distance', () => {
        expect(ring(fleeCandidates(HERE, WEST_THREAT, 12), 12)).toHaveLength(8);
    });
    test('candidates are ordered directly-away-from-threat first', () => {
        expect(fleeCandidates(HERE, WEST_THREAT, 12)[0]).toEqual({ x: 112, z: 100, level: 0 });
    });
    test('every candidate keeps the caller\'s level', () => {
        for (const t of fleeCandidates({ x: 100, z: 100, level: 2 }, WEST_THREAT, 12)) {
            expect(t.level).toBe(2);
        }
    });

    // A single ring strands the bot indoors: from the Waterfall Dungeon safespot only
    // 2 of 8 tiles at distance 12 are walkable, so the evade gave up and stood there
    // being hit. Closer rings are far more likely to be open.
    test('sweeps inward so a cramped room still yields options', () => {
        const c = fleeCandidates(HERE, WEST_THREAT, 12);
        for (const d of [12, 10, 8, 6, 4]) {
            expect(ring(c, d).length).toBeGreaterThan(0);
        }
        expect(c.length).toBeGreaterThan(8);
    });
    test('never offers anything nearer than the minimum, which would not escape', () => {
        for (const t of fleeCandidates(HERE, WEST_THREAT, 12)) {
            expect(Math.max(Math.abs(t.x - 100), Math.abs(t.z - 100))).toBeGreaterThanOrEqual(4);
        }
    });
    test('farther rings are tried before nearer ones', () => {
        const c = fleeCandidates(HERE, WEST_THREAT, 12);
        const firstAt = (d: number) => c.findIndex(t => Math.max(Math.abs(t.x - 100), Math.abs(t.z - 100)) === d);
        expect(firstAt(12)).toBeLessThan(firstAt(4));
    });
    test('no duplicate tiles, so reachability is never probed twice', () => {
        const c = fleeCandidates(HERE, WEST_THREAT, 12);
        expect(new Set(c.map(t => `${t.x},${t.z}`)).size).toBe(c.length);
    });
    test('a short request still returns the innermost ring rather than nothing', () => {
        expect(fleeCandidates(HERE, HERE, 4)).toHaveLength(8);
    });
});
