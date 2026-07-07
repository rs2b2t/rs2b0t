import { expect, test } from 'bun:test';

import { evaluate, evaluateAll } from '#/bot/quests/EligibilityEvaluator.js';
import type { QuestRecord, PlayerState, BankInventorySnapshot } from '#/bot/quests/types.js';

function rec(over: Partial<QuestRecord> = {}): QuestRecord {
    return {
        id: over.id ?? 't',
        name: over.name ?? 'Test Quest',
        members: over.members ?? false,
        questPoints: over.questPoints ?? 1,
        requirements: over.requirements ?? {},
        items: over.items ?? []
    };
}
function player(p: Partial<PlayerState> = {}): PlayerState {
    return { questPoints: p.questPoints ?? 0, skillLevels: p.skillLevels ?? new Map(), completedQuests: p.completedQuests ?? new Set() };
}
function snap(entries: [string, number][] = []): BankInventorySnapshot {
    return { counts: new Map(entries) };
}

test('complete journal status is DONE and skips requirement checks', () => {
    const r = rec({ requirements: { minQuestPoints: 999 }, items: [{ name: 'X', qty: 1, kind: 'mustHave' }] });
    const e = evaluate(r, player(), snap(), 'complete');
    expect(e.status).toBe('DONE');
    expect(e.reasons).toEqual([]);
});

test('all gates met and must-have present is READY', () => {
    const r = rec({ requirements: { skills: [{ skill: 'mining', level: 10 }] }, items: [{ name: 'Iron bar', qty: 2, kind: 'mustHave' }] });
    const e = evaluate(r, player({ skillLevels: new Map([['mining', 10]]) }), snap([['Iron bar', 2]]), 'notStarted');
    expect(e.status).toBe('READY');
    expect(e.reasons).toEqual([]);
});

test('unmet requirement and missing item both appear in BLOCKED reasons', () => {
    const r = rec({ requirements: { minQuestPoints: 32, skills: [{ skill: 'mining', level: 10 }] }, items: [{ name: 'Redberry pie', qty: 1, kind: 'mustHave' }] });
    const e = evaluate(r, player({ questPoints: 18, skillLevels: new Map([['mining', 7]]) }), snap(), 'inProgress');
    expect(e.status).toBe('BLOCKED');
    expect(e.reasons).toContain('needs 32 quest points (have 18)');
    expect(e.reasons).toContain('needs Mining 10 (have 7)');
    expect(e.reasons).toContain('missing item: Redberry pie x1 (have 0)');
});

test('acquirable-only missing items do not block READY', () => {
    const r = rec({ items: [{ name: 'Egg', qty: 1, kind: 'acquirable' }] });
    expect(evaluate(r, player(), snap(), 'notStarted').status).toBe('READY');
});

test('evaluateAll maps names to statuses via statusOf', () => {
    const records = [rec({ id: 'a', name: 'A' }), rec({ id: 'b', name: 'B' })];
    const statuses = new Map<string, 'complete' | 'notStarted'>([['A', 'complete'], ['B', 'notStarted']]);
    const res = evaluateAll(records, player(), snap(), n => statuses.get(n) ?? 'unknown');
    expect(res.find(x => x.id === 'a')!.status).toBe('DONE');
    expect(res.find(x => x.id === 'b')!.status).toBe('READY');
});
