/**
 * Pure decision core for the resilient walk ladder (no client imports → runs
 * under plain `bun test`). `advance` is a state machine: given the player's
 * progress toward the target and how the last strategy ended, it picks the next
 * strategy. The impure driver (Traversal.walkResilient) executes the action and
 * feeds the outcome back. Escalation within one "pass": baked → (big-budget
 * baked on a budget failure) → client-scene → unstick → backoff, then repeat.
 * ANY progress (distance-to-target dropped) restarts the pass at baked.
 */

export type ProbeOutcome = 'probe-fresh' | 'probe-dead';
export type LastOutcome = 'arrived' | 'closest' | 'budget' | 'failed' | 'interrupted' | ProbeOutcome | null;

type LadderAction =
    | { kind: 'baked'; bigBudget: boolean }
    | { kind: 'scene' }
    | { kind: 'unstick' }
    | { kind: 'backoff'; ticks: number }
    | { kind: 'verify' }
    | { kind: 'unreachable' }
    | { kind: 'arrived' }
    | { kind: 'interrupted' };

type StepPhase = 'baked' | 'scene' | 'unstick' | 'verify';

export interface LadderState {
    /** Best (smallest) Chebyshev distance to the target seen so far. */
    bestDist: number;
    /** Consecutive full passes (baked→scene→unstick) that made no progress. */
    noProgressPasses: number;
    /** The strategy the LAST executed action ran (what advance decides FROM). */
    phase: StepPhase;
    /** Whether the big-budget baked retry was already spent this pass. */
    triedBigBudget: boolean;
}

export interface LadderObs {
    /** Current Chebyshev distance to the target. */
    curDist: number;
    /** Genuinely within the requested arrival radius. */
    withinRadius: boolean;
    /** A random event / Stop is pending — yield now. */
    interrupted: boolean;
    /** How the action just executed ended (null = none yet / just backed off). */
    lastOutcome: LastOutcome;
}

const BACKOFF_MIN = 2;
const BACKOFF_MAX = 16;

/** Consecutive fully-exhausted no-progress passes before the driver is asked to
 *  run a verification probe (a big-budget path request). A dead/stale probe then
 *  terminates the walk with an honest `unreachable` instead of retrying forever. */
export const UNREACHABLE_PASSES = 3;

export function initialLadderState(curDist: number): LadderState {
    return { bestDist: curDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
}

/** Growing, capped backoff (in game ticks) between no-progress passes. */
export function backoffTicks(noProgressPasses: number): number {
    return Math.min(BACKOFF_MAX, BACKOFF_MIN + 2 * Math.max(0, noProgressPasses - 1));
}

/** A path failure reason is a budget-exhaustion (retryable with more budget) or
 *  a genuine failure. */
export function classifyReason(reason: string): 'budget' | 'failed' {
    return /budget/i.test(reason) ? 'budget' : 'failed';
}

export function advance(state: LadderState, obs: LadderObs): { action: LadderAction; state: LadderState } {
    if (obs.interrupted || obs.lastOutcome === 'interrupted') {
        return { action: { kind: 'interrupted' }, state };
    }
    if (obs.withinRadius) {
        return { action: { kind: 'arrived' }, state };
    }

    const progressed = obs.curDist < state.bestDist;
    const bestDist = Math.min(state.bestDist, obs.curDist);

    // Progress anywhere → restart the pass fresh at baked.
    if (progressed) {
        return { action: { kind: 'baked', bigBudget: false }, state: { bestDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false } };
    }

    // Start of a pass (first call, or just finished a backoff wait).
    if (obs.lastOutcome === null) {
        return { action: { kind: 'baked', bigBudget: false }, state: { bestDist, noProgressPasses: state.noProgressPasses, phase: 'baked', triedBigBudget: false } };
    }

    // A verification probe just ran (the driver fed its judgement back).
    if (state.phase === 'verify') {
        if (obs.lastOutcome === 'probe-dead') {
            // No path, or the same plan that already failed to be followed —
            // re-walking it provably gains nothing. Honest terminal.
            return { action: { kind: 'unreachable' }, state };
        }
        // probe-fresh: the probe found a NEW plan — reset the exhaustion
        // counter and go again from baked after a short backoff.
        return { action: { kind: 'backoff', ticks: backoffTicks(1) }, state: { bestDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false } };
    }

    // No progress — escalate within the pass by the phase of the action just run.
    if (state.phase === 'baked') {
        if (obs.lastOutcome === 'budget' && !state.triedBigBudget) {
            return { action: { kind: 'baked', bigBudget: true }, state: { ...state, bestDist, phase: 'baked', triedBigBudget: true } };
        }
        return { action: { kind: 'scene' }, state: { ...state, bestDist, phase: 'scene' } };
    }
    if (state.phase === 'scene') {
        return { action: { kind: 'unstick' }, state: { ...state, bestDist, phase: 'unstick' } };
    }
    // phase === 'unstick' → pass exhausted. After UNREACHABLE_PASSES of these,
    // ask the driver to VERIFY before another blind retry; otherwise back off
    // and start a new pass at baked.
    const passes = state.noProgressPasses + 1;
    if (passes >= UNREACHABLE_PASSES) {
        return { action: { kind: 'verify' }, state: { ...state, bestDist, noProgressPasses: passes, phase: 'verify' } };
    }
    return { action: { kind: 'backoff', ticks: backoffTicks(passes) }, state: { bestDist, noProgressPasses: passes, phase: 'baked', triedBigBudget: false } };
}

// 8 neighbours, clockwise from North; the unstick maneuver steps to the first
// reachable one starting at a caller-rotated offset (so repeated unsticks vary).
const DIRS: readonly { dx: number; dz: number }[] = [
    { dx: 0, dz: 1 }, { dx: 1, dz: 1 }, { dx: 1, dz: 0 }, { dx: 1, dz: -1 },
    { dx: 0, dz: -1 }, { dx: -1, dz: -1 }, { dx: -1, dz: 0 }, { dx: -1, dz: 1 }
];

export interface StepOffset { dx: number; dz: number }

/** First reachable neighbour offset (rotating from `startDir`), or null. */
export function pickUnstickStep(canStep: (dx: number, dz: number) => boolean, startDir: number): StepOffset | null {
    for (let i = 0; i < DIRS.length; i++) {
        const d = DIRS[(startDir + i) % DIRS.length];
        if (canStep(d.dx, d.dz)) {
            return { dx: d.dx, dz: d.dz };
        }
    }
    return null;
}

export interface ProbeResult {
    ok: boolean;
    terminal: { x: number; z: number; level: number } | null;
}

/** Judge a verification probe: dead when no path exists, or when the fresh
 *  plan's terminal repeats the previous probe's terminal — that plan was
 *  already tried and could not be followed, so re-walking it gains nothing. */
export function judgeProbe(prev: { x: number; z: number; level: number } | null, probe: ProbeResult): ProbeOutcome {
    if (!probe.ok || probe.terminal === null) {
        return 'probe-dead';
    }
    if (prev && prev.x === probe.terminal.x && prev.z === probe.terminal.z && prev.level === probe.terminal.level) {
        return 'probe-dead';
    }
    return 'probe-fresh';
}
