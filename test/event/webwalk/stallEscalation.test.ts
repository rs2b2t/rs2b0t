import { describe, expect, test } from 'bun:test';
import { findForwardRecoveryIndex, stallPhase } from '#/bot/event/webwalk/routeRecovery.js';
import { PATH_CORRIDOR, resolvePathFollowConfig } from '#/bot/event/webwalk/pathFollowPolicy.js';

// Why: the recovery window is capped at the tile before a hop, so a stall on the approach has nothing forward to click and repathing replans the same route.
describe('stall at a hop approach', () => {
    // ... 8 9 [10 = approach] [11 = door landing] 12 ...
    const tiles = Array.from({ length: 14 }, (_, i) => ({ x: 3200, z: 3200 + i, level: 0 }));
    const hopIdx = 11;
    const limitIdx = hopIdx - 1;
    const clickable = (): boolean => true;

    test('there is no forward recovery tile once path progress reaches the approach', () => {
        const me = tiles[limitIdx]!;
        expect(findForwardRecoveryIndex(tiles, me, limitIdx, clickable, { limitIdx })).toBe(-1);
    });

    test('and none either when the corridor snap has advanced onto the hop tile', () => {
        const me = tiles[hopIdx - 1]!;
        expect(findForwardRecoveryIndex(tiles, me, hopIdx, clickable, { limitIdx })).toBe(-1);
    });

    test('no recovery tile escalates instead of repathing', () => {
        expect(stallPhase({ stallRetries: 0, recoverIdx: -1, inCombat: false })).toBe('escalate');
    });

    test('a recovery tile is still tried first', () => {
        expect(stallPhase({ stallRetries: 0, recoverIdx: 7, inCombat: false })).toBe('recover');
    });

    test('a spent retry escalates', () => {
        expect(stallPhase({ stallRetries: 1, recoverIdx: 7, inCombat: false })).toBe('escalate');
    });

    test('combat holds course rather than opening doors', () => {
        expect(stallPhase({ stallRetries: 1, recoverIdx: -1, inCombat: true })).toBe('combat');
        // Recovery still wins over combat on the first stall — it is a click, not a fight.
        expect(stallPhase({ stallRetries: 0, recoverIdx: 7, inCombat: true })).toBe('recover');
    });
});

// Why: `locateOnPath` counts a tile reached from PATH_CORRIDOR away while clicks target indices after `pathIdx`, so a tighter hop trigger leaves a band with no clicks.
describe('hop trigger vs corridor snap', () => {
    test('the hop trigger is never tighter than the corridor snap', () => {
        expect(resolvePathFollowConfig().transportApproachChebyshev).toBeGreaterThanOrEqual(PATH_CORRIDOR);
    });

    test('a caller cannot tighten it below the corridor either', () => {
        expect(resolvePathFollowConfig({ transportApproachChebyshev: 0 }).transportApproachChebyshev)
            .toBeGreaterThanOrEqual(PATH_CORRIDOR);
    });

    test('a caller may still widen it', () => {
        expect(resolvePathFollowConfig({ transportApproachChebyshev: 8 }).transportApproachChebyshev).toBe(8);
    });
});
