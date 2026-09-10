import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveEnchanter/JiveEnchanter.js';
import { JEWEL_OPTIONS } from '#/bot/scripts/JiveEnchanter/logic.js';
import '#/bot/scripts/index.js';

describe('JiveEnchanter settings', () => {
    test('the jewel is a dropdown over everything the enchant spells convert, defaulting to the sapphire ring', () => {
        expect(SETTINGS.jewel!.options).toEqual(JEWEL_OPTIONS);
        expect(SETTINGS.jewel!.default).toBe('Sapphire ring');
    });

    test('no bank tile is offered, since the script stands at whichever bank it is started beside', () => {
        expect(SETTINGS.bankStand).toBeUndefined();
    });
});

describe('JiveEnchanter registration', () => {
    test('is a Magic script with the enchanting tags', () => {
        const meta = ScriptRegistry.get('JiveEnchanter');
        expect(meta?.category).toBe('Magic');
        expect(meta?.tags).toContain('enchanting');
        expect(meta?.tags).toContain('jewellery');
        expect(meta?.settingsSchema).toBe(SETTINGS);
    });
});
