/**
 * Shared nearest-target selection for gather / combat-adjacent scripts.
 * Prefer a local cluster when any candidate is underfoot so membership-wide
 * nearest does not path across tunnels (Dwarven iron wings, multi-pad mines).
 */

/**
 * Prefer rocks/trees within this Chebyshev of the player when any match.
 * Server iron rocks (ids 2092/2093) respawn on ~6t; see skill_mining mine.dbrow.
 */
export const LOCAL_MINE_PREFER_RADIUS = 12;

/**
 * Pick the best candidate from a pre-filtered list.
 * When any sits within {@link preferRadius} of the player, ignore the rest.
 */
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

/**
 * Whether to soft-cooldown a mine/chop tile after a failed click.
 * Successful depletes must not cool the tile — empty/stump already drop out of
 * type filters, and iron respawns (~6t) faster than a typical 8t skip.
 */
export function shouldCooldownGatherTile(gotProduct: boolean, stillHasOtherTargets: boolean): boolean {
    return !gotProduct && stillHasOtherTargets;
}
