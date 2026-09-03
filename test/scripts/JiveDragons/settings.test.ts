import { describe, expect, test } from 'bun:test';
import { DROP_DB } from '#/bot/data/dropdb.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { SETTINGS, siteTile } from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { TAVERLEY_BLUE } from '#/bot/scripts/JiveDragons/sites.js';

describe('JiveDragons loot defaults', () => {
    const loot = SETTINGS.loot!;
    const defaults = loot.default as string[];

    test('Coins and Bass are offered but start unticked', () => {
        expect(loot.options).toContain('Coins');
        expect(loot.options).toContain('Bass');
        expect(defaults).not.toContain('Coins');
        expect(defaults).not.toContain('Bass');
    });

    test('the drops worth the walk are still on by default', () => {
        expect(defaults).toContain('Dragon bones');
        expect(defaults).toContain('Dragonhide');
    });

    test('no arrow is on the blue dragon table, so a range run only gets its own back by name', () => {
        expect(DROP_DB['Blue dragon']!.some(n => n.toLowerCase().includes('arrow'))).toBe(false);
    });
});

describe('JiveDragons leaveVia', () => {
    test('the teleport and the gate walk are the only ways out, the teleport by default', () => {
        expect(SETTINGS.leaveVia!.options).toEqual(['teleport', 'walk']);
        expect(SETTINGS.leaveVia!.default).toBe('teleport');
    });
});

describe('JiveDragons site tiles', () => {
    const elsewhere = new Tile(3200, 3200, 0);

    test('the schema default is Taverley, so an untouched setting hands the tile back to the site', () => {
        expect(SETTINGS.safespot1!.default).toEqual(TAVERLEY_BLUE.safespots[0]!);
        const bag = new SettingsBag({ safespot1: SETTINGS.safespot1!.default });
        expect(siteTile(bag, 'safespot1', elsewhere)).toBe(elsewhere);
    });

    test('a tile moved off the default is the one that applies', () => {
        const moved = new Tile(2905, 9812, 0);
        expect(siteTile(new SettingsBag({ safespot1: moved }), 'safespot1', elsewhere)).toBe(moved);
    });

    test('a site carrying more safespots than the panel has keys for keeps its own', () => {
        expect(siteTile(new SettingsBag({}), undefined, elsewhere)).toBe(elsewhere);
    });

    test('the melee anchor and the bank stand read the same way', () => {
        const bag = new SettingsBag({ meleeTile: SETTINGS.meleeTile!.default, bankTile: new Tile(3013, 3355, 0) });
        expect(siteTile(bag, 'meleeTile', elsewhere)).toBe(elsewhere);
        expect(siteTile(bag, 'bankTile', elsewhere)).toEqual(new Tile(3013, 3355, 0));
    });
});
