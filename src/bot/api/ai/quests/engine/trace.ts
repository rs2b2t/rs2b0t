// Why: step tracing for the quest engine, where a leg keeps one description for its run: `smith 8 nails` covers mining 4 iron, mining 8 coal, 2 furnace trips and an anvil.
// Why: a log that prints a step once and suppresses repeats goes silent for minutes, which looks like a hang.

/** Re-announce a repeating step after this many attempts. */
export const HEARTBEAT_ATTEMPTS = 5;
/** Or after this long. */
export const HEARTBEAT_MS = 15_000;

/** A failing step never reaches the no-progress watchdog, so it warns on its own. */
export const FAIL_WARN = 5;

export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    if (ms < 60_000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

export function formatTile(tile: { x: number; z: number; level: number } | null | undefined): string {
    return tile ? `(${tile.x},${tile.z}${tile.level > 0 ? `,L${tile.level}` : ''})` : '(no tile)';
}

/** Inventory delta produced by one step. */
export function invDelta(before: Map<string, number>, after: Map<string, number>): string {
    const names = new Set([...before.keys(), ...after.keys()]);
    const parts: string[] = [];
    for (const name of [...names].sort()) {
        const a = before.get(name) ?? 0;
        const b = after.get(name) ?? 0;
        if (a !== b) {
            parts.push(`${name} ${a}→${b}`);
        }
    }
    return parts.length > 0 ? parts.join(', ') : 'no inventory change';
}

// Why: keyed on quest plus step description, since the engine re-decides from scratch every tick and "the same step" is only recognisable by its description.

/** Attempt counting and elapsed time for the step currently being retried. */
export class StepTracker {
    private key = '';
    private attempt = 0;
    private since = 0;
    private lastBeat = 0;

    /** Call once per tick before running the step. Returns the 1-based attempt number. */
    open(key: string, now: number): number {
        if (key !== this.key) {
            this.key = key;
            this.attempt = 0;
            this.since = now;
            this.lastBeat = now;
        }
        this.attempt++;
        return this.attempt;
    }

    attempts(): number {
        return this.attempt;
    }

    elapsed(now: number): number {
        return now - this.since;
    }

    /** True when a repeated step has been quiet long enough to say so again. */
    beat(now: number): boolean {
        if (this.attempt <= 1) {
            return false;
        }
        if (this.attempt % HEARTBEAT_ATTEMPTS === 0 || now - this.lastBeat >= HEARTBEAT_MS) {
            this.lastBeat = now;
            return true;
        }
        return false;
    }

    reset(): void {
        this.key = '';
        this.attempt = 0;
        this.since = 0;
        this.lastBeat = 0;
    }
}
