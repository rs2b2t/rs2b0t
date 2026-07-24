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
