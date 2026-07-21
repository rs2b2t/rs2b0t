import { describe, expect, test } from 'bun:test';
import { advance, initialLadderState, judgeProbe, UNREACHABLE_PASSES, type LadderState } from '#/bot/nav/walkLadder.js';

// Drive one full exhausted pass (baked fail → scene fail → unstick fail) and
// return the state advance leaves behind at the end of the pass.
function exhaustOnePass(state: LadderState, dist: number): { state: LadderState; endAction: string } {
    const obs = (last: 'failed' | null) => ({ curDist: dist, withinRadius: false, interrupted: false, lastOutcome: last });
    let r = advance(state, obs(null)); // start of pass → baked
    expect(r.action.kind).toBe('baked');
    r = advance(r.state, obs('failed')); // baked failed → scene
    expect(r.action.kind).toBe('scene');
    r = advance(r.state, obs('failed')); // scene failed → unstick
    expect(r.action.kind).toBe('unstick');
    r = advance(r.state, obs('failed')); // unstick failed → pass exhausted
    return { state: r.state, endAction: r.action.kind };
}

describe('walkLadder unreachable terminal', () => {
    test(`emits verify after ${UNREACHABLE_PASSES} exhausted passes`, () => {
        let state = initialLadderState(50);
        let endAction = '';
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            const r = exhaustOnePass(state, 50);
            state = r.state;
            endAction = r.endAction;
            if (pass < UNREACHABLE_PASSES) {
                expect(endAction).toBe('backoff');
                // backoff ends with lastOutcome=null → next advance starts a new pass
            }
        }
        expect(endAction).toBe('verify');
        expect(state.phase).toBe('verify');
    });

    test('verify + probe-dead → unreachable', () => {
        let state = initialLadderState(50);
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            state = exhaustOnePass(state, 50).state;
        }
        const r = advance(state, { curDist: 50, withinRadius: false, interrupted: false, lastOutcome: 'probe-dead' });
        expect(r.action.kind).toBe('unreachable');
    });

    test('verify + probe-fresh → backoff with the exhaustion counter reset', () => {
        let state = initialLadderState(50);
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            state = exhaustOnePass(state, 50).state;
        }
        const r = advance(state, { curDist: 50, withinRadius: false, interrupted: false, lastOutcome: 'probe-fresh' });
        expect(r.action.kind).toBe('backoff');
        expect(r.state.noProgressPasses).toBe(0);
        expect(r.state.phase).toBe('baked');
    });

    test('progress during the verify phase resets to baked (progressed branch wins)', () => {
        let state = initialLadderState(50);
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            state = exhaustOnePass(state, 50).state;
        }
        const r = advance(state, { curDist: 10, withinRadius: false, interrupted: false, lastOutcome: 'probe-fresh' });
        expect(r.action.kind).toBe('baked');
        expect(r.state.noProgressPasses).toBe(0);
    });
});

describe('judgeProbe', () => {
    const t = (x: number, z: number) => ({ x, z, level: 0 });
    test('no path → dead', () => {
        expect(judgeProbe(null, { ok: false, terminal: null })).toBe('probe-dead');
    });
    test('first fresh terminal → fresh', () => {
        expect(judgeProbe(null, { ok: true, terminal: t(10, 10) })).toBe('probe-fresh');
    });
    test('same terminal as the previous probe → dead (that plan already failed)', () => {
        expect(judgeProbe(t(10, 10), { ok: true, terminal: t(10, 10) })).toBe('probe-dead');
    });
    test('a NEW terminal → fresh', () => {
        expect(judgeProbe(t(10, 10), { ok: true, terminal: t(12, 10) })).toBe('probe-fresh');
    });
});
