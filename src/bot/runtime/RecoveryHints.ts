import type Tile from '../api/Tile.js';

/**
 * In-memory hand-off between a watchdog-forced script restart and the next
 * run's onStart: scripts that anchor to their start tile re-anchor to the
 * ORIGINAL spot instead of wherever the wedge left them. Cleared on
 * consumption; page reloads reset it.
 */
export const RecoveryHints = {
    pendingRecovery: false,
    anchor: null as Tile | null,

    takeAnchor(): Tile | null {
        if (!this.pendingRecovery) {
            return null;
        }
        this.pendingRecovery = false;
        return this.anchor;
    },

    /**
     * Drop any UNCONSUMED hint. Called by ScriptRunner after a script's onStart
     * settles: if pendingRecovery is still set, the started script never called
     * takeAnchor() (it isn't an anchored script), so the hint would otherwise
     * leak into a later run. A consumer already flipped pendingRecovery=false in
     * takeAnchor and re-registered its anchor, so callers gate on pendingRecovery
     * and this never wipes a live anchor.
     */
    clear(): void {
        this.pendingRecovery = false;
        this.anchor = null;
    }
};
