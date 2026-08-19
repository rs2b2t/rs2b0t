import { describe, expect, test } from 'bun:test';
import {
    TRANSPORT_QUEST_SEEDS,
    transportQuestSetvarCommands,
    transportQuestJournalNames,
    richTransportQuestMap,
    canonicalQuestName
} from '#/bot/event/webwalk/transportQuestReqs.js';
import { worldStateFromData } from '#/bot/event/webwalk/worldStateData.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';
import { REQ } from '#/bot/event/webwalk/transportQuestReqs.js';

describe('transport quest seeds', () => {
    test('covers essence, trees, shilo, ardy tele, and Desert Camp quests', () => {
        const journals = new Set(TRANSPORT_QUEST_SEEDS.map(s => s.journal));
        expect(journals.has('Rune Mysteries Quest')).toBe(true);
        expect(journals.has('The Grand Tree')).toBe(true);
        expect(journals.has('Tree Gnome Village')).toBe(true);
        expect(journals.has('Shilo Village')).toBe(true);
        expect(journals.has('Plague City')).toBe(true);
        expect(journals.has('Tourist Trap')).toBe(true);
    });

    test('setvar commands match content complete stages', () => {
        const cmds = transportQuestSetvarCommands();
        expect(cmds).toContain('setvar runemysteries 6');
        expect(cmds).toContain('setvar grandtree 160');
        expect(cmds).toContain('setvar treequest 9');
        expect(cmds).toContain('setvar zombiequeen 15');
        // read-scroll stages, not quest-complete: spell teles cast only past the scroll
        expect(cmds).toContain('setvar elenaquest 30');
        expect(cmds).toContain('setvar itwatchtower 14');
        // content %eadgar_quest, not %eadgar
        expect(cmds).toContain('setvar eadgar_quest 110');
        expect(cmds).not.toContain('setvar eadgar 110');
        expect(cmds).toContain('setvar desertrescue 30');
    });

    test('journal names for live Quests.status check', () => {
        expect(transportQuestJournalNames()).toContain('Rune Mysteries Quest');
        // questlist.if text=Watch Tower (space)
        expect(transportQuestJournalNames()).toContain('Watch Tower');
        expect(transportQuestJournalNames()).toContain("Eadgar's Ruse");
        expect(transportQuestJournalNames()).toContain('Tourist Trap');
    });

    test('aliases map short catalog names to journal names', () => {
        expect(canonicalQuestName('Rune Mysteries')).toBe('Rune Mysteries Quest');
        expect(canonicalQuestName('Grand Tree')).toBe('The Grand Tree');
        expect(canonicalQuestName('Watchtower')).toBe('Watch Tower');
        expect(canonicalQuestName('Watch Tower')).toBe('Watch Tower');
        expect(canonicalQuestName('The Tourist Trap')).toBe('Tourist Trap');
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

    test('seeded 2004 Tourist Trap journal satisfies catalog requirements using The', () => {
        const state = worldStateFromData({
            members: true,
            skills: {},
            quests: richTransportQuestMap(),
            items: {},
            freeSlots: 28
        });
        expect(meetsRequires(
            { quests: [{ quest: 'The Tourist Trap', minStatus: 'complete' }] },
            state
        ).ok).toBe(true);
    });
});
