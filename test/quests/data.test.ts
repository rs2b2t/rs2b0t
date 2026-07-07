import { expect, test } from 'bun:test';

import { loadQuestRecords } from '#/bot/quests/data/index.js';

test('records have unique ids', () => {
    const ids = loadQuestRecords().map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
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
