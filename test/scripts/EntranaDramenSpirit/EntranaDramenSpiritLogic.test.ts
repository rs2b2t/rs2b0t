import { describe, expect, test } from 'bun:test';
import {
    CAVE_MONK_AGREE,
    RUNE_MIN,
    SAFE_SPOT,
    SPELL_LEVEL,
    TREE_STAND,
    canCastWindStrike,
    chebyshev,
    chopOp,
    classifyArea,
    climbDownOp,
    decide,
    isDramenTreeName,
    isSpiritName,
    isUnderground,
    magicStopReason,
    nextDescendAction,
    onSafeSpot,
    pickCaveMonkOption,
    runeShortage,
    runeStopReason,
    spiritDeadReason,
    type SpiritSnapshot
} from '#/bot/scripts/EntranaDramenSpirit/EntranaDramenSpiritLogic.js';

function snap(over: Partial<SpiritSnapshot> = {}): SpiritSnapshot {
    return {
        ingame: true,
        done: false,
        canContinue: false,
        monkOptions: [],
        magicLevel: 5,
        canCast: true,
        area: 'dungeon',
        runesProvisioned: true,
        hasBronzeAxe: true,
        spiritPresent: false,
        sawSpirit: false,
        onSafeSpot: false,
        distanceToTree: 0,
        ...over
    };
}

describe('classifyArea', () => {
    test('pins the Dramen room as dungeon and the surface ladder as Entrana', () => {
        expect(classifyArea(SAFE_SPOT)).toBe('dungeon');
        expect(classifyArea(TREE_STAND)).toBe('dungeon');
        expect(classifyArea({ x: 2822, z: 9774, level: 0 })).toBe('dungeon');
        expect(classifyArea({ x: 2820, z: 3374, level: 0 })).toBe('entrana');
        expect(classifyArea({ x: 2834, z: 3334, level: 1 })).toBe('entranaShip');
        expect(classifyArea({ x: 3093, z: 3243, level: 0 })).toBe('mainland');
        expect(classifyArea(null)).toBe('unknown');
    });

    test('isUnderground is the dungeon box, not any z >= 6400 tile off Entrana', () => {
        expect(isUnderground(SAFE_SPOT)).toBe(true);
        expect(isUnderground({ x: 3185, z: 9833, level: 0 })).toBe(false);
        expect(isUnderground({ x: 2820, z: 3374, level: 0 })).toBe(false);
    });
});

describe('onSafeSpot', () => {
    test('requires the exact tile, not a neighbour', () => {
        expect(onSafeSpot(SAFE_SPOT)).toBe(true);
        expect(onSafeSpot({ x: 2858, z: 9731, level: 0 })).toBe(false);
        expect(onSafeSpot({ x: 2859, z: 9732, level: 0 })).toBe(false);
        expect(onSafeSpot(null)).toBe(false);
    });
});

describe('names and loc ops', () => {
    test('spirit names match the Lost City npc, not a random tree', () => {
        expect(isSpiritName('Tree spirit')).toBe(true);
        expect(isSpiritName('Dramen Tree Spirit')).toBe(true);
        expect(isSpiritName('Dramen tree')).toBe(false);
        expect(isSpiritName(null)).toBe(false);
    });

    test('Dramen tree name requires both words', () => {
        expect(isDramenTreeName('Dramen Tree')).toBe(true);
        expect(isDramenTreeName('Dramen staff')).toBe(false);
        expect(isDramenTreeName('Oak tree')).toBe(false);
    });

    test('chop prefers Chop down over Cut', () => {
        expect(chopOp(['Examine', 'Chop down'])).toBe('Chop down');
        expect(chopOp(['Cut', 'Examine'])).toBe('Cut');
        expect(chopOp(['Examine'])).toBeNull();
    });

    test('climb-down matches Climb-down and a bare Climb', () => {
        expect(climbDownOp(['Climb-down', 'Examine'])).toBe('Climb-down');
        expect(climbDownOp(['Climb'])).toBe('Climb');
        expect(climbDownOp(['Climb-up'])).toBeNull();
    });
});

describe('canCastWindStrike', () => {
    test('needs Magic 1, a Mind rune, and air (rune or staff)', () => {
        expect(canCastWindStrike(0, [], () => 0)).toBe(false);
        expect(canCastWindStrike(1, [], name => (name === 'Mind rune' ? 5 : 0))).toBe(false);
        expect(canCastWindStrike(1, [], name => (name === 'Mind rune' ? 5 : name === 'Air rune' ? 5 : 0))).toBe(true);
        expect(canCastWindStrike(1, ['Staff of air'], name => (name === 'Mind rune' ? 5 : 0))).toBe(true);
        expect(canCastWindStrike(1, ['Staff of air'], () => 0)).toBe(false);
    });
});

describe('runeShortage', () => {
    test('passes at 200 of each and fails if either stack is short', () => {
        expect(runeShortage(RUNE_MIN, RUNE_MIN)).toBeNull();
        expect(runeShortage(500, 200)).toBeNull();
        expect(runeShortage(199, 500)).toBe(`bank has Air rune (199 < ${RUNE_MIN})`);
        expect(runeShortage(500, 0)).toBe(`bank has Mind rune (0 < ${RUNE_MIN})`);
        expect(runeShortage(10, 10)).toBe(`bank has Air rune (10 < ${RUNE_MIN}) and Mind rune (10 < ${RUNE_MIN})`);
    });
});

describe('pickCaveMonkOption', () => {
    test('picks the Lost City agree line out of the warning options', () => {
        expect(
            pickCaveMonkOption([
                "No thanks, I don't want to die.",
                CAVE_MONK_AGREE
            ])
        ).toBe(CAVE_MONK_AGREE);
        expect(pickCaveMonkOption(["I'll take my chances.", 'No thanks.'])).toBe("I'll take my chances.");
        expect(pickCaveMonkOption(['Hello.', 'No thanks.'])).toBeNull();
        expect(pickCaveMonkOption([])).toBeNull();
    });
});

describe('nextDescendAction', () => {
    test('talk first, climb only after the monk has warned us', () => {
        expect(nextDescendAction({ underground: true, dialogOpen: false, warned: false })).toBe('done');
        expect(nextDescendAction({ underground: false, dialogOpen: true, warned: false })).toBe('drive-dialog');
        expect(nextDescendAction({ underground: false, dialogOpen: false, warned: false })).toBe('open-dialog');
        expect(nextDescendAction({ underground: false, dialogOpen: false, warned: true })).toBe('climb-ladder');
        expect(nextDescendAction({ underground: false, dialogOpen: true, warned: true })).toBe('drive-dialog');
    });
});

describe('decide', () => {
    test('waits while logged out or already finished', () => {
        expect(decide(snap({ ingame: false }))).toEqual({ kind: 'wait' });
        expect(decide(snap({ done: true }))).toEqual({ kind: 'wait' });
    });

    test('continue beats everything else, then the cave-monk option', () => {
        expect(decide(snap({ canContinue: true, spiritPresent: true }))).toEqual({ kind: 'continue-dialog' });
        expect(decide(snap({ monkOptions: [CAVE_MONK_AGREE], area: 'entrana' }))).toEqual({ kind: 'pick-monk' });
    });

    test('stops when Magic is below Wind Strike', () => {
        expect(decide(snap({ magicLevel: 0 }))).toEqual({ kind: 'stop', reason: magicStopReason(0) });
        expect(SPELL_LEVEL).toBe(1);
    });

    test('mainland banks runes before walking to Entrana', () => {
        expect(decide(snap({ area: 'mainland', runesProvisioned: false }))).toEqual({ kind: 'bank-runes' });
        expect(decide(snap({ area: 'mainland', runesProvisioned: true }))).toEqual({ kind: 'enter-dungeon' });
        expect(decide(snap({ area: 'mainland', runesProvisioned: true, canCast: false }))).toEqual({
            kind: 'stop',
            reason: runeStopReason()
        });
    });

    test('Entrana surface and the ship both enter the dungeon', () => {
        expect(decide(snap({ area: 'entrana' }))).toEqual({ kind: 'enter-dungeon' });
        expect(decide(snap({ area: 'entranaShip' }))).toEqual({ kind: 'enter-dungeon' });
    });

    test('dungeon: spirit off the safespot runs there, on-spot casts', () => {
        expect(decide(snap({ spiritPresent: true, onSafeSpot: false }))).toEqual({ kind: 'run-to-safespot' });
        expect(decide(snap({ spiritPresent: true, onSafeSpot: true }))).toEqual({ kind: 'cast' });
    });

    test('dungeon: after the spirit was seen and has gone, the run is over', () => {
        expect(decide(snap({ sawSpirit: true, spiritPresent: false }))).toEqual({
            kind: 'stop',
            reason: spiritDeadReason()
        });
    });

    test('dungeon: no spirit and no Bronze axe farms zombies before chopping', () => {
        expect(decide(snap({ hasBronzeAxe: false, distanceToTree: 0 }))).toEqual({ kind: 'get-axe' });
        expect(decide(snap({ hasBronzeAxe: true, distanceToTree: 0 }))).toEqual({ kind: 'chop-tree' });
    });

    test('dungeon: with an axe, walk to the tree when it is more than 10 tiles away', () => {
        expect(decide(snap({ hasBronzeAxe: true, onSafeSpot: false, distanceToTree: 11 }))).toEqual({ kind: 'walk-to-tree' });
        expect(decide(snap({ hasBronzeAxe: true, onSafeSpot: false, distanceToTree: 10 }))).toEqual({ kind: 'chop-tree' });
    });

    test('a live spirit skips the axe grind even with no Bronze axe', () => {
        expect(decide(snap({ hasBronzeAxe: false, spiritPresent: true, onSafeSpot: true }))).toEqual({ kind: 'cast' });
    });

    test('out of runes in the dungeon stops rather than chopping', () => {
        expect(decide(snap({ canCast: false, hasBronzeAxe: true }))).toEqual({ kind: 'stop', reason: runeStopReason() });
    });
});

describe('chebyshev', () => {
    test('matches Tile.distanceTo on the same level', () => {
        expect(chebyshev(SAFE_SPOT, TREE_STAND)).toBe(Math.max(Math.abs(2859 - 2860), Math.abs(9731 - 9734)));
    });
});
