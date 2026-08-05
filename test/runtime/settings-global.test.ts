import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    SettingsStore,
    GLOBAL_SETTINGS,
    GLOBAL_SETTINGS_CORE,
    NAV_SETTINGS,
    MAP_PICKER_SETTINGS,
    MAP_PICKER_SETTINGS_NS,
    type SettingsSchema
} from '#/bot/runtime/Settings.js';

const SCHEMA: SettingsSchema = { bankCommonJunk: { type: 'boolean', default: true } };
const K = (ns: string, key: string) => `rs2b0t:set:${ns}:${key}`;

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe('GLOBAL_SETTINGS', () => {
    test('exposes lampSkill (default strength, options incl. strength) and bankCommonJunk (bool, default true)', () => {
        expect(GLOBAL_SETTINGS.lampSkill.type).toBe('string');
        expect(GLOBAL_SETTINGS.lampSkill.default).toBe('strength');
        expect(GLOBAL_SETTINGS.lampSkill.options).toContain('strength');
        expect(GLOBAL_SETTINGS.lampSkill.options).toContain('mining');
        expect(GLOBAL_SETTINGS.bankCommonJunk.type).toBe('boolean');
        expect(GLOBAL_SETTINGS.bankCommonJunk.default).toBe(true);
    });

    test('exposes runAuto (bool, default on) and runEnergyMin (number, 0-100, default 20)', () => {
        expect(GLOBAL_SETTINGS.runAuto.type).toBe('boolean');
        expect(GLOBAL_SETTINGS.runAuto.default).toBe(true);
        expect(GLOBAL_SETTINGS.runEnergyMin.type).toBe('number');
        expect(GLOBAL_SETTINGS.runEnergyMin.default).toBe(20);
        expect(GLOBAL_SETTINGS.runEnergyMin.min).toBe(0);
        expect(GLOBAL_SETTINGS.runEnergyMin.max).toBe(100);
    });

    test('exposes navCameraFollow (bool, default off) for optional path-facing camera', () => {
        expect(GLOBAL_SETTINGS.navCameraFollow.type).toBe('boolean');
        expect(GLOBAL_SETTINGS.navCameraFollow.default).toBe(false);
        expect(NAV_SETTINGS.navCameraFollow?.default).toBe(false);
    });

    test('splits core Global vs Nav schemas (storage still Global namespace via GLOBAL_SETTINGS)', () => {
        expect(GLOBAL_SETTINGS_CORE.lampSkill).toBeDefined();
        expect((GLOBAL_SETTINGS_CORE as SettingsSchema).navTeleports).toBeUndefined();
        expect(NAV_SETTINGS.navTeleports).toBeDefined();
        expect(NAV_SETTINGS.navPathStallTicks?.group).toBe('Routing');
        expect(NAV_SETTINGS.showNavPath?.group).toBe('Display');
        expect(NAV_SETTINGS.navPathColorPath?.group).toBe('Path paint');
        expect(NAV_SETTINGS.navPathSceneExpand?.group).toBe('Experimental');
        // Full bag keeps both for SettingsStore.globalBag / resolve
        expect(GLOBAL_SETTINGS.lampSkill).toBeDefined();
        expect(GLOBAL_SETTINGS.navTeleports).toBeDefined();
    });


    test('runEnergyMin saved values clamp to 0-100 through the global bag', () => {
        sessionStorage.setItem(K('Global', 'runEnergyMin'), '250');
        expect(SettingsStore.globalBag().num('runEnergyMin', 20)).toBe(100);
        sessionStorage.setItem(K('Global', 'runEnergyMin'), '-5');
        expect(SettingsStore.globalBag().num('runEnergyMin', 20)).toBe(0);
        sessionStorage.setItem(K('Global', 'runAuto'), 'false');
        expect(SettingsStore.globalBag().bool('runAuto', true)).toBe(false);
    });
});

describe('resolve global fallback (per-script overrides global)', () => {
    test('per-script saved value wins over the global value', () => {
        sessionStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        sessionStorage.setItem(K('MyBot', 'bankCommonJunk'), 'true');
        expect(SettingsStore.resolve('MyBot', SCHEMA).bankCommonJunk).toBe(true);
    });
    test('global value applies when the per-script value is unset', () => {
        sessionStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        expect(SettingsStore.resolve('MyBot', SCHEMA).bankCommonJunk).toBe(false);
    });
    test('global default is the floor when neither is set', () => {
        expect(SettingsStore.resolve('MyBot', SCHEMA).bankCommonJunk).toBe(true);
    });
    test('resolving the Global namespace itself does not re-enter the fallback', () => {
        sessionStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        expect(SettingsStore.resolve('Global', GLOBAL_SETTINGS).bankCommonJunk).toBe(false);
    });
    test('non-global keys are unaffected (still schema default)', () => {
        const s: SettingsSchema = { width: { type: 'number', default: 7 } };
        expect(SettingsStore.resolve('MyBot', s).width).toBe(7);
    });
});

describe('displayString mirrors resolve for global-eligible keys', () => {
    const DEF = SCHEMA.bankCommonJunk;
    test('shows the global value when the per-script value is unset', () => {
        sessionStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        expect(SettingsStore.displayString('MyBot', 'bankCommonJunk', DEF)).toBe('false');
    });
    test('per-script saved value still wins in the display', () => {
        sessionStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        sessionStorage.setItem(K('MyBot', 'bankCommonJunk'), 'true');
        expect(SettingsStore.displayString('MyBot', 'bankCommonJunk', DEF)).toBe('true');
    });
    test('falls back to the global default (not the schema default) when unset', () => {
        expect(SettingsStore.displayString('MyBot', 'bankCommonJunk', DEF)).toBe('true');
    });
    test('non-global keys still show their own schema default', () => {
        const def = { type: 'number', default: 7 } as const;
        expect(SettingsStore.displayString('MyBot', 'width', def)).toBe('7');
    });
});

describe('MAP_PICKER_SETTINGS (in-picker only, not Global)', () => {
    test('is a separate schema with Display + Worldmap layers + rebuild defaults', () => {
        expect(MAP_PICKER_SETTINGS_NS).toBe('MapPicker');
        expect(MAP_PICKER_SETTINGS.showBasemap?.default).toBe(true);
        expect(MAP_PICKER_SETTINGS.keyIconTypes?.type).toBe('string[]');
        expect(MAP_PICKER_SETTINGS.keyIconTypes?.default).toEqual([]);
        expect(MAP_PICKER_SETTINGS.keyIconTypes?.options?.length).toBeGreaterThan(40);
        expect(MAP_PICKER_SETTINGS.keyIconTypes?.options).toContain('Bank');
        expect(MAP_PICKER_SETTINGS.showMultiTint?.default).toBe(false);
        expect(MAP_PICKER_SETTINGS.showFreeTint?.default).toBe(false);
        expect(MAP_PICKER_SETTINGS.bakeLabels?.default).toBe(false);
        expect((GLOBAL_SETTINGS as SettingsSchema).showBasemap).toBeUndefined();
        expect((GLOBAL_SETTINGS as SettingsSchema).mapPickerShowBasemap).toBeUndefined();
    });
});

describe('globalBag', () => {
    test('reads the Global namespace (lampSkill default + saved override)', () => {
        expect(SettingsStore.globalBag().str('lampSkill', 'x')).toBe('strength');
        sessionStorage.setItem(K('Global', 'lampSkill'), 'mining');
        expect(SettingsStore.globalBag().str('lampSkill', 'x')).toBe('mining');
    });
});

describe('value normalization', () => {
    test('trims freeform strings and parses booleans case-insensitively', () => {
        const schema: SettingsSchema = {
            target: { type: 'string', default: 'Guard' },
            enabled: { type: 'boolean', default: false }
        };
        sessionStorage.setItem(K('Normalize', 'target'), '  Moss Giant  ');
        sessionStorage.setItem(K('Normalize', 'enabled'), ' YES ');

        expect(SettingsStore.resolve('Normalize', schema)).toEqual({
            target: 'Moss Giant',
            enabled: true
        });
    });

    test('canonicalizes constrained list values case-insensitively', () => {
        const schema: SettingsSchema = {
            quests: {
                type: 'string[]',
                default: [],
                options: ['cooks_assistant', 'romeo_and_juliet']
            }
        };
        sessionStorage.setItem(K('Normalize', 'quests'), ' COOKS_ASSISTANT, Romeo_And_Juliet ');

        expect(SettingsStore.resolve('Normalize', schema).quests).toEqual(['cooks_assistant', 'romeo_and_juliet']);
    });
});
