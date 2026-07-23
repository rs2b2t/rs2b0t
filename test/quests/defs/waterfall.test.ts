import { expect, test, describe } from 'bun:test';
import { decide } from '#/bot/quests/defs/waterfall.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (
    journal: string,
    items: [string, number][] = [],
    worn: string[] = []
): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(worn),
    noProgress: 0,
    bankCoins: 0
});

const PEBBLE = "glarial's pebble";
const AMULET = "glarial's amulet";
const URN = "glarial's urn";
const BOOK = 'book on baxtorian';

describe('waterfall decide — journal gates', () => {
    test('complete -> done', () => {
        expect(decide(snap('complete')).kind).toBe('done');
    });
    test('unknown -> wait (journal not loaded)', () => {
        expect(decide(snap('unknown')).kind).toBe('wait');
    });
    test('notStarted -> talk Almera', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Almera');
    });
});

describe('waterfall decide — held-item phase dispatch', () => {
    test('row 2: inProgress, empty-handed -> book leg', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'custom' && s.name).toBe('book');
    });
    test('row 3: book held, no pebble -> pebble leg', () => {
        const s = decide(snap('inProgress', [[BOOK, 1]]));
        expect(s.kind === 'custom' && s.name).toBe('pebble');
    });
    test('row 4: pebble held (book kept), no urn -> tomb leg', () => {
        const s = decide(snap('inProgress', [[BOOK, 1], [PEBBLE, 1]]));
        expect(s.kind === 'custom' && s.name).toBe('tomb');
    });
    test('row 4 mid-tomb: pebble + amulet (chest looted), no urn -> still tomb leg', () => {
        const s = decide(snap('inProgress', [[PEBBLE, 1], [AMULET, 1]]));
        expect(s.kind === 'custom' && s.name).toBe('tomb');
    });
    test('rows 5-7: amulet + urn (tomb done) -> falls + dungeon', () => {
        const s = decide(snap('inProgress', [[PEBBLE, 1], [AMULET, 1], [URN, 1]]));
        expect(s.kind === 'custom' && s.name).toBe('falls + dungeon');
    });
    test('rows 5-7: amulet WORN + urn -> falls + dungeon (worn amulet counts)', () => {
        const s = decide(snap('inProgress', [[PEBBLE, 1], [URN, 1]], [AMULET]));
        expect(s.kind === 'custom' && s.name).toBe('falls + dungeon');
    });
    test('row 8: urn WITHOUT amulet (statue consumed it) -> amulet re-obtain dispatcher', () => {
        const s = decide(snap('inProgress', [[PEBBLE, 1], [URN, 1]]));
        expect(s.kind === 'custom' && s.name).toBe('amulet re-obtain');
    });
});
