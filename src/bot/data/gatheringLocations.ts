import type { WorldTile } from '../adapter/ClientAdapter.js';
import { bankDistance } from '../geometry/distance.js';
import Tile from '../geometry/Tile.js';

/**
 * Shared Fisher, Miner, and Woodcutter camp with home and bank stands.
 * `campRadius` bounds wandering; `chaseRadius` bounds fishing-spot hops; `verified` marks live-checked camps.
 */
export interface GatheringLocation {
    name: string;
    /** Home pin, bank return / soft arrive disk centre. */
    spot: Tile;
    bankStand: Tile;
    verified: boolean;
    boothName?: string;
    boothOp?: string;
    obstacles?: string[];
    /** Camp membership radius from {@link spot} (Chebyshev); outside it ReturnToAnchor fires. Defaults to 64. */
    campRadius?: number;
    /** Player-relative fishing-spot hop disk while in camp, default {@link DEFAULT_CHASE_RADIUS}; loc gather (rocks/trees) still uses campRadius from home. */
    chaseRadius?: number;
    /** CSV-ish resource tags for docs / verify helper (not used by Gather target pick). */
    resources?: readonly string[];
    readonly avoidSpots?: readonly Tile[];
    readonly sweep?: readonly Tile[];
    readonly baitVendor?: BaitVendor;
    notes?: string;
}

export interface BaitVendor {
    readonly keeper: string;
    readonly stand: Tile;
    readonly price: number;
    readonly item: string;
}

export const DEFAULT_BOOTH_NAME = 'Bank booth';
export const DEFAULT_BOOTH_OP = 'Use-quickly';

/** Default camp membership when a named location omits {@link GatheringLocation.campRadius}. */
export const DEFAULT_CAMP_RADIUS = 64;

/** Soft prefer-near-player radius for named camps; any matching spot inside camp membership stays valid and this only ranks nearby hops first. */
export const DEFAULT_CHASE_RADIUS = 40;

export function resolveCampRadius(campRadius: number | null | undefined, fallback = DEFAULT_CAMP_RADIUS): number {
    const raw = campRadius != null && Number.isFinite(campRadius) ? campRadius : fallback;
    return Math.max(2, Math.floor(raw));
}

export function resolveChaseRadius(chaseRadius: number | null | undefined, fallback = DEFAULT_CHASE_RADIUS): number {
    const raw = chaseRadius != null && Number.isFinite(chaseRadius) ? chaseRadius : fallback;
    return Math.max(2, Math.floor(raw));
}

/** Engine map-square edge length. Auto snaps to a preset only when the start tile shares this 64x64 chunk with the camp spot; otherwise freeform (location null, nearest bank, start-tile leash). */
export const MAP_SQUARE = 64;

/** True when both tiles sit in the same level + map square (chunk). */
export function sameMapSquare(a: WorldTile, b: WorldTile): boolean {
    if (a.level !== b.level) {
        return false;
    }
    return (
        Math.floor(a.x / MAP_SQUARE) === Math.floor(b.x / MAP_SQUARE)
        && Math.floor(a.z / MAP_SQUARE) === Math.floor(b.z / MAP_SQUARE)
    );
}

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

/** Resolve a location name, or select the nearest preset in the start tile's map square for Auto. None and freeform Auto return null. */
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

    // Auto freeform: only snap when standing in a preset's map square.
    const inChunk = table.filter(l => sameMapSquare(startTile, l.spot));
    if (inChunk.length === 0) {
        return null;
    }

    const sameLevel = inChunk.filter(l => l.spot.level === startTile.level);
    const pool = sameLevel.length > 0 ? sameLevel : inChunk;
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
