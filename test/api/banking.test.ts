import { expect, test } from 'bun:test';
import { shouldBankNow, parseBankStrategy } from '#/bot/api/Banking.js';

const state = (o: Partial<{ lootCount: number; minutesSinceLastBank: number; itemsThreshold: number; minutesThreshold: number }>) => ({
    lootCount: 20, minutesSinceLastBank: 0, itemsThreshold: 15, minutesThreshold: 10, ...o
});

test('off never banks', () => {
    expect(shouldBankNow('off', state({}))).toBe(false);
});
test('no loot never banks, any strategy', () => {
    for (const s of ['items', 'time', 'either'] as const) {
        expect(shouldBankNow(s, state({ lootCount: 0, minutesSinceLastBank: 99 }))).toBe(false);
    }
});
test('items banks at/over the item threshold only', () => {
    expect(shouldBankNow('items', state({ lootCount: 15 }))).toBe(true);
    expect(shouldBankNow('items', state({ lootCount: 14 }))).toBe(false);
    expect(shouldBankNow('items', state({ lootCount: 14, minutesSinceLastBank: 99 }))).toBe(false);
});
test('time banks at/over the minute threshold only (with loot)', () => {
    expect(shouldBankNow('time', state({ minutesSinceLastBank: 10, lootCount: 1 }))).toBe(true);
    expect(shouldBankNow('time', state({ minutesSinceLastBank: 9, lootCount: 99 }))).toBe(false);
});
test('either banks when items OR time trips', () => {
    expect(shouldBankNow('either', state({ lootCount: 20, minutesSinceLastBank: 0 }))).toBe(true);
    expect(shouldBankNow('either', state({ lootCount: 1, minutesSinceLastBank: 10 }))).toBe(true);
    expect(shouldBankNow('either', state({ lootCount: 1, minutesSinceLastBank: 0 }))).toBe(false);
});
test('parseBankStrategy maps labels, unknown -> off', () => {
    expect(parseBankStrategy('Off')).toBe('off');
    expect(parseBankStrategy('Loot count')).toBe('items');
    expect(parseBankStrategy('Time')).toBe('time');
    expect(parseBankStrategy('Either')).toBe('either');
    expect(parseBankStrategy('nonsense')).toBe('off');
});
