import { describe, expect, test } from 'bun:test';

import { bySideThatLands, crossingLanding } from '#/bot/api/ai/quests/defs/upass/stand.js';
import Tile from '#/bot/geometry/Tile.js';

// Why: a seam moves the player a fixed step across itself, not the distance they walked up to it. Ranking a stand by its MIRROR about the loc scales with how far out the stand is, so a tile four out mirrors eight past the seam and outranks the cardinal neighbour that lands on the same square — and the op-click then spends three tiles walking in, which the crossing test reads as the crossing. Live: the rockslide at (2467,9723) was taken from (2471,9723), the approach walked to (2468,9723), and the leg called a successful climb "did not cross".

const ROCKSLIDE = new Tile(2467, 9723, 0);
const KOFTIK = new Tile(2449, 9716, 0);
const CAVE_EXIT = new Tile(2495, 9716, 0);

const sides = (at: Tile, dest: Tile, me: Tile | null, ...tiles: readonly Tile[]): string[] =>
    [...tiles].sort(bySideThatLands(at, dest, me)).map(t => `${t.x},${t.z}`);

describe('where a crossing from a stand lands', () => {
    test('is one tile past the seam, however far out the stand is', () => {
        expect(crossingLanding(ROCKSLIDE, new Tile(2468, 9723, 0))).toEqual(new Tile(2466, 9723, 0));
        expect(crossingLanding(ROCKSLIDE, new Tile(2471, 9723, 0))).toEqual(new Tile(2466, 9723, 0));
        expect(crossingLanding(ROCKSLIDE, new Tile(2466, 9723, 0))).toEqual(new Tile(2468, 9723, 0));
        expect(crossingLanding(ROCKSLIDE, new Tile(2467, 9720, 0))).toEqual(new Tile(2467, 9724, 0));
    });
});

describe('ranking the tiles a seam can be used from', () => {
    test('takes the side whose crossing lands toward the destination', () => {
        expect(sides(ROCKSLIDE, KOFTIK, CAVE_EXIT, new Tile(2466, 9723, 0), new Tile(2468, 9723, 0)))
            .toEqual(['2468,9723', '2466,9723']);
    });

    test('takes the cardinal neighbour over a tile four out that lands on the same square', () => {
        expect(sides(ROCKSLIDE, KOFTIK, CAVE_EXIT,
            new Tile(2471, 9723, 0), new Tile(2470, 9723, 0), new Tile(2469, 9723, 0), new Tile(2468, 9723, 0)))
            .toEqual(['2468,9723', '2469,9723', '2470,9723', '2471,9723']);
    });

    test('still prefers the side that lands forward over a nearer side that does not', () => {
        expect(sides(ROCKSLIDE, KOFTIK, CAVE_EXIT, new Tile(2466, 9723, 0), new Tile(2471, 9723, 0)))
            .toEqual(['2471,9723', '2466,9723']);
    });

    test('breaks a tie on how far the stand is from the character', () => {
        const at = new Tile(2380, 9619, 0);
        expect(sides(at, new Tile(2380, 9619, 0), new Tile(2384, 9619, 0),
            new Tile(2381, 9619, 0), new Tile(2380, 9620, 0)))
            .toEqual(['2381,9619', '2380,9620']);
    });
});
