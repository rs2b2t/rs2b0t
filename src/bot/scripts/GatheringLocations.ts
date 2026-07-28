import type { WorldTile } from '../adapter/ClientAdapter.js';
import { bankDistance } from '../api/BankLocations.js';
import Tile from '../api/Tile.js';

/**
 * Shared gather camp: leash anchor + bank stand for Fisher / Miner / Woodcutter.
 *
 * `verified` marks camps confirmed via live pathability + resource checks
 * (`bun tools/verify-gathering-locations.ts` + visual stand polish).
 */
export interface GatheringLocation {
    name: string;
    spot: Tile;
    bankStand: Tile;
    verified: boolean;
    boothName?: string;
    boothOp?: string;
    obstacles?: string[];
    /** CSV-ish resource tags for docs / verify helper (not used by Gather target pick). */
    resources?: readonly string[];
    notes?: string;
}

export const DEFAULT_BOOTH_NAME = 'Bank booth';
export const DEFAULT_BOOTH_OP = 'Use-quickly';

export function locationOptions(table: readonly GatheringLocation[]): string[] {
    return ['Auto', ...table.map(l => l.name), 'None'];
}

export function boothFields(loc: GatheringLocation | null | undefined): {
    boothName: string;
    boothOp: string;
} {
    return {
        boothName: loc?.boothName ?? DEFAULT_BOOTH_NAME,
        boothOp: loc?.boothOp ?? DEFAULT_BOOTH_OP
    };
}

/**
 * Resolve a location setting against a skill table.
 * - None → null (power / drop mode)
 * - named → case-insensitive match
 * - Auto → Euclidean-nearest spot (same metric as bankDistance); prefer same level
 */
export function resolveGatheringLocation<T extends GatheringLocation>(
    setting: string,
    startTile: WorldTile,
    table: readonly T[]
): T | null {
    const normalized = setting.trim().toLowerCase();
    if (normalized === 'none' || normalized === '') {
        return null;
    }
    if (normalized !== 'auto') {
        return table.find(l => l.name.toLowerCase() === normalized) ?? null;
    }
    if (table.length === 0) {
        return null;
    }

    const sameLevel = table.filter(l => l.spot.level === startTile.level);
    const pool = sameLevel.length > 0 ? sameLevel : table;
    let best = pool[0]!;
    let bestD = bankDistance(startTile, best.spot);
    for (let i = 1; i < pool.length; i++) {
        const loc = pool[i]!;
        const d = bankDistance(startTile, loc.spot);
        if (d < bestD) {
            best = loc;
            bestD = d;
        }
    }
    return best;
}
