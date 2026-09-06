/**
 * Gather camp membership / hunt policy (Fisher / Miner / Woodcutter).
 * Location tables stay in GatheringLocations; these helpers are pure disk math.
 */
import { DEFAULT_CAMP_RADIUS } from '../../data/gatheringLocations.js';

/** Floor for non-Auto location modes (named camps + power None), camp membership. */
export const NAMED_CAMP_LEASH_FLOOR = DEFAULT_CAMP_RADIUS;

/** @deprecated Prefer {@link NAMED_CAMP_LEASH_FLOOR}, same value, kept for imports. */
export const START_TILE_LEASH_FLOOR = NAMED_CAMP_LEASH_FLOOR;

// Why: Auto respects the setting, for freeform and unverified chunk snaps.
// Why: a named camp or None gets at least {@link NAMED_CAMP_LEASH_FLOOR}, which is camp membership.

/** Effective gather leash from the UI value and the location mode. */
export function effectiveGatherLeash(settingLeash: number, locationSetting: string): number {
    const raw = Math.max(2, Math.floor(Number.isFinite(settingLeash) ? settingLeash : 10));
    if (locationSetting.trim().toLowerCase() === 'auto') {
        return raw;
    }
    return Math.max(NAMED_CAMP_LEASH_FLOOR, raw);
}

/** True when Location is Auto, expert freeform; no mob-flee babysitting. */
export function isAutoLocation(locationSetting: string): boolean {
    return locationSetting.trim().toLowerCase() === 'auto';
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

/** A tile the sweep and the avoid list are compared against, so this module needs no Tile. */
export interface CampPoint {
    x: number;
    z: number;
    level: number;
}

// Why: the spot pick is straight-line, so water across a river beats water along the bank the camp stands on and the walk round is the length of it.

/** Whether a spot sits on a tile the camp refuses. */
export function spotAvoided(spot: CampPoint, avoid: readonly CampPoint[]): boolean {
    return avoid.some(t => t.x === spot.x && t.z === spot.z && t.level === spot.level);
}

// Why: standing on a stop with nothing in view is what says the stop is spent, so arriving is what advances the index; measuring off anything else leaves the bot walking to a tile it is already on.

/** The stop to walk next and the index to keep, given where the search has got to. Null stop when the camp has no sweep. */
export function sweepStopFor(
    sweep: readonly CampPoint[],
    index: number,
    here: CampPoint | null
): { stop: CampPoint | null; index: number } {
    if (sweep.length === 0) {
        return { stop: null, index: 0 };
    }
    const at = ((index % sweep.length) + sweep.length) % sweep.length;
    const stop = sweep[at]!;
    if (here !== null && here.level === stop.level && Math.max(Math.abs(here.x - stop.x), Math.abs(here.z - stop.z)) <= 1) {
        const next = (at + 1) % sweep.length;
        return { stop: sweep[next]!, index: next };
    }
    return { stop, index: at };
}
