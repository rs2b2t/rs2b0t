import { expect, test, describe } from 'bun:test';
import { specialCrossingAt, pickChoice, meetsRequirement, SPECIAL_CROSSINGS } from '../../../src/bot/nav/data/specialCrossings.js';

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

    test('gnome stronghold gate: reopen-after-dialogue, free, helps with the boxes', () => {
        const g = specialCrossingAt(2461, 3382, 0); // south approach = the enter edge's from-tile
        expect(g?.label).toBe('Gnome Stronghold gate (Femi boxes)');
        expect(g?.locName).toBe('Gate');
        expect(g?.action).toBe('Open');
        expect(g?.reopenAfterDialogue).toBe(true); // first Open runs the boxes dialogue, second crosses
        expect(g?.requires).toBeUndefined(); // no fare
        // "OK then" (help) is picked from Femi's p_choice2 rather than declining.
        expect(pickChoice(['Sorry, I\'m a bit busy.', 'OK then.'], g!.dialogue!.choose)).toBe('OK then.');
    });

    test('gnome gate: only the enter direction is a special crossing (leave is a plain Open)', () => {
        expect(specialCrossingAt(2461, 3382, 0)).not.toBeNull(); // enter (south -> north)
        expect(specialCrossingAt(2461, 3385, 0)).toBeNull();     // leave (north -> south): crossMultiTileDoor
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
