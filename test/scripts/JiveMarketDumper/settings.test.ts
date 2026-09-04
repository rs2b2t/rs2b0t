import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveMarketDumper/JiveMarketDumper.js';
import '#/bot/scripts/index.js';

describe('JiveMarketDumper settings', () => {
    test('the maker is the only thing to set', () => {
        expect(Object.keys(SETTINGS)).toEqual(['maker']);
        expect(SETTINGS.maker!.default).toBe('');
    });

    test('no price book and no trade cap, since the dump takes whatever the maker pays', () => {
        expect(SETTINGS.priceBook).toBeUndefined();
        expect(SETTINGS.maxPerTrade).toBeUndefined();
    });

    test('no bank or stand tile, since it starts beside the maker at its bank', () => {
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
