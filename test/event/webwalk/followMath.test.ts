import { describe, expect, test } from 'bun:test';
import {
    chooseCrossClick,
    crossingEligible,
    locateOnPath,
    minChebyshevToPath,
    selectClientWalkTarget,
    selectClickTarget,
    shouldApproachClosedBarrier,
    starvedTerminalIndex,
    type PathTileLike
} from '#/bot/event/webwalk/geometry/followMath.js';

const t = (x: number, z: number, level = 0): PathTileLike => ({ x, z, level });

function switchback(): PathTileLike[] {
    const tiles: PathTileLike[] = [];
    for (let x = 0; x <= 30; x++) tiles.push(t(x, 0));
    tiles.push(t(30, 1));
    for (let x = 30; x >= 0; x--) tiles.push(t(x, 2));
    return tiles;
}

describe('locateOnPath', () => {
    const tiles = switchback();
    test('advances to the furthest on-corridor index in the window', () => {
        expect(locateOnPath(tiles, t(12, 0), 10, 26, 3)).toBe(15);
    });
    test('returns -1 when off-corridor', () => {
        expect(locateOnPath(tiles, t(12, 9), 10, 26, 3)).toBe(-1);
    });
    test('level mismatch never matches', () => {
        expect(locateOnPath(tiles, t(12, 0, 1), 10, 26, 3)).toBe(-1);
    });
    test('does not jump across a transport when the path folds nearby', () => {
        const folded = [t(0, 0), t(1, 0), t(2, 0), t(3, 0), t(3, 1), t(2, 1), t(1, 1), t(0, 1)];
        expect(locateOnPath(folded, t(0, 0), 0, 20, 1)).toBe(7);
        expect(locateOnPath(folded, t(0, 0), 0, 20, 1, 3)).toBe(1);
    });
});

describe('selectClickTarget', () => {
    const tiles = switchback();
    test('targets by path index, not straight-line distance', () => {
        expect(selectClickTarget(tiles, 15, 20, tiles.length - 1, 0, () => true)).toBe(35);
    });
    test('pulls back to the first clickable tile', () => {
        expect(selectClickTarget(tiles, 15, 20, tiles.length - 1, 0, tile => tiles.indexOf(tile) <= 30)).toBe(30);
    });
    test('clamps to limitIdx (crossing approach)', () => {
        expect(selectClickTarget(tiles, 15, 20, 25, 0, () => true)).toBe(25);
    });
    test('-1 when nothing clickable ahead', () => {
        expect(selectClickTarget(tiles, 15, 20, tiles.length - 1, 0, () => false)).toBe(-1);
    });
    test('skips tiles on another level', () => {
        expect(selectClickTarget(tiles, 15, 20, tiles.length - 1, 3, () => true)).toBe(-1);
    });
});

describe('selectClientWalkTarget', () => {
    const tiles = [t(0, 0), t(1, 0), t(2, 0), t(3, 0), t(4, 0), t(5, 0)];

    test('picks furthest tile where tryWalk succeeds', () => {
        const tried: number[] = [];
        const idx = selectClientWalkTarget(tiles, 0, 20, 5, 0, () => true, i => {
            tried.push(i);
            return i === 3; // far ones fail, 3 works
        });
        expect(idx).toBe(3);
        // Far→near order: 5,4,3 then stop
        expect(tried).toEqual([5, 4, 3]);
    });

    test('returns -1 when every tryWalk fails', () => {
        expect(selectClientWalkTarget(tiles, 0, 20, 5, 0, () => true, () => false)).toBe(-1);
    });

    test('skips unclickable before tryWalk', () => {
        const tried: number[] = [];
        selectClientWalkTarget(tiles, 0, 20, 5, 0, tile => tile.x !== 5, i => {
            tried.push(i);
            return false;
        });
        expect(tried).not.toContain(5);
        expect(tried[0]).toBe(4);
    });
});

describe('starvedTerminalIndex', () => {
    const CORRIDOR = 3;
    const WINDOW = 26;

    test('cheb-1 claim: starved selection falls back to the terminal', () => {
        const tiles = [t(2667, 3312), t(2668, 3312)];
        const me = t(2667, 3312);
        const pathIdx = locateOnPath(tiles, me, 0, WINDOW, CORRIDOR);
        expect(pathIdx).toBe(1);
        expect(selectClickTarget(tiles, pathIdx, 20, tiles.length - 1, 0, () => true)).toBe(-1);
        expect(starvedTerminalIndex(tiles, me, () => true)).toBe(1);
    });

    test('cheb-2 stand swap: starved from the very first iteration, rescued', () => {
        const tiles = [t(2669, 3310), t(2670, 3310), t(2670, 3311), t(2670, 3312), t(2669, 3312), t(2668, 3312)];
        const me = t(2669, 3310);
        const pathIdx = locateOnPath(tiles, me, 0, WINDOW, CORRIDOR);
        expect(pathIdx).toBe(5);
        expect(selectClickTarget(tiles, pathIdx, 20, tiles.length - 1, 0, () => true)).toBe(-1);
        expect(starvedTerminalIndex(tiles, me, () => true)).toBe(5);
    });

    test('standing ON the terminal is arrival, not a click', () => {
        const tiles = [t(2667, 3312), t(2668, 3312)];
        expect(starvedTerminalIndex(tiles, t(2668, 3312), () => true)).toBe(-1);
    });

    test('unclickable terminal (genuinely blocked booth) keeps the honest blocked verdict', () => {
        const tiles = [t(2667, 3312), t(2668, 3312)];
        expect(starvedTerminalIndex(tiles, t(2667, 3312), () => false)).toBe(-1);
    });

    test('terminal on another level is never clicked', () => {
        const tiles = [t(2667, 3312), t(2668, 3312, 1)];
        expect(starvedTerminalIndex(tiles, t(2667, 3312), () => true)).toBe(-1);
    });

    test('empty path is a no-op', () => {
        expect(starvedTerminalIndex([], t(2667, 3312), () => true)).toBe(-1);
    });
});

describe('crossingEligible', () => {
    const approach = t(10, 10);
    const far = t(10, 11, 1);

    test('fires when proximate to the approach tile and it is reachable', () => {
        expect(crossingEligible(t(8, 8), approach, far, 4, () => true)).toBe(true);
    });

    test('does NOT fire on proximity to the far tile alone (no opportunistic snap)', () => {
        const farApproach = t(0, 0);
        const nearLanding = t(20, 20);
        expect(crossingEligible(t(20, 21), farApproach, nearLanding, 4, () => true)).toBe(false);
    });

    test('does NOT fire when the approach tile is unreachable (ladder behind a wall)', () => {
        expect(crossingEligible(t(9, 10), approach, far, 4, () => false)).toBe(false);
    });

    test('does NOT fire from a different level than the approach', () => {
        expect(crossingEligible(t(10, 9, 1), approach, far, 4, () => true)).toBe(false);
    });

    test('does NOT run the reach probe when out of trigger range', () => {
        let probed = false;
        expect(
            crossingEligible(t(30, 30), approach, far, 4, () => {
                probed = true;
                return true;
            })
        ).toBe(false);
        expect(probed).toBe(false);
    });
});

describe('chooseCrossClick', () => {
    test('open edge → walk onto the step tile itself', () => {
        expect(chooseCrossClick(true, true)).toBe('step');
        expect(chooseCrossClick(true, false)).toBe('step');
    });
    test('edge blocked by the swung leaf but landing routable → gated click', () => {
        expect(chooseCrossClick(false, true)).toBe('landing-click');
    });
    test('edge blocked and no route to landing → raw scene-step', () => {
        expect(chooseCrossClick(false, false)).toBe('landing-scene');
    });
});

describe('shouldApproachClosedBarrier', () => {
    const approach = t(3106, 3162);

    test('walks onto the approach while the diagonal door is shut', () => {
        expect(shouldApproachClosedBarrier(t(3106, 3161), approach, true)).toBe(true);
    });

    test('crosses instead of retrying the tile occupied by the open leaf', () => {
        expect(shouldApproachClosedBarrier(t(3106, 3161), approach, false)).toBe(false);
    });
});


describe('minChebyshevToPath', () => {
    test('nearest same-level path tile', () => {
        const tiles = [t(0, 0), t(5, 0), t(10, 0)];
        expect(minChebyshevToPath(tiles, t(6, 1), 0, 10)).toBe(1);
    });
    test('ignores other levels', () => {
        const tiles = [t(0, 0, 1), t(5, 0, 1)];
        expect(minChebyshevToPath(tiles, t(0, 0, 0), 0, 10)).toBe(Number.POSITIVE_INFINITY);
    });
});
