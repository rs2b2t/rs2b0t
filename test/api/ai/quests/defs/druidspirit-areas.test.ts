import { describe, expect, test } from 'bun:test';

import { inCamp, inGrotto, inSwamp, NS_ID, NS_STAGE, NS_TILE } from '#/bot/api/ai/quests/defs/druidspirit/areas.js';

describe('nature spirit areas', () => {
    test('the swamp zone matches the inzone bounds the scripts use', () => {
        expect(inSwamp({ x: 3440, z: 3336, level: 0 })).toBe(true);
        expect(inSwamp({ x: 3392, z: 3328, level: 0 })).toBe(true);
        expect(inSwamp({ x: 3519, z: 3455, level: 0 })).toBe(true);
        expect(inSwamp({ x: 3391, z: 3336, level: 0 })).toBe(false);
        expect(inSwamp({ x: 3440, z: 3456, level: 0 })).toBe(false);
        expect(inSwamp({ x: 3440, z: 3336, level: 1 })).toBe(false);
    });

    test("Filliman's camp is the decay-free pocket inside the swamp", () => {
        expect(inCamp({ x: 3440, z: 3336, level: 0 })).toBe(true);
        expect(inCamp({ x: 3434, z: 3330, level: 0 })).toBe(true);
        expect(inCamp({ x: 3448, z: 3344, level: 0 })).toBe(true);
        expect(inCamp({ x: 3433, z: 3336, level: 0 })).toBe(false);
        expect(inCamp({ x: 3440, z: 3345, level: 0 })).toBe(false);
    });

    test('the grotto is the sealed pocket under the camp, on either level', () => {
        expect(inGrotto({ x: 3442, z: 9734, level: 0 })).toBe(true);
        expect(inGrotto({ x: 3442, z: 9734, level: 1 })).toBe(true);
        expect(inGrotto({ x: 3440, z: 3336, level: 0 })).toBe(false);
    });

    test('the two druid pouches are separate ids under one display name', () => {
        expect(NS_ID.POUCH_EMPTY).toBe(2957);
        expect(NS_ID.POUCH).toBe(2958);
    });

    test('the faith stone is the tile the ritual is judged from', () => {
        expect(NS_TILE.FAITH_STONE.x).toBe(3440);
        expect(NS_TILE.FAITH_STONE.z).toBe(3335);
    });

    test('stages match quest_druidspirit.constant', () => {
        expect(NS_STAGE.STARTED).toBe(5);
        expect(NS_STAGE.BLESSED).toBe(40);
        expect(NS_STAGE.PERFORMED_RITUAL).toBe(60);
        expect(NS_STAGE.BLESSED_SICKLE).toBe(75);
        expect(NS_STAGE.ADDED_POUCH).toBe(90);
        expect(NS_STAGE.KILLED_GHAST3).toBe(105);
    });
});
