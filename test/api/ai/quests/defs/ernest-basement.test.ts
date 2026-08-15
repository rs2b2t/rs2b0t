import { describe, expect, test } from 'bun:test';

import { CHAIN, DOOR_OPEN, REGION_BOX, basementRegion } from '#/bot/api/ai/quests/defs/ernest/basement.js';

const LEVER = { A: 1 << 0, B: 1 << 1, C: 1 << 2, D: 1 << 3, E: 1 << 4, F: 1 << 5 };
const boxes = Object.entries(REGION_BOX);

describe('Ernest basement geography', () => {
    test('every region box is disjoint from every other', () => {
        // Why: a tile naming a room is what lets each leg be a plain walk.
        for (const [aName, a] of boxes) {
            for (const [bName, b] of boxes) {
                if (aName === bName) {
                    continue;
                }
                const overlaps = a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;
                expect(overlaps, `${aName} overlaps ${bName}`).toBe(false);
            }
        }
    });

    test('the landmarks fall in the rooms the chain assumes', () => {
        expect(basementRegion({ x: 3116, z: 9754, level: 0 })).toBe('entry');
        expect(basementRegion({ x: 3092, z: 9755, level: 0 })).toBe('r9');
        expect(basementRegion({ x: 3111, z: 9761, level: 0 })).toBe('r1r4');
        expect(basementRegion({ x: 3097, z: 9765, level: 0 })).toBe('r3');
    });

    test('anything outside the basement, or on another level, is outside', () => {
        expect(basementRegion({ x: 3093, z: 3243, level: 0 })).toBe('outside');
        expect(basementRegion({ x: 3116, z: 9754, level: 1 })).toBe('outside');
        expect(basementRegion(null)).toBe('outside');
    });
});

describe('Ernest basement chain', () => {
    test('every move is legal in the bit state it runs in', () => {
        // Levers start UP (bits 0); ~reset_haunted_levers clears them on the ladder.
        let bits = 0;
        for (const move of CHAIN) {
            if (move.kind === 'pull') {
                bits ^= LEVER[move.lever];
                const isDown = (bits & LEVER[move.lever]) !== 0;
                expect(isDown, `lever ${move.lever} should end ${move.to}`).toBe(move.to === 'down');
            } else {
                expect(DOOR_OPEN[move.door]!(bits), `${move.door} closed at step`).toBe(true);
            }
        }
    });

    test('every crossing starts in the region its stand is in and lands in another', () => {
        for (const move of CHAIN) {
            if (move.kind !== 'door') {
                continue;
            }
            const from = basementRegion(move.stand);
            const to = basementRegion(move.arrive);
            expect(from, `${move.door} stand is outside`).not.toBe('outside');
            expect(to, `${move.door} arrival is outside`).not.toBe('outside');
            expect(from, `${move.door} does not change room`).not.toBe(to);
        }
    });

    test('ends holding C, D and F down — which keeps 8to9 open for the walk out', () => {
        let bits = 0;
        for (const move of CHAIN) {
            if (move.kind === 'pull') {
                bits ^= LEVER[move.lever];
            }
        }
        expect(bits).toBe(LEVER.C | LEVER.D | LEVER.F);
        expect(DOOR_OPEN['8to9']!(bits)).toBe(true);
    });

    test('undoing the chain in reverse is legal, which is what recovery relies on', () => {
        const states: number[] = [];
        let bits = 0;
        for (const move of CHAIN) {
            states.push(bits);
            if (move.kind === 'pull') {
                bits ^= LEVER[move.lever];
            }
        }
        for (let i = CHAIN.length - 1; i >= 0; i--) {
            const move = CHAIN[i]!;
            if (move.kind === 'door') {
                expect(DOOR_OPEN[move.door]!(states[i]!), `${move.door} not re-crossable`).toBe(true);
            }
        }
    });

    test('ends in the oil-can room', () => {
        const last = CHAIN[CHAIN.length - 1]!;
        expect(last.kind).toBe('door');
        expect(last.kind === 'door' && basementRegion(last.arrive)).toBe('r9');
    });
});
