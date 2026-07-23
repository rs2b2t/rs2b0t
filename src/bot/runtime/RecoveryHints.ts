import type Tile from '../api/Tile.js';

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

    clear(): void {
        this.pendingRecovery = false;
        this.anchor = null;
    }
};
