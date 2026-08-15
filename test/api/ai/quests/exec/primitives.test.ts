import { expect, test, describe } from 'bun:test';
import { pickByLine, pickPreferred, isUnderground, needsHop, talkOp, type LineRule } from '#/bot/api/ai/quests/exec/primitives.js';

describe('pickPreferred', () => {
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

describe('pickByLine', () => {
    const skavid: readonly LineRule[] = [
        { whenLine: 'ar cur', choose: 'Gor.' },
        { whenLine: 'bidith ig', choose: 'Cur.' },
        { whenLine: 'cur tanath', choose: 'Bidith.' },
        { whenLine: 'gor nod', choose: 'Tanath.' }
    ];
    const options = ['Cur.', 'Ar.', 'Bidith.', 'Tanath.', 'Gor.'];

    test('matches the rule whose line the NPC actually spoke', () => {
        expect(pickByLine(['Ar cur...'], options, skavid)).toBe('Gor.');
        expect(pickByLine(['Bidith ig...'], options, skavid)).toBe('Cur.');
        expect(pickByLine(['Cur tanath...'], options, skavid)).toBe('Bidith.');
        expect(pickByLine(['Gor nod...'], options, skavid)).toBe('Tanath.');
    });

    test('prefers the longest matching rule so overlapping phrases cannot collide', () => {
        expect(pickByLine(['Cur tanath...'], options, skavid)).toBe('Bidith.');
    });

    test('ignores colour tags and pipe separators in the spoken line', () => {
        expect(pickByLine(['@dbl@Gor|nod...'], options, skavid)).toBe('Tanath.');
    });

    test('null when no rule matches, rather than guessing', () => {
        expect(pickByLine(['Tanath gor ar bidith?'], options, skavid)).toBeNull();
    });

    test('null when the matched reply is not on offer', () => {
        expect(pickByLine(['Ar cur...'], ['Cur.', 'Ar.'], skavid)).toBeNull();
    });

    test('null when the NPC has said nothing yet', () => {
        expect(pickByLine([], options, skavid)).toBeNull();
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

describe('pickByLine — the option list must not be mistaken for the NPC line', () => {
    const rules: readonly LineRule[] = [{ whenLine: 'ar cur', choose: 'Gor.' }];
    const options = ['Cur.', 'Ar.', 'Bidith.', 'Tanath.', 'Gor.'];

    test('the option labels alone match no rule, so a clobbered capture yields null', () => {
        expect(pickByLine(options, options, rules)).toBeNull();
    });

    test('the NPC line still matches once captured before the options appear', () => {
        expect(pickByLine(['Ar cur...'], options, rules)).toBe('Gor.');
    });
});
