import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveShilo/JiveShilo.js';
import '#/bot/scripts/index.js';

describe('JiveShilo settings', () => {
    test('the counter tile is the one the Fernahei buyout preset stands on', () => {
        expect(SETTINGS.hutStand!.default).toEqual(new Tile(2870, 2971, 0));
    });

    test('the feather target is off by default, so the loop runs until stopped', () => {
        expect(SETTINGS.feathersTarget!.default).toBe(0);
        expect(SETTINGS.feathersTarget!.min).toBe(0);
    });

    test('no river stand or radius is offered, since the spots move and the bank tiles are baked', () => {
        expect(SETTINGS.riverStand).toBeUndefined();
        expect(SETTINGS.spotRadius).toBeUndefined();
    });
});

describe('JiveShilo registration', () => {
    test('is a Fishing script with the Shilo tags', () => {
        const meta = ScriptRegistry.get('JiveShilo');
        expect(meta?.category).toBe('Fishing');
        expect(meta?.tags).toContain('shilo');
        expect(meta?.tags).toContain('feathers');
        expect(meta?.settingsSchema).toBe(SETTINGS);
    });
});
