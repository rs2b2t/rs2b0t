import { describe, expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveChests/JiveChests.js';
import '#/bot/scripts/index.js';

describe('JiveChests settings', () => {
    test('the way home is the only choice, teleporting by default', () => {
        expect(Object.keys(SETTINGS)).toEqual(['teleportHome']);
        expect(SETTINGS.teleportHome!.default).toBe(true);
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
