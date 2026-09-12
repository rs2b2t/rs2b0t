// docs/decisions/multibox-telemetry-honesty.md
// Why: a worker-backed timer keeps ticking through a main-thread freeze; its overshoot is the starvation time.

interface FreezeEvent {
    /** Wall clock when the stall was detected. */
    at: number;
    /** How far past the requested delay the resolve arrived. */
    stallMs: number;
}

interface FreezeWatchOptions {
    /** How often to probe. Shorter tightens the floor on measurable stalls. */
    probeMs?: number;
    /** Overshoot at or above this is recorded as a freeze. */
    thresholdMs?: number;
    /** Bound on retained events; freezes are sparse so this is cheap. */
    capacity?: number;
    sleep: (ms: number) => Promise<void>;
    now?: () => number;
    wallClock?: () => number;
}

const DEFAULT_PROBE_MS = 250;
const DEFAULT_THRESHOLD_MS = 250;
const DEFAULT_CAPACITY = 5000;

export class FreezeWatch {
    private readonly probeMs: number;
    private readonly thresholdMs: number;
    private readonly capacity: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;
    private readonly wallClock: () => number;

    private events: FreezeEvent[] = [];
    private dropped = 0;
    private worst = 0;
    private probes = 0;
    private stallTotal = 0;
    private active = false;

    constructor(options: FreezeWatchOptions) {
        this.probeMs = options.probeMs ?? DEFAULT_PROBE_MS;
        this.thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
        this.capacity = options.capacity ?? DEFAULT_CAPACITY;
        this.sleep = options.sleep;
        this.now = options.now ?? ((): number => performance.now());
        this.wallClock = options.wallClock ?? ((): number => Date.now());

        if (!Number.isFinite(this.probeMs) || this.probeMs <= 0) {
            throw new RangeError(`freeze probe interval must be positive, got ${this.probeMs}`);
        }
        if (!Number.isFinite(this.thresholdMs) || this.thresholdMs < 0) {
            throw new RangeError(`freeze threshold must be non-negative, got ${this.thresholdMs}`);
        }
    }

    /** Runs until stop(). Each iteration measures one probe's overshoot. */
    async run(): Promise<void> {
        if (this.active) {
            throw new Error('[rs2b0t] freeze watch is already running');
        }
        this.active = true;
        while (this.active) {
            const started = this.now();
            await this.sleep(this.probeMs);
            this.record(this.now() - started - this.probeMs);
        }
    }

    stop(): void {
        this.active = false;
    }

    /** Exposed so a single probe can be measured without running the loop. */
    record(stallMs: number): void {
        this.probes++;
        if (stallMs <= 0) {
            return;
        }
        this.stallTotal += stallMs;
        if (stallMs > this.worst) {
            this.worst = stallMs;
        }
        if (stallMs < this.thresholdMs) {
            return;
        }
        // Keep the earliest evidence: the first stalls of a degradation matter most, and a late flood must not evict them.
        if (this.events.length >= this.capacity) {
            this.dropped++;
            return;
        }
        // Attribution is the wall's job: a stall is only seen once it ends, so the suspect is whichever bot's phase overlapped the window (DiagSampler.blame).
        this.events.push({ at: this.wallClock(), stallMs });
    }

    snapshot(): { events: readonly FreezeEvent[]; dropped: number; worstMs: number; probes: number; stallTotalMs: number } {
        return {
            events: this.events,
            dropped: this.dropped,
            worstMs: this.worst,
            probes: this.probes,
            stallTotalMs: this.stallTotal
        };
    }

    /** Stall accumulated since the previous call, the per-sample series. */
    drainStallMs(): number {
        const out = this.stallTotal;
        this.stallTotal = 0;
        return out;
    }
}
