import { describe, expect, test } from 'bun:test';
import { DROP_DB } from '#/bot/data/dropdb.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { SETTINGS, siteTile } from '#/bot/scripts/JiveDemons/JiveDemons.js';
import { TAVERLEY_BLACK_DEMON } from '#/bot/scripts/JiveDemons/sites.js';

describe('JiveDemons loot defaults', () => {
    const loot = SETTINGS.loot!;
    const defaults = loot.default as string[];

    test('the options are the black demon table', () => {
        expect(loot.options).toEqual(DROP_DB['Black Demon']!);
        expect(loot.options).toContain('Rune chainbody');
        expect(loot.options).toContain('Blood rune');
    });

    test('Ashes are offered but start unticked, since nothing pays for a slot of them', () => {
        expect(loot.options).toContain('Ashes');
        expect(defaults).not.toContain('Ashes');
    });

    test('Coins start ticked, since the pile is the most common drop and the walk to it is two tiles', () => {
        expect(defaults).toContain('Coins');
        expect(defaults).toContain('Rune med helm');
    });
});

describe('JiveDemons styles', () => {
    test('range and mage are the only styles, range by default', () => {
        expect(SETTINGS.combatStyle!.options).toEqual(['range', 'mage']);
        expect(SETTINGS.combatStyle!.default).toBe('range');
    });

    test('nothing melee, nothing to bury and no clue trail is offered', () => {
        for (const key of ['meleeStyle', 'weapon', 'useSpecial', 'usePotions', 'meleeTile', 'buryBones', 'solveClues']) {
            expect(SETTINGS[key]).toBeUndefined();
        }
    });

    test('the teleport and the gate walk are the only ways out, the teleport by default', () => {
        expect(SETTINGS.leaveVia!.options).toEqual(['teleport', 'walk']);
        expect(SETTINGS.leaveVia!.default).toBe('teleport');
    });
});

describe('JiveDemons site tiles', () => {
    const elsewhere = new Tile(3200, 3200, 0);

    test('the schema default is the Taverley pocket, so an untouched setting hands the tile back to the site', () => {
        expect(SETTINGS.safespot1!.default).toEqual(TAVERLEY_BLACK_DEMON.safespots[0]!);
        expect(SETTINGS.site!.default).toBe('taverley-black-demon');
        const bag = new SettingsBag({ safespot1: SETTINGS.safespot1!.default });
        expect(siteTile(bag, 'safespot1', elsewhere)).toBe(elsewhere);
    });

    test('a tile moved off the default is the one that applies', () => {
        const moved = new Tile(2858, 9787, 0);
        expect(siteTile(new SettingsBag({ safespot1: moved }), 'safespot1', elsewhere)).toBe(moved);
    });

    test('a site carrying more safespots than the panel has keys for keeps its own', () => {
        expect(siteTile(new SettingsBag({}), undefined, elsewhere)).toBe(elsewhere);
    });

    test('the bank stand reads the same way', () => {
        const bag = new SettingsBag({ bankTile: new Tile(3013, 3355, 0) });
        expect(siteTile(bag, 'bankTile', elsewhere)).toEqual(new Tile(3013, 3355, 0));
    });
});
