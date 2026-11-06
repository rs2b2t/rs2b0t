import { expect, test } from 'bun:test';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { planQuestSelection } from '#/bot/scripts/AIOQuester/questSelection.js';

const records = QUEST_DEFS.map(module => module.record);

test('selecting a dependent quest includes its recursive prerequisites', () => {
    const picked = planQuestSelection(new Set(['regicide']), new Set(), records, new Set(), 200);
    expect(picked.has('upass')).toBe(true);
    expect(picked.has('biohazard')).toBe(true);
    expect(picked.has('elena')).toBe(true);
});

test('explicit exclusions remain excluded even for prerequisites and quest points', () => {
    const picked = planQuestSelection(new Set(['dragon']), new Set(['cook', 'sheep']), records, new Set(), 0);
    expect(picked.has('cook')).toBe(false);
    expect(picked.has('sheep')).toBe(false);
    expect([...picked].filter(id => id !== 'dragon').reduce((sum, id) => sum + records.find(r => r.id === id)!.questPoints, 0)).toBeGreaterThanOrEqual(32);
});

test('completed quests contribute existing points without adding unnecessary work', () => {
    expect([...planQuestSelection(new Set(['dragon']), new Set(), records, new Set(['cook']), 32)]).toEqual(['dragon']);
});

test('simple explicit queues stay narrow', () => {
    expect([...planQuestSelection(new Set(['cook']), new Set(), records, new Set(), 0)]).toEqual(['cook']);
});

test('herblore requirements include its training unlock unless explicitly excluded', () => {
    expect(planQuestSelection(new Set(['legends']), new Set(), records, new Set(), 200).has('druid')).toBe(true);
    expect(planQuestSelection(new Set(['legends']), new Set(['druid']), records, new Set(), 200).has('druid')).toBe(false);
});
