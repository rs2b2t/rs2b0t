import { describe, expect, test } from 'bun:test';
import { CUBE_PARTS, solveCube } from './StrangeBox.js';

// pack ids (rs2b2t-content/pack/obj.pack): 3063 red triangle, 3071 blue
// square, 3085 yellow star, 3079 yellow circle, 3089 blue half moon
describe('solveCube', () => {
    test('answers a colour question by shape position', () => {
        expect(solveCube('What colour is the Star?', [3063, 3085, 3071])).toBe(1);
    });
    test('answers a shape question by colour position', () => {
        expect(solveCube('Which shape is Blue?', [3063, 3085, 3089])).toBe(2);
    });
    test('handles Half Moon (two-word shape)', () => {
        expect(solveCube('What colour is the Half Moon?', [3089, 3063, 3079])).toBe(0);
    });
    test('null on unknown question or missing models', () => {
        expect(solveCube('??', [3063, 3071, 3079])).toBeNull();
        expect(solveCube('What colour is the Star?', [null, 3063, 3071])).toBeNull();
    });
    test('part table covers all 15 combos', () => {
        expect(Object.keys(CUBE_PARTS)).toHaveLength(15);
    });
});
