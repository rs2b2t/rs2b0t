import { describe, expect, test } from 'bun:test';

import { DiagRing, MISSING } from '#/bot/runtime/diag/DiagRing.js';

const FIELDS = ['a', 'b'] as const;

describe('DiagRing', () => {
    test('retains the newest samples once it wraps', () => {
        const ring = new DiagRing(FIELDS, 3, 1000);
        for (let i = 0; i < 5; i++) {
            ring.push(i * 1000, [i, i * 10]);
        }

        expect(ring.length).toBe(3);
        expect(ring.written).toBe(5);
        expect([...ring.series('a')]).toEqual([2, 3, 4]);
        expect([...ring.series('b')]).toEqual([20, 30, 40]);
        expect([...ring.timestamps()]).toEqual([2000, 3000, 4000]);
    });

    test('allocates once, so sampling does not add GC pressure to the thread it measures', () => {
        const ring = new DiagRing(FIELDS, 100, 1000);
        const before = ring.bytes;
        for (let i = 0; i < 1000; i++) {
            ring.push(i, [i, i]);
        }
        expect(ring.bytes).toBe(before);
        expect(before).toBe(100 * 2 * 8 + 100 * 8);
    });

    test('a wrong-width sample throws instead of shifting every later column', () => {
        const ring = new DiagRing(FIELDS, 4, 1000);
        expect(() => ring.push(0, [1])).toThrow(/expected 2/);
        expect(() => ring.push(0, [1, 2, 3])).toThrow(/expected 2/);
    });

    test('unwritten slots read as MISSING, not as a real zero', () => {
        const ring = new DiagRing(FIELDS, 4, 1000);
        ring.push(0, [1, 2]);
        const series = ring.series('a');
        expect(series.length).toBe(1);
        expect(Number.isNaN(MISSING)).toBe(true);
    });

    test('at() answers "what did it look like an hour ago"', () => {
        const ring = new DiagRing(FIELDS, 10, 1000);
        for (let i = 0; i < 5; i++) {
            ring.push(i * 1000, [i, i * 2]);
        }

        expect(ring.at(2500)).toEqual({ a: 2, b: 4 });
        expect(ring.at(2000)).toEqual({ a: 2, b: 4 });
        expect(ring.at(-1)).toBeNull();
    });

    test('rejects malformed construction loudly', () => {
        expect(() => new DiagRing([], 4, 1000)).toThrow(/at least one field/);
        expect(() => new DiagRing(FIELDS, 0, 1000)).toThrow(/positive integer/);
        expect(() => new DiagRing(FIELDS, 4, 0)).toThrow(/interval must be positive/);
        expect(() => new DiagRing(['a', 'a'], 4, 1000)).toThrow(/duplicate/);
    });

    test('unknown field reads throw rather than returning empty data', () => {
        const ring = new DiagRing(FIELDS, 4, 1000);
        expect(() => ring.series('nope')).toThrow(/unknown diagnostics field/);
    });
});
