import type { NavPoint } from './PathFinder.js';
import { chebyshev } from './followMath.js';

export interface ArrivalProbe {
    canReach(t: NavPoint): boolean;
    walkable(t: NavPoint): boolean;
    canReachAdjacent(t: NavPoint): boolean;
    probeable(t: NavPoint): boolean;
}

export function isArrived(me: NavPoint, dest: NavPoint, radius: number, probe: ArrivalProbe): boolean {
    if (me.level !== dest.level) {
        return false;
    }
    const dist = chebyshev(me, dest);
    if (dist > radius) {
        return false;
    }
    if (dist === 0) {
        return true;
    }
    if (probe.canReach(dest)) {
        return true;
    }
    if (probe.walkable(dest)) {
        return false;
    }
    return !probe.probeable(dest) || probe.canReachAdjacent(dest);
}
