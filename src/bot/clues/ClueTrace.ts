/**
 * Bounded per-solve trace for the clue executor. Every log line is stamped
 * with wall time + the player's tile so a failed solve can be reconstructed
 * after the fact — the panel's log ring is shared and shallow, and live-wall
 * failures were unreproducible without knowing WHERE each step stalled.
 * Clock/position/storage are injected so this stays unit-testable.
 */

export interface TraceLine {
    t: number;
    pos: string;
    m: string;
}

export interface TraceDump {
    clueId: number | null;
    name: string;
    reason: string;
    startedAt: number;
    endedAt: number;
    /** Trail legs completed this session before the dump (best guess). */
    legs: number;
    lines: TraceLine[];
}

const DEFAULT_CAP = 200;

export class ClueTrace {
    private readonly cap: number;
    private readonly now: () => number;
    private readonly pos: () => string;
    private buf: TraceLine[] = [];
    private clueId: number | null = null;
    private name = '';
    private startedAt = 0;

    constructor(opts?: { cap?: number; now?: () => number; pos?: () => string }) {
        this.cap = opts?.cap ?? DEFAULT_CAP;
        this.now = opts?.now ?? (() => Date.now());
        this.pos = opts?.pos ?? (() => '?');
    }

    /** Start tracing a new solve (drops the previous one). */
    begin(clueId: number | null, name: string): void {
        this.buf = [];
        this.clueId = clueId;
        this.name = name;
        this.startedAt = this.now();
    }

    note(m: string): void {
        this.buf.push({ t: this.now(), pos: this.pos(), m });
        if (this.buf.length > this.cap) {
            this.buf.shift();
        }
    }

    lines(): readonly TraceLine[] {
        return this.buf;
    }

    dump(reason: string, legs: number): TraceDump {
        return {
            clueId: this.clueId,
            name: this.name,
            reason,
            startedAt: this.startedAt,
            endedAt: this.now(),
            legs,
            lines: [...this.buf]
        };
    }
}

interface StringStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Prepend `dump` to the persisted failure ring (newest first, capped). */
export function pushTraceRing(storage: StringStorage, key: string, dump: TraceDump, max = 5): void {
    const ring = [dump, ...readTraceRing(storage, key)].slice(0, max);
    storage.setItem(key, JSON.stringify(ring));
}

export function readTraceRing(storage: StringStorage, key: string): TraceDump[] {
    const raw = storage.getItem(key);
    if (raw === null) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as TraceDump[]) : [];
    } catch {
        return [];
    }
}
