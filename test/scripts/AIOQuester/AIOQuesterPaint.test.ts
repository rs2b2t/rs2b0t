import { describe, expect, test } from 'bun:test';
import {
    QUEUE_COLOUR,
    blockedEntries,
    blockedLines,
    focusRow,
    queueEntry,
    queueSummary
} from '#/bot/scripts/AIOQuester/AIOQuesterPaint.js';
import type { QueueRow, QueueStatus } from '#/bot/api/ai/quests/engine/queue.js';

const row = (id: string, status: QueueStatus, reasons: string[] = []): QueueRow => ({
    id,
    name: id.toUpperCase(),
    status,
    reasons
});

describe('queueEntry', () => {
    test('a running quest is marked and coloured apart from the rest', () => {
        const e = queueEntry(row('dragonslayer', 'RUNNING'));
        expect(e.icon).toBe('▶');
        expect(e.name).toBe('DRAGONSLAYER');
        expect(e.colour).toBe(QUEUE_COLOUR.RUNNING);
        expect(e.colour).not.toBe(QUEUE_COLOUR.READY);
    });

    test('a finished quest needs no note', () => {
        const e = queueEntry(row('cooksassistant', 'DONE'));
        expect(e.icon).toBe('✓');
        expect(e.note).toBe('');
        expect(e.colour).toBe(QUEUE_COLOUR.DONE);
    });

    test('a blocked quest shows its first reason', () => {
        const e = queueEntry(row('regicide', 'BLOCKED', ['needs 56 agility']));
        expect(e.icon).toBe('✗');
        expect(e.note).toBe('needs 56 agility');
        expect(e.colour).toBe(QUEUE_COLOUR.BLOCKED);
    });

    test('extra reasons are counted, so the Blocked tab is worth opening', () => {
        const e = queueEntry(row('regicide', 'BLOCKED', ['needs 56 agility', 'needs 100 qp', 'missing item: Coins x750 (have 0)']));
        expect(e.note).toBe('needs 56 agility (+2 more)');
    });

    test('every status has an icon and a colour', () => {
        const all: QueueStatus[] = ['DONE', 'RUNNING', 'READY', 'PARKED', 'BLOCKED', 'UNKNOWN'];
        for (const status of all) {
            const e = queueEntry(row('x', status));
            expect(e.icon.length).toBeGreaterThan(0);
            expect(e.colour).toBe(QUEUE_COLOUR[status]);
        }
    });
});

describe('blockedEntries', () => {
    const rows = [
        row('a', 'DONE'),
        row('b', 'BLOCKED', ['needs 20 mining', 'needs 20 smithing']),
        row('c', 'READY'),
        row('d', 'PARKED', ['no progress — parked']),
        row('e', 'RUNNING'),
        row('f', 'UNKNOWN', ['eligibility not evaluated yet'])
    ];

    test('keeps only the quests that are going nowhere, in queue order', () => {
        expect(blockedEntries(rows).map(e => e.name)).toEqual(['B', 'D', 'F']);
    });

    test('carries every reason, not just the first', () => {
        expect(blockedEntries(rows)[0]!.reasons).toEqual(['needs 20 mining', 'needs 20 smithing']);
    });

    test('a blocked quest with no stated reason still says something', () => {
        expect(blockedEntries([row('g', 'BLOCKED')])[0]!.reasons).toEqual(['no reason given']);
    });
});

describe('blockedLines', () => {
    test('the first reason shares the line with the quest name', () => {
        const lines = blockedLines([row('regicide', 'BLOCKED', ['needs 56 agility'])], 60);
        expect(lines).toHaveLength(1);
        expect(lines[0]!.text).toBe('REGICIDE             needs 56 agility');
        expect(lines[0]!.dim).toBe(false);
    });

    test('later reasons hang under the first, dimmed and aligned to the same column', () => {
        const lines = blockedLines([row('regicide', 'BLOCKED', ['needs 56 agility', 'needs 75 quest points'])], 60);
        expect(lines).toHaveLength(2);
        expect(lines[1]!.text).toBe('                     needs 75 quest points');
        expect(lines[1]!.dim).toBe(true);
    });

    test('a reason too long for its column wraps inside the column', () => {
        const lines = blockedLines([row('upass', 'BLOCKED', ['missing item: Blamish oil x1 (have 0) at the swamp'])], 46);
        expect(lines).toHaveLength(2);
        expect(lines[0]!.text).toBe('UPASS                missing item: Blamish oil');
        expect(lines[1]!.text).toBe('                     x1 (have 0) at the swamp');
    });

    test('a long quest name is clipped rather than pushing the reason column', () => {
        const lines = blockedLines([{ ...row('x', 'BLOCKED', ['needs 40 mining']), name: 'Big Chompy Bird Hunting' }], 60);
        expect(lines[0]!.text.startsWith('Big Chompy Bird Hun… ')).toBe(true);
    });

    test('quests that are not stuck contribute nothing', () => {
        expect(blockedLines([row('a', 'DONE'), row('b', 'READY')], 60)).toEqual([]);
    });
});

describe('focusRow', () => {
    const rows = [row('a', 'DONE'), row('b', 'DONE'), row('c', 'RUNNING'), row('d', 'READY')];

    test('points at the running quest', () => {
        expect(focusRow(rows, 'c')).toBe(2);
    });

    test('falls back to the first unfinished quest when nothing is running', () => {
        expect(focusRow([row('a', 'DONE'), row('b', 'BLOCKED')], null)).toBe(1);
    });

    test('a fully finished queue focuses nothing', () => {
        expect(focusRow([row('a', 'DONE')], null)).toBe(-1);
        expect(focusRow([], null)).toBe(-1);
    });
});

describe('queueSummary', () => {
    test('counts what is finished and what is stuck', () => {
        expect(queueSummary([row('a', 'DONE'), row('b', 'BLOCKED'), row('c', 'PARKED'), row('d', 'READY')])).toEqual({
            done: 1,
            stuck: 2,
            total: 4
        });
    });

    test('an empty queue counts nothing', () => {
        expect(queueSummary([])).toEqual({ done: 0, stuck: 0, total: 0 });
    });
});
