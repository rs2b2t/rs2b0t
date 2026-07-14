import { expect, test } from 'bun:test';

import { identifyStep } from '#/bot/clues/ClueLogic.js';
import type { ClueRow } from '#/bot/clues/types.js';

const SEARCH: ClueRow = { obj: 'trail_clue_easy_simple001', id: 100, type: 'search', coord: { x: 1, z: 2, level: 0 } };
const DIG: ClueRow = { obj: 'trail_clue_easy_map001', id: 200, type: 'dig', casketObj: 'map001_casket', casketId: 201, coord: { x: 3, z: 4, level: 0 } };
const db: Record<number, ClueRow> = { 100: SEARCH, 200: DIG };
const casketIds: Record<number, string> = { 201: 'map001_casket' };

test('a held casket beats a held clue (clue listed first still yields open-casket)', () => {
    expect(identifyStep([100, 201], db, casketIds)).toEqual({ type: 'open-casket', casketObj: 'map001_casket', casketId: 201 });
});

test('a held casket yields an open-casket step', () => {
    expect(identifyStep([201], db, casketIds)).toEqual({ type: 'open-casket', casketObj: 'map001_casket', casketId: 201 });
});

test('a held clue yields its row', () => {
    expect(identifyStep([100], db, casketIds)).toEqual(SEARCH);
    expect(identifyStep([200], db, casketIds)).toEqual(DIG);
});

test('unknown ids yield null', () => {
    expect(identifyStep([999, 888], db, casketIds)).toBeNull();
});

test('empty held ids yield null', () => {
    expect(identifyStep([], db, casketIds)).toBeNull();
});
