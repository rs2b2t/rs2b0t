import { describe, expect, test } from 'bun:test';
import {
    COMMON_BANK_LOOT,
    RANDOM_EVENT_CASKET_ID,
    depositAllExcept,
    depositMatcher,
    isDisposableGatherJunk,
    matchesCommonBankLoot,
    PERIODIC_BANK_SETTINGS
} from '#/bot/api/Banking.js';

describe('matchesCommonBankLoot', () => {
    test('matches each junk category (case-insensitive contains)', () => {
        for (const n of ['Uncut sapphire', 'Sapphire', 'Emerald', 'Ruby', 'Diamond', 'Strange fruit', 'Beer', 'Kebab']) {
            expect(matchesCommonBankLoot(n, -1)).toBe(true);
        }
    });
    test('matches only the random-event Casket object ID', () => {
        expect(matchesCommonBankLoot('Casket', RANDOM_EVENT_CASKET_ID)).toBe(true);
        expect(matchesCommonBankLoot('casket', RANDOM_EVENT_CASKET_ID)).toBe(true);
        expect(matchesCommonBankLoot('Casket', 2714)).toBe(false);
        expect(matchesCommonBankLoot('Casket', 406)).toBe(false);
        expect(matchesCommonBankLoot('Rusty casket', 3849)).toBe(false);
    });
    test('rejects unrelated names and empty', () => {
        expect(matchesCommonBankLoot('Coins', 995)).toBe(false);
        expect(matchesCommonBankLoot('Bones', 526)).toBe(false);
        expect(matchesCommonBankLoot('', -1)).toBe(false);
    });
    test('keeps name-only callers compatible without guessing which Casket they mean', () => {
        expect(matchesCommonBankLoot('Ruby')).toBe(true);
        expect(matchesCommonBankLoot('Casket')).toBe(false);
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
        expect(m('Coins', 995)).toBe(true);
        expect(m('Ruby', -1)).toBe(true);
        expect(m('Bones', 526)).toBe(false);
    });
    test('common suppressed when disabled', () => {
        const m = depositMatcher(own, false);
        expect(m('Coins', 995)).toBe(true);
        expect(m('Ruby', -1)).toBe(false);
    });
    test('keeps name-only matcher calls compatible', () => {
        expect(depositMatcher(own, true)('Ruby')).toBe(true);
    });
    test('banks a Casket when common rewards are enabled', () => {
        expect(depositMatcher(() => false, true)('Casket', RANDOM_EVENT_CASKET_ID)).toBe(true);
    });
    test('keeps a Casket when common rewards are disabled', () => {
        expect(depositMatcher(() => false, false)('Casket', RANDOM_EVENT_CASKET_ID)).toBe(false);
    });
    test('the caller predicate still banks its own Casket when common rewards are disabled', () => {
        const ownCasket = (name: string): boolean => name.toLowerCase() === 'casket';
        expect(depositMatcher(ownCasket, false)('Casket', RANDOM_EVENT_CASKET_ID)).toBe(true);
    });
});

describe('isDisposableGatherJunk', () => {
    test('includes common bank loot and random-event casket id', () => {
        expect(isDisposableGatherJunk('Uncut sapphire', -1)).toBe(true);
        expect(isDisposableGatherJunk('Strange fruit', -1)).toBe(true);
        expect(isDisposableGatherJunk('Casket', RANDOM_EVENT_CASKET_ID)).toBe(true);
    });
    test('includes other event leftovers', () => {
        expect(isDisposableGatherJunk('Flier', -1)).toBe(true);
        expect(isDisposableGatherJunk('Spin ticket', -1)).toBe(true);
        expect(isDisposableGatherJunk('Half a meat pie', -1)).toBe(true);
    });
    test('rejects tools, coins, logs', () => {
        expect(isDisposableGatherJunk('Rune axe', -1)).toBe(false);
        expect(isDisposableGatherJunk('Coins', 995)).toBe(false);
        expect(isDisposableGatherJunk('Willow logs', -1)).toBe(false);
        expect(isDisposableGatherJunk('Tinderbox', -1)).toBe(false);
    });
});

describe('PERIODIC_BANK_SETTINGS', () => {
    test('exposes the bankCommonJunk opt-out, default true', () => {
        expect(PERIODIC_BANK_SETTINGS.bankCommonJunk).toBeDefined();
        expect(PERIODIC_BANK_SETTINGS.bankCommonJunk.type).toBe('boolean');
        expect(PERIODIC_BANK_SETTINGS.bankCommonJunk.default).toBe(true);
    });
});

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
