import { describe, expect, test } from 'bun:test';

import { type Stand, spendFrom, spentHere, spentStateHere } from '#/bot/api/ai/quests/defs/upass/spent.js';
import Tile from '#/bot/geometry/Tile.js';

// Why: the slave cage that lets a character into a cell is the only thing that lets them out again, so a seam spent outright seals the pocket it was crossed into. What a crossing spends is the seam FROM THE SIDE it was crossed from, and the side a stand tile is on is a question the loaded scene can answer: reachable means the same pocket. Live: a run sat in the fourteen-tile cell at (2385,9661) for an hour with its own door filtered out of every search.

const CAGE = 'cage@2384,9655';
const WELL_SIDE = new Tile(2385, 9655, 0);
const CELL_SIDE = new Tile(2384, 9657, 0);

/** Stands the character can walk to from where they are — one pocket per call. */
function pocket(...tiles: readonly Stand[]): (t: Stand) => boolean {
    return t => tiles.some(p => p.x === t.x && p.z === t.z && p.level === t.level);
}

describe('a seam spent from one side', () => {
    test('is still open from the other side, so a cul-de-sac can be backed out of', () => {
        const sides: Map<string, Stand[]> = new Map();
        spendFrom(sides, CAGE, WELL_SIDE);

        expect(spentHere(sides, CAGE, pocket(WELL_SIDE))).toBe(true);
        expect(spentHere(sides, CAGE, pocket(CELL_SIDE))).toBe(false);
    });

    test('closes behind a character who has backed out, so the dead end is not re-entered', () => {
        const sides: Map<string, Stand[]> = new Map();
        spendFrom(sides, CAGE, WELL_SIDE);
        spendFrom(sides, CAGE, CELL_SIDE);

        expect(spentHere(sides, CAGE, pocket(WELL_SIDE))).toBe(true);
        expect(spentHere(sides, CAGE, pocket(CELL_SIDE))).toBe(true);
        // Why: a cage joins three pockets, and the third has been in neither list — it keeps its turn.
        expect(spentHere(sides, CAGE, pocket(new Tile(2384, 9654, 0)))).toBe(false);
    });

    test('records a side once, however many times it is tried from there', () => {
        const sides: Map<string, Stand[]> = new Map();
        spendFrom(sides, CAGE, WELL_SIDE);
        spendFrom(sides, CAGE, WELL_SIDE);

        expect(sides.get(CAGE)).toHaveLength(1);
    });

    test('leaves a seam nobody has crossed alone', () => {
        expect(spentHere(new Map<string, Stand[]>(), CAGE, pocket(WELL_SIDE))).toBe(false);
    });

    // Why: the search offers a fresh seam first, an item-use next and the way back last, so the three states
    // have to be told apart rather than collapsed into used-or-not.
    test('reads as fresh, used from here, or used from the far side', () => {
        const sides: Map<string, Stand[]> = new Map();
        expect(spentStateHere(sides, CAGE, pocket(WELL_SIDE))).toBe('fresh');

        spendFrom(sides, CAGE, WELL_SIDE);
        expect(spentStateHere(sides, CAGE, pocket(WELL_SIDE))).toBe('here');
        expect(spentStateHere(sides, CAGE, pocket(CELL_SIDE))).toBe('elsewhere');
    });
});
