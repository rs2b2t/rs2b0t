import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from './Tile.js';

export interface BankLocation {
    name: string;
    tile: Tile;
}

/**
 * Known bank centres (level 0), world coords, derived from the content's
 * `bank_zones.dbrow` (skill_firemaking) — midpoint of each named zone. Used to
 * web-walk to the NEAREST bank when a gathering bot fills up and no booth is
 * loaded in the current scene (the resource is more than a screen from a bank).
 * A centre may be a solid booth tile; callers walk to within a couple tiles and
 * then open the nearest booth from there.
 */
export const BANK_LOCATIONS: BankLocation[] = [
    { name: 'Varrock East', tile: new Tile(3253, 3420, 0) },
    { name: 'Varrock West', tile: new Tile(3185, 3440, 0) },
    { name: 'Al Kharid', tile: new Tile(3269, 3167, 0) },
    { name: 'Draynor', tile: new Tile(3093, 3243, 0) },
    { name: 'Falador East', tile: new Tile(3013, 3355, 0) },
    { name: 'Falador West', tile: new Tile(2946, 3369, 0) },
    { name: 'Edgeville', tile: new Tile(3094, 3493, 0) },
    { name: 'Seers', tile: new Tile(2725, 3491, 0) },
    { name: 'Catherby', tile: new Tile(2809, 3441, 0) },
    { name: 'Yanille', tile: new Tile(2612, 3092, 0) },
    { name: 'Ardougne West', tile: new Tile(2616, 3332, 0) },
    { name: 'Ardougne East', tile: new Tile(2655, 3283, 0) },
    { name: 'Shilo Village', tile: new Tile(2852, 2954, 0) },
    { name: 'Fishing Guild', tile: new Tile(2586, 3420, 0) },
    { name: 'Shantay Pass', tile: new Tile(3309, 3120, 0) },
    { name: 'Duel Arena', tile: new Tile(3382, 3269, 0) }
];

/** Nearest known bank to a tile on the same level, by Chebyshev distance. */
export function nearestBank(from: WorldTile): BankLocation | null {
    let best: BankLocation | null = null;
    let bestD = Infinity;
    for (const bank of BANK_LOCATIONS) {
        if (bank.tile.level !== from.level) {
            continue;
        }
        const d = Math.max(Math.abs(bank.tile.x - from.x), Math.abs(bank.tile.z - from.z));
        if (d < bestD) {
            bestD = d;
            best = bank;
        }
    }
    return best;
}
