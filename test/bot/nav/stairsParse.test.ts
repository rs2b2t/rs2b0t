import { describe, expect, test } from 'bun:test';
import { applyMovecoord, decodeCoord, parseSwitchStairs } from '../../../tools/nav/stairsParse.js';

describe('decodeCoord', () => {
    test('level_mx_mz_lx_lz → world x=mx*64+lx, z=mz*64+lz', () => {
        expect(decodeCoord('1_50_50_5_9')).toEqual({ x: 3205, z: 3209, level: 1 });
        expect(decodeCoord('0_50_50_4_7')).toEqual({ x: 3204, z: 3207, level: 0 });
    });
});

describe('applyMovecoord', () => {
    test('args are (dx, dLevel, dz) — middle is the level delta', () => {
        expect(applyMovecoord({ x: 3108, z: 3363, level: 0 }, [0, 1, 4])).toEqual({ x: 3108, z: 3367, level: 1 });
        expect(applyMovecoord({ x: 3108, z: 3364, level: 1 }, [0, -1, -4])).toEqual({ x: 3108, z: 3360, level: 0 });
    });
});

describe('parseSwitchStairs', () => {
    const FIXTURE = `
[oploc1,spiralstairs]
p_arrivedelay;
switch_coord (loc_coord) {
    case 0_50_50_4_7 : p_telejump(1_50_50_5_9); // Lumbridge Castle South - level 0
    case 0_50_53_55_29 : p_telejump(1_50_53_55_28); // Varrock East Bank - level 0
    case 0_48_52_36_35 : p_telejump(movecoord(coord, 0, 1, 4)); // Draynor manor - level 0
    case default : @unhandled_stairs(loc_coord);
}
`;
    test('parses literal + movecoord p_telejump cases, skips default', () => {
        const rows = parseSwitchStairs(FIXTURE);
        expect(rows).toEqual([
            { from: { x: 3204, z: 3207, level: 0 }, to: { x: 3205, z: 3209, level: 1 }, debugname: 'spiralstairs', op: 1 },
            { from: { x: 3255, z: 3421, level: 0 }, to: { x: 3255, z: 3420, level: 1 }, debugname: 'spiralstairs', op: 1 },
            { from: { x: 3108, z: 3363, level: 0 }, to: { x: 3108, z: 3367, level: 1 }, debugname: 'spiralstairs', op: 1 }
        ]);
    });
});
