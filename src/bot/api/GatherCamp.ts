/**
 * Gather camp membership / hunt policy (Fisher / Miner / Woodcutter).
 * Location tables stay in GatheringLocations; these helpers are pure disk math.
 */
import { DEFAULT_CAMP_RADIUS } from './GatheringLocations.js';

/** Floor for non-Auto location modes (named camps + power None) — camp membership. */
export const NAMED_CAMP_LEASH_FLOOR = DEFAULT_CAMP_RADIUS;

/** @deprecated Prefer {@link NAMED_CAMP_LEASH_FLOOR} — same value, kept for imports. */
export const START_TILE_LEASH_FLOOR = NAMED_CAMP_LEASH_FLOOR;

/**
 * Effective gather leash from the UI value + location mode.
 * - Auto → respect setting (freeform / unverified chunk snaps).
 * - Named camp or None → at least {@link NAMED_CAMP_LEASH_FLOOR} (camp membership).
 */
export function effectiveGatherLeash(settingLeash: number, locationSetting: string): number {
    const raw = Math.max(2, Math.floor(Number.isFinite(settingLeash) ? settingLeash : 10));
    if (locationSetting.trim().toLowerCase() === 'auto') {
        return raw;
    }
    return Math.max(NAMED_CAMP_LEASH_FLOOR, raw);
}

/** True when Location is Auto — expert freeform; no mob-flee babysitting. */
export function isAutoLocation(locationSetting: string): boolean {
    return locationSetting.trim().toLowerCase() === 'auto';
}

/**
 * Origin for fishing-spot distance checks.
 *
 * - **Named camp**: measure from the **player** so pier/river hops beside the bot
 *   stay valid even when far from the home pin (resource fence is camp membership).
 * - **Freeform fish**: same player origin.
 * - No player tile → fall back to anchor/home.
 */
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
 * Freeform has no camp fence — callers skip this check.
 */
export function resourceWithinCamp(distFromHome: number, campRadius: number): boolean {
    const R = Math.max(2, Math.floor(Number.isFinite(campRadius) ? campRadius : NAMED_CAMP_LEASH_FLOOR));
    return Number.isFinite(distFromHome) && distFromHome <= R;
}

/**
 * Freeform hunt radius past the UI/start leash.
 * Named camps do not use this — they accept any spot in camp membership.
 */
export function gatherHuntRadius(primaryDisk: number): number {
    const L = Math.max(2, Math.floor(Number.isFinite(primaryDisk) ? primaryDisk : 10));
    return Math.max(L + 24, 48);
}
