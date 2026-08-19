import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { SETTINGS, shouldKeepBankItem } from '#/bot/scripts/AutoFighter/AutoFighter.js';
import {
    autoBankEnabled,
    BANKING_OPTIONS,
    BURIAL_BONE_NAME,
    CUSTOM_COORDINATES,
    DEFAULT_LOOT,
    resolveKillingSpot,
    shouldBuryRegularBones,
    SPOT_OPTIONS,
    START_POSITION,
    wantsAutoFighterLoot,
    autoRetaliateShouldEnable,
    assertAutoRetaliateOn
} from '#/bot/scripts/AutoFighter/AutoFighterData.js';
import { matchesEntityName } from '#/bot/api/query/Query.js';
import { resolveControl } from '#/bot/panel/paramControls.js';

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

    test('burying regular bones is optional and defaults off', () => {
        expect(SETTINGS.buryBones).toMatchObject({
            type: 'boolean',
            default: false,
            label: 'Bury regular bones'
        });
        expect(wantsAutoFighterLoot(BURIAL_BONE_NAME, DEFAULT_LOOT, false)).toBe(false);
        expect(
            shouldBuryRegularBones({
                enabled: false,
                inCombat: false,
                bankOpen: false,
                boneCount: 1,
                inventoryFull: false
            })
        ).toBe(false);
    });

    test('enabling burial forces only regular Bones into the loot filter', () => {
        expect(wantsAutoFighterLoot('Bones', DEFAULT_LOOT, true)).toBe(true);
        expect(wantsAutoFighterLoot(' bones ', DEFAULT_LOOT, true)).toBe(true);
        expect(wantsAutoFighterLoot('Big bones', DEFAULT_LOOT, true)).toBe(false);
        expect(wantsAutoFighterLoot('Dragon bones', DEFAULT_LOOT, true)).toBe(false);
        expect(wantsAutoFighterLoot('Big bones', ['big bones'], true)).toBe(true);
    });

    test('burial waits for combat and bank interfaces but works with a full inventory', () => {
        const ready = {
            enabled: true,
            inCombat: false,
            bankOpen: false,
            boneCount: 1,
            inventoryFull: true
        };
        expect(shouldBuryRegularBones(ready)).toBe(true);
        expect(shouldBuryRegularBones({ ...ready, inCombat: true })).toBe(false);
        expect(shouldBuryRegularBones({ ...ready, bankOpen: true })).toBe(false);
        expect(shouldBuryRegularBones({ ...ready, boneCount: 0 })).toBe(false);
    });

    test('banking protects carried Bones only while burial is enabled', () => {
        expect(shouldKeepBankItem('Bones', 526, 'Trout', true, [], [], false)).toBe(false);
        expect(shouldKeepBankItem('Bones', 526, 'Trout', true, [], [], true)).toBe(true);
        expect(shouldKeepBankItem('Big bones', 532, 'Trout', true, [], [], true)).toBe(false);
    });

    test('AutoFighter turns Auto Retaliate on and fails loudly if it stays off', () => {
        expect(autoRetaliateShouldEnable(false)).toBe(true);
        expect(autoRetaliateShouldEnable(true)).toBe(false);
        assertAutoRetaliateOn(true);
        expect(() => assertAutoRetaliateOn(false)).toThrow('[AutoFighter] could not enable Auto Retaliate');
    });
});
