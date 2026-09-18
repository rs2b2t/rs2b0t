/**
 * Gather camp membership / hunt policy (Fisher / Miner / Woodcutter).
 * Location tables stay in GatheringLocations; these helpers are pure disk math.
 */
import {
    AUTO_LEGACY,
    DEFAULT_CAMP_RADIUS,
    USE_CLOSEST,
    USE_CUSTOM_POSITION,
    USE_START_POSITION
} from '../../data/gatheringLocations.js';

/** Floor for non-freeform location modes (named camps + Bank=false power), camp membership. */
export const NAMED_CAMP_LEASH_FLOOR = DEFAULT_CAMP_RADIUS;

/** @deprecated Prefer {@link NAMED_CAMP_LEASH_FLOOR}, same value, kept for imports. */
export const START_TILE_LEASH_FLOOR = NAMED_CAMP_LEASH_FLOOR;

// Why: freeform (Use Closest / Use Start Position / Use Custom Position) respects the setting, for freeform and unverified chunk snaps.
// Why: a named camp or Bank=false power gets at least {@link NAMED_CAMP_LEASH_FLOOR}, which is camp membership.

/** Effective gather leash from the UI value and the location mode. */
export function effectiveGatherLeash(settingLeash: number, locationSetting: string): number {
    const raw = Math.max(2, Math.floor(Number.isFinite(settingLeash) ? settingLeash : 10));
    if (isAutoLocation(locationSetting)) {
        return raw;
    }
    return Math.max(NAMED_CAMP_LEASH_FLOOR, raw);
}

/** True when Location is Auto / Use Start Position / Use Custom Position, expert freeform; no mob-flee babysitting. */
export function isAutoLocation(locationSetting: string): boolean {
    const n = locationSetting.trim().toLowerCase();
    return n === 'auto' || n === AUTO_LEGACY.toLowerCase() || n === USE_START_POSITION.toLowerCase() || n === USE_CUSTOM_POSITION.toLowerCase() || n === USE_CLOSEST.toLowerCase();
}

/** True when Location is Use Custom Position. */
export function isCustomLocation(locationSetting: string): boolean {
    return locationSetting.trim().toLowerCase() === USE_CUSTOM_POSITION.toLowerCase();
}

// Why: a named camp measures from the player, so pier and river hops beside the bot stay valid even far from the home pin, the resource fence is camp membership.
// Why: freeform fish uses the same player origin.
// Why: with no player tile it falls back to the anchor or home.

/** Origin for fishing-spot distance checks. */
export function gatherSpotRangeOrigin(
    freeformFish: boolean,
    hasPlayerTile: boolean,
    namedCamp = false
): 'player' | 'anchor' {
    if (!hasPlayerTile) {
        return 'anchor';
    }
    if (namedCamp || freeformFish) {
        return 'player';
    }
    return 'anchor';
}

/** Spot is inside the gather/hunt disk measured from {@link gatherSpotRangeOrigin}. */
export function spotWithinGatherRange(distFromOrigin: number, maxDist: number): boolean {
    return Number.isFinite(distFromOrigin) && distFromOrigin <= maxDist;
}

/**
 * Resource still belongs to the named camp (Chebyshev from home pin).
 * Freeform has no camp fence, callers skip this check.
 */
export function resourceWithinCamp(distFromHome: number, campRadius: number): boolean {
    const R = Math.max(2, Math.floor(Number.isFinite(campRadius) ? campRadius : NAMED_CAMP_LEASH_FLOOR));
    return Number.isFinite(distFromHome) && distFromHome <= R;
}

/**
 * Freeform hunt radius past the UI/start leash.
 * Named camps do not use this, they accept any spot in camp membership.
 */
export function gatherHuntRadius(primaryDisk: number): number {
    const L = Math.max(2, Math.floor(Number.isFinite(primaryDisk) ? primaryDisk : 10));
    return Math.max(L + 24, 48);
}

export interface CampPoint {
    readonly x: number;
    readonly z: number;
    readonly level: number;
}

export function spotAvoided(spot: CampPoint, avoid: readonly CampPoint[]): boolean {
    return avoid.some(tile => tile.x === spot.x && tile.z === spot.z && tile.level === spot.level);
}

export function sweepStopFor(
    sweep: readonly CampPoint[],
    index: number,
    here: CampPoint | null
): { readonly stop: CampPoint | null; readonly index: number } {
    if (sweep.length === 0) return { stop: null, index: 0 };
    const at = ((index % sweep.length) + sweep.length) % sweep.length;
    const stop = sweep[at];
    if (here !== null && here.level === stop.level && Math.max(Math.abs(here.x - stop.x), Math.abs(here.z - stop.z)) <= 1) {
        const next = (at + 1) % sweep.length;
        return { stop: sweep[next], index: next };
    }
    return { stop, index: at };
}
