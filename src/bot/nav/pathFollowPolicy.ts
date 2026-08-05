/**
 * Path stickiness: plan once when the walk is requested; repath only on stall,
 * deviation, or an explicit script/API force. Defaults match observed client vs
 * baked-path slop.
 */

import { SettingsStore } from '../runtime/Settings.js';

/** Default server ticks with no tile change before stall repath. */
export const DEFAULT_PATH_STALL_TICKS = 9;

/**
 * Default Chebyshev distance from the published path before deviation repath.
 */
export const DEFAULT_PATH_DEVIATION_CHEBYSHEV = 10;

/**
 * Engage a planned transport hop only when this close to its **approach** tile
 * (not the far landing, not “any nearby spirit tree”).
 */
export const DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV = 2;

export interface PathFollowConfig {
    /** Server ticks without a tile change → repath (default 9). */
    stallTicks: number;
    /** Chebyshev off the published path → repath (default 10). */
    deviationChebyshev: number;
    /** Chebyshev to hop approach tile before executing the hop (default 2). */
    transportApproachChebyshev: number;
}

export interface PathFollowOverrides {
    stallTicks?: number;
    deviationChebyshev?: number;
    transportApproachChebyshev?: number;
}

/** Resolve follow stickiness: walk opts → Global settings → defaults. */
export function resolvePathFollowConfig(over?: PathFollowOverrides | null): PathFollowConfig {
    let gStall = DEFAULT_PATH_STALL_TICKS;
    let gDev = DEFAULT_PATH_DEVIATION_CHEBYSHEV;
    try {
        const bag = SettingsStore.globalBag();
        gStall = bag.num('navPathStallTicks', DEFAULT_PATH_STALL_TICKS);
        gDev = bag.num('navPathDeviation', DEFAULT_PATH_DEVIATION_CHEBYSHEV);
    } catch {
        // Detached unit tests / pre-settings boot.
    }
    return {
        stallTicks: Math.max(1, over?.stallTicks ?? gStall),
        deviationChebyshev: Math.max(1, over?.deviationChebyshev ?? gDev),
        transportApproachChebyshev: Math.max(
            0,
            over?.transportApproachChebyshev ?? DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV
        )
    };
}
