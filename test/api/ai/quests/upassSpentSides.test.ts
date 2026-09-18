import { describe, expect, test } from 'bun:test';

import { type Stand, spendFrom, spentHere, spentStateHere } from '#/bot/api/ai/quests/defs/upass/spent.js';
import Tile from '#/bot/geometry/Tile.js';

// Why: spending both sides of a cage seals the destination pocket; only the origin side is spent.

const CAGE = 'cage@2384,9655';
const WELL_SIDE = new Tile(2385, 9655, 0);
const CELL_SIDE = new Tile(2384, 9657, 0);

/** Stands reachable from the current pocket. */
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
        // Why: a cage may join a third pocket that remains unused.
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

    // Why: distinguish fresh, item-use, and return sides because they rank differently.
    test('reads as fresh, used from here, or used from the far side', () => {
        const sides: Map<string, Stand[]> = new Map();
        expect(spentStateHere(sides, CAGE, pocket(WELL_SIDE))).toBe('fresh');

        spendFrom(sides, CAGE, WELL_SIDE);
        expect(spentStateHere(sides, CAGE, pocket(WELL_SIDE))).toBe('here');
        expect(spentStateHere(sides, CAGE, pocket(CELL_SIDE))).toBe('elsewhere');
    });
});
