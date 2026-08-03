import { describe, expect, test } from 'bun:test';
import {
    TRANSPORT_QUEST_SEEDS,
    transportQuestSetvarCommands,
    transportQuestJournalNames,
    richTransportQuestMap,
    canonicalQuestName
} from '#/bot/nav/v2/transportQuestReqs.js';
import { worldStateFromData } from '#/bot/nav/v2/worldStateData.js';
import { meetsRequires } from '#/bot/nav/v2/requires.js';
import { REQ } from '#/bot/nav/v2/transportQuestReqs.js';

describe('transport quest seeds', () => {
    test('covers essence, trees, shilo, ardy tele quests', () => {
        const journals = new Set(TRANSPORT_QUEST_SEEDS.map(s => s.journal));
        expect(journals.has('Rune Mysteries Quest')).toBe(true);
        expect(journals.has('The Grand Tree')).toBe(true);
        expect(journals.has('Tree Gnome Village')).toBe(true);
        expect(journals.has('Shilo Village')).toBe(true);
        expect(journals.has('Plague City')).toBe(true);
    });

    test('setvar commands match content complete stages', () => {
        const cmds = transportQuestSetvarCommands();
        expect(cmds).toContain('setvar runemysteries 6');
        expect(cmds).toContain('setvar grandtree 160');
        expect(cmds).toContain('setvar treequest 9');
        expect(cmds).toContain('setvar zombiequeen 15');
        expect(cmds).toContain('setvar elenaquest 29');
    });

    test('journal names for live Quests.status check', () => {
        expect(transportQuestJournalNames()).toContain('Rune Mysteries Quest');
    });

    test('aliases map short catalog names to journal names', () => {
        expect(canonicalQuestName('Rune Mysteries')).toBe('Rune Mysteries Quest');
        expect(canonicalQuestName('Grand Tree')).toBe('The Grand Tree');
    });

    test('rich map + aliases satisfy essence requires', () => {
        const state = worldStateFromData({
            members: true,
            skills: {},
            quests: richTransportQuestMap(),
            items: {},
            freeSlots: 20
        });
        // Requires use journal name
        expect(meetsRequires(REQ.runeMysteriesComplete, state).ok).toBe(true);
        expect(meetsRequires(REQ.grandTreeComplete, state).ok).toBe(true);
        expect(meetsRequires(REQ.shiloComplete, state).ok).toBe(true);
        // Alias path: edge with short name still works via canonicalQuestName
        expect(
            meetsRequires(
                { quests: [{ quest: 'Rune Mysteries', minStatus: 'complete' }] },
                state
            ).ok
        ).toBe(true);
    });
});
