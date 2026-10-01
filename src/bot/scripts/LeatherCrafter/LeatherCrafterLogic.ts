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

// Why: the speculative load spends the bank leg's ticks on crafting instead of waiting, which needs
// the landing slots predicted, so the prediction stays pure and unit-tested rather than in the click loop.

/** One pack slot: the slot index and the item sitting in it. */
export interface SlotItem {
    slot: number;
    id: number;
}

/**
 * The slots a Withdraw-All fills: the lowest free ones, since the server takes the first empty
 * slot. Anything `depositIds` covers is treated as leaving, so its slot becomes free.
 */
export function predictLeatherSlots(
    occupied: readonly SlotItem[],
    depositIds: ReadonlySet<number>,
    size: number,
    want: number = size
): number[] {
    const kept = new Set<number>();
    for (const item of occupied) {
        if (!depositIds.has(item.id)) {
            kept.add(item.slot);
        }
    }
    const out: number[] = [];
    for (let slot = 0; slot < size && out.length < want; slot++) {
        if (!kept.has(slot)) {
            out.push(slot);
        }
    }
    return out;
}

/** Where the crafted body's Deposit-All sits in a bank-side row, for the next trip's Tier 2. */
export interface SideCache {
    comId: number;
    op: number;
}

/**
 * The body's bank-side deposit target, cached from a trip where the rows were readable.
 * Why: null when the body is absent or the row has no Deposit-All, which keeps the speculative leg off.
 */
export function sideCacheFrom(
    rows: readonly { id: number; comId: number; ops: readonly (string | null)[] }[],
    bodyId: number,
    opIndex: (ops: readonly (string | null)[], pattern: RegExp) => number
): SideCache | null {
    const row = rows.find(r => r.id === bodyId);
    if (!row || row.comId < 0) {
        return null;
    }
    const op = opIndex(row.ops, /deposit[\s-]*all/i);
    return op === -1 ? null : { comId: row.comId, op };
}

/** Index (1-based, as the menu actions expect) of the first op matching `pattern`, or -1. */
export function findOp(ops: readonly (string | null)[], pattern: RegExp): number {
    for (let i = 0; i < ops.length; i++) {
        if (ops[i] !== null && pattern.test(ops[i] as string)) {
            return i + 1;
        }
    }
    return -1;
}
