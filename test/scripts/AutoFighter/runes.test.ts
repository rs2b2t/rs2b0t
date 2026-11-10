import { describe, expect, test } from 'bun:test';
import {
    isReserveRune,
    RESERVE_RUNES,
    reserveExcess,
    reserveShortfall
} from '#/bot/scripts/AutoFighter/AutoFighterData.js';

describe('rune reserve', () => {
    test('covers the five teleport runes', () => {
        expect([...RESERVE_RUNES]).toEqual(['Law rune', 'Air rune', 'Fire rune', 'Water rune', 'Earth rune']);
    });

    test('matches reserve runes case-insensitively and ignores everything else', () => {
        expect(isReserveRune('Law rune')).toBe(true);
        expect(isReserveRune('law RUNE')).toBe(true);
        expect(isReserveRune(' Air rune ')).toBe(true);
        expect(isReserveRune('Fire rune')).toBe(true);
        expect(isReserveRune('Water rune')).toBe(true);
        expect(isReserveRune('Earth rune')).toBe(true);
        expect(isReserveRune('Nature rune')).toBe(false);
        expect(isReserveRune(null)).toBe(false);
    });

    test('deposits only the amount above the reservation', () => {
        expect(reserveExcess(10, 5)).toBe(5);
        expect(reserveExcess(5, 5)).toBe(0);
        expect(reserveExcess(3, 5)).toBe(0);
        expect(reserveExcess(10, 0)).toBe(10);
        expect(reserveExcess(10, -5)).toBe(10);
    });

    test('withdraws only the shortfall below the reservation', () => {
        expect(reserveShortfall(3, 5)).toBe(2);
        expect(reserveShortfall(5, 5)).toBe(0);
        expect(reserveShortfall(10, 5)).toBe(0);
        expect(reserveShortfall(3, 0)).toBe(0);
        expect(reserveShortfall(3, -5)).toBe(0);
    });
});
