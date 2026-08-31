import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { SETTINGS as ENTRANA_SETTINGS } from '#/bot/scripts/EntranaChickenKiller/EntranaChickenKiller.js';
import {
    BANK_STAND,
    BANNED_GEAR_RE,
    CANT_REACH_RE,
    CHICKEN_CAMP,
    CAMP_RADIUS,
    COOP_GATE_RADIUS,
    DEATH_RE,
    SARIM_MONK_DOCK,
    TRAINABLE,
    canLootFeathers,
    clampLevels,
    fmtElapsed,
    fmtXph,
    inChickenCamp,
    isBoneName,
    isCoopBarrier,
    isFeatherName,
    isInsideCoop,
    isJunkName,
    isKeepOnBank,
    isOnEntrana,
    isOnSarimSide,
    isShutGate,
    isTrainableStyle,
    isUnderground,
    monkBoatOp,
    needsBankForBoat,
    pickMonkOption,
    refuseSarimMonk,
    shouldRotateStyle,
    shouldStayOnIsland,
    trainablePool
} from '#/bot/scripts/EntranaChickenKiller/EntranaChickenKillerLogic.js';

function loc(name: string, x: number, z: number, actions: string[]) {
    return {
        name,
        actions: () => actions,
        tile: () => new Tile(x, z, 0)
    };
}

describe('Entrana geography', () => {
    test('pins the chicken coop and the Port Sarim approach', () => {
        expect(CHICKEN_CAMP).toEqual(new Tile(2851, 3371, 0));
        expect(SARIM_MONK_DOCK).toEqual(new Tile(3048, 3235, 0));
        expect(BANK_STAND).toEqual(new Tile(3092, 3244, 0));
    });

    test('Entrana is west of Port Sarim and not the dungeon', () => {
        expect(isOnEntrana(CHICKEN_CAMP)).toBe(true);
        expect(isOnEntrana(new Tile(2834, 3335, 0))).toBe(true);
        expect(isOnEntrana(SARIM_MONK_DOCK)).toBe(false);
        expect(isOnEntrana(BANK_STAND)).toBe(false);
        expect(isOnEntrana(new Tile(3222, 3218, 0))).toBe(false);
        expect(isOnEntrana(new Tile(2851, 3371 + 6400, 0))).toBe(false);
        expect(isUnderground(new Tile(2820, 3374 + 6400, 0))).toBe(true);
    });

    test('Port Sarim side covers the monk dock and not Entrana', () => {
        expect(isOnSarimSide(SARIM_MONK_DOCK)).toBe(true);
        expect(isOnSarimSide(new Tile(3048, 3236, 1))).toBe(true);
        expect(isOnSarimSide(CHICKEN_CAMP)).toBe(false);
        expect(isOnSarimSide(BANK_STAND)).toBe(false);
    });

    test('the coop leash covers the fence pin and not the dock', () => {
        expect(isInsideCoop(CHICKEN_CAMP)).toBe(true);
        expect(inChickenCamp(new Tile(2851 + CAMP_RADIUS, 3371, 0))).toBe(true);
        expect(inChickenCamp(new Tile(2851 + CAMP_RADIUS + 1, 3371, 0))).toBe(false);
        expect(inChickenCamp(new Tile(2834, 3335, 0))).toBe(false);
        expect(inChickenCamp(SARIM_MONK_DOCK)).toBe(false);
    });

    test('stay-on-island covers the plank and refuses the return monk', () => {
        expect(shouldStayOnIsland(CHICKEN_CAMP)).toBe(true);
        expect(shouldStayOnIsland(new Tile(2834, 3331, 1))).toBe(true);
        expect(shouldStayOnIsland(SARIM_MONK_DOCK)).toBe(false);
        expect(refuseSarimMonk(CHICKEN_CAMP)).toBe(true);
        expect(refuseSarimMonk(new Tile(2949, 3200, 0))).toBe(true);
        expect(refuseSarimMonk(SARIM_MONK_DOCK)).toBe(false);
    });
});

describe('loot and bank rules', () => {
    test('classifies feathers, bones, junk, and bank keepers', () => {
        expect(isFeatherName('Feather')).toBe(true);
        expect(isFeatherName('Feathers')).toBe(true);
        expect(isBoneName('Bones')).toBe(true);
        expect(isBoneName('Big bones')).toBe(false);
        expect(isJunkName('Raw chicken')).toBe(true);
        expect(isJunkName('Egg')).toBe(true);
        expect(isJunkName('Eggs')).toBe(true);
        expect(isKeepOnBank('Feather')).toBe(true);
        expect(isKeepOnBank('Coins')).toBe(true);
        expect(isKeepOnBank('Bones')).toBe(false);
        expect(isKeepOnBank('Bronze sword')).toBe(false);
    });

    test('loots feathers into a full pack only when a feather stack is already held', () => {
        expect(canLootFeathers(false, 0)).toBe(true);
        expect(canLootFeathers(true, 0)).toBe(false);
        expect(canLootFeathers(true, 12)).toBe(true);
    });

    test('boats after a strip: empty worn slots, keep only feathers and coins', () => {
        expect(needsBankForBoat(true, [])).toBe(false);
        expect(needsBankForBoat(true, ['Feather', 'Coins'])).toBe(false);
        expect(needsBankForBoat(true, ['Feather', 'Bones'])).toBe(true);
        expect(needsBankForBoat(false, ['Feather'])).toBe(true);
        expect(needsBankForBoat(true, ['Bronze sword'])).toBe(true);
    });
});

describe('coop gate', () => {
    test('opens a shut gate on the coop fence and ignores the gangplank and distant doors', () => {
        const gate = loc('Gate', 2851, 3371, ['Open', 'Examine']);
        expect(isShutGate(gate)).toBe(true);
        expect(isCoopBarrier(gate)).toBe(true);

        const far = loc('Gate', 2851 + COOP_GATE_RADIUS + 1, 3371, ['Open']);
        expect(isCoopBarrier(far)).toBe(false);

        const plank = loc('Gangplank', 2834, 3335, ['Cross', 'Open']);
        expect(isShutGate(plank)).toBe(false);
        expect(isCoopBarrier(plank)).toBe(false);

        const openGate = loc('Gate', 2851, 3371, ['Close']);
        expect(isCoopBarrier(openGate)).toBe(false);
    });
});

describe('monk dialogue', () => {
    const options = ["Yes, okay, I'm ready to go.", 'No, not right now.'];

    test('picks the ready-to-go line on the Port Sarim side', () => {
        expect(pickMonkOption(options, false)).toBe("Yes, okay, I'm ready to go.");
    });

    test('refuses the boat once on Entrana', () => {
        expect(pickMonkOption(options, true)).toBe('No, not right now.');
    });

    test('prefers Take-boat over Talk-to', () => {
        expect(monkBoatOp(['Examine', 'Talk-to', 'Take-boat'])).toBe('Take-boat');
        expect(monkBoatOp(['Talk-to'])).toBe('Talk-to');
        expect(monkBoatOp([])).toBe('Talk-to');
    });
});

describe('combat style rotation', () => {
    test('rotates among attack, strength, and defence', () => {
        expect(TRAINABLE).toEqual(['attack', 'strength', 'defence']);
        expect(isTrainableStyle('attack')).toBe(true);
        expect(isTrainableStyle('controlled')).toBe(false);
        expect(trainablePool('attack')).toEqual(['strength', 'defence']);
        expect(trainablePool(null)).toEqual(['attack', 'strength', 'defence']);
    });

    test('swaps after N levels on the current style', () => {
        expect(shouldRotateStyle(6, 1, 5)).toBe(true);
        expect(shouldRotateStyle(5, 1, 5)).toBe(false);
        expect(clampLevels(0)).toBe(1);
        expect(clampLevels(150)).toBe(99);
        expect(clampLevels('nope')).toBe(5);
    });
});

describe('panel settings', () => {
    test('exposes rotate, swap interval, fixed melee style, and own-kill bury', () => {
        expect(ENTRANA_SETTINGS.rotateStyles).toMatchObject({ type: 'boolean', default: true });
        expect(ENTRANA_SETTINGS.levelsBeforeSwap).toMatchObject({
            type: 'number',
            default: 5,
            min: 1,
            max: 99,
            showIf: { key: 'rotateStyles', anyOf: ['true'] }
        });
        expect(ENTRANA_SETTINGS.meleeStyle).toMatchObject({
            type: 'string',
            default: 'attack',
            options: ['attack', 'strength', 'defence'],
            showIf: { key: 'rotateStyles', anyOf: ['false'] }
        });
        expect(ENTRANA_SETTINGS.buryBones).toMatchObject({ type: 'boolean', default: true });
    });
});

describe('chat and overlay helpers', () => {
    test('matches death, reach, and monk-search chat', () => {
        expect(DEATH_RE.test('Oh dear, you are dead!')).toBe(true);
        expect(CANT_REACH_RE.test("I can't reach that!")).toBe(true);
        expect(BANNED_GEAR_RE.test('You cannot take weapons or armour to holy Entrana.')).toBe(true);
    });

    test('formats overlay rates', () => {
        expect(fmtElapsed(65_000)).toBe('1:05');
        expect(fmtElapsed(3_661_000)).toBe('1:01:01');
        expect(fmtXph(12_340)).toBe('12.3k');
        expect(fmtXph(120_000)).toBe('120k');
        expect(fmtXph(40)).toBe('40');
    });
});
