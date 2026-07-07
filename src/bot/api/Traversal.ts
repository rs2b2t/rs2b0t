import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Navigator } from '../nav/Navigator.js';
import { WalkExecutor, type WalkOptions } from '../nav/WalkExecutor.js';
import { Execution } from './Execution.js';

export interface WalkResilientOptions {
    /** Arrive when within this Chebyshev distance of dest. */
    radius: number;
    /** Retry attempts before giving up (default 3). */
    attempts?: number;
    /** Per-attempt walk budget (default 90s — shorter than walkTo's own 300s default so several reroutes fit in one overall recovery window). */
    timeoutMs?: number;
    /** Progress lines (forwarded into each walkTo attempt, plus this call's own retry/giveup lines). */
    log?: (msg: string) => void;
}

/**
 * Script-facing web-walking (Slice 5b): cross-world paths from the baked
 * collision pack + door/transport edges, executed as ordinary game clicks.
 */
export const Traversal = {
    /**
     * Walk to `dest` anywhere in the world, opening doors and taking known
     * transports on the way. Resolves true on arrival (within opts.radius,
     * default 2), false on failure/timeout. Sleeps via Execution.* only —
     * Stop unwinds it like any other script wait.
     */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        return WalkExecutor.walkTo(dest, opts);
    },

    /**
     * `walkTo` with retries (Task 6): each attempt is a fresh `walkTo` call,
     * so a stall/timeout reroutes from wherever the previous attempt left
     * off instead of failing outright. Resolves true as soon as any attempt
     * arrives; false after `attempts` failed tries — the caller should treat
     * that as "still stuck" and escalate (e.g. relog).
     */
    async walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean> {
        const attempts = opts.attempts ?? 3;
        for (let i = 0; i < attempts; i++) {
            const ok = await Traversal.walkTo(dest, { radius: opts.radius, timeoutMs: opts.timeoutMs ?? 90000, log: opts.log });
            if (ok) {
                return true;
            }
            // A random event interrupted the walk. We must NOT wait for it here:
            // walkResilient runs inside loop(), and the runtime only handles the
            // event once loop() unwinds (Scheduler gates the Supervisor on
            // !loopInFlight). Return now so the caller's task loop yields; the
            // caller re-walks from the current position on a later iteration,
            // after the Supervisor has cleared the event. WalkExecutor.lastOutcome
            // stays 'interrupted' so an escalating caller (the watchdog) can tell
            // this apart from a genuine failure.
            if (WalkExecutor.lastOutcome === 'interrupted') {
                opts.log?.('walk interrupted by a random event — yielding to the runtime');
                return false;
            }
            opts.log?.(`walkResilient: attempt ${i + 1}/${attempts} failed, rerouting`);
            await Execution.delayTicks(3);
        }
        return false;
    },

    /** Spawn the nav worker + load the collision pack ahead of the first
     *  walkTo (optional; walkTo does it lazily). */
    preload(): void {
        Navigator.start();
    },

    /** Remaining tile count of the walk in progress (0 when idle). */
    remaining(): number {
        return WalkExecutor.remaining;
    }
};

export type { WalkOptions };
