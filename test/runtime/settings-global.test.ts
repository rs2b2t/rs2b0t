import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SettingsStore, GLOBAL_SETTINGS, type SettingsSchema } from '#/bot/runtime/Settings.js';

const SCHEMA: SettingsSchema = { bankCommonJunk: { type: 'boolean', default: true } };
const K = (ns: string, key: string) => `lcb:set:${ns}:${key}`;

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

describe('globalBag', () => {
    test('reads the Global namespace (lampSkill default + saved override)', () => {
        expect(SettingsStore.globalBag().str('lampSkill', 'x')).toBe('strength');
        localStorage.setItem(K('Global', 'lampSkill'), 'mining');
        expect(SettingsStore.globalBag().str('lampSkill', 'x')).toBe('mining');
    });
});
