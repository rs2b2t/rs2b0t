import { describe, expect, test } from 'bun:test';
import {
    SAFESPOT_BLIND_MS,
    attackRangeFor,
    bodyOrigin,
    gapTo,
    holdDue,
    isClueObj,
    keyStatus,
    meleeShieldGate,
    nearestSpot,
    nextSafespot,
    retreatAim,
    retreatDue,
    wantsDrop
} from '#/bot/scripts/JiveDragons/logic.js';

describe('nextSafespot', () => {
    const base = { index: 0, spots: 3, hurt: false, blindMs: 0 };

    test('holds the current tile while nothing is wrong', () => {
        expect(nextSafespot(base)).toBe(0);
    });

    test('a hit on the safespot rotates to the next tile', () => {
        expect(nextSafespot({ ...base, hurt: true })).toBe(1);
    });

    test('going blind for the full window rotates too', () => {
        expect(nextSafespot({ ...base, blindMs: SAFESPOT_BLIND_MS })).toBe(1);
        expect(nextSafespot({ ...base, blindMs: SAFESPOT_BLIND_MS - 1 })).toBe(0);
    });

    test('rotation wraps rather than running off the end', () => {
        expect(nextSafespot({ ...base, index: 2, hurt: true })).toBe(0);
    });

    test('a single-tile site never rotates', () => {
        expect(nextSafespot({ ...base, spots: 1, hurt: true })).toBe(0);
    });
});

describe('retreatDue', () => {
    const hurt = { inLair: true, onSafespot: false, hpFrac: 0.42, retreatHp: 0.5, hasFood: true, spots: 3 };

    test('off the safespot and under the line, the run walks out of the fire', () => {
        expect(retreatDue(hurt)).toBe(true);
    });

    test('the tile the run already stands on is the one it would walk to', () => {
        expect(retreatDue({ ...hurt, onSafespot: true })).toBe(false);
    });

    test('the line is exclusive, so a run sitting on it keeps fighting', () => {
        expect(retreatDue({ ...hurt, hpFrac: 0.5 })).toBe(false);
        expect(retreatDue({ ...hurt, hpFrac: 0.49 })).toBe(true);
    });

    test('a 0 setting turns it off at every hp, and with an empty pack too', () => {
        expect(retreatDue({ ...hurt, hpFrac: 0.01, retreatHp: 0 })).toBe(false);
        expect(retreatDue({ ...hurt, hpFrac: 0.01, retreatHp: 0, hasFood: false })).toBe(false);
    });

    test('an empty pack walks out of the fire at any hp, since nothing heals in the lair', () => {
        expect(retreatDue({ ...hurt, hasFood: false, hpFrac: 0.99 })).toBe(true);
        expect(retreatDue({ ...hurt, hasFood: false, hpFrac: 0.05 })).toBe(true);
    });

    test('an empty pack on the safespot has arrived, so the bank run gets the loop', () => {
        expect(retreatDue({ ...hurt, hasFood: false, onSafespot: true, hpFrac: 0.99 })).toBe(false);
    });

    test('outside the lair, and at a site with no safespots, there is nowhere to run to', () => {
        expect(retreatDue({ ...hurt, inLair: false })).toBe(false);
        expect(retreatDue({ ...hurt, spots: 0 })).toBe(false);
    });
});

describe('holdDue', () => {
    test('a stocked run walks back to the fight tile wherever it is standing', () => {
        expect(holdDue({ onSafespot: true, hasFood: true })).toBe(true);
        expect(holdDue({ onSafespot: false, hasFood: true })).toBe(true);
    });

    test('an empty pack on a safespot stays put, so melee cannot shuttle to its anchor and back', () => {
        expect(holdDue({ onSafespot: true, hasFood: false })).toBe(false);
    });

    test('an empty pack off every safespot still walks, since the retreat is the walk', () => {
        expect(holdDue({ onSafespot: false, hasFood: false })).toBe(true);
    });
});

describe('nearestSpot', () => {
    const spots = [{ x: 2901, z: 9809 }, { x: 2900, z: 9809 }, { x: 2901, z: 9810 }];

    test('the tile the live run died on is six tiles from the spot it picks', () => {
        expect(nearestSpot({ x: 2898, z: 9803 }, spots)).toBe(0);
    });

    test('a tile west of the ladder picks the western spot', () => {
        expect(nearestSpot({ x: 2896, z: 9809 }, spots)).toBe(1);
    });

    test('distance is Chebyshev, so a diagonal counts as one step', () => {
        expect(nearestSpot({ x: 2902, z: 9811 }, spots)).toBe(2);
    });

    test('a tie goes to the earlier spot', () => {
        expect(nearestSpot({ x: 2900, z: 9810 }, spots)).toBe(0);
    });

    test('standing on one picks that one', () => {
        expect(nearestSpot(spots[1]!, spots)).toBe(1);
    });
});

describe('retreatAim', () => {
    const spots = [{ x: 2901, z: 9809 }, { x: 2900, z: 9809 }, { x: 2901, z: 9810 }];
    const anchor = { x: 2900, z: 9808 };

    test('a fresh retreat runs at the nearest spot and names the one after it', () => {
        expect(retreatAim({ rotated: null, from: anchor, spots })).toEqual({ index: 0, next: 1 });
    });

    test('a retry from the same tile keeps the rotation rather than picking the failed spot again', () => {
        expect(nearestSpot(anchor, spots)).toBe(0);
        expect(retreatAim({ rotated: 1, from: anchor, spots })).toEqual({ index: 1, next: 2 });
        expect(retreatAim({ rotated: 2, from: anchor, spots })).toEqual({ index: 2, next: 0 });
    });

    test('spot 0 is a rotation like any other, not an absent one', () => {
        expect(retreatAim({ rotated: 0, from: { x: 2896, z: 9809 }, spots })).toEqual({ index: 0, next: 1 });
    });

    test('a one-spot site has nowhere to rotate to', () => {
        expect(retreatAim({ rotated: null, from: anchor, spots: spots.slice(0, 1) })).toEqual({ index: 0, next: 0 });
    });
});

describe('meleeShieldGate', () => {
    test('melee without the shield is refused, naming where to get one', () => {
        const why = meleeShieldGate('melee', false);
        expect(why).toContain('Duke Horacio');
    });

    test('melee with the shield passes', () => {
        expect(meleeShieldGate('melee', true)).toBeNull();
    });

    test('a safespot is fire-proof, so mage and range never need it', () => {
        expect(meleeShieldGate('mage', false)).toBeNull();
        expect(meleeShieldGate('range', false)).toBeNull();
    });
});

describe('attackRangeFor', () => {
    test('melee is adjacency, a bow is 7 and a staff is 10', () => {
        expect(attackRangeFor('melee')).toBe(1);
        expect(attackRangeFor('range')).toBe(7);
        expect(attackRangeFor('mage')).toBe(10);
    });
});

describe('gapTo', () => {
    // Why: the engine measures range between the closest tiles of the two footprints, and the client reports a body at its centre tile.
    test('a size-3 body reported nine tiles off has its near face eight away, past a bow', () => {
        expect(gapTo({ x: 2856, z: 9786 }, { x: 2858, z: 9777 }, 3)).toBe(8);
        expect(gapTo({ x: 2856, z: 9786 }, { x: 2858, z: 9777 }, 3)).toBeGreaterThan(attackRangeFor('range'));
    });

    test('a size-4 dragon reads two closer on its north and east faces and three on its south and west', () => {
        expect(gapTo({ x: 2901, z: 9809 }, { x: 2899, z: 9804 }, 4)).toBe(4);
        expect(gapTo({ x: 2895, z: 9800 }, { x: 2899, z: 9804 }, 4)).toBe(2);
    });

    test('a tile beside or inside the footprint reads as adjacent or zero', () => {
        expect(gapTo({ x: 2900, z: 9808 }, { x: 2899, z: 9804 }, 4)).toBe(3);
        expect(gapTo({ x: 2898, z: 9806 }, { x: 2899, z: 9804 }, 4)).toBe(1);
        expect(gapTo({ x: 2898, z: 9803 }, { x: 2899, z: 9804 }, 4)).toBe(0);
    });

    test('a size-1 body is plain Chebyshev', () => {
        expect(gapTo({ x: 10, z: 10 }, { x: 13, z: 8 }, 1)).toBe(3);
    });
});

describe('keyStatus', () => {
    test('held beats banked beats a fetch', () => {
        expect(keyStatus(1, 3)).toBe('held');
        expect(keyStatus(0, 3)).toBe('bank');
        expect(keyStatus(0, 0)).toBe('fetch');
    });
});

describe('wantsDrop', () => {
    const filter = { loot: new Set(['dragonhide']), bankCommon: false, solveClues: false, buryBones: false, boneName: 'Dragon bones' };

    test('a ticked name is taken and an unticked one is left', () => {
        expect(wantsDrop({ id: 1753, name: 'Dragonhide' }, filter)).toBe(true);
        expect(wantsDrop({ id: 314, name: 'Feather' }, filter)).toBe(false);
    });

    test('unticking the bones box does not stop a burial run collecting them', () => {
        expect(wantsDrop({ id: 532, name: 'Dragon bones' }, filter)).toBe(false);
        expect(wantsDrop({ id: 532, name: 'Dragon bones' }, { ...filter, buryBones: true })).toBe(true);
    });

    test('clues are matched by id, since every hard trail displays the same name', () => {
        expect(isClueObj(2722)).toBe(true);
        expect(isClueObj(2714)).toBe(true);
        expect(isClueObj(995)).toBe(false);
        expect(wantsDrop({ id: 2722, name: 'Clue scroll' }, filter)).toBe(false);
        expect(wantsDrop({ id: 2722, name: 'Clue scroll' }, { ...filter, solveClues: true })).toBe(true);
    });

    test('the common-loot box takes a gem the loot list never mentions', () => {
        expect(wantsDrop({ id: 1623, name: 'Uncut sapphire' }, filter)).toBe(false);
        expect(wantsDrop({ id: 1623, name: 'Uncut sapphire' }, { ...filter, bankCommon: true })).toBe(true);
    });

    test('an unnamed ground item is never wanted', () => {
        expect(wantsDrop({ id: 4, name: null }, filter)).toBe(false);
    });
});

describe('bodyOrigin', () => {
    // Why: the client reports an npc at the tile under the centre of its footprint, and the engine measures sight to the south-west corner.
    test('a size-3 body starts one tile south-west of the reported tile, a size-4 body two', () => {
        expect(bodyOrigin({ x: 2860, z: 9782 }, 3)).toEqual({ x: 2859, z: 9781 });
        expect(bodyOrigin({ x: 2899, z: 9804 }, 4)).toEqual({ x: 2897, z: 9802 });
    });

    test('a size-1 or size-2 body reads from its reported tile or one below it', () => {
        expect(bodyOrigin({ x: 10, z: 10 }, 1)).toEqual({ x: 10, z: 10 });
        expect(bodyOrigin({ x: 10, z: 10 }, 2)).toEqual({ x: 9, z: 9 });
    });
});
