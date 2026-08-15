import { describe, expect, test } from 'bun:test';
import {
    HEARTBEAT_ATTEMPTS, HEARTBEAT_MS, StepTracker, formatDuration, formatTile, invDelta
} from '../../../../../src/bot/api/ai/quests/engine/trace.js';

describe('formatDuration', () => {
    test('sub-second in ms, then seconds, then minutes', () => {
        expect(formatDuration(320)).toBe('320ms');
        expect(formatDuration(20_300)).toBe('20.3s');
        expect(formatDuration(185_000)).toBe('3m05s');
    });
});

describe('formatTile', () => {
    test('omits the level on the ground floor and names it above', () => {
        expect(formatTile({ x: 3042, z: 9760, level: 0 })).toBe('(3042,9760)');
        expect(formatTile({ x: 2509, z: 3640, level: 2 })).toBe('(2509,3640,L2)');
        expect(formatTile(null)).toBe('(no tile)');
    });
});

describe('invDelta', () => {
    test('reports only what moved', () => {
        const before = new Map([['coal', 3], ['iron ore', 4], ['coins', 20_000]]);
        const after = new Map([['coal', 4], ['iron ore', 4], ['coins', 20_000]]);
        expect(invDelta(before, after)).toBe('coal 3→4');
    });

    test('names an item that appeared or vanished', () => {
        expect(invDelta(new Map(), new Map([['steel bar', 4]]))).toBe('steel bar 0→4');
        expect(invDelta(new Map([['coal', 8]]), new Map())).toBe('coal 8→0');
    });

    test('a step that moved nothing says so — that is the diagnosis', () => {
        const same = new Map([['coal', 3]]);
        expect(invDelta(same, new Map(same))).toBe('no inventory change');
    });
});

describe('StepTracker', () => {
    test('counts attempts on a repeated step and resets on a new one', () => {
        const t = new StepTracker();
        expect(t.open('horror|smith 8 nails', 0)).toBe(1);
        expect(t.open('horror|smith 8 nails', 600)).toBe(2);
        expect(t.open('horror|smith 8 nails', 1200)).toBe(3);
        expect(t.open('horror|walk to the lighthouse', 1800)).toBe(1);
    });

    test('elapsed measures the whole run of the step, not the last attempt', () => {
        const t = new StepTracker();
        t.open('a', 1000);
        t.open('a', 61_000);
        expect(t.elapsed(61_000)).toBe(60_000);
    });

    test('never beats on the first attempt', () => {
        const t = new StepTracker();
        t.open('a', 0);
        expect(t.beat(0)).toBe(false);
    });

    test('beats on the attempt count even when the ticks are fast', () => {
        const t = new StepTracker();
        for (let i = 1; i < HEARTBEAT_ATTEMPTS; i++) {
            t.open('a', i);
            expect(t.beat(i)).toBe(false);
        }
        t.open('a', HEARTBEAT_ATTEMPTS);
        expect(t.beat(HEARTBEAT_ATTEMPTS)).toBe(true);
    });

    test('beats on elapsed time even when one attempt blocks for minutes', () => {
        const t = new StepTracker();
        t.open('a', 0);
        t.open('a', HEARTBEAT_MS + 1);
        expect(t.beat(HEARTBEAT_MS + 1)).toBe(true);
    });

    test('reset clears the count so a resumed quest starts fresh', () => {
        const t = new StepTracker();
        t.open('a', 0);
        t.open('a', 1);
        t.reset();
        expect(t.open('a', 2)).toBe(1);
    });
});
