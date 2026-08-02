import { expect, test, describe } from 'bun:test';
import { specialCrossingAt, specialCrossingForTransport, pickChoice, meetsRequirement, matchesUseItem, SPECIAL_CROSSINGS } from '../../../src/bot/nav/data/specialCrossings.js';

describe('specialCrossingAt', () => {
    test('matches both Al Kharid toll gate tiles', () => {
        const a = specialCrossingAt(3268, 3227, 0);
        const b = specialCrossingAt(3268, 3228, 0);
        expect(a?.label).toBe('Al Kharid toll gate');
        expect(b?.label).toBe('Al Kharid toll gate');
        expect(a?.requires).toEqual({ item: 'Coins', count: 10 });
        expect(a?.dialogue?.choose).toContain('Yes, ok.');
    });

    test('misses other tiles and other levels', () => {
        expect(specialCrossingAt(3268, 3227, 1)).toBeNull();
        expect(specialCrossingAt(3200, 3200, 0)).toBeNull();
    });

    test('Baxtorian door uses the retained quest key without changing graph availability', () => {
        const door = specialCrossingAt(2568, 9893, 0);
        expect(door?.label).toBe('Baxtorian keyed door');
        expect(door?.locName).toBe('Door');
        expect(door?.useItem).toEqual({ id: 298, name: 'A key' });
        expect(door?.requires).toBeUndefined();
        expect(matchesUseItem({ id: 293 }, door!.useItem!)).toBe(false);
        expect(matchesUseItem({ id: 298 }, door!.useItem!)).toBe(true);
    });

    test('gnome stronghold gate: reopen-after-dialogue, free, helps with the boxes', () => {
        const g = specialCrossingAt(2461, 3382, 0);
        expect(g?.label).toBe('Gnome Stronghold gate (Femi boxes)');
        expect(g?.locName).toBe('Gate');
        expect(g?.action).toBe('Open');
        expect(g?.reopenAfterDialogue).toBe(true);
        expect(g?.requires).toBeUndefined();
        expect(pickChoice(['Sorry, I\'m a bit busy.', 'OK then.'], g!.dialogue!.choose)).toBe('OK then.');
    });

    test('gnome gate: only the enter direction is a special crossing (leave is a plain Open)', () => {
        expect(specialCrossingAt(2461, 3382, 0)).not.toBeNull();
        expect(specialCrossingAt(2461, 3385, 0)).toBeNull();
    });

    test('Mort Myre Ulizius gate: Drezel unlockQuest detour for Nature Spirit (#115)', () => {
        const a = specialCrossingAt(3443, 3458, 0);
        const b = specialCrossingAt(3444, 3458, 0);
        expect(a?.label).toBe('Mort Myre gate (Ulizius)');
        expect(b?.label).toBe('Mort Myre gate (Ulizius)');
        expect(a?.locName).toBe('Gate');
        expect(a?.action).toBe('Open');
        // Gate Open itself has no dialog once NS is started; unlock is a Drezel detour.
        expect(a?.dialogue).toBeUndefined();
        expect(a?.reopenAfterDialogue).toBeUndefined();
        expect(a?.unlockQuest?.quest).toBe('Nature Spirit');
        expect(a?.unlockQuest?.requireComplete).toBe('Priest in Peril');
        expect(a?.unlockQuest?.npc).toBe('Drezel');
        expect(a?.unlockQuest?.stand).toEqual({ x: 3439, z: 9895, level: 0 });
        // Drezel grants 3 meat pie + 3 apple pie (unstackable) on accept.
        expect(a?.unlockQuest?.freeSlots).toBe(6);
        expect(
            pickChoice(
                [
                    "Well, I'm going to look around a bit more.",
                    'Is there anything else interesting to do around here?'
                ],
                a!.unlockQuest!.dialogue.choose
            )
        ).toBe('Is there anything else interesting to do around here?');
        expect(
            pickChoice(
                ["Sorry, not interested...", 'Well, what is it, I may be able to help?'],
                a!.unlockQuest!.dialogue.choose
            )
        ).toBe('Well, what is it, I may be able to help?');
        expect(
            pickChoice(
                ["Yes, I'll go and look for him.", "Sorry, I don't think I can help."],
                a!.unlockQuest!.dialogue.choose
            )
        ).toBe("Yes, I'll go and look for him.");
        expect(
            pickChoice(["Yes, I'm sure.", "Who is this Filliman?"], a!.unlockQuest!.dialogue.choose)
        ).toBe("Yes, I'm sure.");
        expect(b?.unlockQuest?.quest).toBe('Nature Spirit');
    });

    test('every crossing carries the fields the executor reads', () => {
        for (const c of SPECIAL_CROSSINGS) {
            expect(c.locName.length).toBeGreaterThan(0);
            expect(c.action.length).toBeGreaterThan(0);
            expect(c.label.length).toBeGreaterThan(0);
        }
    });
});

describe('pickChoice', () => {
    test('returns the matching option text (case-insensitive, substring)', () => {
        expect(pickChoice(['No thank you.', 'Who does my money go to?', 'Yes, ok.'], ['yes, ok.'])).toBe('Yes, ok.');
    });
    test('returns null when nothing matches', () => {
        expect(pickChoice(['No thank you.'], ['yes, ok.'])).toBeNull();
    });
});

describe('meetsRequirement', () => {
    test('no requirement is always met', () => {
        expect(meetsRequirement(0, undefined)).toBe(true);
    });
    test('met only at or above the count', () => {
        expect(meetsRequirement(9, { item: 'Coins', count: 10 })).toBe(false);
        expect(meetsRequirement(10, { item: 'Coins', count: 10 })).toBe(true);
        expect(meetsRequirement(11, { item: 'Coins', count: 10 })).toBe(true);
    });
});

describe('specialCrossingForTransport', () => {
    test('Femi enter: exact loc tile falls back to approach stand special', () => {
        const transport = { locX: 2459, locZ: 3383 };
        const approach = { x: 2461, z: 3382, level: 0 };
        const sc = specialCrossingForTransport(transport, approach);
        expect(sc?.label).toBe('Gnome Stronghold gate (Femi boxes)');
    });

    test('Femi leave approach is not a special crossing', () => {
        const transport = { locX: 2459, locZ: 3383 };
        const approach = { x: 2461, z: 3385, level: 0 };
        expect(specialCrossingForTransport(transport, approach)).toBeNull();
    });
});
