import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { prefsKeyFromBakePrefs } from '#/bot/panel/basemapLocalCache.js';
import { WorldMapPicker } from '#/bot/panel/WorldMapPicker.js';
import {
    prefsFingerprint,
    resolveBasemapBakePrefs,
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

function countStorageWrites(action: () => void): number {
    let writes = 0;
    const cleanup: (() => void)[] = [];
    try {
        for (const storage of [localStorage, sessionStorage]) {
            for (const method of ['setItem', 'removeItem'] as const) {
                const original = storage[method];
                Object.defineProperty(storage, method, {
                    configurable: true,
                    value: (...args: [string, string?]) => {
                        writes++;
                        return Reflect.apply(original, storage, args);
                    }
                });
                cleanup.push(() => Object.defineProperty(storage, method, { value: original }));
            }
        }
        action();
        return writes;
    } finally {
        for (const restore of cleanup) restore();
    }
}

describe('prefsKeyFromBakePrefs', () => {
    test('matches basemapRegen prefsFingerprint', () => {
        const p = prefs({ labels: true, borders: true });
        expect(prefsKeyFromBakePrefs(p)).toBe(prefsFingerprint(p));
        expect(prefsKeyFromBakePrefs(p)).toBe('LBnikmf');
    });

    test('default bake prefs fingerprint is terrain-only (nothing stamped)', () => {
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

    test.each([false, true])("Escape preserves another tab's label save (edited borders: %p)", async editBorders => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        const params = SettingsStore['urlParams'];
        const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
        const frame = spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => new Response(null, { status: 404 }) });
        try {
            SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
            SettingsStore['urlParams'] = new URLSearchParams('MapPicker.bakeLabels=true');
            const result = WorldMapPicker.open();
            await new Promise<void>(resolve => setImmediate(resolve));
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-settings')!.click();
            localStorage.setItem(labels, 'true');
            if (editBorders) {
                const row = Array.from(document.querySelectorAll('.rs2b0t-param-row'))
                    .find(row => row.querySelector('.rs2b0t-param-label')?.textContent === 'Map-square borders')!;
                row.querySelector<HTMLInputElement>('input')!.click();
                expect(localStorage.getItem(borders)).toBe('true');
            }
            const writes = countStorageWrites(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            });
            expect(writes).toBe(editBorders ? 2 : 0);
            expect(localStorage.getItem(borders)).toBeNull();
            expect(sessionStorage.getItem(borders)).toBeNull();
            sessionStorage.clear();
            SettingsStore['urlParams'] = new URLSearchParams();
            expect(resolveBasemapBakePrefs().labels).toBe(true);
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')!.click();
            expect(await result).toBeNull();
        } finally {
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')?.click();
            SettingsStore['urlParams'] = params;
            Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
            frame.mockRestore();
        }
    });

    test('untouched close leaves the saved preference and absent keys alone under a URL override', () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
        const params = SettingsStore['urlParams'];
        try {
            SettingsStore['urlParams'] = new URLSearchParams('MapPicker.bakeLabels=true');
            expect(resolveBasemapBakePrefs().labels).toBe(true);
            const writes = countStorageWrites(() => restoreMapPickerBakeSettings(snapshotMapPickerBakeSettings(), new Set()));
            expect(writes).toBe(0);
            expect(localStorage.length).toBe(1);
            expect(sessionStorage.length).toBe(1);

            sessionStorage.clear();
            SettingsStore['urlParams'] = new URLSearchParams();
            expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toBe('false');
            expect(resolveBasemapBakePrefs().labels).toBe(false);
        } finally {
            SettingsStore['urlParams'] = params;
        }
    });

    test('discard restores prior raw values and absence in both storage layers', () => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        localStorage.setItem(labels, '0');
        sessionStorage.setItem(borders, 'yes');
        const snap = snapshotMapPickerBakeSettings();

        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'true');
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeBorders', 'false');
        const restored: Record<string, string> = {};
        const unsubscribe = SettingsStore.onChange((_name, key, value) => { restored[key] = value; });
        try {
            restoreMapPickerBakeSettings(snap, new Set(['bakeLabels', 'bakeBorders']));
        } finally {
            unsubscribe();
        }
        expect(restored).toEqual({ bakeLabels: '0', bakeBorders: 'yes' });
        expect(localStorage.getItem(labels)).toBe('0');
        expect(sessionStorage.getItem(labels)).toBeNull();
        expect(localStorage.getItem(borders)).toBeNull();
        expect(sessionStorage.getItem(borders)).toBe('yes');
    });

    test('post-rebuild baseline: further edits discard to last rebuilt snapshot', () => {
        let baseline = snapshotMapPickerBakeSettings();
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'true');
        baseline = snapshotMapPickerBakeSettings();

        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeNpcs', 'true');
        restoreMapPickerBakeSettings(baseline, new Set(['bakeLabels', 'bakeNpcs']));
        expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toBe('true');
        expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeNpcs')).toBeUndefined();
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
