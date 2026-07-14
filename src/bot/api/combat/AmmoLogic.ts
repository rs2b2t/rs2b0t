/**
 * Pure decision core for ranged ground-ammo collection (no client imports).
 * Fired ammo lands on the target's tile; the engine merges OUR stackable
 * drops per tile and the client exposes the live count (OBJ_COUNT), so a
 * stack's size is readable. Every merge resets the server despawn timer, so
 * an actively-fed stack persists — only stacks that STOPPED growing age out,
 * which is what `sinceChangeMs` measures.
 */

export interface AmmoStack {
    /** Stable identity for a stack: its tile (e.g. "x|z|level"). */
    key: string;
    count: number;
    /** ms since the stack's count last changed (0 for just-seen/just-grown). */
    sinceChangeMs: number;
}

export interface CollectOptions {
    /** Collect a stack once it reaches this many (the "mature" rule). */
    collectAt: number;
    /** Collect stacks unchanged for this long — despawn safety backstop. */
    staleMs: number;
    /** Out of ammo NOW → grab everything on the ground. */
    quiverEmpty: boolean;
    /** About to bank/reset/solve-clue → sweep everything before leaving. */
    leavingField: boolean;
}

/** Keys of the stacks worth collecting right now, input order preserved. */
export function planAmmoCollection(stacks: AmmoStack[], opts: CollectOptions): string[] {
    const all = opts.quiverEmpty || opts.leavingField;
    return stacks.filter(s => all || s.count >= opts.collectAt || s.sinceChangeMs >= opts.staleMs).map(s => s.key);
}

/** Tracks per-tile stack counts across loop iterations so the planner can see
 *  how long each stack has sat unchanged. Feed it every observation. */
export class AmmoStackTracker {
    private seen = new Map<string, { count: number; changedAt: number }>();

    observe(stacks: { key: string; count: number }[], nowMs: number): void {
        const alive = new Set(stacks.map(s => s.key));
        for (const key of [...this.seen.keys()]) {
            if (!alive.has(key)) {
                this.seen.delete(key); // picked up or despawned
            }
        }
        for (const s of stacks) {
            const prev = this.seen.get(s.key);
            if (!prev || prev.count !== s.count) {
                this.seen.set(s.key, { count: s.count, changedAt: nowMs });
            }
        }
    }

    stacks(nowMs: number): AmmoStack[] {
        return [...this.seen.entries()].map(([key, s]) => ({ key, count: s.count, sinceChangeMs: nowMs - s.changedAt }));
    }

    reset(): void {
        this.seen.clear();
    }
}
