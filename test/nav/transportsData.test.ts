import { describe, expect, test } from 'bun:test';

import transports from '#/bot/nav/data/transports.json';
import type { TransportEdgeData } from '#/bot/nav/PathFinder.js';

const edges = transports as TransportEdgeData[];

/**
 * Key order is not significant in this file, so compare on a canonical form.
 * `JSON.stringify(v, keys)` is not it — the array argument is a property
 * allowlist that recurses, so it strips `from.x`/`to.x` and collapses edges that
 * differ only in their coordinates.
 */
function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

describe('transports.json hygiene', () => {
    test('no entry is byte-identical to another', () => {
        // The file is curated by hand and appended to from both sides of a merge,
        // which is how two gnome_areagate edges arrived twice in #322. A duplicate
        // is silently harmless — the pathfinder just adds the same edge again — so
        // nothing catches it without this.
        //
        // Byte-identical only. Self-loops and repeated from/to pairs are both
        // legitimate here: a `laddermiddle` entry points at its own tile and
        // carries a `disabledReason`, which is how a known-but-unusable action is
        // recorded.
        const seen = new Map<string, { edge: TransportEdgeData; count: number }>();
        for (const edge of edges) {
            const id = canonical(edge);
            const hit = seen.get(id);
            seen.set(id, { edge, count: (hit?.count ?? 0) + 1 });
        }
        const repeated = [...seen.values()]
            .filter(({ count }) => count > 1)
            .map(({ edge: e, count }) =>
                `${e.debugName ?? e.locName} (${e.from.x},${e.from.z}) → (${e.to.x},${e.to.z}) ×${count}`);
        expect(repeated).toEqual([]);
    });

    test('every entry has a from, a to, and an action', () => {
        for (const edge of edges) {
            expect(typeof edge.action, JSON.stringify(edge)).toBe('string');
            expect(Number.isFinite(edge.from?.x), JSON.stringify(edge)).toBe(true);
            expect(Number.isFinite(edge.to?.x), JSON.stringify(edge)).toBe(true);
        }
    });
});
