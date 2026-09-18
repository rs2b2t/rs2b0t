// docs/decisions/multibox-telemetry-honesty.md
// Why: Firefox Event Timing measures input queueing and handler time directly; CPU samples cannot.

const DEFAULT_THRESHOLD_MS = 100;

interface InputLatencyReading {
    maxMs: number;
    count: number;
}

interface EventTimingEntry {
    duration: number;
    name: string;
}

interface ObserverLike {
    observe(options: { type: string; durationThreshold?: number; buffered?: boolean }): void;
    disconnect(): void;
}

type ObserverFactory = (onEntries: (entries: EventTimingEntry[]) => void) => ObserverLike;

export class InputLatency {
    private maxMs = 0;
    private count = 0;
    private worstName = '';
    private observer: ObserverLike | null = null;

    constructor(
        private readonly makeObserver: ObserverFactory,
        private readonly thresholdMs: number = DEFAULT_THRESHOLD_MS
    ) {}

    /** Requires Event Timing so unsupported browsers do not report a false zero. */
    start(): void {
        if (this.observer) {
            throw new Error('[rs2b0t] input latency observer is already started');
        }
        this.observer = this.makeObserver(entries => {
            for (const entry of entries) {
                this.count++;
                if (entry.duration > this.maxMs) {
                    this.maxMs = entry.duration;
                    this.worstName = entry.name;
                }
            }
        });
        this.observer.observe({ type: 'event', durationThreshold: this.thresholdMs, buffered: true });
    }

    stop(): void {
        this.observer?.disconnect();
        this.observer = null;
    }

    get worstEvent(): string {
        return this.worstName;
    }

    drain(): InputLatencyReading {
        const out = { maxMs: this.maxMs, count: this.count };
        this.maxMs = 0;
        this.count = 0;
        return out;
    }
}

/** Throws when the API is absent, so the wall never runs a blind sampler. */
export function browserObserverFactory(scope: typeof globalThis = globalThis): ObserverFactory {
    const Ctor = (scope as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    const supported = Ctor?.supportedEntryTypes;
    if (!Ctor || !supported || !supported.includes('event')) {
        throw new Error('[rs2b0t] this browser has no Event Timing; input latency cannot be measured');
    }
    return onEntries =>
        new Ctor(list => {
            onEntries(list.getEntries() as unknown as EventTimingEntry[]);
        }) as unknown as ObserverLike;
}
