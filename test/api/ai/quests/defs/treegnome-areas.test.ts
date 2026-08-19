import { describe, expect, test } from 'bun:test';

import {
    TG_ITEM,
    TG_TILE,
    inChestFloor,
    inKhazardHall,
    inLadderRoom,
    inStronghold
} from '#/bot/api/ai/quests/defs/treegnome/areas.js';

const at = (x: number, z: number, level = 0): { x: number; z: number; level: number } => ({ x, z, level });

describe('Khazard stronghold rooms', () => {
    test('the crumbled-wall landing is the east hall', () => {
        expect(inKhazardHall(TG_TILE.HALL_LANDING)).toBe(true);
        expect(inLadderRoom(TG_TILE.HALL_LANDING)).toBe(false);
    });

    test('the ladder stand is the west room', () => {
        expect(inLadderRoom(TG_TILE.LADDER_STAND)).toBe(true);
        expect(inKhazardHall(TG_TILE.LADDER_STAND)).toBe(false);
    });

    // Why: the two rooms share x and z ranges, so a single box would answer for the wrong side of the inner door.
    test('the rows that overlap in z still separate the two rooms', () => {
        expect(inLadderRoom(at(2506, 3255))).toBe(true);
        expect(inKhazardHall(at(2506, 3255))).toBe(false);
        expect(inKhazardHall(at(2507, 3255))).toBe(true);
        expect(inLadderRoom(at(2507, 3255))).toBe(false);
    });

    test('the chest floor is level 1 only', () => {
        expect(inChestFloor(TG_TILE.CHEST_STAND)).toBe(true);
        expect(inChestFloor(at(2506, 3258))).toBe(false);
    });

    test('the tile the front door drops you on is outside', () => {
        expect(inStronghold(TG_TILE.OUTSIDE_FRONT_DOOR)).toBe(false);
        expect(inStronghold(TG_TILE.WALL_STAND)).toBe(false);
    });

    test('the battlefield and the village are outside', () => {
        expect(inStronghold(TG_TILE.MONTAI)).toBe(false);
        expect(inStronghold(TG_TILE.BOLREN)).toBe(false);
        expect(inStronghold(null)).toBe(false);
    });
});

describe('Tree Gnome Village items', () => {
    // Why: `orb_of_protection` and `orbs_of_protection` share a display name, and only the plural finishes the quest.
    test('the one orb and the two orbs differ by id alone', () => {
        expect(TG_ITEM.ORB.name).toBe(TG_ITEM.ORBS.name);
        expect(TG_ITEM.ORB.id).not.toBe(TG_ITEM.ORBS.id);
    });
});
