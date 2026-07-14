// Reachability-aware arrival — the ONE predicate every walk gate shares
// (WalkExecutor.walkTo early-return + followPath arrived check, Traversal
// .walkResilient's withinRadius, DirectNavigator.walkTo). Pure module: callers
// inject an ArrivalProbe over whatever surface they have (the live scene in
// production, a stub in tests), so no client import leaks in and it runs under
// plain `bun test`.
//
// Why it exists: arrival used to be pure Chebyshev — a bot standing `radius`
// tiles from dest across a CLOSED door returned `true` in 0.0s with zero
// movement (live-confirmed H1), then wedged running interaction loops it could
// never satisfy. Arrival now additionally demands the dest be REACHABLE through
// the current collision map — unless the dest isn't a stand-able tile at all
// (a booth/counter/rock), where we fall back to the old Chebyshev gate so a
// legitimately-unwalkable target never becomes a never-arrives hang.

import type { NavPoint } from './PathFinder.js';
import { chebyshev } from './followMath.js';

/** Live "can I stand where I'm aiming?" surface, injected so `isArrived` stays
 *  pure/testable. In production both wrap the current scene CollisionMap
 *  (`Reachability.arrivalProbe()`). */
export interface ArrivalProbe {
    /** BFS over the current collision map reaches `t` from the player. */
    canReach(t: NavPoint): boolean;
    /** `t` is a stand-able floor tile (not a whole-tile blocker). */
    walkable(t: NavPoint): boolean;
}

/**
 * Arrived ⟺ same level ∧ Chebyshev(me,dest) ≤ radius ∧ (canReach(dest) ∨
 * !walkable(dest)). Standing exactly on dest (cheb 0) is always arrival and
 * short-circuits before the probe — `canReachLocal(from==to)` is degenerate and
 * being on the tile IS arrival regardless.
 */
export function isArrived(me: NavPoint, dest: NavPoint, radius: number, probe: ArrivalProbe): boolean {
    if (me.level !== dest.level) {
        return false;
    }
    const dist = chebyshev(me, dest);
    if (dist > radius) {
        return false;
    }
    if (dist === 0) {
        return true; // standing on the tile IS arrival, always
    }
    // Within radius but off the tile: only truly arrived if the dest is
    // reachable through the live scene — OR it's an unwalkable target (booth/
    // rock), where reachability can never hold and we keep the old semantics.
    return probe.canReach(dest) || !probe.walkable(dest);
}
