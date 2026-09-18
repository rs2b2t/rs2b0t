/** What the search knows about a seam before it tries it. */
export interface SeamRank {
    /** Crossing it would leave you closer to the target than standing still. */
    gains: boolean;
    /** This pocket can walk to it, by the scene's collision flags. */
    open: boolean;
}

// Why: Reachability outranks straight-line gain, which can favor blocked bridges over a necessary detour to an open exit.
// Why: still an ordering. The scene can call a bridge you walked 140 tiles to stand beside "walled off", so a seam the flood refuses keeps its turn, last.
export function seamBucket(seam: SeamRank): number {
    if (seam.gains && seam.open) {
        return 0;
    }
    if (!seam.gains && seam.open) {
        return 1;
    }
    return seam.gains ? 2 : 3;
}

/**
 * Order seams by what the pocket can reach first, then by what gains, then by distance.
 * Why: `byDistance` alone can't separate a seam in this pocket from one behind a wall, and both are in the list because neither test vetoes.
 */
export function orderSeams<T>(seams: readonly T[], rank: (seam: T) => SeamRank, dist: (seam: T) => number): T[] {
    return [...seams].sort((a, b) => (seamBucket(rank(a)) - seamBucket(rank(b))) || (dist(a) - dist(b)));
}
