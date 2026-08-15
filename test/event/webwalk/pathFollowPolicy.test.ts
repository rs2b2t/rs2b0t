import { describe, expect, test } from 'bun:test';
import {
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
