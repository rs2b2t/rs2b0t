import Tile from '../api/Tile.js';

export const ROCKS_SPAWNS: readonly Tile[] = [
    new Tile(2694, 3724, 0),
    new Tile(2700, 3718, 0),
    new Tile(2701, 3728, 0),
    new Tile(2702, 3720, 0),
    new Tile(2703, 3716, 0),
    new Tile(2704, 3727, 0),
    new Tile(2705, 3725, 0),
    new Tile(2708, 3719, 0),
    new Tile(2711, 3715, 0),
    new Tile(2712, 3719, 0),
    new Tile(2712, 3725, 0),
    new Tile(2715, 3729, 0),
    new Tile(2716, 3721, 0),
    new Tile(2719, 3719, 0)
];

export const DEFAULT_SPOTS: readonly Tile[] = [
    new Tile(2704, 3726, 0),
    new Tile(2701, 3719, 0),
    new Tile(2717, 3720, 0),
    new Tile(2710, 3717, 0),
    new Tile(2713, 3727, 0)
];

export function spawnsWithin(spot: Tile, ring: number, spawns: readonly Tile[] = ROCKS_SPAWNS): number {
    return spawns.filter(s => s.distanceTo(spot) <= ring).length;
}
