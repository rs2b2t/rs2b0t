import { chebyshev } from '../../../../../event/webwalk/geometry/followMath.js';
import Tile from '../../../../../geometry/Tile.js';

/**
 * Where crossing the seam at `at` from `stand` puts the player: one tile past it, on the side away from the stand.
 * Why: a seam moves the player a fixed step across itself, not the distance they walked up to it — `@rockslide_obstacle` ends at `movecoord(loc_coord, ±1)` and `~open_and_close_door2` puts them one tile through. Mirroring the stand about the loc scales with how far out the stand is, so a tile four out mirrors eight past the seam and outranks the cardinal neighbour that lands on the same square.
 */
export function crossingLanding(at: Tile, stand: Tile): Tile {
    return new Tile(at.x + Math.sign(at.x - stand.x), at.z + Math.sign(at.z - stand.z), at.level);
}

/**
 * Rank the tiles a seam can be used from: by where crossing from each lands, then by how close each stands to the seam, then by how close it is to the character.
 * Why: MANHATTAN toward the destination, not chebyshev — the four-way cage at (2380,9619) opens south onto the only pocket that can operate the pipe into the unicorn area, and chebyshev takes the greater of dx and dz, so eleven tiles of southward gain hid behind one tile of x and the route took the east side on every run. The seam's own distance then breaks the tie before the character's does, because an op-click walks the player from the stand to the seam before its script runs: a stand four tiles out spends three of them on the approach, which the crossing test reads as the crossing, and a climb the chatbox reported as finished was logged as "did not cross".
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
