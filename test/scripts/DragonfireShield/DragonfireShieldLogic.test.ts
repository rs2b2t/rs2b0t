import { describe, expect, test } from 'bun:test';
import { BANK_STAND, DUKE_STAND, SHIELD_ID, decide, type PackState } from '#/bot/scripts/DragonfireShield/DragonfireShieldLogic.js';

function mk(over: Partial<PackState> = {}): PackState {
    return {
        atStand: false,
        atBank: false,
        full: false,
        free: 28,
        unNoted: 0,
        notes: 0,
        junk: 0,
        ground: 0,
        tripActive: false,
        wantNotes: true,
        hasBankedShields: true,
        ...over
    };
}

describe('DragonfireShield.decide', () => {
    test('anchor constants point at the Duke and the shield object', () => {
        expect(SHIELD_ID).toBe(1540);
        expect(DUKE_STAND.x).toBe(3212);
        expect(DUKE_STAND.z).toBe(3220);
        expect(DUKE_STAND.level).toBe(1);
        expect(BANK_STAND.x).toBe(3269);
        expect(BANK_STAND.z).toBe(3167);
        expect(BANK_STAND.level).toBe(0);
    });

    test('keeps farming while a trip is live at the Duke', () => {
        expect(decide(mk({ atStand: true, tripActive: true, free: 1 }))).toBe('farm');
    });

    test('stops farming when the pack is full, even mid-trip', () => {
        expect(decide(mk({ atStand: true, tripActive: true, full: true, free: 0 }))).toBe('bank');
    });

    test('loots the floor pile once the trip ends', () => {
        expect(decide(mk({ atStand: true, ground: 3, unNoted: 1 }))).toBe('loot');
    });

    test('banks a full pack from anywhere', () => {
        expect(decide(mk({ atBank: true, full: true, free: 0 }))).toBe('bank');
        expect(decide(mk({ atStand: true, full: true, free: 0, ground: 2 }))).toBe('bank');
    });

    test('banks held shields once the pile is cleared', () => {
        expect(decide(mk({ atStand: true, unNoted: 2 }))).toBe('bank');
        expect(decide(mk({ atStand: true, notes: 3 }))).toBe('bank');
        expect(decide(mk({ atStand: true, junk: 1 }))).toBe('bank');
    });

    test('banks un-noted shields while standing at the bank', () => {
        expect(decide(mk({ atBank: true, unNoted: 1 }))).toBe('bank');
        expect(decide(mk({ atBank: true, junk: 2 }))).toBe('bank');
    });

    test('withdraws the noted stack when none is carried', () => {
        expect(decide(mk({ atBank: true, notes: 0, wantNotes: true, free: 28 }))).toBe('bank');
    });

    test('leaves an empty bank instead of looping the notes-missing re-bank', () => {
        expect(decide(mk({ atBank: true, notes: 0, wantNotes: true, hasBankedShields: false, free: 28, unNoted: 0, junk: 0 }))).toBe('duke');
    });

    test('does not re-bank while already carrying notes and pack is clean', () => {
        expect(decide(mk({ atBank: true, notes: 20, free: 27 }))).toBe('duke');
    });

    test('walks to the Duke otherwise', () => {
        expect(decide(mk({ atStand: false, atBank: true, notes: 20 }))).toBe('duke');
    });

    test('starts a fresh farm when idle at the Duke with an empty pack', () => {
        expect(decide(mk({ atStand: true, free: 28 }))).toBe('farm');
    });

    test('a ground pile at the bank still takes priority over farm', () => {
        expect(decide(mk({ atBank: true, ground: 1, unNoted: 0, notes: 20 }))).toBe('duke');
    });

    test('falls back to waiting only when nothing is actionable', () => {
        expect(decide(mk({ atStand: true, tripActive: true, full: true }))).toBe('bank');
    });
});