import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Navigator } from '../nav/Navigator.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { WalkExecutor, type WalkOptions } from '../nav/WalkExecutor.js';
import { advance, initialLadderState, pickUnstickStep, type LadderState, type LastOutcome } from '../nav/walkLadder.js';
import { Reachability } from './Reachability.js';
import { EventSignal } from './EventSignal.js';
import { Execution } from './Execution.js';

export interface WalkResilientOptions {
    /** Arrive when within this Chebyshev distance of dest. */
    radius: number;
    /** Bound the escalation to this many baked-walk passes. Default: undefined =
     *  retry forever (the walker never gives up; only a random event / Stop ends
     *  it early). Set a number for a bounded caller. */
    attempts?: number;
    /** Per baked-walk budget (default 90s — several fit one recovery window). */
    timeoutMs?: number;
    /** Client-scene-walk arrival radius when bridging a baked gap (default = radius+1). */
    sceneRadius?: number;
    /** Big-budget baked retry's node budget (default 1.2M). */
    maxBudget?: number;
    /** Progress lines. */
    log?: (msg: string) => void;
}

const SCENE_TIMEOUT_MS = 6000; // short: return to the ladder promptly to re-check events/progress
const DEFAULT_MAX_BUDGET = 1_200_000;
const PROGRESS_LOG_MS = 15_000;

export const Traversal = {
    /** Walk to `dest` anywhere in the world (baked graph + doors + transports).
     *  True on arrival (within opts.radius, default 2), false on failure/timeout. */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        return WalkExecutor.walkTo(dest, opts);
    },

    /**
     * Tenacious world-walk: an escalation ladder (baked → bigger-budget baked →
     * client-scene walk → unstick maneuver → backoff) driven by the pure
     * `walkLadder` state machine, looping until it genuinely arrives within
     * `radius`. Retries FOREVER by default — returns false ONLY when a random
     * event / Stop interrupts (a yield, not a give-up; the runtime
     * Supervisor→StallGuard is the backstop for a truly impossible target). Pass
     * `attempts` to bound it. Sleeps via Execution.* so Stop unwinds it.
     */
    async walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean> {
        const log = opts.log ?? ((): void => {});
        const radius = opts.radius;
        const sceneRadius = opts.sceneRadius ?? radius + 1;
        const maxBudget = opts.maxBudget ?? DEFAULT_MAX_BUDGET;
        const bakedTimeout = opts.timeoutMs ?? 90000;
        const maxPasses = opts.attempts; // undefined = forever

        const dist = (): number => {
            const me = reader.worldTile();
            return me ? Math.max(Math.abs(me.x - dest.x), Math.abs(me.z - dest.z)) : Number.POSITIVE_INFINITY;
        };
        const withinRadius = (): boolean => {
            const me = reader.worldTile();
            return me !== null && me.level === dest.level && Math.max(Math.abs(me.x - dest.x), Math.abs(me.z - dest.z)) <= radius;
        };

        let state: LadderState = initialLadderState(dist());
        let lastOutcome: LastOutcome = null;
        let unstickDir = 0;
        let lastLoggedAt = performance.now();

        // Guard against the pathological empty-scene case where every observation
        // is Infinity (no player tile): a bounded safety cap on total iterations
        // that is astronomically above any real walk but prevents a hot spin if
        // reader.worldTile() is null forever.
        for (let iter = 0; iter < 100_000; iter++) {
            if (EventSignal.pending()) {
                log('walk interrupted by a random event — yielding to the runtime');
                return false;
            }

            const interrupted = lastOutcome === 'interrupted';
            const { action, state: next } = advance(state, { curDist: dist(), withinRadius: withinRadius(), interrupted, lastOutcome });
            state = next;

            if (action.kind === 'arrived') {
                return true;
            }
            if (action.kind === 'interrupted') {
                log('walk interrupted by a random event — yielding to the runtime');
                return false;
            }
            if (maxPasses !== undefined && state.noProgressPasses >= maxPasses) {
                log(`walkResilient: ${maxPasses} passes made no progress — stopping (bounded caller)`);
                return false;
            }

            if (performance.now() - lastLoggedAt > PROGRESS_LOG_MS) {
                lastLoggedAt = performance.now();
                log(`walkResilient: ${action.kind} toward (${dest.x},${dest.z}), best ${state.bestDist} tiles, pass ${state.noProgressPasses}`);
            }

            if (action.kind === 'baked') {
                await WalkExecutor.walkTo(dest, { radius, timeoutMs: bakedTimeout, log, ...(action.bigBudget ? { maxExpansions: maxBudget } : {}) });
                lastOutcome = WalkExecutor.lastOutcome;
            } else if (action.kind === 'scene') {
                await DirectNavigator.walkTo(dest, sceneRadius, SCENE_TIMEOUT_MS);
                lastOutcome = EventSignal.pending() ? 'interrupted' : 'failed'; // progress is read from the tile next iteration
            } else if (action.kind === 'unstick') {
                await WalkExecutor.tryNearbyDoor(log);
                const me = reader.worldTile();
                if (me) {
                    const step = pickUnstickStep((dx, dz) => Reachability.canStep(me, { x: me.x + dx, z: me.z + dz, level: me.level }), unstickDir);
                    unstickDir = (unstickDir + 3) % 8;
                    if (step) {
                        await DirectNavigator.walkTo({ x: me.x + step.dx, z: me.z + step.dz, level: me.level }, 0, 3000);
                    }
                }
                lastOutcome = 'failed';
            } else if (action.kind === 'backoff') {
                await Execution.delayTicks(action.ticks);
                lastOutcome = null; // a new pass starts at baked
            }
        }
        log('walkResilient: iteration cap hit (no player tile?) — yielding');
        return false;
    },

    /** Spawn the nav worker + load the collision pack ahead of first walkTo. */
    preload(): void {
        Navigator.start();
    },

    /** Remaining tile count of the walk in progress (0 when idle). */
    remaining(): number {
        return WalkExecutor.remaining;
    }
};

export type { WalkOptions };
