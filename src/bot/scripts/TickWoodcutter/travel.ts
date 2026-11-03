import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { BANK_LOCATIONS } from '../../api/bank/BankLocations.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { resolveWoodcuttingLocation } from '../../data/woodcuttingLocations.js';

export interface TravelPlan {
    anchor: Tile;
    bankStand: Tile | null;
    campRadius: number;
}

export function nearestBank(from: Tile): Tile | null {
    let best: { tile: Tile; distance: number } | null = null;
    for (const bank of BANK_LOCATIONS) {
        const distance = from.distanceTo(bank.tile);
        if (!best || distance < best.distance) {
            best = { tile: bank.tile, distance };
        }
    }
    return best?.tile ?? null;
}

export function resolveTravel(
    locationSetting: string,
    start: Tile,
    custom: Tile
): TravelPlan {
    const here: WorldTile = { x: start.x, z: start.z, level: start.level };
    const loc = resolveWoodcuttingLocation(locationSetting, here);
    if (loc) {
        return {
            anchor: loc.spot,
            bankStand: loc.bankStand,
            campRadius: loc.campRadius ?? 64
        };
    }
    if (locationSetting.trim().toLowerCase() === 'use custom position') {
        const anchor = new Tile(custom.x, custom.z, custom.level);
        return { anchor, bankStand: nearestBank(anchor), campRadius: 64 };
    }
    return { anchor: start, bankStand: nearestBank(start), campRadius: 64 };
}

export function awayFromAnchor(anchor: Tile, radius: number): boolean {
    const here = Game.tile();
    return !here || Tile.from(here).distanceTo(anchor) > radius;
}
