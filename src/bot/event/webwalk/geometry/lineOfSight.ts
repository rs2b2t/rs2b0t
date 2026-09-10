import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import type { FlagsAt } from './localReach.js';

/** A footprint by its south-west tile, in scene-local coordinates. */
export interface Footprint {
    lx: number;
    lz: number;
    size: number;
}

const SIGHT_W = CollisionFlag.VIS_SCENERY | CollisionFlag.V_W;
const SIGHT_E = CollisionFlag.VIS_SCENERY | CollisionFlag.V_E;
const SIGHT_S = CollisionFlag.VIS_SCENERY | CollisionFlag.V_S;
const SIGHT_N = CollisionFlag.VIS_SCENERY | CollisionFlag.V_N;
const HALF_TILE = (1 << 16) / 2;

/** The edge of a footprint the ray starts from or ends on, the one facing the other body. */
function coordinate(a: number, b: number, size: number): number {
    if (a >= b) {
        return a;
    }
    if (a + size - 1 <= b) {
        return a + size - 1;
    }
    return b;
}

// Why: this is the engine's rayCastLine with los on and no extra flag, so what it says the server can see is what an Attack click will not walk toward.
// Why: a tile outside the loaded scene reads as opaque, where the engine reads an unallocated zone as clear, since the bot cannot vouch for ground it has not loaded.

/** Whether the engine's sight ray from `src` reaches `dest` across the loaded scene's flags. */
export function hasLineOfSightLocal(flags: FlagsAt, src: Footprint, dest: Footprint): boolean {
    const flagged = (lx: number, lz: number, mask: number): boolean => {
        const f = flags(lx, lz);
        return f === null || (f & mask) !== 0;
    };
    const startX = coordinate(src.lx, dest.lx, src.size);
    const startZ = coordinate(src.lz, dest.lz, src.size);
    const endX = coordinate(dest.lx, src.lx, dest.size);
    const endZ = coordinate(dest.lz, src.lz, dest.size);
    if (startX === endX && startZ === endZ) {
        return true;
    }
    if (flagged(startX, startZ, CollisionFlag.WALK_SCENERY)) {
        return false;
    }
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    const absX = Math.abs(deltaX);
    const absZ = Math.abs(deltaZ);
    const east = deltaX >= 0;
    const north = deltaZ >= 0;
    let xFlags = east ? SIGHT_W : SIGHT_E;
    let zFlags = north ? SIGHT_S : SIGHT_N;
    if (absX > absZ) {
        const stepX = east ? 1 : -1;
        let scaledZ = (startZ << 16) + HALF_TILE + (north ? 0 : -1);
        const tangent = ((deltaZ << 16) / absX) | 0;
        let x = startX;
        while (x !== endX) {
            x += stepX;
            const z = scaledZ >> 16;
            if (x === endX && z === endZ) {
                xFlags &= ~CollisionFlag.VIS_SCENERY;
            }
            if (flagged(x, z, xFlags)) {
                return false;
            }
            scaledZ += tangent;
            const nextZ = scaledZ >> 16;
            if (x === endX && nextZ === endZ) {
                zFlags &= ~CollisionFlag.VIS_SCENERY;
            }
            if (nextZ !== z && flagged(x, nextZ, zFlags)) {
                return false;
            }
        }
        return true;
    }
    const stepZ = north ? 1 : -1;
    let scaledX = (startX << 16) + HALF_TILE + (east ? 0 : -1);
    const tangent = ((deltaX << 16) / absZ) | 0;
    let z = startZ;
    while (z !== endZ) {
        z += stepZ;
        const x = scaledX >> 16;
        if (x === endX && z === endZ) {
            zFlags &= ~CollisionFlag.VIS_SCENERY;
        }
        if (flagged(x, z, zFlags)) {
            return false;
        }
        scaledX += tangent;
        const nextX = scaledX >> 16;
        if (nextX === endX && z === endZ) {
            xFlags &= ~CollisionFlag.VIS_SCENERY;
        }
        if (nextX !== x && flagged(nextX, z, xFlags)) {
            return false;
        }
    }
    return true;
}
