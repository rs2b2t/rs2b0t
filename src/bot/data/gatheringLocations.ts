import type { WorldTile } from '../adapter/ClientAdapter.js';
import { bankDistance } from '../geometry/distance.js';
import Tile from '../geometry/Tile.js';

/**
 * Shared gather camp: home pin + bank stand for Fisher / Miner / Woodcutter. Membership (ReturnToAnchor / soft wander bound) uses {@link campRadius}, while fishing hop chase inside camp uses {@link chaseRadius} measured from the player.
 * `verified` marks camps confirmed via live pathability and resource checks (`bun e2e/verify-gathering-locations.ts` plus visual stand polish).
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
    /**
     * Camp membership radius from {@link spot} (Chebyshev).
     * Player outside this disk → ReturnToAnchor. Defaults to 64 when omitted.
     */
    campRadius?: number;
    /**
     * Player-relative fishing-spot / hop disk while in camp.
     * Defaults to 24 when omitted. Loc gather (rocks/trees) still uses campRadius from home.
     */
    chaseRadius?: number;
    /** CSV-ish resource tags for docs / verify helper (not used by Gather target pick). */
    resources?: readonly string[];
    notes?: string;
}

export const DEFAULT_BOOTH_NAME = 'Bank booth';
export const DEFAULT_BOOTH_OP = 'Use-quickly';

/** Default camp membership when a named location omits {@link GatheringLocation.campRadius}. */
export const DEFAULT_CAMP_RADIUS = 64;

/**
 * Soft prefer-near-player radius for named camps, not a hard exclusion.
 * Any matching spot inside camp membership stays valid; this only ranks nearby hops first when both exist.
 */
export const DEFAULT_CHASE_RADIUS = 40;

export function resolveCampRadius(campRadius: number | null | undefined, fallback = DEFAULT_CAMP_RADIUS): number {
    const raw = campRadius != null && Number.isFinite(campRadius) ? campRadius : fallback;
    return Math.max(2, Math.floor(raw));
}

export function resolveChaseRadius(chaseRadius: number | null | undefined, fallback = DEFAULT_CHASE_RADIUS): number {
    const raw = chaseRadius != null && Number.isFinite(chaseRadius) ? chaseRadius : fallback;
    return Math.max(2, Math.floor(raw));
}

/**
 * Engine map-square edge length.
 * Auto snaps to a preset only when the start tile shares this 64×64 chunk with the camp spot; otherwise freeform (location null, nearest bank, start-tile leash).
 */
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

export const USE_CLOSEST = 'Use Closest';
export const USE_START_POSITION = 'Use Start Position';
export const USE_CUSTOM_POSITION = 'Use Custom Position';
/** Legacy alias, kept for saves that stored 'Auto'. */
export const AUTO_LEGACY = 'Auto';

export function locationOptions(table: readonly GatheringLocation[]): string[] {
    return [USE_CLOSEST, USE_START_POSITION, USE_CUSTOM_POSITION, ...table.map(l => l.name)];
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

/** Resolve location setting: Use Closest = nearest by distance, Start/Custom = freeform null, named = case-insensitive. */
export function resolveGatheringLocation<T extends GatheringLocation>(
    setting: string,
    startTile: WorldTile,
    table: readonly T[]
): T | null {
    const normalized = setting.trim().toLowerCase();
    if (normalized === USE_CUSTOM_POSITION.toLowerCase()) {
        return null;
    }
    if (normalized === USE_START_POSITION.toLowerCase()) {
        return null;
    }
    if (normalized === USE_CLOSEST.toLowerCase() || normalized === 'auto' || normalized === AUTO_LEGACY.toLowerCase()) {
        if (table.length === 0) {
            return null;
        }
        // Use Closest: pick nearest preset by distance to spot, no map-square restriction.
        let best = table[0]!;
        let bestD = bankDistance(startTile, best.spot);
        for (let i = 1; i < table.length; i++) {
            const loc = table[i]!;
            const d = bankDistance(startTile, loc.spot);
            if (d < bestD) {
                best = loc;
                bestD = d;
            }
        }
        return best;
    }
    return table.find(l => l.name.toLowerCase() === normalized) ?? null;
}
