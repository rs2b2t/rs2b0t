/** What the search knows about a seam before it tries it. */
export interface SeamRank {
    /** Crossing it would leave the character closer to the target than standing still does. */
    gains: boolean;
    /** This pocket can walk to it — the scene's own collision flags, not the straight line. */
    open: boolean;
}

// Why: reachability outranks gain. `gains` is a straight line across a pocket graph, and the pass is the one map where that lies most: the mud pocket's only exit is a ledge eighteen tiles WEST while the target lies south, so the ledge reads as no gain at all, while seven stone bridges behind a wall read as twenty tiles of it. Ordering gain first put every one of those bridges — and ten cages in another cell — ahead of the one seam the character was standing next to. `open` is a fact about the pocket the character is in; `gains` is a guess about a map that is not a plane.
// Why: still an ordering and not a veto. The scene called a bridge the character had walked a hundred and forty tiles to stand beside "walled off", so a seam the flood refuses keeps its turn — it takes it last.
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
 * Why: `byDistance` alone cannot separate a seam in this pocket from one behind a wall, and both are in the list because neither test is allowed to veto.
 */
export function orderSeams<T>(seams: readonly T[], rank: (seam: T) => SeamRank, dist: (seam: T) => number): T[] {
    return [...seams].sort((a, b) => (seamBucket(rank(a)) - seamBucket(rank(b))) || (dist(a) - dist(b)));
}
