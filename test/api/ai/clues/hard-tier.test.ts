import { describe, expect, test } from 'bun:test';

import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { CLUE_GATES } from '#/bot/api/ai/clues/data/clueGates.js';
import { PUZZLE_PIECE_SLOT } from '#/bot/api/ai/clues/data/puzzlePieces.js';
import { PUZZLE_BLANK_SLOT } from '#/bot/api/ai/clues/puzzleLogic.js';

const rows = Object.values(CLUE_DB);
const hard = rows.filter(row => row.obj.includes('_hard_'));

const GUARDIANS = ['Saradomin Wizard', 'Zamorak Wizard'];

describe('hard tier in CLUE_DB', () => {
    test('all 64 hard clues from trail_hard.enum are present', () => {
        expect(hard.length).toBe(64);
        expect(rows.length).toBe(186);
    });

    test('the tiers share one table without colliding on an obj id', () => {
        expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    });

    // A trail_casket param alone does not make a dig: riddle004 carries one but
    // has no coord and is answered by talking to Gerrant.
    test('every dig has a coord and every talk has an npc', () => {
        expect(rows.filter(r => r.type === 'dig' && !r.coord)).toEqual([]);
        expect(rows.filter(r => r.type === 'talk' && !r.npc)).toEqual([]);
        expect(CLUE_DB[2778]).toMatchObject({ type: 'talk', npc: 'Gerrant' });
    });
});

describe('dig guardians', () => {
    const guarded = hard.filter(row => row.guardian !== undefined);

    test('30 coordinate digs are guarded, by one of the two wizards', () => {
        expect(guarded.length).toBe(30);
        expect([...new Set(guarded.map(r => r.guardian))].sort()).toEqual(GUARDIANS);
    });

    test('a guardian only ever sits on a sextant dig', () => {
        expect(guarded.filter(r => r.type !== 'dig')).toEqual([]);
        expect(guarded.filter(r => r.needsSextant !== true)).toEqual([]);
    });

    test('no easy or medium clue picked up a guardian', () => {
        expect(rows.filter(r => r.guardian !== undefined && !r.obj.includes('_hard_'))).toEqual([]);
    });
});

describe('puzzle boxes', () => {
    const puzzles = hard.filter(row => row.puzzle !== undefined);

    test('9 talk clues hand over a puzzle box, each with a resolved obj id', () => {
        expect(puzzles.length).toBe(9);
        expect(puzzles.filter(r => r.type !== 'talk')).toEqual([]);
        expect(puzzles.filter(r => !Number.isInteger(r.puzzle!.id) || r.puzzle!.id <= 0)).toEqual([]);
    });

    test('the three piece sets cover every board slot exactly once', () => {
        const slots = Object.values(PUZZLE_PIECE_SLOT);
        expect(slots.length).toBe(72);
        for (let set = 0; set < 3; set++) {
            const ofSet = slots.slice(set * 24, set * 24 + 24).sort((a, b) => a - b);
            expect(ofSet).toEqual(Array.from({ length: PUZZLE_BLANK_SLOT }, (_, i) => i));
        }
    });
});

describe('gated clues', () => {
    test('every gate names a real clue and gives a reason', () => {
        for (const [idStr, reason] of Object.entries(CLUE_GATES)) {
            expect(CLUE_DB[Number(idStr)], `gate ${idStr} is not a clue`).toBeDefined();
            expect(reason.length).toBeGreaterThan(10);
        }
    });
});
