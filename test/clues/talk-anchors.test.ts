import { expect, test } from 'bun:test';

import { TALK_ANCHORS } from '#/bot/clues/ClueExecutor.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';

// Drift guard: TALK_ANCHORS (hand-maintained in ClueExecutor, keyed by clue obj
// id) must cover every talk clue in the generated CLUE_DB. A future cluedb regen
// that adds or renumbers a talk clue would otherwise silently abandon it at
// runtime (blockReason bails on a missing anchor). Pure — no client needed.
const talkRows = Object.values(CLUE_DB).filter(row => row.type === 'talk');

test('CLUE_DB has talk clues (guards against a vacuous pass)', () => {
    expect(talkRows.length).toBeGreaterThan(0);
});

test('every talk clue in CLUE_DB has a TALK_ANCHORS entry', () => {
    const missing = talkRows.filter(row => TALK_ANCHORS[row.id] === undefined).map(row => `${row.id} (${row.obj}, npc '${row.npc ?? '?'}')`);
    expect(missing).toEqual([]);
});
