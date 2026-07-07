import type { WorldTile } from '../adapter/ClientAdapter.js';

/** Immutable world-coordinate tile. */
export default class Tile implements WorldTile {
    constructor(
        readonly x: number,
        readonly z: number,
        readonly level: number = 0
    ) {}

    static from(tile: WorldTile): Tile {
        return new Tile(tile.x, tile.z, tile.level);
    }

    /** Chebyshev distance (game movement metric). */
    distanceTo(other: WorldTile): number {
        return Math.max(Math.abs(this.x - other.x), Math.abs(this.z - other.z));
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
