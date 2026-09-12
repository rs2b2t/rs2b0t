// docs/decisions/multibox-telemetry-honesty.md
// Per-phase costs for one iframe, cleared whenever the wall samples them.

export type Phase = 'logic' | 'draw';

export const PHASES: readonly Phase[] = ['logic', 'draw'];

/** A long phase with its wall-clock window, used to attribute a completed stall. */
export interface SlowSpan {
    phase: Phase;
    /** Wall clock: every iframe has its own performance.now() origin, so only a shared clock lets the wall line a span up with a stall. */
    start: number;
    end: number;
}

/** Spans at or above this are worth keeping as freeze suspects. */
const SLOW_SPAN_MS = 50;

/** Bounded so a pathological bot cannot grow this without limit between drains. */
const SLOW_SPAN_CAPACITY = 64;

interface PhaseTotals {
    /** Summed ms in each phase since the last drain. */
    ms: Record<Phase, number>;
    /** Slowest single occurrence of each phase since the last drain. */
    maxMs: Record<Phase, number>;
    /** Occurrences of each phase since the last drain. */
    count: Record<Phase, number>;
    /** Long phases with their windows, for freeze attribution. */
    slowSpans: SlowSpan[];
}

function zeroed(): PhaseTotals {
    return {
        ms: { logic: 0, draw: 0 },
        maxMs: { logic: 0, draw: 0 },
        count: { logic: 0, draw: 0 },
        slowSpans: []
    };
}

export class PhaseTimer {
    private totals: PhaseTotals = zeroed();
    private depth = 0;

    constructor(
        private readonly box: string,
        private readonly wallClock: () => number = () => Date.now()
    ) {}

    // Why: synchronous on purpose; wrapping an async body counted every yield to other bots and read 4-13x above the true cost.
    // Why: only an uninterrupted synchronous run is main-thread occupancy.
    // Why: phases must not nest, since a nested span would be counted in both buckets.

    /** Times `body` into `phase`. */
    measure<T>(phase: Phase, body: () => T): T {
        if (this.depth !== 0) {
            throw new Error(`[rs2b0t] phase "${phase}" opened while another is already running on ${this.box}`);
        }
        this.depth++;
        const started = performance.now();
        try {
            return body();
        } finally {
            const ended = performance.now();
            const elapsed = ended - started;
            this.totals.ms[phase] += elapsed;
            this.totals.count[phase]++;
            if (elapsed > this.totals.maxMs[phase]) {
                this.totals.maxMs[phase] = elapsed;
            }
            if (elapsed >= SLOW_SPAN_MS && this.totals.slowSpans.length < SLOW_SPAN_CAPACITY) {
                const endedAt = this.wallClock();
                this.totals.slowSpans.push({ phase, start: endedAt - elapsed, end: endedAt });
            }
            this.depth--;
        }
    }

    /** Returns the totals accumulated since the previous drain and resets them. */
    drain(): PhaseTotals {
        const out = this.totals;
        this.totals = zeroed();
        return out;
    }
}
