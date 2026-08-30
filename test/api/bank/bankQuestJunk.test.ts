import { describe, expect, test } from 'bun:test';

import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import { findQuestJunk, QUEST_JUNK } from '#/bot/api/bank/bankQuestJunk.js';

const entry = QUEST_JUNK[0];

function statuses(map: Record<string, QuestStatus>) {
    return (quest: string): QuestStatus => map[quest] ?? 'unknown';
}

describe('findQuestJunk', () => {
    test('a complete quest makes its leftover droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({ [entry.quest]: 'complete' }));
        expect(found).toHaveLength(1);
        expect(found[0].droppable).toBe(true);
    });

    test('an in-progress quest is reported but never droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({ [entry.quest]: 'inProgress' }));
        expect(found[0].droppable).toBe(false);
    });

    test('a not-started quest is reported but never droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({ [entry.quest]: 'notStarted' }));
        expect(found[0].droppable).toBe(false);
    });

    test('an unknown status is reported but never droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({}));
        expect(found[0].status).toBe('unknown');
        expect(found[0].droppable).toBe(false);
    });

    test('items not on the list are ignored', () => {
        expect(findQuestJunk([{ id: 31337 }], statuses({}))).toEqual([]);
    });

    test('an empty bank finds nothing', () => {
        expect(findQuestJunk([], statuses({}))).toEqual([]);
    });

    test('the list has no duplicate ids', () => {
        expect(new Set(QUEST_JUNK.map(e => e.id)).size).toBe(QUEST_JUNK.length);
    });

    test('every entry names an item and a quest', () => {
        for (const item of QUEST_JUNK) {
            expect(item.id).toBeGreaterThan(0);
            expect(item.name.length).toBeGreaterThan(0);
            expect(item.quest.length).toBeGreaterThan(0);
        }
    });
});
