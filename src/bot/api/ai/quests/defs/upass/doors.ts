import Tile from '../../../../../geometry/Tile.js';

// Why: a railing is a WALL_STRAIGHT loc, and `~open_and_close_door2` moves the player across its own edge — never around it. Which way is one test: `~check_axis_locactive` is true when the player shares the door's coordinate on the wall's axis, and the script then teleports them to the tile across the edge; false, and it teleports them onto the door's own tile. So the two tiles a railing can be used from are its own tile and the tile across from it, and nothing else. The perpendicular neighbours a ring search offers set `entering` false from the corridor and drop the player back where the door already stands, which opens nothing and reads as a crossing that did not move anyone.
// Why: the pairs are the map's own angles run through `~door_open` — `^loc_west` 0 gives (-1,0), `^loc_north` 1 gives (0,1), `^loc_east` 2 gives (1,0), `^loc_south` 3 gives (0,-1) — and the collision pack agrees that each pair joins two pockets.

const key = (tile: { x: number; z: number; level: number }): string => `${tile.x},${tile.z},${tile.level}`;

const pair = (at: Tile, across: Tile): [string, Tile] => [key(at), across];

/** Each railing door's own tile, and the tile its edge runs against. */
const ACROSS: ReadonlyMap<string, Tile> = new Map([
    // The slave cages: a corridor at z 9655-9656 with five cells hung south of it and five north.
    pair(new Tile(2381, 9655, 0), new Tile(2381, 9654, 0)),
    pair(new Tile(2384, 9655, 0), new Tile(2384, 9654, 0)),
    pair(new Tile(2387, 9655, 0), new Tile(2387, 9654, 0)),
    pair(new Tile(2390, 9655, 0), new Tile(2390, 9654, 0)),
    pair(new Tile(2393, 9655, 0), new Tile(2393, 9654, 0)),
    pair(new Tile(2381, 9656, 0), new Tile(2381, 9657, 0)),
    pair(new Tile(2384, 9656, 0), new Tile(2384, 9657, 0)),
    pair(new Tile(2387, 9656, 0), new Tile(2387, 9657, 0)),
    pair(new Tile(2390, 9656, 0), new Tile(2390, 9657, 0)),
    pair(new Tile(2393, 9656, 0), new Tile(2393, 9657, 0)),
    // The two thieving-50 railings of the swamp band, both angled along x rather than z.
    pair(new Tile(2380, 9619, 0), new Tile(2381, 9619, 0)),
    pair(new Tile(2404, 9620, 0), new Tile(2403, 9620, 0))
]);

/** The tile a railing's edge runs against, or null where the loc is not one of them. */
export function doorAcross(at: Tile): Tile | null {
    return ACROSS.get(key(at)) ?? null;
}

/** The only tiles a railing may be operated from: its own tile to go through, the tile across it to come back. */
export function doorStands(at: Tile): readonly Tile[] {
    const across = doorAcross(at);
    return across === null ? [] : [at, across];
}

// Why: nine of the ten slave cages open onto a dead end of seven to fourteen tiles. The mud at (2393,9650) is the only way south out of the cages, it sits in the cell behind (2393,9655) alone, and by distance no search can tell that cage from its nine neighbours — one run picked four wrong cells in a row and then sat in one with every other cage answering "I can't reach that!".
/** The cage that leads to the mud, and the tile inside its cell the dig is worth walking to. */
export const MUD_CAGE = new Tile(2393, 9655, 0);
export const MUD_CELL = new Tile(2393, 9651, 0);

/** Where a cage lands the player, for the one cage whose cell is worth entering. */
export function mudCellDoor(at: Tile): readonly Tile[] {
    return at.x === MUD_CAGE.x && at.z === MUD_CAGE.z && at.level === MUD_CAGE.level ? [MUD_CELL] : [];
}
