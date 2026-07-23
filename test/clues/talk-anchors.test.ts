import { expect, test } from 'bun:test';

import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';

const talkRows = Object.values(CLUE_DB).filter(row => row.type === 'talk');

test('CLUE_DB has talk clues (guards against a vacuous pass)', () => {
    expect(talkRows.length).toBeGreaterThan(0);
});

test('every talk clue in CLUE_DB has a TALK_ANCHORS entry', () => {
    const missing = talkRows.filter(row => TALK_ANCHORS[row.id] === undefined).map(row => `${row.id} (${row.obj}, npc '${row.npc ?? '?'}')`);
    expect(missing).toEqual([]);
});
