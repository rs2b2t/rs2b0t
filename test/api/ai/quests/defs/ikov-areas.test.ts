import { describe, expect, test } from 'bun:test';

import {
    ICE_CHESTS,
    IKOV_TILE,
    inChamberOfFear,
    inDarkRoom,
    inGuardianTemple,
    inIceCavern,
    inTemple,
    inTrapPit,
    onWineldaLedge,
    pastSouthGate,
    westOfBridge
} from '#/bot/api/ai/quests/defs/ikov/areas.js';

type Region = (t: { x: number; z: number }) => boolean;

const REGIONS: [string, Region][] = [
    ['dark room', inDarkRoom],
    ['west of the bridge', westOfBridge],
    ['trap pit', inTrapPit],
    ["Winelda's ledge", onWineldaLedge],
    ["guardians' temple", inGuardianTemple]
];

/** One tile inside each pocket the module has to recognise it woke up in. */
const INSIDE: [string, { x: number; z: number }][] = [
    ['dark room', IKOV_TILE.DARK_LANDING],
    ['west of the bridge', IKOV_TILE.BRIDGE_WEST],
    ['trap pit', { x: 2682, z: 9854 }],
    ["Winelda's ledge", IKOV_TILE.WINELDA],
    ["guardians' temple", IKOV_TILE.GUARDIANS]
];

describe('Temple of Ikov regions', () => {
    // Why: `escapePocket` picks its climb off these, so two that overlap send the bot up the wrong ladder.
    test('each pocket tile matches its own region and no other', () => {
        for (const [name, tile] of INSIDE) {
            const matched = REGIONS.filter(([, inside]) => inside(tile)).map(([label]) => label);
            expect([name, matched]).toEqual([name, [name]]);
        }
    });

    test('the entrance corridor is in none of the pockets', () => {
        const matched = REGIONS.filter(([, inside]) => inside(IKOV_TILE.ENTRANCE)).map(([label]) => label);
        expect(matched).toEqual([]);
    });

    test('the chamber of fear holds the trap lever and the east bank of the bridge', () => {
        expect(inChamberOfFear(IKOV_TILE.TRAP_LEVER)).toBe(true);
        expect(inChamberOfFear(IKOV_TILE.BRIDGE_EAST)).toBe(true);
        expect(inChamberOfFear(IKOV_TILE.ENTRANCE)).toBe(false);
    });

    test('every ice chest is inside the ice cavern and none is in the chamber of fear', () => {
        for (const { loc, stand } of ICE_CHESTS) {
            expect(inIceCavern(loc)).toBe(true);
            expect(inIceCavern(stand)).toBe(true);
            expect(inChamberOfFear(loc)).toBe(false);
        }
    });

    // Why: `forceapproach=north` rotates with each placement, and the wrong side drops the Open with no refusal at all.
    test('every chest stand is one tile off its chest', () => {
        for (const { loc, stand } of ICE_CHESTS) {
            expect(Math.abs(loc.x - stand.x) + Math.abs(loc.z - stand.z)).toBe(1);
        }
    });

    test('the ice cavern excludes the corridor the south gate opens from', () => {
        expect(inIceCavern(IKOV_TILE.SOUTH_GATE_NORTH)).toBe(false);
        expect(inIceCavern(IKOV_TILE.SOUTH_GATE_SOUTH)).toBe(true);
    });

    // Why: `inIceCavern` is the half-plane south and east of the temple, and the boots room sits inside it — a leg that treats "in the cavern" as "past the gate" reads the dark room as an unlocked gate.
    test('the boots room is inside the ice cavern half-plane', () => {
        expect(inIceCavern(IKOV_TILE.BOOTS_SPAWN)).toBe(true);
        expect(inDarkRoom(IKOV_TILE.BOOTS_SPAWN)).toBe(true);
    });

    test('past the south gate excludes the boots room and the corridor alike', () => {
        expect(pastSouthGate(IKOV_TILE.BOOTS_SPAWN)).toBe(false);
        expect(pastSouthGate(IKOV_TILE.SOUTH_GATE_NORTH)).toBe(false);
        expect(pastSouthGate(IKOV_TILE.SOUTH_GATE_SOUTH)).toBe(true);
        for (const { stand } of ICE_CHESTS) {
            expect(pastSouthGate(stand)).toBe(true);
        }
    });

    // Why: the far side wraps around the Fire Warrior's room, so the temple box has to stop at the corridor the wall opens into.
    test('the guardian temple box excludes the far side that shares its rows', () => {
        expect(inGuardianTemple(IKOV_TILE.SECRET_WALL_INSIDE)).toBe(true);
        expect(inGuardianTemple(IKOV_TILE.SECRET_WALL)).toBe(false);
        expect(inGuardianTemple(IKOV_TILE.MCGRUBOR_LADDER)).toBe(false);
        expect(inGuardianTemple({ x: 2637, z: 9893 })).toBe(false);
        expect(inGuardianTemple({ x: 2657, z: 9895 })).toBe(false);
    });

    test('every temple tile reads as inside the temple, and the surface does not', () => {
        expect(inTemple(IKOV_TILE.ENTRANCE)).toBe(true);
        expect(inTemple(IKOV_TILE.GUARDIANS)).toBe(true);
        expect(inTemple(IKOV_TILE.DARK_LANDING)).toBe(true);
        expect(inTemple(IKOV_TILE.TEMPLE_LADDER)).toBe(false);
        expect(inTemple(IKOV_TILE.LUCIEN_HUT)).toBe(false);
    });
});
