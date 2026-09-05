import { describe, expect, test } from 'bun:test';
import { CHEST_STAND, JUNK, KEY, KEYS_PER_TRIP, LOOT_SLOTS, decide, junkHeld, keysToWithdraw, type PackState } from '#/bot/scripts/JiveChests/logic.js';

const at = (over: Partial<PackState> = {}): PackState => ({ keys: 7, junk: 0, loot: 0, free: 20, atChest: true, ...over });

describe('the junk list', () => {
    test('is the three the chest gives that are not worth a bank slot', () => {
        expect(JUNK).toEqual(['Raw swordfish', 'Body rune', 'Spinach roll']);
    });

    test('names them as the client does, so a drop can find them', () => {
        expect(JUNK).not.toContain('Swordfish');
        expect(JUNK).not.toContain('Body runes');
    });

    test('junkHeld counts every junk line in the pack', () => {
        const counts: Record<string, number> = { 'Raw swordfish': 5, 'Body rune': 50, 'Uncut dragonstone': 3 };
        expect(junkHeld(n => counts[n] ?? 0)).toBe(55);
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

    test('the trip is seven keys, which leaves room for the loot they turn into', () => {
        expect(KEYS_PER_TRIP).toBe(7);
        expect(KEYS_PER_TRIP + LOOT_SLOTS).toBeLessThanOrEqual(28);
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
        expect(decide(at({ keys: 0, loot: 4 }))).toEqual({ kind: 'bank' });
        expect(decide(at({ keys: 0, loot: 0 }))).toEqual({ kind: 'bank' });
    });

    // Why: a chest roll can be eleven rune stacks at once, so a pack too full to hold one is banked rather than opened into a loss.
    test('banks early when the pack cannot hold another roll', () => {
        expect(decide(at({ free: LOOT_SLOTS - 1 }))).toEqual({ kind: 'bank' });
        expect(decide(at({ free: LOOT_SLOTS }))).toEqual({ kind: 'open' });
    });
});

describe('the chest stand', () => {
    // Why: forceapproach is a block mask, so the chest's forceapproach=north names the one side it cannot be used from, and a wall loc sits on that tile too; the stand is the open tile west of it.
    test('is west of the chest at (2914, 3452), never the blocked north side', () => {
        expect([CHEST_STAND.x, CHEST_STAND.z, CHEST_STAND.level]).toEqual([2913, 3452, 0]);
        expect(CHEST_STAND.z).not.toBe(3453);
    });

    test('the key is the one the chest takes', () => {
        expect(KEY).toBe('Crystal key');
    });
});
