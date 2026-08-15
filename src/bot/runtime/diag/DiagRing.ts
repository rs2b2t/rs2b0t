// docs/decisions/multibox-telemetry-honesty.md
// Why: an object per sample costs ~10x the bytes and adds GC pressure to the main thread being measured, so every series is a pre-allocated Float64Array and a sample is a strided write.

/** Slot value meaning "the sampler did not run" -- distinct from a 0. */
export const MISSING = Number.NaN;

export class DiagRing {
    readonly capacity: number;
    readonly fields: readonly string[];
    /** Wall-clock ms per sample, so a reader can date a slot without storing time twice. */
    readonly intervalMs: number;

    private readonly data: Float64Array;
    private readonly stamps: Float64Array;
    private readonly index: Map<string, number>;
    private writes = 0;

    constructor(fields: readonly string[], capacity: number, intervalMs: number) {
        if (fields.length === 0) {
            throw new RangeError('a diagnostics ring needs at least one field');
        }
        if (!Number.isSafeInteger(capacity) || capacity <= 0) {
            throw new RangeError(`diagnostics ring capacity must be a positive integer, got ${capacity}`);
        }
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new RangeError(`diagnostics ring interval must be positive, got ${intervalMs}`);
        }
        const index = new Map<string, number>();
        fields.forEach((name, i) => {
            if (index.has(name)) {
                throw new RangeError(`duplicate diagnostics field "${name}"`);
            }
            index.set(name, i);
        });

        this.fields = fields;
        this.capacity = capacity;
        this.intervalMs = intervalMs;
        this.index = index;
        this.data = new Float64Array(fields.length * capacity).fill(MISSING);
        this.stamps = new Float64Array(capacity).fill(MISSING);
    }

    get length(): number {
        return Math.min(this.writes, this.capacity);
    }

    /** Total samples ever written, including those already overwritten. */
    get written(): number {
        return this.writes;
    }

    get bytes(): number {
        return this.data.byteLength + this.stamps.byteLength;
    }

    /**
     * Values must be ordered as `fields`. A short or long row is a caller
     * bug that would silently shift every later column, so it throws.
     */
    push(at: number, values: ArrayLike<number>): void {
        if (values.length !== this.fields.length) {
            throw new RangeError(`diagnostics sample has ${values.length} values, expected ${this.fields.length}`);
        }
        const slot = this.writes % this.capacity;
        const base = slot * this.fields.length;
        for (let i = 0; i < values.length; i++) {
            this.data[base + i] = values[i];
        }
        this.stamps[slot] = at;
        this.writes++;
    }

    /** One field across the retained window, oldest first. */
    series(field: string): Float64Array {
        const col = this.index.get(field);
        if (col === undefined) {
            throw new RangeError(`unknown diagnostics field "${field}"`);
        }
        const len = this.length;
        const out = new Float64Array(len);
        const stride = this.fields.length;
        const start = this.writes - len;
        for (let i = 0; i < len; i++) {
            out[i] = this.data[((start + i) % this.capacity) * stride + col];
        }
        return out;
    }

    /** Sample timestamps aligned 1:1 with `series()`. */
    timestamps(): Float64Array {
        const len = this.length;
        const out = new Float64Array(len);
        const start = this.writes - len;
        for (let i = 0; i < len; i++) {
            out[i] = this.stamps[(start + i) % this.capacity];
        }
        return out;
    }

    /**
     * The newest sample at or before `at`. Answering "what did it look like an hour
     * ago" is the point of retention, so it is a first-class read.
     */
    at(wallClockMs: number): Record<string, number> | null {
        const stamps = this.timestamps();
        let found = -1;
        for (let i = stamps.length - 1; i >= 0; i--) {
            if (stamps[i] <= wallClockMs) {
                found = i;
                break;
            }
        }
        if (found < 0) {
            return null;
        }
        const start = this.writes - stamps.length;
        const base = ((start + found) % this.capacity) * this.fields.length;
        const row: Record<string, number> = {};
        this.fields.forEach((name, i) => {
            row[name] = this.data[base + i];
        });
        return row;
    }
}
