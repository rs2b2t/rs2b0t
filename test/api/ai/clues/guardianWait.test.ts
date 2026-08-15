import { describe, expect, test } from 'bun:test';
import { sustainUntil } from '#/bot/api/ai/clues/Guardian.js';

/** A fake clock + tick pump, so the wait can be driven without a live client. */
function harness(opts: { ticksToSatisfy: number; tickMs?: number }) {
    const tickMs = opts.tickMs ?? 600;
    let now = 0;
    let ticks = 0;
    let pumps = 0;
    return {
        pumps: () => pumps,
        ticks: () => ticks,
        deps: {
            now: () => now,
            pump: async () => {
                pumps++;
            },
            tick: async () => {
                ticks++;
                now += tickMs;
            }
        },
        cond: () => ticks >= opts.ticksToSatisfy
    };
}

describe('sustainUntil', () => {
    test('pumps upkeep on every tick it waits — a long fight must still eat', async () => {
        const h = harness({ ticksToSatisfy: 10 });
        const done = await sustainUntil(h.cond, 180_000, h.deps);
        expect(done).toBe(true);
        // A tick-paced wait pumps once per tick; a single 180s park pumps once.
        expect(h.pumps()).toBeGreaterThanOrEqual(10);
    });

    test('pumps at least once even when the condition is already true', async () => {
        const h = harness({ ticksToSatisfy: 0 });
        expect(await sustainUntil(h.cond, 10_000, h.deps)).toBe(true);
        expect(h.pumps()).toBe(1);
        expect(h.ticks()).toBe(0);
    });

    test('gives up at the deadline and reports the condition', async () => {
        const h = harness({ ticksToSatisfy: 1_000_000 });
        expect(await sustainUntil(h.cond, 3000, h.deps)).toBe(false);
        // 600ms ticks inside a 3s budget — bounded, and it pumped the way.
        expect(h.ticks()).toBeLessThanOrEqual(5);
        expect(h.pumps()).toBeGreaterThan(1);
    });

    test('a zero budget still pumps once rather than skipping upkeep entirely', async () => {
        const h = harness({ ticksToSatisfy: 1_000_000 });
        expect(await sustainUntil(h.cond, 0, h.deps)).toBe(false);
        expect(h.pumps()).toBe(1);
    });
});
