import { reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { canReachLocal, canStepLocal, type ReachOptions } from '../nav/localReach.js';
import type { ArrivalProbe } from '../nav/arrival.js';
import { chebyshev } from '../nav/followMath.js';
import { CollisionFlag } from '#/dash3d/CollisionFlag.js';

// BFS budget for the per-tick arrival reach probe. Arrival is checked every
// walk-loop tick, so it's bounded well below the click-target REACH_CHECK_STEPS
// (1200) — a couple tiles across a doorway needs only a small neighbourhood, and
// measured cost is negligible (see .superpowers/sdd/task-2-report.md).
const ARRIVAL_MAX_STEPS = 512;

/**
 * Script-facing "could the client walk there RIGHT NOW?" checks over the live
 * scene CollisionMap (doors in their current open/closed state — unlike the
 * baked NavWorker pack). Scene-local and current-level only; anything out of
 * scene or cross-level is simply `false` — callers treat that as unreachable
 * and fall back to web-walking. Synchronous and bounded; never throws.
 */
export const Reachability = {
    canReach(dest: WorldTile, opts?: ReachOptions): boolean {
        const me = reader.worldTile();
        if (!me || me.level !== dest.level) {
            return false;
        }
        const from = reader.toLocal(me.x, me.z);
        const to = reader.toLocal(dest.x, dest.z);
        if (!from || !to) {
            return false;
        }
        return canReachLocal((lx, lz) => reader.collisionFlags(lx, lz), from, to, opts);
    },

    /** Single-tile step check between two ADJACENT world tiles (same level). */
    canStep(from: WorldTile, to: WorldTile): boolean {
        if (from.level !== to.level || chebyshev(from, to) !== 1) {
            return false;
        }
        const a = reader.toLocal(from.x, from.z);
        if (!a) {
            return false;
        }
        return canStepLocal((lx, lz) => reader.collisionFlags(lx, lz), a.lx, a.lz, to.x - from.x, to.z - from.z);
    },

    /**
     * Is `dest` a stand-able floor tile in the live scene? A tile carrying any
     * `SQ_BLOCKED` bit (WR_GRND | BLOCK_NPCS_AND_PLAYERS | WALK_SCENERY) can
     * never be entered from ANY direction — every `PL_WALK_*` mask ORs SQ_BLOCKED
     * in, so `canStepLocal` refuses it from all four cardinals (localReach.ts).
     * That's exactly "a booth/counter/rock the player can't occupy". Out of
     * scene / cross-level ⇒ false (unprobeable ⇒ the arrival fallback keeps old
     * Chebyshev semantics for it).
     */
    walkable(dest: WorldTile): boolean {
        const me = reader.worldTile();
        if (!me || me.level !== dest.level) {
            return false;
        }
        const to = reader.toLocal(dest.x, dest.z);
        if (!to) {
            return false;
        }
        const f = reader.collisionFlags(to.lx, to.lz);
        return f !== null && (f & CollisionFlag.SQ_BLOCKED) === 0;
    },

    /** The live ArrivalProbe (canReach bounded to ARRIVAL_MAX_STEPS + walkable)
     *  the four walk gates feed to the shared `isArrived` predicate. */
    arrivalProbe(): ArrivalProbe {
        return {
            canReach: t => Reachability.canReach(t, { maxSteps: ARRIVAL_MAX_STEPS }),
            walkable: t => Reachability.walkable(t)
        };
    }
};
