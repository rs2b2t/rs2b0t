import { describe, expect, test } from 'bun:test';

import transports from '#/bot/event/webwalk/data/transports.json';
import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';

const edges = transports as TransportEdgeData[];

// Why: `JSON.stringify(v, keys)` takes the array as a recursing property allowlist, so it strips `from.x`/`to.x` and collapses edges differing only in coordinates.
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
        // Byte-identical only: self-loops and repeated from/to pairs are legitimate, since a `laddermiddle` entry points at its own tile and carries a `disabledReason`.
        // Why: the file is hand-curated and appended from both sides of a merge, and a duplicate edge is silent.
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
