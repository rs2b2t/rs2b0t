import { expect, test, describe } from 'bun:test';
import { nextQuest, queueRows } from './queue.js';
import type { QuestEligibility } from '../types.js';

const e = (id: string, status: QuestEligibility['status'], reasons: string[] = []): [string, QuestEligibility] =>
    [id, { id, name: id.toUpperCase(), status, reasons }];

const ORDER = ['runemysteries', 'doric', 'sheep', 'priest'];

describe('nextQuest', () => {
    test('first READY in def order wins', () => {
        const elig = new Map([e('runemysteries', 'DONE'), e('doric', 'READY'), e('sheep', 'READY'), e('priest', 'BLOCKED', ['x'])]);
        expect(nextQuest(ORDER, new Set(ORDER), elig, new Set())).toBe('doric');
    });
    test('unpicked quests are invisible', () => {
        const elig = new Map([e('doric', 'READY'), e('sheep', 'READY')]);
        expect(nextQuest(ORDER, new Set(['sheep']), elig, new Set())).toBe('sheep');
    });
    test('parked quests defer to unparked, then retry', () => {
        const elig = new Map([e('doric', 'READY'), e('sheep', 'READY')]);
        expect(nextQuest(ORDER, new Set(['doric', 'sheep']), elig, new Set(['doric']))).toBe('sheep');
        // everything runnable is parked -> retry the parked one
        expect(nextQuest(ORDER, new Set(['doric']), elig, new Set(['doric']))).toBe('doric');
    });
    test('nothing runnable -> null', () => {
        const elig = new Map([e('doric', 'DONE'), e('sheep', 'BLOCKED', ['missing item'])]);
        expect(nextQuest(ORDER, new Set(['doric', 'sheep']), elig, new Set())).toBeNull();
    });
});

describe('queueRows', () => {
    test('def order, picked only, RUNNING and PARKED stamped over eligibility', () => {
        const elig = new Map([e('runemysteries', 'DONE'), e('doric', 'READY'), e('sheep', 'READY'), e('priest', 'BLOCKED', ['qp'])]);
        const rows = queueRows(ORDER, new Set(['runemysteries', 'doric', 'sheep', 'priest']), elig, new Set(['sheep']), 'doric');
        expect(rows.map(r => `${r.id}:${r.status}`)).toEqual([
            'runemysteries:DONE', 'doric:RUNNING', 'sheep:PARKED', 'priest:BLOCKED'
        ]);
        expect(rows[3].reasons).toEqual(['qp']);
    });
});
