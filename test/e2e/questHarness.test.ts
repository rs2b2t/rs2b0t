import { expect, spyOn, test } from 'bun:test';
import { printQuestLogs } from '../../e2e/lib/questHarness.js';

test('prints every new line in ring order and keeps the newest timestamp across polls', () => {
    const output = spyOn(console, 'log').mockImplementation(() => {});
    try {
        const lines = [12, 10, 11, 12].map((time, i) => ({ time, level: 'info', msg: String(i) }));
        const latest = printQuestLogs(lines, 10);
        expect(latest).toBe(12);
        expect(printQuestLogs(lines, latest)).toBe(12);
        expect(printQuestLogs([], latest)).toBe(12);
        expect(output.mock.calls).toEqual([['      · [info] 0'], ['      · [info] 2'], ['      · [info] 3']]);
        printQuestLogs([{ time: 2500, level: 'warn', msg: 'late' }], latest, 1000);
        expect(output.mock.calls.at(-1)).toEqual(['      ·   1.5s [warn] late']);
    } finally {
        output.mockRestore();
    }
});
