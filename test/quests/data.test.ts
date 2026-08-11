import { expect, test } from 'bun:test';

import { QUEST_ROCK_TYPES, ROCK_OPTIONS } from '#/bot/api/MiningRocks.js';
import { loadQuestRecords } from '#/bot/quests/data/index.js';

test('records have unique ids', () => {
    const ids = loadQuestRecords().map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
});

test('records have unique names (name is the live journal-lookup key)', () => {
    const names = loadQuestRecords().map(r => r.name);
    expect(new Set(names).size).toBe(names.length);
});

test('every prerequisite quest id resolves to a real record', () => {
    const records = loadQuestRecords();
    const ids = new Set(records.map(r => r.id));
    for (const r of records) {
        for (const pre of r.requirements.quests ?? []) {
            expect(ids.has(pre)).toBe(true);
        }
    }
});

test('every record has a non-empty name and a numeric questPoints', () => {
    for (const r of loadQuestRecords()) {
        expect(r.name.length).toBeGreaterThan(0);
        expect(Number.isFinite(r.questPoints)).toBe(true);
    }
});

test('item kinds are valid and quantities positive', () => {
    for (const r of loadQuestRecords()) {
        for (const it of r.items) {
            expect(['mustHave', 'acquirable']).toContain(it.kind);
            expect(it.qty).toBeGreaterThan(0);
        }
    }
});

test('the dataset covers all 63 journal quests', () => {
    expect(loadQuestRecords().length).toBe(63);
});

test('blurite is a quest rock, and never a GatheringBot option', () => {
    expect(QUEST_ROCK_TYPES.Blurite).toEqual([2110]);
    expect(ROCK_OPTIONS).not.toContain('Blurite');
});

test("the knight's sword requires Mining and Cooking 10 and acquires its items", () => {
    const squire = loadQuestRecords().find(q => q.id === 'squire')!;
    expect(squire.items.every(i => i.kind === 'acquirable')).toBe(true);
    expect(squire.requirements.skills).toEqual([
        { skill: 'mining', level: 10 },
        { skill: 'cooking', level: 10 }
    ]);
});
