import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Execution } from '../api/Execution.js';
import { ActionRouter } from '../input/ActionRouter.js';

/**
 * Scene-local walking via the client's own tryMove BFS (Slice 3). Web-walking
 * across map squares lands in Slice 5; this navigator only handles targets
 * inside (or clamped to) the loaded 104x104 scene.
 */
export const DirectNavigator = {
    /** Fire one walk click toward the tile (clamped into the scene).
     *  Synthetic mode returns a promise for the minimap-click gesture. */
    walk(dest: WorldTile): boolean | Promise<boolean> {
        const me = reader.worldTile();
        if (!me) {
            return false;
        }

        // clamp the destination into the loaded scene so cross-scene targets
        // still make progress toward the edge
        const clamped = {
            x: Math.max(me.x - 48, Math.min(me.x + 48, dest.x)),
            z: Math.max(me.z - 48, Math.min(me.z + 48, dest.z))
        };

        const local = reader.toLocal(clamped.x, clamped.z);
        if (!local) {
            return false;
        }

        return ActionRouter.driver.walk(local.lx, local.lz);
    },

    /**
     * Walk until within `radius` tiles of dest (re-clicking when progress
     * stalls). Resolves false on timeout or when no path move was accepted.
     */
    async walkTo(dest: WorldTile, radius: number = 2, timeoutMs: number = 45000): Promise<boolean> {
        const deadline = performance.now() + timeoutMs;
        let lastIssued = 0;
        let lastTile = reader.worldTile();

        while (performance.now() < deadline) {
            const me = reader.worldTile();
            if (!me) {
                return false;
            }

            if (Math.max(Math.abs(me.x - dest.x), Math.abs(me.z - dest.z)) <= radius) {
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
