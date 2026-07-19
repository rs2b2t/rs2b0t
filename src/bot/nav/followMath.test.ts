import { describe, expect, test } from 'bun:test';
import { chooseCrossClick, crossingEligible, locateOnPath, selectClickTarget, type PathTileLike } from './followMath.js';

const t = (x: number, z: number, level = 0): PathTileLike => ({ x, z, level });

/** A switchback: 30 tiles east on z=0, then back 30 tiles west on z=2 —
 *  index 0..30 outbound, 31 = (30,1), 32..62 return (32+k = (30-k, 2)). */
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
        // at (12,0), window [10,36), corridor 3: outbound x 9..15 match; the
        // return-leg tiles above (z=2) are indices 47..53 — outside the window
        expect(locateOnPath(tiles, t(12, 0), 10, 26, 3)).toBe(15);
    });
    test('returns -1 when off-corridor', () => {
        expect(locateOnPath(tiles, t(12, 9), 10, 26, 3)).toBe(-1);
    });
    test('level mismatch never matches', () => {
        expect(locateOnPath(tiles, t(12, 0, 1), 10, 26, 3)).toBe(-1);
    });
});

describe('selectClickTarget', () => {
    const tiles = switchback();
    test('targets by path index, not straight-line distance', () => {
        // player at index 15; steps=20 ⇒ target index 35 (early return leg)
        // even though its straight-line distance is tiny
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

describe('crossingEligible', () => {
    const approach = t(10, 10);
    const far = t(10, 11, 1); // stair hop: far endpoint on the level above

    test('fires when proximate to the approach tile and it is reachable', () => {
        expect(crossingEligible(t(8, 8), approach, far, 4, () => true)).toBe(true);
    });

    test('fires on proximity to the far tile too (horizontal), approach reachable', () => {
        expect(crossingEligible(t(10, 14), approach, far, 4, () => true)).toBe(true);
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
