import { describe, expect, test } from 'bun:test';
import { LOOT_GUARD, guarded } from '#/bot/scripts/JiveDemons/logic.js';

describe('guarded', () => {
    const demon = { tile: { x: 2860, z: 9781 }, size: 3 };

    test('a drop at a demon\'s feet is guarded', () => {
        expect(guarded({ x: 2862, z: 9784 }, [demon])).toBe(true);
    });

    test('the guard reaches the hunt range plus a tile, measured to the body, inclusive', () => {
        expect(LOOT_GUARD).toBe(4);
        expect(guarded({ x: 2856, z: 9786 }, [demon])).toBe(true);
        expect(guarded({ x: 2856, z: 9787 }, [demon])).toBe(false);
    });

    test('with no demon in the scene nothing is guarded', () => {
        expect(guarded({ x: 2862, z: 9784 }, [])).toBe(false);
    });

    test('any one demon in range guards the drop', () => {
        const far = { tile: { x: 2870, z: 9776 }, size: 3 };
        expect(guarded({ x: 2856, z: 9787 }, [far, demon])).toBe(false);
        expect(guarded({ x: 2856, z: 9786 }, [far, demon])).toBe(true);
    });
});
