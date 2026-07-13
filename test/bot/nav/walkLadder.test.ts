import { describe, expect, test } from 'bun:test';
import { advance, backoffTicks, classifyReason, initialLadderState, pickUnstickStep, type LadderObs, type LadderState } from '#/bot/nav/walkLadder.js';

const obs = (o: Partial<LadderObs>): LadderObs => ({ curDist: 10, withinRadius: false, interrupted: false, lastOutcome: null, ...o });

describe('initialLadderState', () => {
    test('seeds bestDist from the starting distance, fresh pass', () => {
        expect(initialLadderState(12)).toEqual({ bestDist: 12, noProgressPasses: 0, phase: 'baked', triedBigBudget: false });
    });
});

describe('advance — terminal outcomes', () => {
    test('within radius → arrived', () => {
        const r = advance(initialLadderState(10), obs({ withinRadius: true }));
        expect(r.action).toEqual({ kind: 'arrived' });
    });
    test('interrupted flag → interrupted', () => {
        const r = advance(initialLadderState(10), obs({ interrupted: true }));
        expect(r.action).toEqual({ kind: 'interrupted' });
    });
    test('lastOutcome interrupted → interrupted', () => {
        const r = advance(initialLadderState(10), obs({ lastOutcome: 'interrupted' }));
        expect(r.action).toEqual({ kind: 'interrupted' });
    });
});

describe('advance — first action + start of pass', () => {
    test('null lastOutcome runs a normal baked walk', () => {
        const r = advance(initialLadderState(10), obs({ lastOutcome: null }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: false });
        expect(r.state.phase).toBe('baked');
    });
});

describe('advance — escalation with no progress', () => {
    test('baked→budget-exceeded once → retry baked with big budget', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'budget' }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: true });
        expect(r.state.triedBigBudget).toBe(true);
    });
    test('baked→budget when big budget already tried → escalate to scene', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'baked', triedBigBudget: true };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'budget' }));
        expect(r.action).toEqual({ kind: 'scene' });
        expect(r.state.phase).toBe('scene');
    });
    test('baked→closest (no progress) → escalate to scene', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'closest' }));
        expect(r.action).toEqual({ kind: 'scene' });
    });
    test('scene (no progress) → unstick', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'scene', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'failed' }));
        expect(r.action).toEqual({ kind: 'unstick' });
        expect(r.state.phase).toBe('unstick');
    });
    test('unstick (no progress) → backoff, bumps passes, resets phase to baked', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'unstick', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'failed' }));
        expect(r.action.kind).toBe('backoff');
        expect(r.state.noProgressPasses).toBe(1);
        expect(r.state.phase).toBe('baked');
        expect(r.state.triedBigBudget).toBe(false);
    });
    test('after backoff (null lastOutcome) → baked again (new pass)', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 1, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: null }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: false });
    });
});

describe('advance — progress restarts the pass', () => {
    test('any progress resets to a fresh baked pass and clears noProgress', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 3, phase: 'unstick', triedBigBudget: true };
        const r = advance(s, obs({ curDist: 7, lastOutcome: 'closest' }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: false });
        expect(r.state).toEqual({ bestDist: 7, noProgressPasses: 0, phase: 'baked', triedBigBudget: false });
    });
    test('bestDist only ever decreases', () => {
        const s: LadderState = { bestDist: 5, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 9, lastOutcome: 'closest' }));
        expect(r.state.bestDist).toBe(5);
    });
});

describe('backoffTicks', () => {
    test('monotonic non-decreasing and capped', () => {
        const seq = [1, 2, 3, 5, 8, 20].map(backoffTicks);
        for (let i = 1; i < seq.length; i++) { expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]); }
        expect(backoffTicks(1)).toBeGreaterThanOrEqual(2);
        expect(backoffTicks(1000)).toBeLessThanOrEqual(16);
    });
});

describe('classifyReason', () => {
    test('budget messages classify as budget, others as failed', () => {
        expect(classifyReason('expansion budget exceeded (300000)')).toBe('budget');
        expect(classifyReason('unreachable')).toBe('failed');
        expect(classifyReason('path request timed out')).toBe('failed');
    });
});

describe('pickUnstickStep', () => {
    const OPEN = () => true;
    test('returns a step when a neighbour is reachable', () => {
        expect(pickUnstickStep(OPEN, 0)).toEqual({ dx: 0, dz: 1 });
    });
    test('rotates by startDir', () => {
        expect(pickUnstickStep(OPEN, 2)).toEqual({ dx: 1, dz: 0 });
    });
    test('skips blocked neighbours to the first reachable one', () => {
        // only West (dx:-1,dz:0) is open
        const onlyWest = (dx: number, dz: number): boolean => dx === -1 && dz === 0;
        expect(pickUnstickStep(onlyWest, 0)).toEqual({ dx: -1, dz: 0 });
    });
    test('returns null when nothing is reachable', () => {
        expect(pickUnstickStep(() => false, 0)).toBeNull();
    });
});
