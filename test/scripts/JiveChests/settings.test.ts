import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveChests/JiveChests.js';
import '#/bot/scripts/index.js';

describe('JiveChests settings', () => {
    test('keeps chest trips as the default and offers bank-only key combining', () => {
        expect(Object.keys(SETTINGS)).toEqual(['combineKeys', 'teleportHome']);
        expect(SETTINGS.combineKeys!.default).toBe(false);
        expect(SETTINGS.teleportHome!.default).toBe(true);
        expect(SETTINGS.teleportHome!.showIf).toEqual({ key: 'combineKeys', anyOf: ['false'] });
    });

    test('no key count or tile is offered, since the trip size and the chest are fixed', () => {
        expect(SETTINGS.keys).toBeUndefined();
        expect(SETTINGS.chestTile).toBeUndefined();
        expect(SETTINGS.bankStand).toBeUndefined();
    });
});

describe('JiveChests registration', () => {
    test('is a Money making script with the chest tags', () => {
        const meta = ScriptRegistry.get('JiveChests');
        expect(meta?.category).toBe('Money making');
        expect(meta?.tags).toContain('chest');
        expect(meta?.tags).toContain('taverley');
        expect(meta?.settingsSchema).toBe(SETTINGS);
    });
});
