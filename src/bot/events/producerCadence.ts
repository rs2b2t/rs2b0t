/**
 * How hard `pumpProducers` should scan this client frame.
 *
 * Full scans (skills + inventory + 300 varps + chat) used to run every logic
 * frame (20–50 Hz × every multibox iframe). Server-visible state only advances
 * on packets — usually once per ~600 ms server tick — so full scans only need
 * to land once per tick. Inventory/chat can still flip mid-tick, so a cheap
 * mid-tick pass keeps those events timely without re-reading the whole varp
 * table fifty times a second.
 */
export type ProducerPass = 'full' | 'mid' | 'skip';

export interface ProducerCadenceState {
    lastTick: number;
    lastMidAt: number;
}

export interface ProducerCadenceDecision {
    pass: ProducerPass;
    /** Updated cadence state after this frame. */
    state: ProducerCadenceState;
    /** True when this frame first observes a new server tick. */
    tickAdvanced: boolean;
}

/** Mid-tick inventory/chat scan interval (ms). */
export const PRODUCER_MID_TICK_MS = 150;

export function decideProducerPass(
    tickCount: number,
    now: number,
    state: ProducerCadenceState,
    midIntervalMs: number = PRODUCER_MID_TICK_MS
): ProducerCadenceDecision {
    const tickAdvanced = tickCount !== state.lastTick;
    if (tickAdvanced || state.lastTick < 0) {
        return {
            pass: 'full',
            tickAdvanced: tickAdvanced || state.lastTick < 0,
            state: { lastTick: tickCount, lastMidAt: now }
        };
    }
    if (now - state.lastMidAt >= midIntervalMs) {
        return {
            pass: 'mid',
            tickAdvanced: false,
            state: { lastTick: state.lastTick, lastMidAt: now }
        };
    }
    return {
        pass: 'skip',
        tickAdvanced: false,
        state
    };
}
