// Ported from LostCityRS/Engine-TS@274: src/engine/GameMap.ts ("rsmod wasm exports"
// section) — changeLandCollision / changeLocCollision / changeRoofCollision, the
// collision-change helpers GameMap uses while loading mapsquares. MIT licensed.
// Identical semantics; the only deviation is that the engine routes through a
// module-level RouteFinder singleton, while these take the CollisionEngine
// instance explicitly as the first parameter.
import CollisionEngine from './CollisionEngine.js';
import { LocAngle, LocLayer, locShapeLayer } from './flags.js';

/**
 * Change collision at a specified Position for lands/floors.
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeLandCollision(collision: CollisionEngine, x: number, z: number, level: number, add: boolean): void {
    collision.changeFloor(x, z, level, add);
}

/**
 * Change collision at a specified Position for locs.
 * @param shape The shape of the loc to change.
 * @param angle The angle of the loc to change.
 * @param blockrange If this loc blocks range.
 * @param length The length of this loc.
 * @param width The width of this loc.
 * @param active If this loc is active.
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeLocCollision(collision: CollisionEngine, shape: number, angle: number, blockrange: boolean, length: number, width: number, active: number, x: number, z: number, level: number, add: boolean): void {
    const locLayer: LocLayer = locShapeLayer(shape);
    if (locLayer === LocLayer.WALL) {
        collision.changeWall(x, z, level, angle, shape, blockrange, false, add);
    } else if (locLayer === LocLayer.GROUND) {
        if (angle === LocAngle.NORTH || angle === LocAngle.SOUTH) {
            collision.changeLoc(x, z, level, length, width, blockrange, false, add);
        } else {
            collision.changeLoc(x, z, level, width, length, blockrange, false, add);
        }
    } else if (locLayer === LocLayer.GROUND_DECOR) {
        if (active === 1) {
            collision.changeFloor(x, z, level, add);
        }
    }
}

/**
 * Change collision at a specified Position for roofs.
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeRoofCollision(collision: CollisionEngine, x: number, z: number, level: number, add: boolean): void {
    collision.changeRoof(x, z, level, add);
}
