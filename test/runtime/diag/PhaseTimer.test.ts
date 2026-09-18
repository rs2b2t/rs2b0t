import { describe, expect, test } from 'bun:test';

import { PhaseTimer } from '#/bot/runtime/diag/PhaseTimer.js';

const spin = (ms: number): void => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
        /* no-op */
    }
};

describe('PhaseTimer', () => {
    test('attributes cost to the phase that spent it', () => {
        const t = new PhaseTimer('red bracket');
        t.measure('logic', () => spin(20));
        t.measure('draw', () => spin(5));

        const totals = t.drain();
        expect(totals.ms.logic).toBeGreaterThanOrEqual(18);
        expect(totals.ms.draw).toBeGreaterThanOrEqual(4);
        expect(totals.ms.draw).toBeLessThan(totals.ms.logic);
        expect(totals.count.logic).toBe(1);
        expect(totals.count.draw).toBe(1);
    });

    test('drain resets, so a bucket is always cost since the last sample', () => {
        const t = new PhaseTimer('red bracket');
        t.measure('logic', () => spin(5));
        t.drain();

        const second = t.drain();
        expect(second.ms.logic).toBe(0);
        expect(second.count.logic).toBe(0);
    });

    test('tracks the slowest single occurrence, not just the total', () => {
        const t = new PhaseTimer('red bracket');
        t.measure('logic', () => spin(2));
        t.measure('logic', () => spin(25));

        const totals = t.drain();
        expect(totals.count.logic).toBe(2);
        expect(totals.maxMs.logic).toBeGreaterThanOrEqual(22);
        expect(totals.ms.logic).toBeGreaterThan(totals.maxMs.logic);
    });

    test('does not bill a bot for time it spent yielded to other bots', async () => {
        const t = new PhaseTimer('red bracket');

        // an async body would have its await time billed as occupancy; measuring
        // only the synchronous run keeps a yield off this bot's ledger
        const body = (): void => spin(5);
        t.measure('logic', body);
        await new Promise(r => setTimeout(r, 60));
        t.measure('logic', body);

        const totals = t.drain();
        expect(totals.ms.logic).toBeGreaterThanOrEqual(8);
        expect(totals.ms.logic).toBeLessThan(40);
    });

    test('nested phases throw instead of double-counting into two buckets', () => {
        const t = new PhaseTimer('red bracket');
        expect(() =>
            t.measure('logic', () => {
                t.measure('draw', () => undefined);
            })
        ).toThrow(/already running/);
    });

    test('a throwing body still records its cost and clears the running marker', () => {
        const t = new PhaseTimer('red bracket');
        expect(() =>
            t.measure('logic', () => {
                spin(5);
                throw new Error('boom');
            })
        ).toThrow('boom');

        expect(t.drain().ms.logic).toBeGreaterThanOrEqual(4);
    });
});
