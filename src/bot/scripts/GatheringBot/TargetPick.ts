// Shared target selection for gathering and nearby combat scripts.

// Why: a local cluster wins when any candidate is underfoot, so membership-wide nearest does not path across tunnels such as the Dwarven iron wings or multi-pad mines.

/** Prefer rocks and trees within this range; iron respawns in roughly six ticks. */
export const LOCAL_MINE_PREFER_RADIUS = 12;

/** Pick the best candidate, ignoring distant ones when any fall inside `preferRadius`. */
export function pickNearestPreferLocal<T>(
    candidates: readonly T[],
    distToPlayer: (c: T) => number,
    preferRadius = LOCAL_MINE_PREFER_RADIUS
): T | null {
    if (candidates.length === 0) {
        return null;
    }
    const r = Math.max(0, Math.floor(Number.isFinite(preferRadius) ? preferRadius : LOCAL_MINE_PREFER_RADIUS));
    let pool = candidates;
    if (r > 0) {
        const local = candidates.filter(c => distToPlayer(c) <= r);
        if (local.length > 0) {
            pool = local;
        }
    }
    let best: T | null = null;
    let bestD = Infinity;
    for (const c of pool) {
        const d = distToPlayer(c);
        if (d < bestD) {
            best = c;
            bestD = d;
        }
    }
    return best;
}

// Why: a successful deplete must not cool the tile, empty rocks and stumps already drop out of the type filters.
// Why: iron respawns in about 6 ticks, faster than a typical 8-tick skip.

/** Whether to soft-cooldown a mine or chop tile after a failed click. */
export function shouldCooldownGatherTile(gotProduct: boolean, stillHasOtherTargets: boolean): boolean {
    return !gotProduct && stillHasOtherTargets;
}
