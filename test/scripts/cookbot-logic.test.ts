import { describe, expect, test } from 'bun:test';
import { countRaw, lastRawIndex } from '#/bot/scripts/CookBotLogic.js';

const pack = [
    { name: 'Raw salmon' }, { name: 'Salmon' }, { name: 'Raw salmon' },
    { name: 'Burnt fish' }, { name: 'Raw salmon' }, { name: 'Coins' }
];

describe('countRaw', () => {
    test('counts case-insensitive substring matches only', () => {
        expect(countRaw(pack, 'Raw salmon')).toBe(3);      // three raw, not the cooked "Salmon"
        expect(countRaw(pack, 'raw salmon')).toBe(3);      // case-insensitive
        expect(countRaw(pack, 'Raw shark')).toBe(0);
    });
    test('ignores null names', () => {
        expect(countRaw([{ name: null }, { name: 'Raw salmon' }], 'raw salmon')).toBe(1);
    });
});

describe('lastRawIndex', () => {
    test('returns the index of the LAST match, not the first', () => {
        expect(lastRawIndex(pack, 'Raw salmon')).toBe(4); // slots 0,2,4 match → last is 4
    });
    test('-1 when none match', () => {
        expect(lastRawIndex(pack, 'Raw shark')).toBe(-1);
    });
});
