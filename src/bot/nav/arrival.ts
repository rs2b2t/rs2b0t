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
// the current collision map. An unwalkable dest (booth/counter/rock/ladder)
// can never be stood on, so for those "reachable" means a wall-open tile
// CARDINALLY beside it — the old plain-Chebyshev fallback let a bot outside a
// house "arrive" at a ladder just inside the wall and click it through the
// wall forever ("I can't reach that!"). Only a dest the scene can't probe at
// all (out of scene) keeps the Chebyshev gate, so a legitimately unprobeable
// target never becomes a never-arrives hang.

import type { NavPoint } from './PathFinder.js';
import { chebyshev } from './followMath.js';

/** Live "can I stand where I'm aiming?" surface, injected so `isArrived` stays
 *  pure/testable. In production all four wrap the current scene CollisionMap
 *  (`Reachability.arrivalProbe()`). */
export interface ArrivalProbe {
    /** BFS over the current collision map reaches `t` from the player. */
    canReach(t: NavPoint): boolean;
    /** `t` is a stand-able floor tile (not a whole-tile blocker). */
    walkable(t: NavPoint): boolean;
    /** BFS reaches a tile CARDINALLY beside `t` with no wall between — the
     *  stand an interaction with an unwalkable `t` could be issued from. */
    canReachAdjacent(t: NavPoint): boolean;
    /** The scene can read collision at `t` (same level, in scene). False means
     *  the other probe answers are vacuous, not "blocked". */
    probeable(t: NavPoint): boolean;
}

/**
 * Arrived ⟺ same level ∧ Chebyshev(me,dest) ≤ radius ∧ dest genuinely
 * reachable: canReach for a walkable dest, canReachAdjacent for an unwalkable
 * one (an interact-legal stand), Chebyshev-only when the scene can't probe
 * dest. Standing exactly on dest (cheb 0) is always arrival and
 * short-circuits before the probe — `canReachLocal(from==to)` is degenerate
 * and being on the tile IS arrival regardless.
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
    if (probe.canReach(dest)) {
        return true;
    }
    if (probe.walkable(dest)) {
        return false; // stand-able but unreachable (closed door between) — keep walking
    }
    // Unwalkable target: arrived only from a stand an interact could use — a
    // wall-open cardinal neighbour. Unprobeable (out of scene) keeps the old
    // Chebyshev semantics so it can't hang a walk.
    return !probe.probeable(dest) || probe.canReachAdjacent(dest);
}
