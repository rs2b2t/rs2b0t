import { describe, expect, test } from 'bun:test';

import { beyondLeash, createReturnToAnchorTask, resolveRunAnchor, tileWithinLeash, type AnchorHost, type ReturnToAnchorOptions } from '#/bot/api/Anchor.js';
import { Game } from '#/bot/api/Game.js';
import Tile from '#/bot/api/Tile.js';

/**
 * Run `body` with no player position. Asserting on "there is no live tile" has to
 * establish it: another test file mocking Game leaves a tile behind, and this assertion
 * silently inverted whenever that file ran first.
 */
function withNoPlayerTile(body: () => void): void {
    const realTile = Game.tile;
    (Game as unknown as { tile: () => Tile | null }).tile = () => null;
    try {
        body();
    } finally {
        (Game as unknown as { tile: unknown }).tile = realTile;
    }
}

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

    test('soft return defaults: slack 6 / arrive disk 8 (createReturnToAnchorTask)', () => {
        // Humans re-enter the camp disk — beyondLeash with slack 6, arrive ≤ 8.
        const h = host(0, 0, 10);
        expect(beyondLeash(h, new Tile(16, 0, 0), 6)).toBe(false); // 16 <= 10+6
        expect(beyondLeash(h, new Tile(17, 0, 0), 6)).toBe(true);
        const anchor = new Tile(0, 0, 0);
        expect(anchor.distanceTo(new Tile(8, 0, 0))).toBeLessThanOrEqual(8);
        expect(anchor.distanceTo(new Tile(9, 0, 0))).toBeGreaterThan(8);
    });

    test('createReturnToAnchorTask accepts obstacle / long-range options', () => {
        const h = host(0, 0, 10);
        const opts: ReturnToAnchorOptions = {
            slack: 4,
            arriveRadius: 2,
            obstacles: ['door', 'gate'],
            longRangeTiles: 30,
            status: 'returning to anchor'
        };
        const task = createReturnToAnchorTask(h, opts);
        expect(typeof task.validate).toBe('function');
        expect(typeof task.execute).toBe('function');
        // Without a live Game.tile(), beyondLeash is false — task stays idle.
        withNoPlayerTile(() => {
            expect(task.validate()).toBe(false);
        });
    });
});
