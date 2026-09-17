import { describe, expect, test } from 'bun:test';
import { CHEST_STAND, JUNK, KEY, KEYS_PER_TRIP, decide, junkHeld, keysToWithdraw, type PackState } from '#/bot/scripts/JiveChests/logic.js';

const at = (over: Partial<PackState> = {}): PackState => ({ keys: 7, junk: 0, free: 20, atChest: true, groundLoot: false, canLoot: false, pendingLoot: false, banking: false, ...over });

describe('the junk list', () => {
    test('includes the unwanted chest rewards', () => {
        expect(JUNK).toEqual(['Raw swordfish', 'Body rune', 'Spinach roll', 'Adamant sq shield']);
    });

    test('names them as the client does, so a drop can find them', () => {
        expect(JUNK).not.toContain('Swordfish');
        expect(JUNK).not.toContain('Body runes');
    });

    test('junkHeld counts every junk line in the pack', () => {
        const counts: Record<string, number> = { 'Raw swordfish': 5, 'Body rune': 50, 'Adamant sq shield': 1, 'Uncut dragonstone': 3 };
        expect(junkHeld(n => counts[n] ?? 0)).toBe(56);
        expect(junkHeld(() => 0)).toBe(0);
    });
});

describe('keysToWithdraw', () => {
    test('tops the pack up to the trip size', () => {
        expect(keysToWithdraw(0, 100)).toBe(KEYS_PER_TRIP);
        expect(keysToWithdraw(3, 100)).toBe(KEYS_PER_TRIP - 3);
        expect(keysToWithdraw(7, 100)).toBe(0);
    });

    test('takes what the bank has when it is short, and nothing when it is empty', () => {
        expect(keysToWithdraw(0, 3)).toBe(3);
        expect(keysToWithdraw(0, 0)).toBe(0);
    });

});

describe('decide', () => {
    test('drops the junk before anything else, so the pack never fills with it', () => {
        expect(decide(at({ junk: 1 }))).toEqual({ kind: 'drop' });
        expect(decide(at({ junk: 1, keys: 0, atChest: false }))).toEqual({ kind: 'drop' });
    });

    test('opens the chest while a key is held and we are standing at it', () => {
        expect(decide(at())).toEqual({ kind: 'open' });
    });

    test('walks to the chest while a key is held and we are not', () => {
        expect(decide(at({ atChest: false }))).toEqual({ kind: 'travel' });
    });

    test('goes home once the keys are spent', () => {
        expect(decide(at({ keys: 0 }))).toEqual({ kind: 'bank' });
    });

    test('keeps opening after a rune reward instead of reserving twelve empty slots', () => {
        expect(decide(at({ keys: 6, free: 11 }))).toEqual({ kind: 'open' });
        expect(decide(at({ free: 1 }))).toEqual({ kind: 'open' });
        expect(decide(at({ free: 0 }))).toEqual({ kind: 'bank' });
    });

    test('collects overflow before using another key or leaving after the last key', () => {
        expect(decide(at({ groundLoot: true, canLoot: true }))).toEqual({ kind: 'loot' });
        expect(decide(at({ keys: 0, groundLoot: true, canLoot: true }))).toEqual({ kind: 'loot' });
        expect(decide(at({ free: 0, groundLoot: true, canLoot: false }))).toEqual({ kind: 'bank' });
    });

    test('returns for overflow even when all keys have been used', () => {
        expect(decide(at({ keys: 0, atChest: false, pendingLoot: true }))).toEqual({ kind: 'travel' });
    });

    test('finishes banking when teleporting has freed inventory slots', () => {
        expect(decide(at({ banking: true, atChest: false, keys: 3, free: 3, pendingLoot: true }))).toEqual({ kind: 'bank' });
    });
});

describe('the chest stand', () => {
    test('is the requested player stand tile south of the chest at (2914, 3452)', () => {
        expect([CHEST_STAND.x, CHEST_STAND.z, CHEST_STAND.level]).toEqual([2914, 3451, 0]);
    });

    test('the key is the one the chest takes', () => {
        expect(KEY).toBe('Crystal key');
    });
});
