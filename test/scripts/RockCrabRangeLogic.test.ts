import { describe, expect, test } from 'bun:test';
import { BOWS, DARTS } from '#/bot/api/combat/equipment.js';
import { SETTINGS } from '#/bot/scripts/RockCrab.js';
import { ROCK_CRAB_RANGED_WEAPONS, rangeSupplyEmpty, rockCrabRangeLoadout } from '#/bot/scripts/RockCrabRangeLogic.js';

describe('RockCrab ranged loadouts', () => {
    test('offers every bow and standard dart as a ranged weapon', () => {
        expect(ROCK_CRAB_RANGED_WEAPONS).toEqual([...BOWS, ...DARTS]);
        expect(DARTS).toEqual(['Bronze dart', 'Iron dart', 'Steel dart', 'Black dart', 'Mithril dart', 'Adamant dart', 'Rune dart']);
    });

    test('wires the persisted bow setting to the unified ranged weapon control', () => {
        expect(SETTINGS.bow.label).toBe('Ranged weapon');
        expect(SETTINGS.bow.options).toEqual(ROCK_CRAB_RANGED_WEAPONS);
        expect(SETTINGS.ammo.label).toBe('Bow ammo');
    });

    test.each(DARTS)('%s is its own weapon-slot projectile', dart => {
        expect(rockCrabRangeLoadout(dart, 'Rune arrow')).toEqual({
            weapon: dart,
            projectile: dart,
            thrown: true
        });
    });

    test('recognizes persisted dart names case-insensitively', () => {
        expect(rockCrabRangeLoadout('  rUnE DaRt ', 'Bronze arrow')).toEqual({
            weapon: 'Rune dart',
            projectile: 'Rune dart',
            thrown: true
        });
    });

    test('bows retain their separate quiver ammo', () => {
        expect(rockCrabRangeLoadout('Maple shortbow', 'Adamant arrow')).toEqual({
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
