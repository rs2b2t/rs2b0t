// test/api/banking-common.test.ts
import { describe, expect, test } from 'bun:test';
import { COMMON_BANK_LOOT, matchesCommonBankLoot, depositMatcher, depositAllExcept, PERIODIC_BANK_SETTINGS } from '#/bot/api/Banking.js';

describe('matchesCommonBankLoot', () => {
    test('matches each junk category (case-insensitive contains)', () => {
        for (const n of ['Uncut sapphire', 'Sapphire', 'Emerald', 'Ruby', 'Diamond', 'Strange fruit', 'Beer', 'Kebab']) {
            expect(matchesCommonBankLoot(n)).toBe(true);
        }
    });
    test('rejects unrelated names and empty', () => {
        expect(matchesCommonBankLoot('Coins')).toBe(false);
        expect(matchesCommonBankLoot('Bones')).toBe(false);
        expect(matchesCommonBankLoot('')).toBe(false);
    });
    test('COMMON_BANK_LOOT is non-empty and lowercased', () => {
        expect(COMMON_BANK_LOOT.length).toBeGreaterThan(0);
        expect(COMMON_BANK_LOOT.every(p => p === p.toLowerCase())).toBe(true);
    });
});

describe('depositMatcher', () => {
    const own = (n: string) => n.toLowerCase().includes('coins');
    test('own OR common when enabled', () => {
        const m = depositMatcher(own, true);
        expect(m('Coins')).toBe(true);   // own
        expect(m('Ruby')).toBe(true);    // common
        expect(m('Bones')).toBe(false);  // neither
    });
    test('common suppressed when disabled', () => {
        const m = depositMatcher(own, false);
        expect(m('Coins')).toBe(true);   // own still
        expect(m('Ruby')).toBe(false);   // common off
    });
});

describe('PERIODIC_BANK_SETTINGS', () => {
    test('exposes the bankCommonJunk opt-out, default true', () => {
        expect(PERIODIC_BANK_SETTINGS.bankCommonJunk).toBeDefined();
        expect(PERIODIC_BANK_SETTINGS.bankCommonJunk.type).toBe('boolean');
        expect(PERIODIC_BANK_SETTINGS.bankCommonJunk.default).toBe(true);
    });
});

// The cow-killer banks EVERYTHING except what it still needs (issue #9): loot,
// feathers, AND random-event junk the loot filter never knew about all deposit.
describe('depositAllExcept', () => {
    test('deposits loot and random-event junk alike', () => {
        const d = depositAllExcept(['Bones']);
        for (const junk of ['Casket', 'Strange fruit', 'Beer', 'Kebab', 'Uncut sapphire', 'Cow hide']) {
            expect(d(junk), junk).toBe(true);
        }
    });
    test('keeps the keep-list (case-insensitive), never the empty name', () => {
        const d = depositAllExcept(['Bones', 'Lobster']);
        expect(d('Bones')).toBe(false);
        expect(d('bones')).toBe(false);
        expect(d('LOBSTER')).toBe(false);
        expect(d('')).toBe(false);
    });
    test('empty keep-list (cow killer, not burying) deposits the whole pack', () => {
        const d = depositAllExcept([]);
        expect(d('Bones')).toBe(true);
        expect(d('Casket')).toBe(true);
    });
});
