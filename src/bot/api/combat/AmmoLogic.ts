/**
 * Pure decision core for ranged ground-ammo collection (no client imports).
 *
 * Design: sweep on kill. Every crab kill triggers a sweep of our ammo stacks
 * within range; `minStack` filters out piles too small to be worth the walk
 * (the engine does not reliably merge same-tile drops, so fired arrows land
 * as many small per-tile stacks — a size-maturity rule can never see "the
 * pile", but a kill-triggered sweep collects it while we're standing in it).
 * Force mode (quiver empty / leaving the field) takes everything.
 */

export interface AmmoStack {
    /** Stable identity for a stack: its tile (e.g. "x|z|level"). */
    key: string;
    count: number;
    /** Chebyshev distance from the player. */
    distance: number;
}

export interface SweepOptions {
    /** Ignore stacks smaller than this (the panel slider). */
    minStack: number;
    /** Only sweep stacks within this many tiles of the player. */
    range: number;
    /** Quiver empty / leaving the field: take everything in range. */
    force: boolean;
}

/** Keys of the stacks worth collecting, nearest first. */
export function sweepPlan(stacks: AmmoStack[], opts: SweepOptions): string[] {
    return stacks
        .filter(s => s.distance <= opts.range && (opts.force || s.count >= opts.minStack))
        .sort((a, b) => a.distance - b.distance)
        .map(s => s.key);
}
