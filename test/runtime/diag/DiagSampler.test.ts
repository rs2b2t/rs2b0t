import { describe, expect, test } from 'bun:test';

import { COLD_INTERVAL_MS, DiagSampler, HOT_INTERVAL_MS } from '#/bot/multibox/DiagSampler.js';
import { FreezeWatch } from '#/bot/runtime/diag/FreezeWatch.js';
import type { FrameSample } from '#/bot/runtime/diag/BotDiag.js';

function frame(box: string, over: Partial<FrameSample> = {}): FrameSample {
    return {
        box,
        ingame: true,
        logicMs: 0,
        drawMs: 0,
        logicMaxMs: 0,
        drawMaxMs: 0,
        logicCount: 0,
        drawCount: 0,
        slowSpans: [],
        ...over
    };
}

function harness(frames: () => FrameSample[]) {
    let clock = 1_000_000;
    const freeze = new FreezeWatch({ sleep: async (): Promise<void> => undefined, wallClock: () => clock });
    let input = { maxMs: 0, count: 0 };
    const sampler = new DiagSampler({
        collect: frames,
        freeze,
        input: {
            drain: () => {
                const out = input;
                input = { maxMs: 0, count: 0 };
                return out;
            }
        },
        wallClock: () => clock
    });
    return {
        sampler,
        freeze,
        setInput: (v: { maxMs: number; count: number }): void => {
            input = v;
        },
        tick: (n = 1): void => {
            for (let i = 0; i < n; i++) {
                clock += HOT_INTERVAL_MS;
                sampler.sample();
            }
        },
        now: (): number => clock
    };
}

describe('DiagSampler', () => {
    test('separates a single hot bot from 26 healthy ones', () => {
        const boxes = Array.from({ length: 27 }, (_, i) => `bot${i}`);
        const h = harness(() => boxes.map(b => frame(b, { logicMs: b === 'bot7' ? 200 : 5, logicCount: 20 })));
        h.tick(5);

        const bot7 = h.sampler.snapshot() as { bots: Record<string, { hot: Record<string, number[]> }> };
        expect(bot7.bots.bot7.hot.logicMs.at(-1)).toBe(200);
        expect(bot7.bots.bot3.hot.logicMs.at(-1)).toBe(5);
    });

    test('compare() ranks the bot whose cost grew most', () => {
        let heavy = 5;
        const h = harness(() => [frame('calm', { logicMs: 5 }), frame('creeping', { logicMs: heavy })]);

        h.tick(Math.ceil(COLD_INTERVAL_MS / HOT_INTERVAL_MS));
        const then = h.now();
        heavy = 300;
        h.tick(Math.ceil(COLD_INTERVAL_MS / HOT_INTERVAL_MS));

        const diff = h.sampler.compare(h.now() - then);
        const worst = diff.bots.find(r => r.field === 'logicMs');
        expect(worst?.box).toBe('creeping');
        expect(worst!.delta).toBeGreaterThan(0);
    });

    test('the coarse tier aggregates rather than dropping samples', () => {
        const perTick = Math.ceil(COLD_INTERVAL_MS / HOT_INTERVAL_MS);
        const h = harness(() => [frame('a', { logicMs: 10, logicMaxMs: 10 })]);
        h.tick(perTick);

        const snap = h.sampler.snapshot() as { bots: Record<string, { cold: Record<string, number[]> }> };
        // summed field carries the window, not one sample of it
        expect(snap.bots.a.cold.logicMs.at(-1)).toBe(10 * perTick);
        // max field carries the worst, not the sum
        expect(snap.bots.a.cold.logicMaxMs.at(-1)).toBe(10);
    });

    test('a spike inside the coarse window survives aggregation', () => {
        const perTick = Math.ceil(COLD_INTERVAL_MS / HOT_INTERVAL_MS);
        let spike = 1;
        const h = harness(() => [frame('a', { logicMaxMs: spike })]);
        for (let i = 0; i < perTick; i++) {
            spike = i === 3 ? 900 : 1;
            h.tick(1);
        }

        const snap = h.sampler.snapshot() as { bots: Record<string, { cold: Record<string, number[]> }> };
        expect(snap.bots.a.cold.logicMaxMs.at(-1)).toBe(900);
    });

    test('records input latency and freeze stall on the wall series', () => {
        const h = harness(() => [frame('a')]);
        h.freeze.record(1500);
        h.setInput({ maxMs: 2000, count: 3 });
        h.tick(1);

        const snap = h.sampler.snapshot() as {
            wall: { hot: Record<string, number[]> };
            freezes: { events: { stallMs: number }[]; worstMs: number };
        };
        expect(snap.wall.hot.inputMaxMs.at(-1)).toBe(2000);
        expect(snap.wall.hot.stallMs.at(-1)).toBe(1500);
        expect(snap.freezes.events[0].stallMs).toBe(1500);
    });

    test('memory stays inside the napkin budget for a 27-bot wall', () => {
        const boxes = Array.from({ length: 27 }, (_, i) => `bot${i}`);
        const h = harness(() => boxes.map(b => frame(b)));
        h.tick(2);

        // 24h retention for 27 bots must not balloon: budget was ~10MB
        expect(h.sampler.bytes).toBeLessThan(10 * 1024 * 1024);
        expect(h.sampler.bytes).toBeGreaterThan(1024 * 1024);
    });

    test('blames the bot whose phase overlapped the stall, not whoever runs later', () => {
        const h = harness(() => [
            frame('guilty', { slowSpans: [{ phase: 'logic', start: 1_000_500, end: 1_001_400 }] }),
            frame('innocent', { slowSpans: [{ phase: 'logic', start: 1_002_000, end: 1_002_100 }] })
        ]);
        h.tick(1);

        // a 900ms stall observed at 1_001_400 overlaps only the guilty span
        const blame = h.sampler.blame(1_001_400, 900);
        expect(blame[0].box).toBe('guilty');
        expect(blame.map(b => b.box)).not.toContain('innocent');
    });

    test('ranks suspects by how much of the stall each one covered', () => {
        const h = harness(() => [
            frame('major', { slowSpans: [{ phase: 'logic', start: 1_000_000, end: 1_000_800 }] }),
            frame('minor', { slowSpans: [{ phase: 'draw', start: 1_000_700, end: 1_000_900 }] })
        ]);
        h.tick(1);

        const blame = h.sampler.blame(1_000_900, 900);
        expect(blame[0].box).toBe('major');
        expect(blame[0].overlapMs).toBeGreaterThan(blame[1].overlapMs);
    });

    test('attaches blame to freeze events in the dump', () => {
        // the span must already be sampled before the stall is recorded, which is
        // the live order: the frame reports it, then the wall notices the stall
        const h = harness(() => [frame('guilty', { slowSpans: [{ phase: 'logic', start: 1_000_100, end: 1_001_000 }] })]);
        h.tick(1);
        h.freeze.record(900);

        const snap = h.sampler.snapshot() as { freezes: { events: { blame: { box: string }[] }[] } };
        expect(snap.freezes.events[0].blame[0].box).toBe('guilty');
    });

    test('double start throws instead of silently running two timers', () => {
        const h = harness(() => []);
        h.sampler.start();
        expect(() => h.sampler.start()).toThrow(/already started/);
        h.sampler.stop();
    });
});
