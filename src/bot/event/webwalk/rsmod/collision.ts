import CollisionEngine from './CollisionEngine.js';
import { LocAngle, LocLayer, locShapeLayer } from './flags.js';

export function changeLandCollision(collision: CollisionEngine, x: number, z: number, level: number, add: boolean): void {
    collision.changeFloor(x, z, level, add);
}

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

export function changeRoofCollision(collision: CollisionEngine, x: number, z: number, level: number, add: boolean): void {
    collision.changeRoof(x, z, level, add);
}
