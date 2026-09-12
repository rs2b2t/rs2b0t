// docs/decisions/multibox-telemetry-honesty.md
// Why: degradation is only visible against its own past, so a fine tier covers the minutes
// around an incident and a coarse tier answers "what did it look like an hour ago".

import { DiagRing } from '../runtime/diag/DiagRing.js';
import type { FrameSample } from '../runtime/diag/BotDiag.js';
import type { FreezeWatch } from '../runtime/diag/FreezeWatch.js';

export const HOT_INTERVAL_MS = 1000;
const HOT_CAPACITY = 600; // 10 minutes
export const COLD_INTERVAL_MS = 30_000;
const COLD_CAPACITY = 2880; // 24 hours

const BOT_FIELDS = ['logicMs', 'drawMs', 'logicMaxMs', 'drawMaxMs', 'logicCount', 'drawCount', 'ingame'] as const;
const WALL_FIELDS = ['botCount', 'stallMs', 'inputMaxMs', 'inputCount', 'freezeCount'] as const;

/** Fields that accumulate over a window; the rest carry their worst or latest value. */
const SUMMED = new Set<string>(['logicMs', 'drawMs', 'logicCount', 'drawCount', 'stallMs', 'inputCount']);

class Tier {
    readonly hot: DiagRing;
    readonly cold: DiagRing;
    private accumulator: number[];
    private accumulated = 0;

    constructor(private readonly fields: readonly string[]) {
        this.hot = new DiagRing(fields, HOT_CAPACITY, HOT_INTERVAL_MS);
        this.cold = new DiagRing(fields, COLD_CAPACITY, COLD_INTERVAL_MS);
        this.accumulator = new Array(fields.length).fill(0);
    }

    get bytes(): number {
        return this.hot.bytes + this.cold.bytes;
    }

    /**
     * The coarse tier aggregates rather than decimates: dropping 29 of every 30
     * samples would hide the spikes worth keeping.
     */
    push(at: number, values: number[]): void {
        this.hot.push(at, values);
        for (let i = 0; i < values.length; i++) {
            const field = this.fields[i];
            if (SUMMED.has(field)) {
                this.accumulator[i] += values[i];
            } else {
                this.accumulator[i] = Math.max(this.accumulator[i], values[i]);
            }
        }
        this.accumulated++;

        if (this.accumulated * HOT_INTERVAL_MS >= COLD_INTERVAL_MS) {
            this.cold.push(at, this.accumulator);
            this.accumulator.fill(0);
            this.accumulated = 0;
        }
    }
}

interface InputLatencySource {
    /** Worst input handler duration since the previous call, and how many landed. */
    drain(): { maxMs: number; count: number };
}

interface DiagSamplerOptions {
    collect: () => FrameSample[];
    freeze: FreezeWatch;
    input: InputLatencySource;
    wallClock?: () => number;
}

/** Bounded: spans are only kept long enough to attribute recent stalls. */
const SPAN_HISTORY = 512;

export class DiagSampler {
    private readonly bots = new Map<string, Tier>();
    private spans: { box: string; phase: string; start: number; end: number }[] = [];
    private readonly wall = new Tier(WALL_FIELDS);
    private readonly collect: () => FrameSample[];
    private readonly freeze: FreezeWatch;
    private readonly input: InputLatencySource;
    private readonly wallClock: () => number;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: DiagSamplerOptions) {
        this.collect = options.collect;
        this.freeze = options.freeze;
        this.input = options.input;
        this.wallClock = options.wallClock ?? ((): number => Date.now());
    }

    get bytes(): number {
        let total = this.wall.bytes;
        for (const tier of this.bots.values()) {
            total += tier.bytes;
        }
        return total;
    }

    /** One sampling tick. Separate from the timer so tests drive it directly. */
    sample(): void {
        const at = this.wallClock();
        const frames = this.collect();

        for (const frame of frames) {
            let tier = this.bots.get(frame.box);
            if (!tier) {
                tier = new Tier(BOT_FIELDS);
                this.bots.set(frame.box, tier);
            }
            tier.push(at, [
                frame.logicMs,
                frame.drawMs,
                frame.logicMaxMs,
                frame.drawMaxMs,
                frame.logicCount,
                frame.drawCount,
                frame.ingame ? 1 : 0
            ]);
            for (const span of frame.slowSpans) {
                this.spans.push({ box: frame.box, phase: span.phase, start: span.start, end: span.end });
            }
        }
        if (this.spans.length > SPAN_HISTORY) {
            this.spans = this.spans.slice(-SPAN_HISTORY);
        }

        const input = this.input.drain();
        this.wall.push(at, [frames.length, this.freeze.drainStallMs(), input.maxMs, input.count, this.freeze.snapshot().events.length]);
    }

    start(): void {
        if (this.timer !== null) {
            throw new Error('[rs2b0t] diagnostics sampler is already started');
        }
        this.timer = setInterval(() => this.sample(), HOT_INTERVAL_MS);
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Per-bot state as of `wallClockMs`, reading the coarse tier so it can reach
     * back hours. Returns only bots that existed then.
     */
    at(wallClockMs: number): Record<string, Record<string, number>> {
        const out: Record<string, Record<string, number>> = {};
        for (const [box, tier] of this.bots) {
            const row = tier.cold.at(wallClockMs) ?? tier.hot.at(wallClockMs);
            if (row) {
                out[box] = row;
            }
        }
        return out;
    }

    /**
     * "It was fine an hour ago" made mechanical: the same fields then and now,
     * with the delta, sorted by the bot whose logic cost grew most.
     */
    compare(agoMs: number): { agoMs: number; then: number; now: number; bots: { box: string; field: string; then: number; now: number; delta: number }[] } {
        const now = this.wallClock();
        const then = now - agoMs;
        const past = this.at(then);
        const present = this.at(now);

        const rows: { box: string; field: string; then: number; now: number; delta: number }[] = [];
        for (const [box, nowRow] of Object.entries(present)) {
            const thenRow = past[box];
            if (!thenRow) {
                continue;
            }
            for (const field of BOT_FIELDS) {
                const a = thenRow[field];
                const b = nowRow[field];
                if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
                    rows.push({ box, field, then: a, now: b, delta: b - a });
                }
            }
        }
        rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
        return { agoMs, then, now, bots: rows };
    }

    /**
     * Which bots were mid-phase during a stall.
     * Why: a stall is only detected once it ends, so the suspect is whoever's span overlapped the window, not whoever is running when the record is written.
     */
    blame(at: number, stallMs: number): { box: string; phase: string; overlapMs: number }[] {
        const from = at - stallMs;
        const hits: { box: string; phase: string; overlapMs: number }[] = [];
        for (const span of this.spans) {
            const overlap = Math.min(span.end, at) - Math.max(span.start, from);
            if (overlap > 0) {
                hits.push({ box: span.box, phase: span.phase, overlapMs: overlap });
            }
        }
        return hits.sort((a, b) => b.overlapMs - a.overlapMs);
    }

    /** Everything a reader needs, JSON-safe, for a one-call dump. */
    snapshot(): Record<string, unknown> {
        const bots: Record<string, unknown> = {};
        for (const [box, tier] of this.bots) {
            bots[box] = {
                hot: Object.fromEntries(BOT_FIELDS.map(f => [f, [...tier.hot.series(f)]])),
                cold: Object.fromEntries(BOT_FIELDS.map(f => [f, [...tier.cold.series(f)]])),
                hotAt: [...tier.hot.timestamps()],
                coldAt: [...tier.cold.timestamps()]
            };
        }
        const freeze = this.freeze.snapshot();
        return {
            takenAt: this.wallClock(),
            bytes: this.bytes,
            retention: { hotMs: HOT_CAPACITY * HOT_INTERVAL_MS, coldMs: COLD_CAPACITY * COLD_INTERVAL_MS },
            wall: {
                hot: Object.fromEntries(WALL_FIELDS.map(f => [f, [...this.wall.hot.series(f)]])),
                cold: Object.fromEntries(WALL_FIELDS.map(f => [f, [...this.wall.cold.series(f)]])),
                hotAt: [...this.wall.hot.timestamps()],
                coldAt: [...this.wall.cold.timestamps()]
            },
            freezes: {
                events: freeze.events.map(e => ({ ...e, blame: this.blame(e.at, e.stallMs).slice(0, 3) })),
                dropped: freeze.dropped,
                worstMs: freeze.worstMs,
                probes: freeze.probes
            },
            bots
        };
    }
}
