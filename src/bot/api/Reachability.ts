import { reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { canReachLocal, canStepLocal, type ReachOptions } from '../nav/localReach.js';
import type { ArrivalProbe } from '../nav/arrival.js';
import { chebyshev } from '../nav/followMath.js';
import { CollisionFlag } from '#/dash3d/CollisionFlag.js';

const ARRIVAL_MAX_STEPS = 512;

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

    probeable(dest: WorldTile): boolean {
        const me = reader.worldTile();
        if (!me || me.level !== dest.level) {
            return false;
        }
        const to = reader.toLocal(dest.x, dest.z);
        return to !== null && reader.collisionFlags(to.lx, to.lz) !== null;
    },

    arrivalProbe(): ArrivalProbe {
        return {
            canReach: t => Reachability.canReach(t, { maxSteps: ARRIVAL_MAX_STEPS }),
            walkable: t => Reachability.walkable(t),
            canReachAdjacent: t => Reachability.canReach(t, { maxSteps: ARRIVAL_MAX_STEPS, adjacentOk: true }),
            probeable: t => Reachability.probeable(t)
        };
    }
};
