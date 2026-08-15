import { describe, expect, test } from 'bun:test';
import { findForwardRecoveryIndex } from '#/bot/event/webwalk/routeRecovery.js';
import type { PathTileLike } from '#/bot/event/webwalk/geometry/followMath.js';

const t = (x: number, z: number, level = 0): PathTileLike => ({ x, z, level });

describe('findForwardRecoveryIndex', () => {
    const line: PathTileLike[] = [];
    for (let x = 0; x <= 40; x++) {
        line.push(t(x, 0));
    }

    test('returns furthest clickable ahead', () => {
        const me = t(5, 0);
        const idx = findForwardRecoveryIndex(line, me, 5, tile => tile.x <= 20);
        expect(idx).toBe(20);
    });

    test('returns -1 when nothing ahead', () => {
        const me = t(40, 0);
        expect(findForwardRecoveryIndex(line, me, 40, () => true)).toBe(-1);
    });

    test('respects limitIdx (before transport)', () => {
        const me = t(5, 0);
        const idx = findForwardRecoveryIndex(line, me, 5, () => true, { limitIdx: 12 });
        expect(idx).toBe(12);
    });

    test('skips wrong level', () => {
        const tiles = [t(0, 0), t(1, 0), t(2, 0, 1), t(3, 0)];
        const me = t(0, 0);
        const idx = findForwardRecoveryIndex(tiles, me, 0, () => true);
        expect(idx).toBe(3);
    });
});
