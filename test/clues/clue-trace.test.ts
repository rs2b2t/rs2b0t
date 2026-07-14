import { describe, expect, test } from 'bun:test';
import { ClueTrace, pushTraceRing, readTraceRing, type TraceDump } from '#/bot/clues/ClueTrace.js';

function makeTrace(cap?: number): { trace: ClueTrace; tick: () => void } {
    let now = 1000;
    const trace = new ClueTrace({ cap, now: () => now, pos: () => '3210,3225,0' });
    return { trace, tick: () => (now += 250) };
}

describe('ClueTrace', () => {
    test('collects lines with timestamp and position', () => {
        const { trace, tick } = makeTrace();
        trace.begin(2697, 'easy simple021');
        trace.note('solving trail_clue_easy_simple021 (talk Ned)');
        tick();
        trace.note('step done');
        const lines = trace.lines();
        expect(lines.length).toBe(2);
        expect(lines[0]).toEqual({ t: 1000, pos: '3210,3225,0', m: 'solving trail_clue_easy_simple021 (talk Ned)' });
        expect(lines[1].t).toBe(1250);
    });

    test('begin resets the previous solve', () => {
        const { trace } = makeTrace();
        trace.begin(2697, 'easy simple021');
        trace.note('old line');
        trace.begin(2681, 'easy simple005');
        expect(trace.lines().length).toBe(0);
        expect(trace.dump('abandon', 0).clueId).toBe(2681);
    });

    test('caps the line count by evicting the oldest', () => {
        const { trace } = makeTrace(3);
        trace.begin(1, 'x');
        for (let i = 0; i < 5; i++) {
            trace.note(`line ${i}`);
        }
        const lines = trace.lines();
        expect(lines.length).toBe(3);
        expect(lines[0].m).toBe('line 2');
        expect(lines[2].m).toBe('line 4');
    });

    test('dump carries clue identity, reason, leg count and timing', () => {
        const { trace, tick } = makeTrace();
        trace.begin(2697, 'easy simple021');
        trace.note('solving');
        tick();
        const dump = trace.dump('no progress after 4 attempts', 2);
        expect(dump.clueId).toBe(2697);
        expect(dump.name).toBe('easy simple021');
        expect(dump.reason).toBe('no progress after 4 attempts');
        expect(dump.legs).toBe(2);
        expect(dump.startedAt).toBe(1000);
        expect(dump.endedAt).toBe(1250);
        expect(dump.lines.length).toBe(1);
    });
});

describe('trace ring persistence', () => {
    function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; backing: Map<string, string> } {
        const backing = new Map<string, string>();
        return { backing, getItem: k => backing.get(k) ?? null, setItem: (k, v) => void backing.set(k, v) };
    }
    const dump = (id: number): TraceDump => ({ clueId: id, name: `clue ${id}`, reason: 'r', startedAt: 0, endedAt: 1, legs: 1, lines: [] });

    test('pushes newest first and caps the ring', () => {
        const storage = memStorage();
        for (let i = 1; i <= 7; i++) {
            pushTraceRing(storage, 'k', dump(i), 5);
        }
        const ring = readTraceRing(storage, 'k');
        expect(ring.length).toBe(5);
        expect(ring[0].clueId).toBe(7);
        expect(ring[4].clueId).toBe(3);
    });

    test('reads empty on missing or corrupt data', () => {
        const storage = memStorage();
        expect(readTraceRing(storage, 'k')).toEqual([]);
        storage.setItem('k', 'not json');
        expect(readTraceRing(storage, 'k')).toEqual([]);
    });
});
