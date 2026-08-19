import { describe, expect, test } from 'bun:test';

import { MUD_CAGE, MUD_CELL, doorAcross, doorStands, mudCellDoor } from '#/bot/api/ai/quests/defs/upass/doors.js';
import Tile from '#/bot/geometry/Tile.js';

// Why: the slave cages are ten identical locked railings on one corridor. `~open_and_close_door2` moves the player across the door's own edge and picks the direction on one test — `~check_axis_locactive` is true when the player shares the door's coordinate on the wall's axis — so the door's own tile is the tile to stand on, and a perpendicular neighbour opens nothing and teleports the player back onto that tile. Live: a leg picked the same two cages back and forth along the corridor for a minute, then let itself into a north cell and sat there while every other cage answered "I can't reach that!".

describe('a railing door', () => {
    test('names the tile its edge runs against, south for the z 9655 row', () => {
        expect(doorAcross(new Tile(2381, 9655, 0))).toEqual(new Tile(2381, 9654, 0));
        expect(doorAcross(new Tile(2393, 9655, 0))).toEqual(new Tile(2393, 9654, 0));
    });

    test('and north for the z 9656 row', () => {
        expect(doorAcross(new Tile(2381, 9656, 0))).toEqual(new Tile(2381, 9657, 0));
        expect(doorAcross(new Tile(2393, 9656, 0))).toEqual(new Tile(2393, 9657, 0));
    });

    test('runs east-west where the map angles it that way', () => {
        expect(doorAcross(new Tile(2380, 9619, 0))).toEqual(new Tile(2381, 9619, 0));
        expect(doorAcross(new Tile(2404, 9620, 0))).toEqual(new Tile(2403, 9620, 0));
    });

    test('offers its own tile first and the tile across it second, and nothing else', () => {
        expect(doorStands(new Tile(2393, 9655, 0)))
            .toEqual([new Tile(2393, 9655, 0), new Tile(2393, 9654, 0)]);
    });

    test('offers nothing for a tile that carries no door, so the ring search keeps it', () => {
        expect(doorAcross(new Tile(2393, 9650, 0))).toBeNull();
        expect(doorStands(new Tile(2393, 9650, 0))).toEqual([]);
    });
});

describe('the cage that leads to the mud', () => {
    test('is the south door at (2393,9655)', () => {
        expect(MUD_CAGE).toEqual(new Tile(2393, 9655, 0));
        expect(doorAcross(MUD_CAGE)).toEqual(new Tile(2393, 9654, 0));
    });

    test('carries the mud cell as its landing', () => {
        expect(mudCellDoor(MUD_CAGE)).toEqual([MUD_CELL]);
    });

    test('and the north door above it does not — it opens on a dead end', () => {
        expect(mudCellDoor(new Tile(2393, 9656, 0))).toEqual([]);
    });

    test('nor does any other cage in the row', () => {
        for (const x of [2381, 2384, 2387, 2390]) {
            expect(mudCellDoor(new Tile(x, 9655, 0))).toEqual([]);
        }
    });
});
