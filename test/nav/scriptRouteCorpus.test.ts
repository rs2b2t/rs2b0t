import { describe, expect, test } from 'bun:test';
import { buildScriptRoutes } from '../../tools/nav/script-route-corpus.ts';

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
