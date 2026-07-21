import { expect, test, describe } from 'bun:test';
import { decide } from '#/bot/quests/defs/romeojuliet.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (journal: string, inv: string[] = [], noProgress = 0): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv.map(n => [n, 1])),
    worn: new Set(),
    noProgress,
    bankCoins: 0
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);

describe('romeojuliet decide', () => {
    test('held items disambiguate their stages', () => {
        expect(npcOf(decide(snap('notStarted')))).toBe('Romeo');
        expect(npcOf(decide(snap('inProgress', ['message'])))).toBe('Romeo');        // deliver message (20->30)
        expect(npcOf(decide(snap('inProgress', ['cadava potion'])))).toBe('Juliet'); // deliver potion (50->60)
        expect(decide(snap('complete')).kind).toBe('done');
    });
    test('invisible stages rotate the probe Juliet -> Lawrence -> Apothecary -> Romeo', () => {
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 0)))).toBe('Juliet');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 1)))).toBe('Father Lawrence');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 2)))).toBe('Apothecary');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 3)))).toBe('Romeo');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 4)))).toBe('Juliet'); // wraps
    });
});
