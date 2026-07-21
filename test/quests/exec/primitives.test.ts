import { expect, test, describe } from 'bun:test';
import { pickPreferred, isUnderground, needsHop, talkOp } from '#/bot/quests/exec/primitives.js';

describe('pickPreferred', () => {
    // exact option strings from the quest .rs2 sources
    const sedridor = ["Nothing thanks, I'm just looking around.", 'What are you doing down here?', "I'm looking for the head wizard."];

    test('returns the full option text for the first preferred match', () => {
        expect(pickPreferred(sedridor, ["I'm looking for the head wizard."])).toBe("I'm looking for the head wizard.");
    });

    test('prefer order wins over option order', () => {
        expect(pickPreferred(['No, I am busy.', 'Yes, certainly.'], ['Yes, certainly.', 'No, I am busy.'])).toBe('Yes, certainly.');
    });

    test('matches case-insensitively by substring', () => {
        expect(pickPreferred(['Have you any quests for me?'], ['have you any quests'])).toBe('Have you any quests for me?');
    });

    test('null when nothing matches (caller falls back + warns)', () => {
        expect(pickPreferred(['Yes please!', "Oh, it's a rune shop. No thank you, then."], ['I have been sent here with a package'])).toBeNull();
    });
});

describe('isUnderground / needsHop', () => {
    test('classifies the wizard basement as underground, the tower as surface', () => {
        expect(isUnderground({ z: 9571 })).toBe(true);
        expect(isUnderground({ z: 3162 })).toBe(false);
    });

    test('needsHop only when regions disagree', () => {
        expect(needsHop({ z: 3218 }, { z: 9572 })).toBe(true);
        expect(needsHop({ z: 9576 }, { z: 3402 })).toBe(true);
        expect(needsHop({ z: 3218 }, { z: 3402 })).toBe(false);
        expect(needsHop({ z: 9571 }, { z: 9576 })).toBe(false);
    });
});

describe('talkOp', () => {
    test("resolves the standard 'Talk-to'", () => {
        expect(talkOp(['Talk-to', 'Trade'])).toBe('Talk-to');
    });
    test("resolves a bare 'Talk' (Fycie — the ICY FE abandon)", () => {
        expect(talkOp(['Talk'])).toBe('Talk');
    });
    test('null when the NPC has no talk-style op', () => {
        expect(talkOp(['Attack', 'Pickpocket'])).toBeNull();
    });
});
