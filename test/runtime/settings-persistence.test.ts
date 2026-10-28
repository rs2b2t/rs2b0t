import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SettingsStore } from '#/bot/runtime/Settings.js';

const K = (ns: string, key: string) => `rs2b0t:set:${ns}:${key}`;

const clearAll = () => {
    sessionStorage.clear();
    localStorage.clear();
};
beforeEach(clearAll);
afterEach(clearAll);

describe('durable settings persistence (client relaunch)', () => {
    test('JiveRC preserves saved NatureCrafter settings through the rename', () => {
        SettingsStore.save('NatureCrafter', 'partner', 'runner one,runner two');
        expect(SettingsStore.saved('JiveRC', 'partner')).toBe('runner one,runner two');
        SettingsStore.save('JiveRC', 'partner', 'runner three');
        sessionStorage.clear();
        expect(SettingsStore.saved('JiveRC', 'partner')).toBe('runner three');
        SettingsStore.clear('JiveRC', 'partner');
        expect(SettingsStore.saved('JiveRC', 'partner')).toBeUndefined();
    });

    test('explicit JiveRC settings override legacy NatureCrafter settings', () => {
        SettingsStore.save('NatureCrafter', 'partner', 'legacy');
        sessionStorage.setItem(K('JiveRC', 'partner'), 'current');
        expect(SettingsStore.saved('JiveRC', 'partner')).toBe('current');
    });

    test('save writes through to localStorage so a fresh instance inherits it', () => {
        SettingsStore.save('MossGiant', 'combatStyle', 'range');
        expect(localStorage.getItem(K('MossGiant', 'combatStyle'))).toBe('range');
        sessionStorage.clear();
        expect(SettingsStore.saved('MossGiant', 'combatStyle')).toBe('range');
    });

    test('live sessionStorage value wins over the durable layer', () => {
        localStorage.setItem(K('MossGiant', 'combatStyle'), 'range');
        sessionStorage.setItem(K('MossGiant', 'combatStyle'), 'mage');
        expect(SettingsStore.saved('MossGiant', 'combatStyle')).toBe('mage');
    });

    test('clear removes both layers so reset really resets', () => {
        SettingsStore.save('MossGiant', 'combatStyle', 'range');
        SettingsStore.clear('MossGiant', 'combatStyle');
        expect(SettingsStore.saved('MossGiant', 'combatStyle')).toBeUndefined();
        expect(localStorage.getItem(K('MossGiant', 'combatStyle'))).toBeNull();
    });
});
