import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from './Tile.js';

/**
 * Tile regions for scripts (RuneMate shape): leashes, wander zones, walk
 * targets. Build with Area.rectangular(a, b) / Area.circular(center, r).
 */
export abstract class Area {
    abstract contains(tile: WorldTile): boolean;
    abstract getRandomTile(): Tile;

    /** Axis-aligned rectangle spanning the two corner tiles (inclusive). */
    static rectangular(a: WorldTile, b: WorldTile): Area {
        return new RectangularArea(a, b);
    }

    /** Euclidean disc of `radius` tiles around `center` (inclusive). */
    static circular(center: WorldTile, radius: number): Area {
        return new CircularArea(center, radius);
    }
}

class RectangularArea extends Area {
    private readonly minX: number;
    private readonly maxX: number;
    private readonly minZ: number;
    private readonly maxZ: number;
    private readonly level: number;

    constructor(a: WorldTile, b: WorldTile) {
        super();
        this.minX = Math.min(a.x, b.x);
        this.maxX = Math.max(a.x, b.x);
        this.minZ = Math.min(a.z, b.z);
        this.maxZ = Math.max(a.z, b.z);
        this.level = a.level;
    }

    contains(tile: WorldTile): boolean {
        return tile.level === this.level && tile.x >= this.minX && tile.x <= this.maxX && tile.z >= this.minZ && tile.z <= this.maxZ;
    }

    getRandomTile(): Tile {
        const x = this.minX + Math.floor(Math.random() * (this.maxX - this.minX + 1));
        const z = this.minZ + Math.floor(Math.random() * (this.maxZ - this.minZ + 1));
        return new Tile(x, z, this.level);
    }
}

class CircularArea extends Area {
    constructor(
        private readonly center: WorldTile,
        private readonly radius: number
    ) {
        super();
    }

    contains(tile: WorldTile): boolean {
        const dx = tile.x - this.center.x;
        const dz = tile.z - this.center.z;
        return tile.level === this.center.level && dx * dx + dz * dz <= this.radius * this.radius;
    }

    getRandomTile(): Tile {
        // rejection-sample the bounding box; disc fills ~78% of it
        for (let attempt = 0; attempt < 64; attempt++) {
            const x = this.center.x + Math.floor(Math.random() * (2 * this.radius + 1)) - this.radius;
            const z = this.center.z + Math.floor(Math.random() * (2 * this.radius + 1)) - this.radius;
            if (this.contains({ x, z, level: this.center.level })) {
                return new Tile(x, z, this.center.level);
            }
        }
        return Tile.from(this.center);
    }
}
