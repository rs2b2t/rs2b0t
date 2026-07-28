import { describe, expect, test } from 'bun:test';

import { beyondLeash, resolveRunAnchor, tileWithinLeash, type AnchorHost } from '#/bot/api/Anchor.js';
import Tile from '#/bot/api/Tile.js';

function host(ax: number, az: number, leash: number): AnchorHost {
    const anchor = new Tile(ax, az, 0);
    return {
        getAnchor: () => anchor,
        leashRadius: () => leash
    };
}

describe('Anchor helpers', () => {
    test('resolveRunAnchor prefers location spot', () => {
        const here = new Tile(100, 100, 0);
        const spot = new Tile(200, 200, 0);
        expect(resolveRunAnchor(here, spot)).toBe(spot);
        expect(resolveRunAnchor(here, null).x).toBe(100);
    });

    test('beyondLeash respects slack', () => {
        const h = host(0, 0, 10);
        expect(beyondLeash(h, new Tile(10, 0, 0), 0)).toBe(false);
        expect(beyondLeash(h, new Tile(11, 0, 0), 0)).toBe(true);
        expect(beyondLeash(h, new Tile(14, 0, 0), 4)).toBe(false);
        expect(beyondLeash(h, new Tile(15, 0, 0), 4)).toBe(true);
        expect(beyondLeash(h, null)).toBe(false);
    });

    test('tileWithinLeash', () => {
        const h = host(50, 50, 5);
        expect(tileWithinLeash(h, new Tile(55, 50, 0))).toBe(true);
        expect(tileWithinLeash(h, new Tile(56, 50, 0))).toBe(false);
        expect(tileWithinLeash(h, new Tile(56, 50, 0), 1)).toBe(true);
    });
});
