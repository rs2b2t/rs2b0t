import { describe, expect, test } from 'bun:test';
import { DROP_DB } from '#/bot/data/dropdb.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { SETTINGS, siteTile } from '#/bot/scripts/JiveKBD/JiveKBD.js';
import { KBD_LAIR } from '#/bot/scripts/JiveKBD/sites.js';

describe('JiveKBD loot defaults', () => {
    const loot = SETTINGS.loot!;

    test('the options are the King Black Dragon table and every row starts ticked', () => {
        expect(loot.options).toEqual(DROP_DB['King black dragon']!);
        expect(loot.default).toEqual(loot.options!);
        expect(loot.options).toContain('Dragon bones');
        expect(loot.options).toContain('Dragon med helm');
        expect(loot.options).toContain('Rune longsword');
    });
});

describe('JiveKBD is mage only', () => {
    test('a staff and a spell are offered, nothing for range or melee', () => {
        expect(SETTINGS.staff!.default).toBe('Staff of fire');
        expect(SETTINGS.spell!.default).toBe('Fire Strike');
        for (const key of ['combatStyle', 'bow', 'ammo', 'rangeStyle', 'ammoWithdraw', 'meleeStyle', 'weapon', 'useSpecial', 'usePotions', 'buryBones', 'solveClues', 'leaveVia']) {
            expect(SETTINGS[key]).toBeUndefined();
        }
    });

    test('one antipoison flask a trip by default, never none', () => {
        expect(SETTINGS.dosesWithdraw!.default).toBe(1);
        expect(SETTINGS.dosesWithdraw!.min).toBe(1);
    });
});

describe('JiveKBD site tiles', () => {
    const elsewhere = new Tile(3200, 3200, 0);

    test('the schema default is the alcove, so an untouched setting hands the tile back to the site', () => {
        expect(SETTINGS.safespot1!.default).toEqual(KBD_LAIR.safespots[0]!);
        expect(SETTINGS.safespot2!.default).toEqual(KBD_LAIR.safespots[1]!);
        expect(SETTINGS.bankTile!.default).toEqual(KBD_LAIR.bank);
        expect(SETTINGS.site!.default).toBe('kbd-lair');
        const bag = new SettingsBag({ safespot1: SETTINGS.safespot1!.default });
        expect(siteTile(bag, 'safespot1', elsewhere)).toBe(elsewhere);
    });

    test('a tile moved off the default is the one that applies', () => {
        const moved = new Tile(2714, 9830, 0);
        expect(siteTile(new SettingsBag({ safespot1: moved }), 'safespot1', elsewhere)).toBe(moved);
    });
});
