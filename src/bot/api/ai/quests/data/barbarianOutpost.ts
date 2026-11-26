import Tile from '../../../../geometry/Tile.js';

export function barbarianOutpostPlankSpawns() {
    return [
        new Tile(2552, 3574, 0),
        new Tile(2553, 3575, 0),
        new Tile(2554, 3574, 0),
        new Tile(2556, 3573, 0)
    ] as const;
}
