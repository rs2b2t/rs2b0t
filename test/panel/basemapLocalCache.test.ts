import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { prefsKeyFromBakePrefs } from '#/bot/panel/basemapLocalCache.js';
import {
    prefsFingerprint,
    restoreMapPickerBakeSettings,
    snapshotMapPickerBakeSettings,
    type BasemapBakePrefs
} from '#/bot/panel/basemapRegen.js';
import { MAP_PICKER_SETTINGS_NS, SettingsStore } from '#/bot/runtime/Settings.js';

const prefs = (over: Partial<BasemapBakePrefs> = {}): BasemapBakePrefs => ({
    labels: false,
    borders: false,
    npcs: false,
    items: false,
    keyIcons: false,
    multimap: false,
    freemap: false,
    ...over
});

describe('prefsKeyFromBakePrefs', () => {
    test('matches basemapRegen prefsFingerprint', () => {
        const p = prefs({ labels: true, borders: true });
        expect(prefsKeyFromBakePrefs(p)).toBe(prefsFingerprint(p));
        expect(prefsKeyFromBakePrefs(p)).toBe('LBnikmf');
    });

    test('default bake prefs fingerprint is terrain-only (nothing stamped)', () => {
        // labels/key/overlays off
        expect(prefsKeyFromBakePrefs(prefs())).toBe('lbnikmf');
    });
});

describe('client CRC key format (unit of /crc)', () => {
    test('nine big-endian u32 encode as 72 hex chars', () => {
        // Mirrors fetchClientCrcKey: first 36 bytes → 72 hex digits
        const bytes = new Uint8Array(40);
        for (let i = 0; i < 36; i++) {
            bytes[i] = i;
        }
        let key = '';
        for (let i = 0; i < 36; i++) {
            key += bytes[i]!.toString(16).padStart(2, '0');
        }
        expect(key.length).toBe(72);
        expect(key.startsWith('000102')).toBe(true);
    });
});

describe('bake settings snapshot/restore (settings modal discard)', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });
    afterEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    test('restore reverts bake layer keys after uncommitted edits', () => {
        const snap = snapshotMapPickerBakeSettings();
        expect(snap.bakeLabels).toBe('false');

        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'true');
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeBorders', 'true');
        expect(snapshotMapPickerBakeSettings().bakeLabels).toBe('true');
        expect(snapshotMapPickerBakeSettings().bakeBorders).toBe('true');

        restoreMapPickerBakeSettings(snap);
        const again = snapshotMapPickerBakeSettings();
        expect(again.bakeLabels).toBe('false');
        expect(again.bakeBorders).toBe('false');
    });

    test('post-rebuild baseline: further edits discard to last rebuilt snapshot', () => {
        // Open settings
        let baseline = snapshotMapPickerBakeSettings();
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'true');
        // Successful rebuild → refresh baseline (committed values stay)
        baseline = snapshotMapPickerBakeSettings();
        expect(baseline.bakeLabels).toBe('true');

        // Further edit without rebuild
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeNpcs', 'true');
        // Close settings → restore to post-rebuild baseline
        restoreMapPickerBakeSettings(baseline);
        const after = snapshotMapPickerBakeSettings();
        expect(after.bakeLabels).toBe('true');
        expect(after.bakeNpcs).toBe('false');
    });
});

describe('prefs fingerprint invalidation shape', () => {
    test('prefsKey changes when any bake layer flips', () => {
        const a = prefsKeyFromBakePrefs(prefs());
        const b = prefsKeyFromBakePrefs(prefs({ labels: true }));
        const c = prefsKeyFromBakePrefs(prefs({ freemap: true }));
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        expect(b).not.toBe(c);
    });
});

