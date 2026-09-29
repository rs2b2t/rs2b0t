export const HARD_LEATHER_BURST = 60;

// Why: hard-leather bodies are crafted synchronously by the server.
// Why: queue every needle-on-leather slot without awaiting each send (GemCutter's packet-burst pattern); the settle in craftLeg waits for the leather to move instead.

/** Queues needle-on-leather actions across the slots, without awaiting each send. */
export async function issueHardLeatherBurst<T>(targets: readonly T[], useNeedleOn: (target: T) => boolean | Promise<boolean>, limit = HARD_LEATHER_BURST): Promise<number> {
    let sent = 0;
    for (const target of targets.slice(0, Math.max(0, limit))) {
        const queued = useNeedleOn(target);
        if (queued === false) {
            break;
        }
        sent++;
    }
    return sent;
}

// Why: idle ticks tell "still draining" from "stalled", which a blind tick cannot and so either cuts the burst short or over-waits.
export const STALL_TICKS = 2;

/** Re-fires allowed per burst before the pack is banked instead. */
export const MAX_REFIRES = 2;

/** The burst watcher's per-tick view of how the leather count is moving. */
export interface DrainState {
    /** Leather count at the last tick that dropped. */
    last: number;
    /** Consecutive ticks with no drop. */
    idle: number;
    /** Re-fires spent this burst. */
    refires: number;
}

export type DrainAction = 'done' | 'wait' | 'refire' | 'bank';

/** Opens a watcher on a burst that started with `leather` items in the pack. */
export function newDrain(leather: number): DrainState {
    return { last: leather, idle: 0, refires: 0 };
}

/**
 * One tick of the burst watcher: done, wait, refire (stalled with budget left), or bank.
 * Why: `threadOut` banks, because re-firing without reels only queues packets the server rejects.
 */
export function stepDrain(state: DrainState, leather: number, threadOut = false): { state: DrainState; action: DrainAction } {
    if (leather <= 0) {
        return { state: { ...state, last: 0, idle: 0 }, action: 'done' };
    }
    if (leather < state.last) {
        return { state: { ...state, last: leather, idle: 0 }, action: 'wait' };
    }
    if (threadOut) {
        return { state: { ...state, idle: state.idle + 1 }, action: 'bank' };
    }
    const idle = state.idle + 1;
    if (idle < STALL_TICKS) {
        return { state: { ...state, idle }, action: 'wait' };
    }
    if (state.refires < MAX_REFIRES) {
        return { state: { last: leather, idle: 0, refires: state.refires + 1 }, action: 'refire' };
    }
    return { state: { ...state, idle }, action: 'bank' };
}
