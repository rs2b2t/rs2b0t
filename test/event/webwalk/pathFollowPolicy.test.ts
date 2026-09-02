import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_DOOR_STEP_TICKS,
    DEFAULT_PATH_DEVIATION_CHEBYSHEV,
    DEFAULT_PATH_STALL_TICKS,
    DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV,
    resolvePathFollowConfig
} from '#/bot/event/webwalk/pathFollowPolicy.js';

describe('resolvePathFollowConfig', () => {
    test('defaults match observed client/baked path slop', () => {
        const c = resolvePathFollowConfig();
        expect(c.stallTicks).toBe(DEFAULT_PATH_STALL_TICKS);
        expect(c.deviationChebyshev).toBe(DEFAULT_PATH_DEVIATION_CHEBYSHEV);
        expect(c.transportApproachChebyshev).toBe(DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV);
        expect(c.stallTicks).toBe(5);
        expect(c.deviationChebyshev).toBe(10);
    });

    test('walk opts override defaults', () => {
        const c = resolvePathFollowConfig({ stallTicks: 15, deviationChebyshev: 12 });
        expect(c.stallTicks).toBe(15);
        expect(c.deviationChebyshev).toBe(12);
    });
});

describe('doorStepTicks', () => {
    test('defaults to one tick after the open leaf shows', () => {
        expect(DEFAULT_DOOR_STEP_TICKS).toBe(1);
        expect(resolvePathFollowConfig().doorStepTicks).toBe(1);
    });

    test('a walk can step on the open frame', () => {
        expect(resolvePathFollowConfig({ doorStepTicks: 0 }).doorStepTicks).toBe(0);
    });

    test('never waits a negative or fractional tick', () => {
        expect(resolvePathFollowConfig({ doorStepTicks: -3 }).doorStepTicks).toBe(0);
        expect(resolvePathFollowConfig({ doorStepTicks: 1.9 }).doorStepTicks).toBe(1);
    });
});
