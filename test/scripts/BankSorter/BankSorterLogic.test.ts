import { describe, expect, test } from 'bun:test';

import type { QuestJunkFinding } from '#/bot/api/bank/bankQuestJunk.js';
import { droppableOf, questCategories, reportLine, summaryLine } from '#/bot/scripts/BankSorter/BankSorterLogic.js';

function finding(name: string, droppable: boolean, id = 1): QuestJunkFinding {
    return { id, name, quest: 'A Quest', status: droppable ? 'complete' : 'inProgress', droppable };
}

describe('droppableOf', () => {
    test('it keeps only droppable findings when arming is on', () => {
        const found = [finding('a', true), finding('b', false)];
        expect(droppableOf(found, true).map(f => f.name)).toEqual(['a']);
    });

    test('it keeps nothing when arming is off', () => {
        expect(droppableOf([finding('a', true)], false)).toEqual([]);
    });
});

describe('questCategories', () => {
    test('a complete quest sinks its leftover to questObsolete', () => {
        expect(questCategories([finding('a', true, 42)]).get(42)).toBe('questObsolete');
    });

    test('anything else stays questLive', () => {
        expect(questCategories([finding('a', false, 43)]).get(43)).toBe('questLive');
    });
});

describe('reportLine', () => {
    test('it names each finding and its quest on one line', () => {
        const line = reportLine([finding('Stake', true), finding('Rats tail', false)]);
        expect(line).toContain('Stake');
        expect(line).toContain('Rats tail');
        expect(line.split('\n')).toHaveLength(1);
    });

    test('nothing found still says so', () => {
        expect(reportLine([])).toContain('none');
    });
});

describe('summaryLine', () => {
    test('it names the moves, the mode and the leftovers on one line', () => {
        const line = summaryLine(
            { sorted: true, moves: 12, mode: 'insert', unmatched: [1, 2], reason: 'sorted' },
            [finding('a', true)],
            1
        );
        expect(line).toContain('12 moves');
        expect(line).toContain('insert');
        expect(line).toContain('2 unfiled');
        expect(line).toContain('1 dropped');
        expect(line.split('\n')).toHaveLength(1);
    });

    test('an unsorted run says why', () => {
        const line = summaryLine(
            { sorted: false, moves: 4, mode: 'swap', unmatched: [], reason: 'bank closed' },
            [],
            0
        );
        expect(line).toContain('bank closed');
    });
});
