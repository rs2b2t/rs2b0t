import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveMarketDumper/JiveMarketDumper.js';
import '#/bot/scripts/index.js';

describe('JiveMarketDumper settings', () => {
    test('names the maker, takes the maker\'s book from the price books store, and caps a trade at the default float', () => {
        expect(SETTINGS.maker!.default).toBe('');
        expect(SETTINGS.priceBook!.optionsFrom).toBe('priceBooks');
        expect(SETTINGS.maxPerTrade!.default).toBe(200_000);
    });

    test('no bank or stand tile is offered, since the script starts beside the maker at its bank', () => {
        expect(SETTINGS.bankStand).toBeUndefined();
        expect(SETTINGS.spot).toBeUndefined();
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
