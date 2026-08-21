import { describe, expect, test } from 'bun:test';
import { barsFor, canSmith, countBars, type PackItem } from '#/bot/scripts/SmithingBot/SmithingBotLogic.js';

const pack = (...entries: (string | [string, number])[]): PackItem[] =>
    entries.map(entry => (typeof entry === 'string' ? { name: entry, count: 1 } : { name: entry[0], count: entry[1] }));

describe('barsFor', () => {
    test('platebody is 5; dagger is 1; 2h sword is 3', () => {
        expect(barsFor('Platebody')).toBe(5);
        expect(barsFor('Dagger')).toBe(1);
        expect(barsFor('2h sword')).toBe(3);
    });

    test('unknown product costs 1', () => {
        expect(barsFor('platinum widget')).toBe(1);
        expect(barsFor('')).toBe(1);
    });

    test('short keywords must not steal longer products', () => {
        expect(barsFor('Sword')).toBe(1);
        expect(barsFor('2h sword')).toBe(3);
        expect(barsFor('Axe')).toBe(1);
        expect(barsFor('Battleaxe')).toBe(3);
        expect(barsFor('Longsword')).toBe(2);
    });
});

describe('canSmith', () => {
    test('a full 27-bar platebody pack can smith; 2, 4 cannot; 5 can', () => {
        expect(canSmith(27, 'Platebody')).toBe(true);
        expect(canSmith(2, 'Platebody')).toBe(false);
        expect(canSmith(4, 'Platebody')).toBe(false);
        expect(canSmith(5, 'Platebody')).toBe(true);
    });

    test('leftover 2 after a 27-bar platebody load cannot smith', () => {
        const leftover = 27 % barsFor('Platebody');
        expect(leftover).toBe(2);
        expect(canSmith(leftover, 'Platebody')).toBe(false);
    });
});

describe('countBars', () => {
    test('include-matches the bar name and sums stack counts', () => {
        expect(countBars(pack(['Bronze bar', 27], 'Hammer'), 'Bronze bar')).toBe(27);
        expect(countBars(pack('Bronze bar', 'Bronze bar', 'Iron bar'), 'Bronze bar')).toBe(2);
        expect(countBars(pack('Hammer', 'Bronze platebody'), 'Bronze bar')).toBe(0);
    });
});
