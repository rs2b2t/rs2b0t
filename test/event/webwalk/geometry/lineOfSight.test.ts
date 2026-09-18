import { describe, expect, test } from 'bun:test';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import { hasLineOfSightLocal } from '#/bot/event/webwalk/geometry/lineOfSight.js';

/** A 16x16 open scene with a few flagged tiles. */
function scene(set: Record<string, number> = {}): (lx: number, lz: number) => number | null {
    return (lx, lz) => {
        if (lx < 0 || lz < 0 || lx >= 16 || lz >= 16) {
            return null;
        }
        return set[`${lx},${lz}`] ?? CollisionFlag._OPEN;
    };
}

const one = (lx: number, lz: number) => ({ lx, lz, size: 1 });

describe('hasLineOfSightLocal', () => {
    test('open ground is seen along a row, a column and a diagonal', () => {
        expect(hasLineOfSightLocal(scene(), one(1, 1), one(8, 1))).toBe(true);
        expect(hasLineOfSightLocal(scene(), one(1, 1), one(1, 8))).toBe(true);
        expect(hasLineOfSightLocal(scene(), one(1, 1), one(6, 6))).toBe(true);
        expect(hasLineOfSightLocal(scene(), one(8, 8), one(2, 3))).toBe(true);
    });

    test('the same tile sees itself', () => {
        expect(hasLineOfSightLocal(scene(), one(3, 3), one(3, 3))).toBe(true);
    });

    test('a blockrange wall on the entered tile stops the ray, a walk-only wall does not', () => {
        expect(hasLineOfSightLocal(scene({ '5,1': CollisionFlag.V_W }), one(1, 1), one(8, 1))).toBe(false);
        expect(hasLineOfSightLocal(scene({ '5,1': CollisionFlag.W_W }), one(1, 1), one(8, 1))).toBe(true);
        expect(hasLineOfSightLocal(scene({ '1,5': CollisionFlag.V_S }), one(1, 1), one(1, 8))).toBe(false);
        expect(hasLineOfSightLocal(scene({ '1,5': CollisionFlag.V_N }), one(1, 8), one(1, 1))).toBe(false);
    });

    test('a rock that blocks range stops the ray, a table that only blocks walking does not', () => {
        expect(hasLineOfSightLocal(scene({ '5,1': CollisionFlag.VIS_SCENERY }), one(1, 1), one(8, 1))).toBe(false);
        expect(hasLineOfSightLocal(scene({ '5,1': CollisionFlag.WALK_SCENERY }), one(1, 1), one(8, 1))).toBe(true);
        expect(hasLineOfSightLocal(scene({ '4,4': CollisionFlag.VIS_SCENERY }), one(1, 1), one(6, 6))).toBe(false);
    });

    test('a rock on the target tile does not hide what stands on it', () => {
        expect(hasLineOfSightLocal(scene({ '8,1': CollisionFlag.VIS_SCENERY }), one(1, 1), one(8, 1))).toBe(true);
    });

    test('standing on scenery sees nothing', () => {
        expect(hasLineOfSightLocal(scene({ '1,1': CollisionFlag.WALK_SCENERY }), one(1, 1), one(8, 1))).toBe(false);
    });

    test('the edge of the scene is opaque', () => {
        expect(hasLineOfSightLocal(scene(), one(14, 1), one(20, 1))).toBe(false);
    });

    // Why: the engine aims the ray at the corner of a multi-tile footprint nearest the viewer, so a rock behind that corner is inside the body and never blocks.
    test('a size-3 body is seen at its nearest corner', () => {
        const body = { lx: 3, lz: 3, size: 3 };
        expect(hasLineOfSightLocal(scene({ '4,4': CollisionFlag.VIS_SCENERY }), one(8, 8), body)).toBe(true);
        expect(hasLineOfSightLocal(scene({ '6,6': CollisionFlag.VIS_SCENERY }), one(8, 8), body)).toBe(false);
        expect(hasLineOfSightLocal(scene({ '7,4': CollisionFlag.VIS_SCENERY }), one(9, 4), body)).toBe(false);
        expect(hasLineOfSightLocal(scene({ '2,4': CollisionFlag.VIS_SCENERY }), one(9, 4), body)).toBe(true);
    });

    test('a size-4 body reads from the viewer side as well', () => {
        const body = { lx: 5, lz: 5, size: 4 };
        expect(hasLineOfSightLocal(scene({ '3,3': CollisionFlag.VIS_SCENERY }), one(1, 1), body)).toBe(false);
        expect(hasLineOfSightLocal(scene({ '7,7': CollisionFlag.VIS_SCENERY }), one(1, 1), body)).toBe(true);
    });
});
