import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveCrafting/JiveCrafting.js';
import { PRODUCT_OPTIONS } from '#/bot/scripts/JiveCrafting/logic.js';
import '#/bot/scripts/index.js';

describe('JiveCrafting settings', () => {
    test('the product is a dropdown over every gold jewel, defaulting to the first gem ring', () => {
        expect(SETTINGS.product!.options).toEqual(PRODUCT_OPTIONS);
        expect(SETTINGS.product!.default).toBe('Sapphire ring');
    });

    test('no bank or furnace tile is offered, since the Al Kharid pair is baked until the AIO version', () => {
        expect(SETTINGS.bankStand).toBeUndefined();
        expect(SETTINGS.furnaceStand).toBeUndefined();
    });
});

describe('JiveCrafting registration', () => {
    test('is a Crafting script with the jewellery tags', () => {
        const meta = ScriptRegistry.get('JiveCrafting');
        expect(meta?.category).toBe('Crafting');
        expect(meta?.tags).toContain('jewellery');
        expect(meta?.tags).toContain('al kharid');
        expect(meta?.settingsSchema).toBe(SETTINGS);
    });
});
