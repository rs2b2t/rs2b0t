import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Skills } from './hud/Skills.js';
import Tile from './Tile.js';

export interface AltarLocation {
    name: string;
    tile: Tile;
    /** Loc name to interact with; every altar answers to Pray-at. */
    loc: string;
    requires?: { skill: { name: string; level: number } };
}

/**
 * Altars that restore prayer points, picked from the Pray-at locs in the map
 * data for being close to a bank. Chaos altars are deliberately absent.
 * @see docs/CLUES.md#prayer-between-trails
 */
export const ALTARS: AltarLocation[] = [
    { name: 'Varrock church', tile: new Tile(3253, 3486, 0), loc: 'Altar' },
    { name: 'Edgeville Monastery', tile: new Tile(3051, 3498, 1), loc: 'Altar', requires: { skill: { name: 'prayer', level: 31 } } },
    { name: 'Al Kharid church', tile: new Tile(3243, 3205, 0), loc: 'Altar' },
    { name: 'Port Sarim church', tile: new Tile(2991, 3177, 0), loc: 'Altar' },
    { name: 'Ardougne church', tile: new Tile(2617, 3309, 0), loc: 'Altar' },
    { name: 'West Ardougne church', tile: new Tile(2529, 3286, 0), loc: 'Altar' },
    { name: 'Seers church', tile: new Tile(2694, 3462, 0), loc: 'Altar' },
    { name: 'Yanille church', tile: new Tile(2604, 3208, 0), loc: 'Altar' },
    { name: 'Falador church', tile: new Tile(2925, 3483, 0), loc: 'Altar of Guthix' },
    { name: 'Duel Arena chapel', tile: new Tile(3376, 3285, 0), loc: 'Altar' },
    { name: 'Canifis temple', tile: new Tile(3416, 3488, 0), loc: 'Altar' }
];

// A staircase is walkable but costs more than the tile count suggests, so an
// upstairs altar only wins when it is clearly closer.
const LEVEL_CHANGE_PENALTY = 30;

function usable(altar: AltarLocation): boolean {
    const need = altar.requires?.skill;
    return !need || Skills.level(need.name) >= need.level;
}

function altarDistance(from: WorldTile | Tile, altar: AltarLocation): number {
    const flat = Math.max(Math.abs(altar.tile.x - from.x), Math.abs(altar.tile.z - from.z));
    return flat + (altar.tile.level === from.level ? 0 : LEVEL_CHANGE_PENALTY);
}

/** The nearest altar this account can actually use. */
export function nearestAltar(from: WorldTile | Tile): AltarLocation | null {
    let best: { altar: AltarLocation; dist: number } | null = null;
    for (const altar of ALTARS) {
        if (!usable(altar)) {
            continue;
        }
        const dist = altarDistance(from, altar);
        if (best === null || dist < best.dist) {
            best = { altar, dist };
        }
    }
    return best?.altar ?? null;
}
