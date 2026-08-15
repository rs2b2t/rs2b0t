import { describe, expect, test } from 'bun:test';
import { isTeleportItem, teleportKitFor } from '#/bot/api/ai/clues/teleportKit.js';
import { worldStateFromData } from '#/bot/event/webwalk/worldStateData.js';
import type { WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const state = (over: Partial<WorldStateData> = {}) =>
    worldStateFromData({
        members: false,
        skills: {},
        quests: {},
        items: {},
        worn: {},
        freeSlots: 20,
        entranaRestrictedGear: false,
        ...over
    });

const runeNames = (kit: ReturnType<typeof teleportKitFor>) => kit.runes.map(r => r.name).sort();
const perCast = (kit: ReturnType<typeof teleportKitFor>, name: string) =>
    kit.runes.find(r => r.name === name)?.perCast ?? 0;

describe('teleportKitFor — magic level', () => {
    test('a magic-1 account gets no runes at all', () => {
        const kit = teleportKitFor(state({ skills: { magic: 1 } }));
        expect(kit.runes).toEqual([]);
        expect(kit.usable).toEqual([]);
    });

    test('magic 24 is still one level short of Varrock', () => {
        expect(teleportKitFor(state({ skills: { magic: 24 } })).runes).toEqual([]);
    });

    test('magic 25 unlocks Varrock only — fire, air, law', () => {
        const kit = teleportKitFor(state({ skills: { magic: 25 } }));
        expect(runeNames(kit)).toEqual(['Air rune', 'Fire rune', 'Law rune']);
        expect(kit.usable).toEqual(['varrock']);
        expect(perCast(kit, 'Air rune')).toBe(3);
        expect(perCast(kit, 'Law rune')).toBe(1);
    });

    test('no water or earth runes until Falador and Lumbridge are castable', () => {
        expect(runeNames(teleportKitFor(state({ skills: { magic: 25 } })))).not.toContain('Water rune');
        expect(runeNames(teleportKitFor(state({ skills: { magic: 31 } })))).toContain('Earth rune');
        expect(runeNames(teleportKitFor(state({ skills: { magic: 31 } })))).not.toContain('Water rune');
        expect(runeNames(teleportKitFor(state({ skills: { magic: 37 } })))).toContain('Water rune');
    });
});

describe('teleportKitFor — members and quest gates', () => {
    test('Camelot lifts the air-rune count to 5, but only on a members world', () => {
        expect(perCast(teleportKitFor(state({ skills: { magic: 45 } })), 'Air rune')).toBe(3);
        expect(perCast(teleportKitFor(state({ members: true, skills: { magic: 45 } })), 'Air rune')).toBe(5);
    });

    test('Ardougne stays out until Plague City is complete', () => {
        const noQuest = teleportKitFor(state({ members: true, skills: { magic: 51 } }));
        expect(noQuest.usable).not.toContain('ardougne');

        const done = teleportKitFor(
            state({ members: true, skills: { magic: 51 }, quests: { 'Plague City': 'complete' } })
        );
        expect(done.usable).toContain('ardougne');
        expect(perCast(done, 'Law rune')).toBe(2);
    });

    test('a maxed members account gets the whole spellbook', () => {
        const kit = teleportKitFor(
            state({
                members: true,
                skills: { magic: 99 },
                quests: { 'Plague City': 'complete', 'Watch Tower': 'complete', "Eadgar's Ruse": 'complete' }
            })
        );
        expect(kit.usable).toEqual(
            expect.arrayContaining(['varrock', 'lumbridge', 'falador', 'camelot', 'ardougne', 'watchtower', 'trollheim'])
        );
        expect(runeNames(kit)).toEqual(['Air rune', 'Earth rune', 'Fire rune', 'Law rune', 'Water rune']);
    });
});

describe('teleportKitFor — jewellery', () => {
    test('glory and the dueling ring need no magic, so a level-1 account still keeps them', () => {
        const kit = teleportKitFor(state({ skills: { magic: 1 } }));
        expect(kit.jewelleryPrefixes).toContain('amulet of glory(');
        expect(kit.jewelleryPrefixes).toContain('ring of dueling');
    });

    test('the games necklace drops out on a free world', () => {
        expect(teleportKitFor(state()).jewelleryPrefixes).not.toContain('games necklace');
        expect(teleportKitFor(state({ members: true })).jewelleryPrefixes).toContain('games necklace');
    });
});

describe('isTeleportItem', () => {
    test('a rune no spell can pay for is not kit, so the bank stop deposits it', () => {
        const kit = teleportKitFor(state({ skills: { magic: 25 } }));
        expect(isTeleportItem('Law rune', kit)).toBe(true);
        expect(isTeleportItem('Water rune', kit)).toBe(false);
        expect(isTeleportItem('Earth rune', kit)).toBe(false);
    });

    test('a magic-1 account keeps no runes but still keeps a charged glory', () => {
        const kit = teleportKitFor(state({ skills: { magic: 1 } }));
        expect(isTeleportItem('Law rune', kit)).toBe(false);
        expect(isTeleportItem('Amulet of glory(4)', kit)).toBe(true);
    });
});
