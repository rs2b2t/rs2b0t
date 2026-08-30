import type { WorldTile } from '../adapter/ClientAdapter.js';

/**
 * A world tile. Distances are Chebyshev, the game's movement metric.
 * @see docs/reference/api-game.md#world-primitives
 */
export default class Tile implements WorldTile {
    constructor(
        readonly x: number,
        readonly z: number,
        readonly level: number = 0
    ) {}

    static from(tile: WorldTile): Tile {
        return new Tile(tile.x, tile.z, tile.level);
    }

    distanceTo(other: WorldTile): number {
        const xz = Math.max(Math.abs(this.x - other.x), Math.abs(this.z - other.z));
        // Why: xz Chebyshev treats Jiminua's lookout (2766,3122,1) as arrived at the store.
        if ((this.level ?? 0) !== (other.level ?? 0)) {
            return 1_000_000 + xz;
        }
        return xz;
    }

    translate(dx: number, dz: number): Tile {
        return new Tile(this.x + dx, this.z + dz, this.level);
    }

    equals(other: WorldTile): boolean {
        return this.x === other.x && this.z === other.z && this.level === other.level;
    }

    toString(): string {
        return `(${this.x}, ${this.z}, ${this.level})`;
    }
}
