import Tile from '../api/Tile.js';

/**
 * Pure data for AutoFighter — no client imports (plain `bun test`).
 * Spots are guard spawn clusters measured from maps/*.jm2 (npc ids 9/10
 * generic Guard, 32 ardougne_guard; see the 2026-07-20 design doc). Anchor
 * tiles are pack-walkable stands near each cluster centroid (offline-probed
 * against collision.lcnav.gz + nearest-bank pathability); leash covers the
 * cluster spread.
 */
export const TARGET_OPTIONS = ['Guard'];

export const SPOTS: Record<string, { tile: Tile; leash: number }> = {
    'Varrock East gate': { tile: new Tile(3273, 3427, 0), leash: 8 },
    'Varrock West gate': { tile: new Tile(3174, 3426, 0), leash: 8 },
    'Varrock Palace': { tile: new Tile(3212, 3462, 0), leash: 10 },
    'Varrock south entrance': { tile: new Tile(3209, 3379, 0), leash: 8 },
    'Ardougne market': { tile: new Tile(2661, 3306, 0), leash: 12 },
    'Ardougne north gate': { tile: new Tile(2636, 3339, 0), leash: 8 },
    'Falador east gate': { tile: new Tile(2951, 3380, 0), leash: 8 },
    'Falador park': { tile: new Tile(2965, 3390, 0), leash: 12 },
    'Port Sarim jail': { tile: new Tile(3006, 3322, 0), leash: 8 },
    'Edgeville south road': { tile: new Tile(3104, 3515, 0), leash: 14 }
};
export const SPOT_OPTIONS = Object.keys(SPOTS);

/** Gems + clues, nothing else (user spec 2026-07-20). Contains-matched,
 *  case-insensitive. Engine names verified: both key halves display as
 *  'Half of a key', so one entry covers the pair. */
export const DEFAULT_LOOT = [
    'clue scroll',
    'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
    'half of a key',
    'chaos talisman', 'nature talisman'
];
