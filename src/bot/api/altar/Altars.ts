import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Skills } from '../skills/Skills.js';
import Tile from '../../geometry/Tile.js';
import { EventSignal } from '../execution/EventSignal.js';
import { Navigator } from '../../event/webwalk/Navigator.js';

interface AltarLocation {
    name: string;
    tile: Tile;
/** Altar loc name; all use the Pray-at op. */
    loc: string;
    requires?: { skill: { name: string; level: number } };
}

/**
 * Altars that restore prayer points: the Pray-at locs near a bank. No chaos altars.
 * @see docs/reference/clues-mechanics.md#prayer-between-trails
 */
const ALTARS: AltarLocation[] = [
    { name: 'Varrock church', tile: new Tile(3253, 3486, 0), loc: 'Altar' },
    { name: 'Edgeville Monastery', tile: new Tile(3051, 3498, 1), loc: 'Altar', requires: { skill: { name: 'prayer', level: 31 } } },
    { name: 'Lumbridge church', tile: new Tile(3243, 3205, 0), loc: 'Altar' },
    { name: 'Port Sarim church', tile: new Tile(2991, 3177, 0), loc: 'Altar' },
    { name: 'Ardougne church', tile: new Tile(2617, 3309, 0), loc: 'Altar' },
    { name: 'West Ardougne church', tile: new Tile(2529, 3286, 0), loc: 'Altar' },
    { name: 'Seers church', tile: new Tile(2694, 3462, 0), loc: 'Altar' },
    { name: 'Yanille church', tile: new Tile(2604, 3208, 0), loc: 'Altar' },
    { name: 'Falador church', tile: new Tile(2925, 3483, 0), loc: 'Altar of Guthix' },
    { name: 'Duel Arena chapel', tile: new Tile(3376, 3285, 0), loc: 'Altar' },
    { name: 'Canifis temple', tile: new Tile(3416, 3488, 0), loc: 'Altar' }
];

export async function nearestAltar(from: WorldTile | Tile): Promise<AltarLocation | null> {
    const altars = ALTARS.filter(altar => {
        const need = altar.requires?.skill;
        return !need || Skills.level(need.name) >= need.level;
    });
    let best: AltarLocation | null = null;
    let bestCost = Infinity;
    for (const altar of altars.sort((a, b) => a.tile.distanceTo(from) - b.tile.distanceTo(from))) {
        if (EventSignal.pending()) return null;
        const path = await Navigator.findPath(from, altar.tile, {
            useTeleportCatalog: false,
            maxExpansions: 500_000,
            timeoutMs: 5_000
        }).catch(() => null);
        if (path?.ok && path.cost < bestCost) {
            best = altar;
            bestCost = path.cost;
        }
    }
    return best;
}
