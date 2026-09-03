import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SETTINGS } from '#/bot/scripts/JiveShilo/JiveShilo.js';
import '#/bot/scripts/index.js';

describe('JiveShilo settings', () => {
    test('the river stand is the bank row south of the first fly spot, not the water it sits in', () => {
        expect(SETTINGS.riverStand!.default).toEqual(new Tile(2855, 2972, 0));
    });

    test('the counter tile is the one the Fernahei buyout preset stands on', () => {
        expect(SETTINGS.hutStand!.default).toEqual(new Tile(2870, 2971, 0));
    });

    test('the feather target is off by default, so the loop runs until stopped', () => {
        expect(SETTINGS.feathersTarget!.default).toBe(0);
        expect(SETTINGS.feathersTarget!.min).toBe(0);
    });

    test('the spot radius keeps the search to the two spots on the village bank', () => {
        expect(SETTINGS.spotRadius!.default).toBe(2);
        expect(SETTINGS.spotRadius!.min).toBe(1);
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
