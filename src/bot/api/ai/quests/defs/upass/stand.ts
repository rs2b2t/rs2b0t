import { chebyshev } from '../../../../../event/webwalk/geometry/followMath.js';
import Tile from '../../../../../geometry/Tile.js';

/**
 * Landing tile when crossing the seam at `at` from `stand`.
 * Why: Crossings move one tile past the seam; mirroring a distant stand overstates that movement.
 */
export function crossingLanding(at: Tile, stand: Tile): Tile {
    return new Tile(at.x + Math.sign(at.x - stand.x), at.z + Math.sign(at.z - stand.z), at.level);
}

/**
 * Rank stands by landing progress, seam distance, then player distance.
 * Why: Manhattan distance preserves the cage's 11-tile southward gain, and the op-click approaches the seam before crossing.
 */
export function bySideThatLands(
    at: Tile,
    dest: Tile,
    me: { x: number; z: number } | null
): (a: Tile, b: Tile) => number {
    const toward = (tile: Tile): number => Math.abs(tile.x - dest.x) + Math.abs(tile.z - dest.z);
    return (a, b) =>
        (toward(crossingLanding(at, a)) - toward(crossingLanding(at, b)))
        || (chebyshev(a, at) - chebyshev(b, at))
        || (chebyshev(a, me ?? a) - chebyshev(b, me ?? b));
}
