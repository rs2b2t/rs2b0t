import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SettingsStore, GLOBAL_SETTINGS, type SettingsSchema } from '#/bot/runtime/Settings.js';

const SCHEMA: SettingsSchema = { bankCommonJunk: { type: 'boolean', default: true } };
const K = (ns: string, key: string) => `rs2b0t:set:${ns}:${key}`;

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

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

    test('runEnergyMin saved values clamp to 0-100 through the global bag', () => {
        localStorage.setItem(K('Global', 'runEnergyMin'), '250');
        expect(SettingsStore.globalBag().num('runEnergyMin', 20)).toBe(100);
        localStorage.setItem(K('Global', 'runEnergyMin'), '-5');
        expect(SettingsStore.globalBag().num('runEnergyMin', 20)).toBe(0);
        localStorage.setItem(K('Global', 'runAuto'), 'false');
        expect(SettingsStore.globalBag().bool('runAuto', true)).toBe(false);
    });
});

describe('resolve global fallback (per-script overrides global)', () => {
    test('per-script saved value wins over the global value', () => {
        localStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        localStorage.setItem(K('MyBot', 'bankCommonJunk'), 'true');
        expect(SettingsStore.resolve('MyBot', SCHEMA).bankCommonJunk).toBe(true);
    });
    test('global value applies when the per-script value is unset', () => {
        localStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        expect(SettingsStore.resolve('MyBot', SCHEMA).bankCommonJunk).toBe(false);
    });
    test('global default is the floor when neither is set', () => {
        expect(SettingsStore.resolve('MyBot', SCHEMA).bankCommonJunk).toBe(true);
    });
    test('resolving the Global namespace itself does not re-enter the fallback', () => {
        localStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
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
        localStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        expect(SettingsStore.displayString('MyBot', 'bankCommonJunk', DEF)).toBe('false');
    });
    test('per-script saved value still wins in the display', () => {
        localStorage.setItem(K('Global', 'bankCommonJunk'), 'false');
        localStorage.setItem(K('MyBot', 'bankCommonJunk'), 'true');
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

describe('globalBag', () => {
    test('reads the Global namespace (lampSkill default + saved override)', () => {
        expect(SettingsStore.globalBag().str('lampSkill', 'x')).toBe('strength');
        localStorage.setItem(K('Global', 'lampSkill'), 'mining');
        expect(SettingsStore.globalBag().str('lampSkill', 'x')).toBe('mining');
    });
});
