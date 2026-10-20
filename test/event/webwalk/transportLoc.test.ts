import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { findTransportLoc, matchesTransportLoc, transportLocValid } from '#/bot/event/webwalk/exec/transportLoc.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import type { TransportInfo } from '#/bot/event/webwalk/PathFinder.js';

const gate: TransportInfo = {
    locName: 'Gate',
    action: 'Open',
    locX: 3312,
    locZ: 3235,
    locId: 3198
};

const loc = (id: number, x: number, z: number): { id: number; tile(): { x: number; z: number } } => ({
    id,
    tile: () => ({ x, z })
});

afterEach(() => mock.restore());

const iceLadder: TransportInfo = {
    locName: 'Ladder', action: 'Climb-Down', locId: 1759, locX: 2848, locZ: 3513,
    toTile: { x: 2848, z: 9914 }
};

test('Ice Queen ladders require the recorded placement even when their IDs match', () => {
    expect(matchesTransportLoc(iceLadder, loc(1759, 2848, 3513))).toBe(true);
    expect(matchesTransportLoc(iceLadder, loc(1759, 2845, 3516))).toBe(false);
});

test.each([true, false])('Ice Queen ladder lookup cannot substitute a closer ladder, intended ladder present=%s', present => {
    const neighbor = { id: 1759, name: 'Ladder', typecode: 10, ops: ['Climb-Down'], tile: { x: 2845, z: 3516, level: 0 }, distance: 1 };
    const intended = { ...neighbor, tile: { x: 2848, z: 3513, level: 0 }, distance: 4 };
    spyOn(reader, 'locs').mockReturnValue(present ? [neighbor, intended] : [neighbor]);
    const found = findTransportLoc(iceLadder);
    if (present) expect(found?.tile()).toMatchObject(intended.tile);
    else expect(found).toBeNull();
    expect(transportLocValid(iceLadder)).toBe(present);
});

describe('matchesTransportLoc', () => {
    test('an ID-defined transport requires the id and near placement (slack 3)', () => {
        expect(matchesTransportLoc(gate, loc(3198, 3312, 3235))).toBe(true);
        expect(matchesTransportLoc(gate, loc(3197, 3312, 3234))).toBe(false);
        // 1 tile off still matches, pack stands / gangplanks drift.
        expect(matchesTransportLoc(gate, loc(3198, 3312, 3234))).toBe(true);
        expect(matchesTransportLoc(gate, loc(3198, 3312, 3240))).toBe(false);
    });

    test('locId 0 still requires that id (near placement)', () => {
        const zeroId = { ...gate, locId: 0 };
        expect(matchesTransportLoc(zeroId, loc(0, 3312, 3235))).toBe(true);
        expect(matchesTransportLoc(zeroId, loc(3198, 3312, 3235))).toBe(false);
        expect(matchesTransportLoc(zeroId, loc(0, 3313, 3235))).toBe(true);
        expect(matchesTransportLoc(zeroId, loc(0, 3320, 3235))).toBe(false);
    });

    test('a legacy no-ID transport retains the three-tile radius lookup', () => {
        const { locId: _locId, ...legacy } = gate;
        expect(matchesTransportLoc(legacy, loc(3197, 3315, 3238))).toBe(true);
        expect(matchesTransportLoc(legacy, loc(3197, 3316, 3235))).toBe(false);
    });

    test('openLocId matches the open trapdoor after transform (near placement tile)', () => {
        const trap: TransportInfo = {
            locName: 'Trapdoor',
            action: 'Climb-down',
            locX: 3097,
            locZ: 3468,
            locId: 1568, // closed map placement
            openLocId: 1570 // trapdoor_open
        };
        expect(matchesTransportLoc(trap, loc(1568, 3097, 3468))).toBe(true);
        expect(matchesTransportLoc(trap, loc(1570, 3097, 3468))).toBe(true);
        expect(matchesTransportLoc(trap, loc(1570, 3096, 3468))).toBe(true); // open may shift
        expect(matchesTransportLoc(trap, loc(1571, 3097, 3468))).toBe(false);
    });
});
