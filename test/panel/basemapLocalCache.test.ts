import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as basemapRegen from '#/bot/panel/basemapRegen.js';
import { prefsKeyFromBakePrefs } from '#/bot/panel/basemapLocalCache.js';
import { WorldMapPicker } from '#/bot/panel/WorldMapPicker.js';
import {
    prefsFingerprint,
    resolveBasemapBakePrefs,
    MapPickerBakeDraft,
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

    function bakeCheckbox(label: string): HTMLInputElement {
        const row = Array.from(document.querySelectorAll('.rs2b0t-param-row'))
            .find(row => row.querySelector('.rs2b0t-param-label')?.textContent === label)!;
        return row.querySelector<HTMLInputElement>('input')!;
    }

    function openSettings(): void {
        document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-settings')!.click();
    }

    function escapeSettings(): void {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    function rebuiltMap(): Awaited<ReturnType<typeof basemapRegen.regenerateBasemap>> {
        return {
            manifest: {
                schema: 2, fingerprint: 'terrain', origin: { x: 0, z: 0 }, sizeTiles: { w: 1, h: 1 },
                pixelsPerTile: 1, basemapUrl: 'live-regen'
            },
            image: document.createElement('canvas')
        };
    }

    async function withPicker(check: () => void | Promise<void>): Promise<void> {
        const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
        const frame = spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => new Response(null, { status: 404 }) });
        try {
            const result = WorldMapPicker.open();
            await new Promise<void>(resolve => setImmediate(resolve));
            await check();
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')!.click();
            expect(await result).toBeNull();
        } finally {
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')?.click();
            Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
            frame.mockRestore();
        }
    }

    test.each([false, true])("Escape preserves another tab's label save (edited borders: %p)", async editBorders => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        const params = SettingsStore['urlParams'];
        try {
            SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
            SettingsStore['urlParams'] = new URLSearchParams('MapPicker.bakeLabels=true');
            await withPicker(() => {
                openSettings();
                localStorage.setItem(labels, 'true');
                if (editBorders) {
                    bakeCheckbox('Map-square borders').click();
                    expect(localStorage.getItem(borders)).toBe('true');
                }
                expect(countStorageWrites(escapeSettings)).toBe(editBorders ? 2 : 0);
                expect(localStorage.getItem(borders)).toBeNull();
                expect(sessionStorage.getItem(borders)).toBeNull();
                sessionStorage.clear();
                SettingsStore['urlParams'] = new URLSearchParams();
                expect(resolveBasemapBakePrefs().labels).toBe(true);
            });
        } finally {
            SettingsStore['urlParams'] = params;
        }
    });

    test.each([
        ['before the first edit', 'false'],
        ['after the last edit', 'false'],
        ['after the last edit', '0']
    ])("Escape keeps another tab's save to the edited key %s (initial value %s)", async (timing, initial) => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        localStorage.setItem(labels, initial);
        await withPicker(() => {
            openSettings();
            const checkbox = bakeCheckbox('Stamp labels into rebuild');
            if (timing === 'before the first edit') localStorage.setItem(labels, 'true');
            checkbox.click();
            checkbox.click();
            expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toEqual({ local: 'false', session: 'false' });
            if (timing === 'after the last edit') localStorage.setItem(labels, 'true');
            escapeSettings();
            expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toEqual({ local: 'true', session: null });
        });
    });

    test.each([false, true])('Escape restores the settings used by a successful rebuild (Settings already open: %p)', async alreadyOpen => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeBorders', 'false');
        const pending = Promise.withResolvers<Awaited<ReturnType<typeof basemapRegen.regenerateBasemap>>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValue(pending.promise);
        try {
            await withPicker(async () => {
                const rebuild = document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-rebuild')!;
                if (alreadyOpen) {
                    openSettings();
                    bakeCheckbox('Stamp labels into rebuild').click();
                }
                rebuild.click();
                expect(bake).toHaveBeenCalledWith(prefs({ labels: alreadyOpen }));
                if (!alreadyOpen) openSettings();
                bakeCheckbox('Map-square borders').click();
                expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeBorders')).toBe('true');
                if (alreadyOpen) bakeCheckbox('Stamp labels into rebuild').click();
                pending.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('basemap rebuilt');
                bakeCheckbox('NPC dots').click();
                escapeSettings();
                expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeBorders')).toEqual({ local: 'false', session: 'false' });
                expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toBe(alreadyOpen ? 'true' : undefined);
                expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeNpcs')).toBeUndefined();
            });
        } finally {
            bake.mockRestore();
        }
    });

    test.each([false, true])('Settings opened during a rebuild keeps the other tab\'s label save (reopened: %p)', async reopened => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const pending = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValue(pending.promise);
        try {
            await withPicker(async () => {
                if (reopened) openSettings();
                document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-rebuild')!.click();
                expect(bake).toHaveBeenCalledWith(prefs());
                if (reopened) escapeSettings();
                localStorage.setItem('rs2b0t:set:MapPicker:bakeLabels', 'true');
                openSettings();
                pending.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('basemap rebuilt');

                bakeCheckbox('Stamp labels into rebuild').click();
                expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toBe('false');
                escapeSettings();
                expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toEqual({ local: 'true', session: null });
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('Escape removes the session draft when the local save throws', async () => {
        await withPicker(() => {
            openSettings();
            const setItem = localStorage.setItem;
            const report = spyOn(console, 'error').mockImplementationOnce(() => {});
            Object.defineProperty(localStorage, 'setItem', {
                configurable: true,
                value: () => { throw new DOMException('storage full', 'QuotaExceededError'); }
            });
            try {
                bakeCheckbox('Map-square borders').click();
                expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeBorders')).toEqual({ local: null, session: 'true' });
                escapeSettings();
                expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeBorders')).toEqual({ local: null, session: null });
            } finally {
                Object.defineProperty(localStorage, 'setItem', { value: setItem });
                report.mockRestore();
            }
        });
    });

    test('untouched close leaves the saved preference and absent keys alone under a URL override', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
        const params = SettingsStore['urlParams'];
        try {
            SettingsStore['urlParams'] = new URLSearchParams('MapPicker.bakeLabels=true');
            expect(resolveBasemapBakePrefs().labels).toBe(true);
            await withPicker(() => {
                expect(countStorageWrites(() => {
                    openSettings();
                    escapeSettings();
                })).toBe(0);
            });
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
        const draft = new MapPickerBakeDraft();

        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'true', draft.record);
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeBorders', 'false', draft.record);
        const restored: Record<string, string> = {};
        const unsubscribe = SettingsStore.onChange((_name, key, value) => { restored[key] = value; });
        try {
            draft.discard();
        } finally {
            unsubscribe();
        }
        expect(restored).toEqual({ bakeLabels: '0', bakeBorders: 'yes' });
        expect(localStorage.getItem(labels)).toBe('0');
        expect(sessionStorage.getItem(labels)).toBeNull();
        expect(localStorage.getItem(borders)).toBeNull();
        expect(sessionStorage.getItem(borders)).toBe('yes');
    });

    test('a failed rebuild leaves the original draft baseline in place', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockRejectedValue(new Error('fixture failure'));
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Map-square borders').click();
                document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-rebuild')!.click();
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('rebuild failed');
                escapeSettings();
                expect(SettingsStore.snapshotStored(MAP_PICKER_SETTINGS_NS, 'bakeBorders')).toEqual({ local: null, session: null });
            });
        } finally {
            bake.mockRestore();
        }
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
