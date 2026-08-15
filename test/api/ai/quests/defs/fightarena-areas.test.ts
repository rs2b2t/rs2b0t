import { describe, expect, test } from 'bun:test';

import { FA_TILE, pocketOf } from '#/bot/api/ai/quests/defs/fightarena/areas.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('pocketOf', () => {
    test('the mainland stands are outside every pocket', () => {
        expect(pocketOf(FA_TILE.YANILLE_BANK)).toBe('outside');
        expect(pocketOf(FA_TILE.LADY_SERVIL)).toBe('outside');
        expect(pocketOf(FA_TILE.BARMAN)).toBe('outside');
        expect(pocketOf(FA_TILE.CHEST_STAND)).toBe('outside');
        expect(pocketOf(FA_TILE.DOOR1_OUTSIDE)).toBe('outside');
    });

    test('the guard corridor, the drunk guard and the arena door stand are the building', () => {
        expect(pocketOf(FA_TILE.DOOR1_INSIDE)).toBe('building');
        expect(pocketOf(FA_TILE.DRUNK_GUARD)).toBe('building');
        expect(pocketOf(FA_TILE.DOOR2_OUTSIDE)).toBe('building');
        expect(pocketOf(FA_TILE.JEREMY_DOOR_STAND)).toBe('building');
        expect(pocketOf(at(2609, 3149))).toBe('building');
    });

    test('the arena floor is its own pocket', () => {
        expect(pocketOf(FA_TILE.ARENA_CENTRE)).toBe('arena');
        expect(pocketOf(FA_TILE.DOOR2_INSIDE)).toBe('arena');
        expect(pocketOf(at(2583, 3160))).toBe('arena');
        expect(pocketOf(at(2606, 3170))).toBe('arena');
    });

    test('both cells win over the building rect they sit inside', () => {
        expect(pocketOf(at(2616, 3168))).toBe('jeremyCell');
        expect(pocketOf(at(2614, 3166))).toBe('jeremyCell');
        expect(pocketOf(at(2600, 3142))).toBe('prisonCell');
        expect(pocketOf(at(2598, 3142))).toBe('prisonCell');
    });

    test('the corridor tile beside each cell is still the building', () => {
        expect(pocketOf(at(2617, 3168))).toBe('building');
        expect(pocketOf(at(2602, 3142))).toBe('building');
    });

    test('an unknown or upper-level tile is outside', () => {
        expect(pocketOf(null)).toBe('outside');
        expect(pocketOf(undefined)).toBe('outside');
        expect(pocketOf(at(2600, 3160, 3))).toBe('outside');
    });
});
