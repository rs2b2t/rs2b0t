import { reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { canReachLocal, canStepLocal, type ReachOptions } from '../nav/localReach.js';

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
        if (from.level !== to.level || Math.max(Math.abs(from.x - to.x), Math.abs(from.z - to.z)) !== 1) {
            return false;
        }
        const a = reader.toLocal(from.x, from.z);
        if (!a) {
            return false;
        }
        return canStepLocal((lx, lz) => reader.collisionFlags(lx, lz), a.lx, a.lz, to.x - from.x, to.z - from.z);
    }
};
