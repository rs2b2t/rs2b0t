// Why: path stickiness plans once when the walk is requested and repaths only on stall, on deviation, or on an explicit script/API force.
// Why: the defaults match observed client versus baked-path slop.

import { SettingsStore } from '../../runtime/Settings.js';

/** Default server ticks with no tile change before stall repath. */
export const DEFAULT_PATH_STALL_TICKS = 5;

/**
 * Default Chebyshev distance from the published path before deviation repath.
 */
export const DEFAULT_PATH_DEVIATION_CHEBYSHEV = 10;

// Why: path progress counts a tile as reached from this far away, so any trigger below it opens a band where the walker believes it is at a hop and refuses to cross it.

/** The corridor-snap radius (`WalkExecutor.CORRIDOR`). */
export const PATH_CORRIDOR = 3;

// Why: a planned transport hop engages only this close to its approach tile — not the far landing, and not any nearby spirit tree.
// Why: this must be ≥ {@link PATH_CORRIDOR}, since `locateOnPath` snaps `pathIdx` onto the approach from up to `PATH_CORRIDOR` tiles away and the click selector never targets a tile at or before `pathIdx`.
// Why: between the trigger and the corridor the walker would emit zero clicks and skip the hop, with only a `nearApproach` fallback saving the walk, so keeping the trigger at the arrival radius closes that band.
export const DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV = 4;

interface PathFollowConfig {
    /** Server ticks without a tile change → repath (default 5). */
    stallTicks: number;
    /** Chebyshev off the published path → repath (default 10). */
    deviationChebyshev: number;
    /** Chebyshev to hop approach tile before executing the hop (default 4). */
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
        // Never below the corridor snap — see DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV.
        transportApproachChebyshev: Math.max(
            PATH_CORRIDOR,
            over?.transportApproachChebyshev ?? DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV
        )
    };
}
