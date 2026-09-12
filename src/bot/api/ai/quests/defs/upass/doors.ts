import Tile from '../../../../../geometry/Tile.js';

// Why: `~open_and_close_door2` crosses a WALL_STRAIGHT edge only from the railing tile or the tile opposite it.
// Why: the pairs are the map's angles run through `~door_open`: `^loc_west` 0 gives (-1,0), `^loc_north` 1 gives (0,1), `^loc_east` 2 gives (1,0), `^loc_south` 3 gives (0,-1). The collision pack agrees each pair joins 2 pockets.

const key = (tile: { x: number; z: number; level: number }): string => `${tile.x},${tile.z},${tile.level}`;

const pair = (at: Tile, across: Tile): [string, Tile] => [key(at), across];

/** Each railing door's own tile, and the tile its edge runs against. */
const ACROSS: ReadonlyMap<string, Tile> = new Map([
    // The slave cages: a corridor at z 9655-9656 with 5 cells south of it and 5 north.
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
    // The 2 thieving-50 railings of the swamp band, both angled along x.
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

// Why: 9 of the 10 slave cages open onto a 7 to 14 tile dead end. The mud at (2393,9650) is the only way south and sits in the cell behind (2393,9655) alone, and by distance no search can tell that cage from its 9 neighbours.
/** The cage that leads to the mud, and the tile inside its cell the dig is worth walking to. */
export const MUD_CAGE = new Tile(2393, 9655, 0);
export const MUD_CELL = new Tile(2393, 9651, 0);

/** Where a cage lands you, for the one cage whose cell is worth entering. */
export function mudCellDoor(at: Tile): readonly Tile[] {
    return at.x === MUD_CAGE.x && at.z === MUD_CAGE.z && at.level === MUD_CAGE.level ? [MUD_CELL] : [];
}
