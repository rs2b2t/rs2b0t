/** Pure camp-membership and hunt-range policy for gathering scripts. */
import { DEFAULT_CAMP_RADIUS } from '../../data/gatheringLocations.js';

/** Floor for non-Auto location modes (named camps + power None), camp membership. */
export const NAMED_CAMP_LEASH_FLOOR = DEFAULT_CAMP_RADIUS;

/** @deprecated Prefer {@link NAMED_CAMP_LEASH_FLOOR}, same value, kept for imports. */
export const START_TILE_LEASH_FLOOR = NAMED_CAMP_LEASH_FLOOR;

// Why: named camps need the membership floor; Auto keeps the freeform setting.

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

// Why: chase from the player so nearby pier and river hops remain valid; fall back to anchor or home.

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

/** Whether a resource remains inside a named camp's Chebyshev fence. */
export function resourceWithinCamp(distFromHome: number, campRadius: number): boolean {
    const R = Math.max(2, Math.floor(Number.isFinite(campRadius) ? campRadius : NAMED_CAMP_LEASH_FLOOR));
    return Number.isFinite(distFromHome) && distFromHome <= R;
}

/** Freeform hunt radius beyond the UI/start leash; named camps use membership instead. */
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
