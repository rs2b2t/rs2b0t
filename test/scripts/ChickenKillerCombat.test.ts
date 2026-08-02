import { describe, expect, test } from 'bun:test';
import { SETTINGS as CHICKEN_SETTINGS } from '#/bot/scripts/ChickenKiller.js';
import { SETTINGS as COW_SETTINGS } from '#/bot/scripts/CowKiller.js';

describe('ChickenKiller combat settings (AutoFighter-aligned)', () => {
    test('combatStyle is melee | mage | range', () => {
        expect(CHICKEN_SETTINGS.combatStyle).toMatchObject({
            type: 'string',
            default: 'melee',
            options: ['melee', 'mage', 'range']
        });
    });

    test('melee / mage / range groups use showIf', () => {
        expect(CHICKEN_SETTINGS.meleeStyle?.showIf).toEqual({ key: 'combatStyle', anyOf: ['melee'] });
        expect(CHICKEN_SETTINGS.spell?.showIf).toEqual({ key: 'combatStyle', anyOf: ['mage'] });
        expect(CHICKEN_SETTINGS.runesWithdraw?.showIf).toEqual({ key: 'combatStyle', anyOf: ['mage'] });
        expect(CHICKEN_SETTINGS.rangeStyle?.showIf).toEqual({ key: 'combatStyle', anyOf: ['range'] });
        expect(CHICKEN_SETTINGS.ammo?.showIf).toEqual({ key: 'combatStyle', anyOf: ['range'] });
        expect(CHICKEN_SETTINGS.ammoWithdraw?.showIf).toEqual({ key: 'combatStyle', anyOf: ['range'] });
    });

    test('CowKiller inherits combat style options via chicken preset', () => {
        expect(COW_SETTINGS.combatStyle?.options).toEqual(['melee', 'mage', 'range']);
        expect(COW_SETTINGS.rangeStyle?.showIf).toEqual({ key: 'combatStyle', anyOf: ['range'] });
        expect(COW_SETTINGS.ammo?.default).toBe('Bronze arrow');
    });
});
