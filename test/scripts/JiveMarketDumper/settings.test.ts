import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import { NEAREST_BANK, SETTINGS, bankChoice } from '#/bot/scripts/JiveMarketDumper/JiveMarketDumper.js';
import '#/bot/scripts/index.js';

describe('JiveMarketDumper settings', () => {
    test('the maker and the bank are what there is to set', () => {
        expect(Object.keys(SETTINGS)).toEqual(['maker', 'bank']);
        expect(SETTINGS.maker!.default).toBe('');
    });

    test('no price book and no trade cap, since the dump takes whatever the maker pays', () => {
        expect(SETTINGS.priceBook).toBeUndefined();
        expect(SETTINGS.maxPerTrade).toBeUndefined();
    });

    // Why: the maker stands at a bank of its own choosing, and the nearest one to the dumper is not always that bank.
    test('the bank is picked from the known banks, defaulting to the nearest', () => {
        expect(SETTINGS.bank!.default).toBe(NEAREST_BANK);
        expect(SETTINGS.bank!.options).toContain(NEAREST_BANK);
        for (const name of ['Seers', 'Varrock West', 'Falador East']) {
            expect(SETTINGS.bank!.options).toContain(name);
        }
        expect(SETTINGS.bank!.options).toEqual([NEAREST_BANK, ...BANK_LOCATIONS.map(b => b.name)]);
    });

    test('no free-typed tile, so a bank is only ever one the walker knows how to open', () => {
        expect(SETTINGS.bankStand).toBeUndefined();
        expect(SETTINGS.spot).toBeUndefined();
    });
});

describe('bankChoice', () => {
    test('a named bank resolves to that bank, whatever is nearer', () => {
        expect(bankChoice('Seers')?.name).toBe('Seers');
        expect(bankChoice('  seers  ')?.name).toBe('Seers');
    });

    test('the nearest option and an unknown name both resolve to nothing, leaving the walker to pick', () => {
        expect(bankChoice(NEAREST_BANK)).toBeNull();
        expect(bankChoice('')).toBeNull();
        expect(bankChoice('Lumbridge')).toBeNull();
    });
});

describe('JiveMarketDumper registration', () => {
    test('is a Money making script with the trading tags', () => {
        const meta = ScriptRegistry.get('JiveMarketDumper');
        expect(meta?.category).toBe('Money making');
        expect(meta?.tags).toContain('trading');
        expect(meta?.tags).toContain('bank');
        expect(meta?.settingsSchema).toBe(SETTINGS);
    });
});
