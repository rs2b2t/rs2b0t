import { expect, test } from 'bun:test';

import { checkRequirements } from '#/bot/quests/RequirementChecker.js';
import type { QuestRecord, PlayerState } from '#/bot/quests/types.js';

function rec(requirements: QuestRecord['requirements']): QuestRecord {
    return { id: 't', name: 'Test', questPoints: 1, requirements, items: [] };
}
function player(p: Partial<PlayerState> = {}): PlayerState {
    return {
        questPoints: p.questPoints ?? 0,
        skillLevels: p.skillLevels ?? new Map(),
        completedQuests: p.completedQuests ?? new Set()
    };
}

test('no requirements yields no results', () => {
    expect(checkRequirements(rec({}), player())).toEqual([]);
});

test('quest-point gate passes and fails with a reason showing have-value', () => {
    const pass = checkRequirements(rec({ minQuestPoints: 32 }), player({ questPoints: 40 }));
    expect(pass).toEqual([{ ok: true, reason: '' }]);
    const fail = checkRequirements(rec({ minQuestPoints: 32 }), player({ questPoints: 18 }));
    expect(fail[0].ok).toBe(false);
    expect(fail[0].reason).toBe('needs 32 quest points (have 18)');
});

test('skill gate compares base level and reports the shortfall', () => {
    const r = rec({ skills: [{ skill: 'mining', level: 10 }] });
    expect(checkRequirements(r, player({ skillLevels: new Map([['mining', 10]]) }))[0].ok).toBe(true);
    const fail = checkRequirements(r, player({ skillLevels: new Map([['mining', 7]]) }));
    expect(fail[0]).toEqual({ ok: false, reason: 'needs Mining 10 (have 7)' });
});

test('missing skill level reads as 0', () => {
    const r = rec({ skills: [{ skill: 'mining', level: 10 }] });
    expect(checkRequirements(r, player())[0].reason).toBe('needs Mining 10 (have 0)');
});

test('prerequisite quest gate uses completedQuests set', () => {
    const r = rec({ quests: ['runemysteries'] });
    const done = checkRequirements(r, player({ completedQuests: new Set(['runemysteries']) }));
    expect(done[0].ok).toBe(true);
    const missing = checkRequirements(r, player());
    expect(missing[0]).toEqual({ ok: false, reason: 'prerequisite quest not complete: runemysteries' });
});

test('multiple gates return one result each in order QP, skills, quests', () => {
    const r = rec({ minQuestPoints: 5, skills: [{ skill: 'cooking', level: 2 }], quests: ['cook'] });
    const res = checkRequirements(r, player({ questPoints: 5, skillLevels: new Map([['cooking', 3]]), completedQuests: new Set(['cook']) }));
    expect(res.map(x => x.ok)).toEqual([true, true, true]);
});
