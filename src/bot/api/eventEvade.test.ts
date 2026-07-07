import { describe, expect, test } from 'bun:test';
import { fleeCandidates } from './eventEvade.js';

describe('fleeCandidates', () => {
    test('offers 8 compass candidates at the requested distance', () => {
        const c = fleeCandidates({ x: 100, z: 100, level: 0 }, { x: 98, z: 100 }, 12);
        expect(c).toHaveLength(8);
        for (const t of c) {
            expect(Math.max(Math.abs(t.x - 100), Math.abs(t.z - 100))).toBe(12);
            expect(t.level).toBe(0);
        }
    });
    test('candidates are ordered directly-away-from-threat first', () => {
        const c = fleeCandidates({ x: 100, z: 100, level: 0 }, { x: 98, z: 100 }, 12);
        expect(c[0]).toEqual({ x: 112, z: 100, level: 0 });
    });
});
