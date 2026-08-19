import { describe, expect, test } from 'bun:test';

import { CAGE_ID, cageWith, caughtIn, EVERY_SCORPION, type ScorpionKey } from '#/bot/api/ai/quests/defs/scorpcatcher/areas.js';

describe('cage ids', () => {
    test('the empty cage holds nothing', () => {
        expect([...caughtIn(CAGE_ID.EMPTY)]).toEqual([]);
    });

    test('each single-scorpion cage names its own scorpion', () => {
        expect([...caughtIn(CAGE_ID.A)]).toEqual(['a']);
        expect([...caughtIn(CAGE_ID.B)]).toEqual(['b']);
        expect([...caughtIn(CAGE_ID.C)]).toEqual(['c']);
    });

    test('each pair cage names both of its scorpions', () => {
        expect([...caughtIn(CAGE_ID.AB)].sort()).toEqual(['a', 'b']);
        expect([...caughtIn(CAGE_ID.AC)].sort()).toEqual(['a', 'c']);
        expect([...caughtIn(CAGE_ID.BC)].sort()).toEqual(['b', 'c']);
    });

    test('the full cage names all three', () => {
        expect([...caughtIn(CAGE_ID.FULL)].sort()).toEqual(['a', 'b', 'c']);
    });

    test('an id that is not a cage holds nothing', () => {
        expect([...caughtIn(995)]).toEqual([]);
    });

    // Why: the cage id is the only client-visible record of which scorpions are in it, so every combination has to round-trip or a resumed run re-catches one it already has.
    test('every combination of scorpions round-trips through an id', () => {
        const combos: ScorpionKey[][] = [
            [], ['a'], ['b'], ['c'], ['a', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'b', 'c']
        ];
        for (const combo of combos) {
            const id = cageWith(new Set(combo));
            expect(id).not.toBeUndefined();
            expect([...caughtIn(id!)].sort()).toEqual([...combo].sort());
        }
    });

    test('the three scorpions are catchable in a fixed order', () => {
        expect([...EVERY_SCORPION].sort()).toEqual(['a', 'b', 'c']);
    });
});
