import { SettingsBag } from '#/bot/runtime/Settings.js';
import { rangedItem } from '#/bot/api/combat/rangedSettings.js';
import { describe, expect, test } from 'bun:test';
import { BOWS, DARTS } from '#/bot/api/combat/equipment.js';
import { SETTINGS as MOSS_SETTINGS } from '#/bot/scripts/MossGiant/MossGiant.js';
import { SETTINGS as FIRE_SETTINGS } from '#/bot/scripts/FireGiant/FireGiant.js';
import { SETTINGS as BRIM_SETTINGS } from '#/bot/scripts/BrimhavenMossGiants/settings.js';
import { SETTINGS as ROCK_SETTINGS } from '#/bot/scripts/RockCrab/RockCrab.js';
import { RANGED_WEAPONS, ROCK_CRAB_RANGED_WEAPONS, rangeLoadoutOf, rangeSupplyEmpty, rockCrabRangeLoadout } from '#/bot/api/combat/ranged.js';

describe('shared ranged loadouts (RockCrab + MossGiant)', () => {
    test('offers every bow and standard dart as a ranged weapon', () => {
        expect(RANGED_WEAPONS).toEqual([...BOWS, ...DARTS]);
        expect(ROCK_CRAB_RANGED_WEAPONS).toEqual(RANGED_WEAPONS);
        expect(DARTS).toEqual(['Bronze dart', 'Iron dart', 'Steel dart', 'Black dart', 'Mithril dart', 'Adamant dart', 'Rune dart']);
    });

    test('wires the persisted bow setting to the unified ranged weapon control', () => {
        for (const settings of [ROCK_SETTINGS, MOSS_SETTINGS]) {
            expect(settings.bow.label).toBe('Ranged weapon');
            expect(settings.bow.options).toEqual([...RANGED_WEAPONS, 'Other']);
            expect(settings.ammo.label).toBe('Bow ammo');
            expect(settings.ammo.help).toMatch(/ignored when the ranged weapon is a dart/i);
        }
        expect(MOSS_SETTINGS.ammoWithdraw.label).toBe('Projectiles per bank trip');
    });

    test.each(DARTS)('%s is its own weapon-slot projectile', dart => {
        expect(rangeLoadoutOf(dart, 'Rune arrow')).toEqual({
            weapon: dart,
            projectile: dart,
            thrown: true
        });
        // deprecated RockCrab alias stays wired
        expect(rockCrabRangeLoadout(dart, 'Rune arrow')).toEqual(rangeLoadoutOf(dart, 'Rune arrow'));
    });

    test('recognizes persisted dart names case-insensitively', () => {
        expect(rangeLoadoutOf('  rUnE DaRt ', 'Bronze arrow')).toEqual({
            weapon: 'Rune dart',
            projectile: 'Rune dart',
            thrown: true
        });
    });

    test('bows retain their separate quiver ammo', () => {
        expect(rangeLoadoutOf('Maple shortbow', 'Adamant arrow')).toEqual({
            weapon: 'Maple shortbow',
            projectile: 'Adamant arrow',
            thrown: false
        });
    });

    test('only reports depletion when no projectile remains anywhere', () => {
        expect(rangeSupplyEmpty(0, 0, 0)).toBe(true);
        expect(rangeSupplyEmpty(1, 0, 0)).toBe(false);
        expect(rangeSupplyEmpty(0, 1, 0)).toBe(false);
        expect(rangeSupplyEmpty(0, 0, 1)).toBe(false);
    });
});


test('all ranged grind scripts expose custom weapon and ammunition fields', () => {
    for (const settings of [ROCK_SETTINGS, MOSS_SETTINGS, FIRE_SETTINGS, BRIM_SETTINGS]) {
        expect(settings.bow.options).toContain('Other');
        expect(settings.ammo.options).toContain('Other');
        expect(settings.customBow?.showIf).toEqual({ key: 'bow', anyOf: ['Other'] });
        expect(settings.customAmmo?.showIf).toEqual({ key: 'ammo', anyOf: ['Other'] });
    }
});

test('matching custom weapon and ammo use one thrown projectile stack', () => {
    expect(rangeLoadoutOf('Rune knife', 'Rune knife')).toEqual({
        weapon: 'Rune knife', projectile: 'Rune knife', thrown: true
    });
    expect(rangeLoadoutOf('Crossbow', 'Bolts')).toEqual({
        weapon: 'Crossbow', projectile: 'Bolts', thrown: false
    });
});


test('custom ranged choices reach the loadout with whitespace trimmed', () => {
    const settings = new SettingsBag({ bow: 'Other', customBow: '  Crossbow ', ammo: 'Other', customAmmo: ' Bolts ' });
    expect(rangeLoadoutOf(rangedItem(settings, 'bow', 'Maple shortbow'), rangedItem(settings, 'ammo', 'Iron arrow'))).toEqual({
        weapon: 'Crossbow', projectile: 'Bolts', thrown: false
    });
    expect(rangedItem(new SettingsBag({ bow: 'Maple shortbow', customBow: 'Crossbow' }), 'bow', '')).toBe('Maple shortbow');
    expect(() => rangedItem(new SettingsBag({ bow: 'Other' }), 'bow', '')).toThrow('custom ranged weapon');
});
