/**
 * Session route progress for the active walk (not Global settings).
 * Shared with pathPublish for overlay + recovery.
 */

interface RouteStateSnapshot {
    pathIdx: number;
    bestPathIdx: number;
    lastProgressAt: number;
    lastTransportAt: number | null;
    lastTransport: { origin: { x: number; z: number; level: number }; dest: { x: number; z: number; level: number } } | null;
    interimClick: { x: number; z: number; level: number } | null;
}

const empty = (): RouteStateSnapshot => ({
    pathIdx: 0,
    bestPathIdx: 0,
    lastProgressAt: 0,
    lastTransportAt: null,
    lastTransport: null,
    interimClick: null
});

let state: RouteStateSnapshot = empty();

export const RouteState = {
    reset(): void {
        state = empty();
        state.lastProgressAt = performance.now();
    },

    get(): Readonly<RouteStateSnapshot> {
        return state;
    },

    setPathIdx(idx: number): void {
        if (idx > state.bestPathIdx) {
            state.bestPathIdx = idx;
            state.lastProgressAt = performance.now();
        }
        state.pathIdx = idx;
    },

    noteTransport(origin: { x: number; z: number; level: number }, dest: { x: number; z: number; level: number }): void {
        state.lastTransportAt = performance.now();
        state.lastTransport = { origin, dest };
        state.lastProgressAt = performance.now();
    },

    setInterimClick(tile: { x: number; z: number; level: number } | null): void {
        state.interimClick = tile;
    }
};
