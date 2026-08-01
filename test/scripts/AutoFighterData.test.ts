import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/api/Tile.js';
import { SETTINGS, shouldKeepBankItem } from '#/bot/scripts/AutoFighter.js';
import {
    autoBankEnabled,
    BANKING_OPTIONS,
    CUSTOM_COORDINATES,
    DEFAULT_LOOT,
    resolveKillingSpot,
    SPOT_OPTIONS,
    START_POSITION
} from '#/bot/scripts/AutoFighterData.js';
import { matchesEntityName } from '#/bot/api/queries/Query.js';
import { resolveControl } from '#/bot/ui/paramControls.js';

describe('AutoFighter data', () => {
    test('loot defaults to exactly gems + clues (the spec set)', () => {
        expect(DEFAULT_LOOT).toEqual([
            'clue scroll',
            'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
            'half of a key',
            'chaos talisman', 'nature talisman'
        ]);
    });
    test('target is a freeform text control', () => {
        expect(SETTINGS.target.options).toBeUndefined();
        expect(resolveControl(SETTINGS.target)).toBe('text');
    });
    test('fresh NPC snapshots match lowercase freeform targets', () => {
        expect(matchesEntityName('Man', 'man')).toBe(true);
        expect(matchesEntityName(' Chicken ', ' chicken ')).toBe(true);
        expect(matchesEntityName('Woman', 'man')).toBe(false);
        expect(matchesEntityName(null, 'man')).toBe(false);
    });
    test('killing spot defaults to the script start or accepts coordinates', () => {
        expect(SPOT_OPTIONS).toEqual([START_POSITION, CUSTOM_COORDINATES]);
        expect(SETTINGS.spot.default).toBe(START_POSITION);
        expect(SETTINGS.coordinates.showIf).toEqual({ key: 'spot', anyOf: [CUSTOM_COORDINATES] });

        const start = new Tile(3200, 3201, 0);
        const custom = new Tile(3300, 3301, 1);
        expect(resolveKillingSpot(START_POSITION, start, custom).equals(start)).toBe(true);
        expect(resolveKillingSpot(CUSTOM_COORDINATES, start, custom).equals(custom)).toBe(true);
        expect(resolveKillingSpot('unknown legacy preset', start, custom).equals(start)).toBe(true);
    });
    test('banking uses the Miner-style Auto or None choice', () => {
        expect(BANKING_OPTIONS).toEqual(['Auto', 'None']);
        expect(SETTINGS.banking.options).toEqual(BANKING_OPTIONS);
        expect(autoBankEnabled('Auto')).toBe(true);
        expect(autoBankEnabled('auto')).toBe(true);
        expect(autoBankEnabled('None')).toBe(false);
    });
    test('banking deposits only the generic reward Casket when common junk is enabled', () => {
        expect(SETTINGS.bankCommonJunk).toMatchObject({ type: 'boolean', default: true });
        expect(shouldKeepBankItem('Casket', 405, 'Trout', true)).toBe(false);
        expect(shouldKeepBankItem('Casket', 405, 'Trout', false)).toBe(true);
        expect(shouldKeepBankItem('Casket', 2714, 'Trout', true)).toBe(true);
        expect(shouldKeepBankItem('Casket', 406, 'Trout', true)).toBe(true);
        expect(shouldKeepBankItem('Rusty casket', 3849, 'Trout', true)).toBe(true);
    });
    test('banking still protects food, coins, clue tools, and clue scrolls', () => {
        for (const [name, id] of [['Trout', 333], ['Coins', 995], ['Spade', 952], ['Clue scroll', 2677]] as const) {
            expect(shouldKeepBankItem(name, id, 'Trout', true)).toBe(true);
        }
        expect(shouldKeepBankItem('Uncut ruby', 1619, 'Trout', true)).toBe(false);
    });
    test('combat style defaults to melee and gates mage/range settings', () => {
        expect(SETTINGS.combatStyle).toMatchObject({ type: 'string', default: 'melee', options: ['melee', 'mage', 'range'] });
        expect(SETTINGS.spell.showIf).toEqual({ key: 'combatStyle', anyOf: ['mage'] });
        expect(SETTINGS.runesWithdraw.showIf).toEqual({ key: 'combatStyle', anyOf: ['mage'] });
        expect(SETTINGS.rangeStyle.showIf).toEqual({ key: 'combatStyle', anyOf: ['range'] });
        expect(SETTINGS.ammo.showIf).toEqual({ key: 'combatStyle', anyOf: ['range'] });
        expect(SETTINGS.ammoRestockBelow.showIf).toEqual({ key: 'combatStyle', anyOf: ['mage', 'range'] });
    });
    test('banking keeps range ammo and tracked gear', () => {
        expect(shouldKeepBankItem('Bronze arrow', 882, 'Trout', true, ['Bronze arrow'], [])).toBe(true);
        expect(shouldKeepBankItem('Bronze arrow', 882, 'Trout', true, [], ['Bronze arrow'])).toBe(true);
        expect(shouldKeepBankItem('Iron arrow', 884, 'Trout', true, ['Bronze arrow'], [])).toBe(false);
        expect(shouldKeepBankItem('Maple shortbow', 853, 'Trout', true, [], ['Maple shortbow'])).toBe(true);
    });
});
