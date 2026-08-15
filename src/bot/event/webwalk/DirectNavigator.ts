import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/execution/Execution.js';
import { Reachability } from './geometry/Reachability.js';
import { Input } from '../../input/Input.js';
import { isArrived } from './geometry/arrival.js';

export const DirectNavigator = {
    walk(dest: WorldTile): boolean | Promise<boolean> {
        const me = reader.worldTile();
        if (!me) {
            return false;
        }

        const clamped = {
            x: Math.max(me.x - 48, Math.min(me.x + 48, dest.x)),
            z: Math.max(me.z - 48, Math.min(me.z + 48, dest.z))
        };

        const local = reader.toLocal(clamped.x, clamped.z);
        if (!local) {
            return false;
        }

        return Input.walk(local.lx, local.lz);
    },

    async walkTo(dest: WorldTile, radius: number = 2, timeoutMs: number = 45000): Promise<boolean> {
        const deadline = performance.now() + timeoutMs;
        let lastIssued = 0;
        let lastTile = reader.worldTile();

        while (performance.now() < deadline) {
            const me = reader.worldTile();
            if (!me) {
                return false;
            }

            if (isArrived(me, dest, radius, Reachability.arrivalProbe())) {
                return true;
            }

            const stalled = lastTile && me.x === lastTile.x && me.z === lastTile.z;
            if (performance.now() - lastIssued > 2400 || stalled) {
                this.walk(dest);
                lastIssued = performance.now();
            }

            lastTile = me;
            await Execution.delayTicks(2);
        }

        return false;
    }
};
