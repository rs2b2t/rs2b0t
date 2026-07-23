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
    bestDist: number;
    noProgressPasses: number;
    phase: StepPhase;
    triedBigBudget: boolean;
}

export interface LadderObs {
    curDist: number;
    withinRadius: boolean;
    interrupted: boolean;
    lastOutcome: LastOutcome;
}

const BACKOFF_MIN = 2;
const BACKOFF_MAX = 16;

export const UNREACHABLE_PASSES = 3;

export function initialLadderState(curDist: number): LadderState {
    return { bestDist: curDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
}

export function backoffTicks(noProgressPasses: number): number {
    return Math.min(BACKOFF_MAX, BACKOFF_MIN + 2 * Math.max(0, noProgressPasses - 1));
}

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

    if (progressed) {
        return { action: { kind: 'baked', bigBudget: false }, state: { bestDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false } };
    }

    if (obs.lastOutcome === null) {
        return { action: { kind: 'baked', bigBudget: false }, state: { bestDist, noProgressPasses: state.noProgressPasses, phase: 'baked', triedBigBudget: false } };
    }

    if (state.phase === 'verify') {
        if (obs.lastOutcome === 'probe-dead') {
            return { action: { kind: 'unreachable' }, state };
        }
        return { action: { kind: 'backoff', ticks: backoffTicks(1) }, state: { bestDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false } };
    }

    if (state.phase === 'baked') {
        if (obs.lastOutcome === 'budget' && !state.triedBigBudget) {
            return { action: { kind: 'baked', bigBudget: true }, state: { ...state, bestDist, phase: 'baked', triedBigBudget: true } };
        }
        return { action: { kind: 'scene' }, state: { ...state, bestDist, phase: 'scene' } };
    }
    if (state.phase === 'scene') {
        return { action: { kind: 'unstick' }, state: { ...state, bestDist, phase: 'unstick' } };
    }
    const passes = state.noProgressPasses + 1;
    if (passes >= UNREACHABLE_PASSES) {
        return { action: { kind: 'verify' }, state: { ...state, bestDist, noProgressPasses: passes, phase: 'verify' } };
    }
    return { action: { kind: 'backoff', ticks: backoffTicks(passes) }, state: { bestDist, noProgressPasses: passes, phase: 'baked', triedBigBudget: false } };
}

const DIRS: readonly { dx: number; dz: number }[] = [
    { dx: 0, dz: 1 }, { dx: 1, dz: 1 }, { dx: 1, dz: 0 }, { dx: 1, dz: -1 },
    { dx: 0, dz: -1 }, { dx: -1, dz: -1 }, { dx: -1, dz: 0 }, { dx: -1, dz: 1 }
];

export interface StepOffset { dx: number; dz: number }

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

export function judgeProbe(prev: { x: number; z: number; level: number } | null, probe: ProbeResult): ProbeOutcome {
    if (!probe.ok || probe.terminal === null) {
        return 'probe-dead';
    }
    if (prev && prev.x === probe.terminal.x && prev.z === probe.terminal.z && prev.level === probe.terminal.level) {
        return 'probe-dead';
    }
    return 'probe-fresh';
}
