import type { NavPoint } from '#/bot/nav/PathFinder.js';

export interface ReachChecker {
    walkable(x: number, z: number, level: number): boolean;
    connected(from: NavPoint, anchor: NavPoint): boolean;
}

export type TargetKind = 'ok' | 'unwalkable' | 'island';

export function classifyTarget(rc: ReachChecker, target: NavPoint, anchor: NavPoint): TargetKind {
    if (!rc.walkable(target.x, target.z, target.level)) {
        return 'unwalkable';
    }
    if (!rc.connected(target, anchor)) {
        return 'island';
    }
    return 'ok';
}

export function nearestConnected(rc: ReachChecker, tile: NavPoint, anchor: NavPoint, maxRing: number): NavPoint | null {
    for (let r = 1; r <= maxRing; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) {
                    continue;
                }
                const c: NavPoint = { x: tile.x + dx, z: tile.z + dz, level: tile.level };
                if (rc.walkable(c.x, c.z, c.level) && rc.connected(c, anchor)) {
                    return c;
                }
            }
        }
    }
    return null;
}
