import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as basemapRegen from '#/bot/panel/basemapRegen.js';
import * as localCache from '#/bot/panel/basemapLocalCache.js';
import { WorldMapPicker } from '#/bot/panel/WorldMapPicker.js';
import {
    prefsFingerprint,
    resolveBasemapBakePrefs,
    type BasemapBakePrefs
} from '#/bot/panel/basemapRegen.js';
import { desktopStorage } from '#/bot/runtime/desktopStorage.js';
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
        expect(localCache.prefsKeyFromBakePrefs(p)).toBe(prefsFingerprint(p));
        expect(localCache.prefsKeyFromBakePrefs(p)).toBe('LBnikmf');
    });

    test('default bake prefs fingerprint is terrain-only (nothing stamped)', () => {
        expect(localCache.prefsKeyFromBakePrefs(prefs())).toBe('lbnikmf');
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

describe('map picker bake settings drafts', () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

    function disableWebLocks(): void {
        Object.defineProperty(navigator, 'locks', { value: undefined });
        const stores = new Set<string>();
        let writer = Promise.resolve();
        const db = {
            close() {},
            createObjectStore(name: string) { stores.add(name); },
            transaction(name: string, mode: IDBTransactionMode) {
                expect(stores.has(name)).toBe(true);
                expect(mode).toBe('readwrite');
                const store = {
                    getKey() {
                        const read = { onsuccess: () => {} };
                        writer = writer.then(() => read.onsuccess());
                        return read;
                    }
                };
                return { objectStore: () => store };
            }
        };
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
            open() {
                const request = { result: db, onupgradeneeded: () => {}, onsuccess: () => {} };
                queueMicrotask(() => {
                    if (!stores.size) request.onupgradeneeded();
                    request.onsuccess();
                });
                return request;
            }
        } });
    }

    beforeEach(() => {
        const held = new Map<string, Promise<void>>();
        Object.defineProperty(navigator, 'locks', { configurable: true, value: {
            async request(name: string, commit: () => boolean) {
                while (held.has(name)) await held.get(name);
                const released = Promise.withResolvers<void>();
                held.set(name, released.promise);
                try {
                    return commit();
                } finally {
                    held.delete(name);
                    released.resolve();
                }
            }
        } });
        sessionStorage.clear();
        localStorage.clear();
    });
    afterEach(() => {
        if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
        else Reflect.deleteProperty(navigator, 'locks');
        if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
        sessionStorage.clear();
        localStorage.clear();
    });

    function stored(key: string) {
        const id = `rs2b0t:set:MapPicker:${key}`;
        return { local: localStorage.getItem(id), session: sessionStorage.getItem(id) };
    }

    function bakeCheckbox(label: string, root: ParentNode = document): HTMLInputElement {
        const row = Array.from(root.querySelectorAll('.rs2b0t-param-row'))
            .find(row => row.querySelector('.rs2b0t-param-label')?.textContent === label)!;
        return row.querySelector<HTMLInputElement>('input')!;
    }

    function openSettings(): void {
        document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-settings')!.click();
    }

    function clickRebuild(inSettings: boolean): void {
        const root = inSettings ? '.rs2b0t-modal' : '.rs2b0t-walkmap-overlay';
        const button = document.querySelector<HTMLButtonElement>(`${root} .rs2b0t-walkmap-rebuild`);
        expect(button).not.toBeNull();
        button!.click();
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

    async function withPicker(check: (paint: () => void) => void | Promise<void>): Promise<void> {
        const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
        const frame = spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => new Response(null, { status: 404 }) });
        try {
            const result = WorldMapPicker.open();
            await new Promise<void>(resolve => setImmediate(resolve));
            await check(() => frame.mock.lastCall![0](0));
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')!.click();
            expect(await result).toBeNull();
        } finally {
            document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')?.click();
            Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
            frame.mockRestore();
        }
    }

    test('discarding overlapping drafts in two tabs preserves the saved labels preference', async () => {
        localStorage.setItem('rs2b0t:set:MapPicker:bakeLabels', 'false');
        await withPicker(async () => {
            const second = WorldMapPicker.open();
            const [tabA, tabB] = Array.from(document.querySelectorAll<HTMLButtonElement>('.rs2b0t-walkmap-settings'));
            const [modalA, modalB] = Array.from(document.querySelectorAll<HTMLElement>('.rs2b0t-modal-backdrop')).slice(-2);
            const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!;
            const sessionA = sessionStorage;
            const sessionB = new Storage();
            const selectSession = (value: Storage) => Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value });
            try {
                tabA.click();
                selectSession(sessionB);
                tabB.click();
                const labelsA = bakeCheckbox('Stamp labels into rebuild', modalA);
                const labelsB = bakeCheckbox('Stamp labels into rebuild', modalB);
                expect([labelsA.checked, labelsB.checked]).toEqual([false, false]);
                selectSession(sessionA);
                labelsA.click();
                selectSession(sessionB);
                labelsB.click();
                labelsB.click();
                selectSession(sessionA);
                modalA.click();
                selectSession(sessionB);
                modalB.click();

                selectSession(new Storage());
                expect(resolveBasemapBakePrefs().labels).toBe(false);
            } finally {
                Object.defineProperty(globalThis, 'sessionStorage', original);
                document.querySelectorAll<HTMLButtonElement>('.rs2b0t-walkmap-cancel')[1]!.click();
                await second;
            }
        });
    });

    test.each([false, true])("Escape preserves another tab's label save (edited borders: %p)", async editBorders => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        const params = SettingsStore['urlParams'];
        try {
            await SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
            SettingsStore['urlParams'] = new URLSearchParams('MapPicker.bakeLabels=true');
            await withPicker(() => {
                openSettings();
                localStorage.setItem(labels, 'true');
                if (editBorders) {
                    bakeCheckbox('Map-square borders').click();
                    expect(localStorage.getItem(borders)).toBeNull();
                }
                expect(countStorageWrites(escapeSettings)).toBe(0);
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
            expect(stored('bakeLabels')).toEqual({ local: timing === 'before the first edit' ? 'true' : initial, session: null });
            if (timing === 'after the last edit') localStorage.setItem(labels, 'true');
            escapeSettings();
            expect(stored('bakeLabels')).toEqual({ local: 'true', session: null });
        });
    });

    test("Don't ask again checks the preference in open Settings as soon as the rebuild is confirmed", async () => {
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                const skip = bakeCheckbox("Don't ask before rebuild");
                expect(skip.checked).toBe(false);
                clickRebuild(true);
                document.querySelector<HTMLInputElement>('.rs2b0t-confirm-dont-ask-check')!.click();
                document.querySelector<HTMLButtonElement>('.rs2b0t-confirm-yes')!.click();
                await Promise.resolve();

                expect(stored('skipRebuildConfirm')).toEqual({ local: 'true', session: 'true' });
                expect(skip.checked).toBe(true);
            });
        } finally {
            bake.mockRestore();
        }
    });

    test("a rejected Don't ask again preference still runs the confirmed rebuild", async () => {
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        const setItem = localStorage.setItem;
        try {
            await withPicker(async () => {
                openSettings();
                clickRebuild(true);
                document.querySelector<HTMLInputElement>('.rs2b0t-confirm-dont-ask-check')!.click();
                Object.defineProperty(localStorage, 'setItem', { configurable: true, value() {
                    throw new DOMException('storage full', 'QuotaExceededError');
                } });
                document.querySelector<HTMLButtonElement>('.rs2b0t-confirm-yes')!.click();
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(bake).toHaveBeenCalledTimes(1);
                expect(document.querySelector('.rs2b0t-modal [role="alert"]')?.textContent).toContain("Don't ask before rebuild");
                expect(stored('skipRebuildConfirm')).toEqual({ local: null, session: null });
                expect(bakeCheckbox("Don't ask before rebuild").checked).toBe(false);
                clickRebuild(true);
                document.querySelector<HTMLButtonElement>('.rs2b0t-confirm-no')!.click();
                expect(bake).toHaveBeenCalledTimes(1);
            });
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
            bake.mockRestore();
        }
    });

    test("Don't ask again keeps a newer preference saved while confirmation is open", async () => {
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                clickRebuild(true);
                document.querySelector<HTMLInputElement>('.rs2b0t-confirm-dont-ask-check')!.click();
                localStorage.setItem('rs2b0t:set:MapPicker:skipRebuildConfirm', 'false');
                document.querySelector<HTMLButtonElement>('.rs2b0t-confirm-yes')!.click();
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(bake).toHaveBeenCalledTimes(1);
                expect(stored('skipRebuildConfirm')).toEqual({ local: 'false', session: null });
                expect(bakeCheckbox("Don't ask before rebuild").checked).toBe(false);
                expect(document.querySelector('[role="alert"]')?.textContent).toContain("Kept newer preferences: Don't ask before rebuild");
            });
        } finally {
            bake.mockRestore();
        }
    });

    test.each([false, true])('Escape restores the settings used by a successful rebuild (Settings already open: %p)', async alreadyOpen => {
        await SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeBorders', 'false');
        const pending = Promise.withResolvers<Awaited<ReturnType<typeof basemapRegen.regenerateBasemap>>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValue(pending.promise);
        try {
            await withPicker(async () => {
                if (alreadyOpen) {
                    openSettings();
                    bakeCheckbox('Stamp labels into rebuild').click();
                }
                clickRebuild(alreadyOpen);
                document.querySelector<HTMLButtonElement>('.rs2b0t-confirm-yes')!.click();
                await Promise.resolve();
                expect(bake).toHaveBeenCalledWith(prefs({ labels: alreadyOpen }));
                if (!alreadyOpen) openSettings();
                bakeCheckbox('Map-square borders').click();
                expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeBorders')).toBe('false');
                if (alreadyOpen) bakeCheckbox('Stamp labels into rebuild').click();
                pending.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('basemap rebuilt');
                bakeCheckbox('NPC dots').click();
                escapeSettings();
                expect(document.querySelector('.rs2b0t-walkmap-overlay .rs2b0t-walkmap-rebuild')).not.toBeNull();
                expect(stored('bakeBorders')).toEqual({ local: 'false', session: 'false' });
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
                clickRebuild(reopened);
                expect(bake).toHaveBeenCalledWith(prefs());
                if (reopened) escapeSettings();
                localStorage.setItem('rs2b0t:set:MapPicker:bakeLabels', 'true');
                openSettings();
                pending.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('basemap rebuilt');

                bakeCheckbox('Stamp labels into rebuild').click();
                expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, 'bakeLabels')).toBe('true');
                escapeSettings();
                expect(stored('bakeLabels')).toEqual({ local: 'true', session: null });
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('reopened Settings shows a completed rebuild alongside its own pending edits', async () => {
        const pending = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValue(pending.promise);
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox("Don't ask before rebuild").click();
                bakeCheckbox('Stamp labels into rebuild').click();
                clickRebuild(true);
                expect(bake).toHaveBeenCalledWith(prefs({ labels: true }));
                escapeSettings();
                openSettings();
                bakeCheckbox('NPC dots').click();
                pending.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(bakeCheckbox('Stamp labels into rebuild').checked).toBe(true);
                expect(bakeCheckbox('NPC dots').checked).toBe(true);
                escapeSettings();
                expect(stored('bakeLabels')).toEqual({ local: 'true', session: 'true' });
                expect(stored('bakeNpcs')).toEqual({ local: null, session: null });
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('rebuild completion preserves a focused Walkable colour edit until change', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const pending = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValue(pending.promise);
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Stamp labels into rebuild').click();
                clickRebuild(true);
                bakeCheckbox('Show basemap').click();
                const selector = '.rs2b0t-modal .rs2b0t-ctl-color input[type="text"]';
                const colour = document.querySelector<HTMLInputElement>(selector)!;
                colour.focus();
                colour.value = '#123abc';
                colour.dispatchEvent(new Event('input', { bubbles: true }));
                pending.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(stored('bakeLabels')).toEqual({ local: 'true', session: 'true' });
                expect(document.querySelector<HTMLInputElement>(selector)?.value).toBe('#123abc');
                expect(document.activeElement).toBe(colour);
                expect(stored('dotColor')).toEqual({ local: null, session: null });
                colour.dispatchEvent(new Event('change', { bubbles: true }));
                expect(stored('dotColor')).toEqual({ local: '#123abc', session: '#123abc' });
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('a URL-controlled checkbox stays fixed during rebuild and leaves its saved key absent', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const params = SettingsStore['urlParams'];
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        try {
            SettingsStore['urlParams'] = new URLSearchParams('mappicker.bakelabels=yes');
            await withPicker(async () => {
                openSettings();
                const labels = bakeCheckbox('Stamp labels into rebuild');
                expect(labels.checked).toBe(true);
                labels.click();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(bake).toHaveBeenCalledWith(prefs({ labels: true, borders: true }));
                expect(stored('bakeLabels')).toEqual({ local: null, session: null });
                expect(labels.disabled).toBe(true);
                expect(labels.checked).toBe(true);
                expect(stored('bakeBorders')).toEqual({ local: 'true', session: 'true' });
            });
        } finally {
            SettingsStore['urlParams'] = params;
            bake.mockRestore();
        }
    });

    test('untouched close leaves the saved preference and absent keys alone under a URL override', async () => {
        await SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
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

    test('editing and discarding preserves raw values and absence in both storage layers', async () => {
        localStorage.setItem('rs2b0t:set:MapPicker:bakeLabels', '0');
        sessionStorage.setItem('rs2b0t:set:MapPicker:bakeBorders', 'yes');
        await withPicker(() => {
            openSettings();
            expect(countStorageWrites(() => {
                bakeCheckbox('Stamp labels into rebuild').click();
                bakeCheckbox('Map-square borders').click();
                escapeSettings();
            })).toBe(0);
            expect(stored('bakeLabels')).toEqual({ local: '0', session: null });
            expect(stored('bakeBorders')).toEqual({ local: null, session: 'yes' });
        });
    });

    test('a rebuild persists both submitted fields and keeps a later edit for the next rebuild', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const first = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValueOnce(first.promise).mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                const labels = bakeCheckbox('Stamp labels into rebuild');
                labels.click();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                labels.click();
                first.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeLabels').local).toBe('true');
                expect(stored('bakeBorders').local).toBe('true');
                expect(labels.checked).toBe(false);

                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(bake).toHaveBeenLastCalledWith(prefs({ borders: true }));
                expect(stored('bakeLabels').local).toBe('false');
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('a peer save during regeneration survives while the cache records the submitted labels', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const pending = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const next = rebuiltMap();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValue(pending.promise);
        const crc = spyOn(localCache, 'fetchClientCrcKey').mockResolvedValue('test-crc');
        const cache = spyOn(localCache, 'saveRegeneratedBasemapLocally').mockResolvedValue();
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Stamp labels into rebuild').click();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                expect(bake).toHaveBeenCalledWith(prefs({ labels: true, borders: true }));
                localStorage.setItem('rs2b0t:set:MapPicker:bakeLabels', 'false');
                pending.resolve(next);
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(stored('bakeLabels')).toEqual({ local: 'false', session: null });
                expect(stored('bakeBorders').local).toBe('true');
                expect(cache).toHaveBeenCalledWith('test-crc', prefs({ labels: true, borders: true }), next.manifest, next.image);
                expect(document.querySelector('[role="alert"]')?.textContent).toContain('Kept newer preferences: Stamp labels into rebuild');
                expect(bakeCheckbox('Stamp labels into rebuild').checked).toBe(false);
            });
        } finally {
            cache.mockRestore();
            crc.mockRestore();
            bake.mockRestore();
        }
    });

    test.each([false, true])('Retry respects a peer save to the rejected field (edited again: %p)', async editedAgain => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                const borders = bakeCheckbox('Map-square borders');
                borders.click();
                const setItem = localStorage.setItem;
                Object.defineProperty(localStorage, 'setItem', { configurable: true, value() {
                    throw new DOMException('storage full', 'QuotaExceededError');
                } });
                try {
                    clickRebuild(true);
                    await new Promise<void>(resolve => setImmediate(resolve));
                    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Map-square borders.*retry/i);
                } finally {
                    Object.defineProperty(localStorage, 'setItem', { value: setItem });
                }

                localStorage.setItem('rs2b0t:set:MapPicker:bakeBorders', 'false');
                if (editedAgain) {
                    borders.click();
                    borders.click();
                }
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders')).toEqual(editedAgain ? { local: 'true', session: 'true' } : { local: 'false', session: null });
                expect(borders.checked).toBe(editedAgain);
                expect(bake).toHaveBeenLastCalledWith(prefs({ borders: true }));
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('a conflicting bake keeps a later edit with the same checkbox value', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const first = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValueOnce(first.promise).mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                escapeSettings();
                localStorage.setItem('rs2b0t:set:MapPicker:bakeBorders', 'false');
                openSettings();
                const borders = bakeCheckbox('Map-square borders');
                borders.click();
                first.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders').local).toBe('false');
                expect(borders.checked).toBe(true);

                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders').local).toBe('true');
            });
        } finally {
            bake.mockRestore();
        }
    });

    test.skipIf(!!desktopStorage).each([true, false])('only one overlapping browser commit can replace the same expected value (Web Locks: %p)', async hasLocks => {
        if (!hasLocks) disableWebLocks();
        const id = 'rs2b0t:set:MapPicker:bakeBorders';
        const getItem = localStorage.getItem;
        let peer: Promise<boolean> | undefined;
        Object.defineProperty(localStorage, 'getItem', { configurable: true, value(key: string) {
            const before = getItem.call(localStorage, key);
            if (key === id) {
                Object.defineProperty(localStorage, 'getItem', { value: getItem });
                peer = SettingsStore.saveBakePreference('bakeBorders', 'false', null);
            }
            return before;
        } });
        try {
            const first = await SettingsStore.saveBakePreference('bakeBorders', 'true', null);
            expect([first, await peer]).toEqual([true, false]);
            expect(stored('bakeBorders')).toEqual({ local: 'true', session: 'true' });
        } finally {
            Object.defineProperty(localStorage, 'getItem', { value: getItem });
        }
    });

    test.skipIf(!!desktopStorage)('without Web Locks rebuild saves edits and keeps a competing save', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const first = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValueOnce(first.promise).mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                disableWebLocks();
                openSettings();
                bakeCheckbox('Stamp labels into rebuild').click();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                localStorage.setItem('rs2b0t:set:MapPicker:bakeLabels', 'false');
                first.resolve(rebuiltMap());
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders')).toEqual({ local: 'true', session: 'true' });
                expect(stored('bakeLabels')).toEqual({ local: 'false', session: null });
                expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Kept newer preferences: Stamp labels/);

                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders')).toEqual({ local: 'false', session: 'false' });
                expect(bake).toHaveBeenLastCalledWith(prefs());
                expect(document.querySelector('[role="alert"]')).toBeNull();
            });
        } finally {
            bake.mockRestore();
        }
    });

    test.each([null, '0'])('Retry saves only the field rejected by durable storage (previous value %p)', async previous => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        if (previous !== null) SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeBorders', previous);
        const peerSession = new Storage();
        const setItem = localStorage.setItem;
        const peerSave = (value: string) => {
            peerSession.setItem(labels, value);
            setItem.call(localStorage, labels, value);
        };
        const writes: string[] = [];
        let full = true;
        Object.defineProperty(localStorage, 'setItem', { configurable: true, value(id: string, value: string) {
            writes.push(id);
            if (id === borders && full) {
                peerSave('true');
                throw new DOMException('storage full', 'QuotaExceededError');
            }
            setItem.call(localStorage, id, value);
        } });
        const next = rebuiltMap();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(next);
        const crc = spyOn(localCache, 'fetchClientCrcKey').mockResolvedValue('test-crc');
        const cache = spyOn(localCache, 'saveRegeneratedBasemapLocally').mockResolvedValue();
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Stamp labels into rebuild').click();
                const checkbox = bakeCheckbox('Map-square borders');
                checkbox.click();
                bakeCheckbox('NPC dots').click();
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(stored('bakeLabels').local).toBe('true');
                expect(stored('bakeBorders')).toEqual({ local: previous, session: previous });
                expect(stored('bakeNpcs').local).toBe('true');
                expect(checkbox.checked).toBe(true);
                const alert = () => document.querySelector('.rs2b0t-modal [role="alert"]')?.textContent;
                expect(alert()).toContain('Map-square borders');
                expect(cache).toHaveBeenCalledWith('test-crc', prefs({ labels: true, borders: true, npcs: true }), next.manifest, next.image);

                peerSave('false');
                writes.length = 0;
                full = false;
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(writes).toEqual([borders]);
                expect(alert()).toBeUndefined();
                escapeSettings();
                sessionStorage.clear();
                expect(resolveBasemapBakePrefs()).toEqual(prefs({ borders: true, npcs: true }));
            });
        } finally {
            cache.mockRestore();
            crc.mockRestore();
            bake.mockRestore();
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
        }
    });

    test.each([false, true])('Retry keeps a rejected preference after Settings reopens (borders edited again: %p)', async editBorders => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const first = Promise.withResolvers<ReturnType<typeof rebuiltMap>>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockReturnValueOnce(first.promise).mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                expect(bake).toHaveBeenCalledWith(prefs({ borders: true }));
                escapeSettings();
                openSettings();
                bakeCheckbox('NPC dots').click();
                const borders = bakeCheckbox('Map-square borders');
                if (editBorders) {
                    borders.click();
                    borders.click();
                }

                const setItem = localStorage.setItem;
                Object.defineProperty(localStorage, 'setItem', { configurable: true, value() {
                    throw new DOMException('storage full', 'QuotaExceededError');
                } });
                try {
                    first.resolve(rebuiltMap());
                    await new Promise<void>(resolve => setImmediate(resolve));
                    expect(document.querySelector('.rs2b0t-modal [role="alert"]')?.textContent).toContain('Map-square borders');
                    expect(stored('bakeBorders')).toEqual({ local: null, session: null });
                } finally {
                    Object.defineProperty(localStorage, 'setItem', { value: setItem });
                }

                expect(borders.checked).toBe(!editBorders);
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders').local).toBe(String(!editBorders));
                expect(stored('bakeNpcs').local).toBe('true');
                expect(bake).toHaveBeenLastCalledWith(prefs({ borders: !editBorders, npcs: true }));
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('Retry uses the rejected borders draft when Settings closes during the cache write', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const pending = Promise.withResolvers<void>();
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        const crc = spyOn(localCache, 'fetchClientCrcKey').mockResolvedValue('test-crc');
        const cache = spyOn(localCache, 'saveRegeneratedBasemapLocally').mockReturnValueOnce(pending.promise).mockResolvedValue();
        const setItem = localStorage.setItem;
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Map-square borders').click();
                Object.defineProperty(localStorage, 'setItem', { configurable: true, value() {
                    throw new DOMException('storage full', 'QuotaExceededError');
                } });
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(cache).toHaveBeenCalledTimes(1);
                escapeSettings();
                Object.defineProperty(localStorage, 'setItem', { value: setItem });
                pending.resolve();
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Map-square borders.*retry/i);
                clickRebuild(false);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(bake).toHaveBeenLastCalledWith(prefs({ borders: true }));
                expect(stored('bakeBorders').local).toBe('true');
            });
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
            cache.mockRestore();
            crc.mockRestore();
            bake.mockRestore();
        }
    });

    test('a quota warning survives repaint when Settings closes during the rebuild', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        const context: Partial<CanvasRenderingContext2D> = {
            fillRect() {}, fillText() {}, strokeRect() {}, save() {}, restore() {}, drawImage() {},
            beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
        };
        const canvas = spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
        const setItem = localStorage.setItem;
        try {
            await withPicker(async paint => {
                openSettings();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                escapeSettings();
                Object.defineProperty(localStorage, 'setItem', { configurable: true, value() {
                    throw new DOMException('storage full', 'QuotaExceededError');
                } });
                await new Promise<void>(resolve => setImmediate(resolve));
                paint();

                const warning = /Map-square borders.*retry/i;
                expect(document.querySelector('.rs2b0t-walkmap-overlay [role="alert"]')?.textContent).toMatch(warning);
                expect(stored('bakeBorders')).toEqual({ local: null, session: null });
                Object.defineProperty(localStorage, 'setItem', { value: setItem });
                openSettings();
                expect(document.querySelector('.rs2b0t-modal [role="alert"]')?.textContent).toMatch(warning);
                expect(bakeCheckbox('Map-square borders').checked).toBe(true);
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(stored('bakeBorders').local).toBe('true');
                expect(document.querySelector('[role="alert"]')).toBeNull();
            });
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
            canvas.mockRestore();
            bake.mockRestore();
        }
    });

    test('Settings shows the rebuild failure and retries with the same draft', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const bake = spyOn(basemapRegen, 'regenerateBasemap')
            .mockRejectedValueOnce(new Error('fixture failure'))
            .mockResolvedValue(rebuiltMap());
        try {
            await withPicker(async () => {
                openSettings();
                const borders = bakeCheckbox('Map-square borders');
                borders.click();
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                const modal = borders.closest('.rs2b0t-modal')!;
                expect(modal.textContent).toContain('rebuild failed: fixture failure');
                expect(borders.checked).toBe(true);
                expect(stored('bakeBorders')).toEqual({ local: null, session: null });
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(bake).toHaveBeenLastCalledWith(prefs({ borders: true }));
                expect(stored('bakeBorders')).toEqual({ local: 'true', session: 'true' });
                expect(modal.textContent).not.toContain('fixture failure');
            });
        } finally {
            bake.mockRestore();
        }
    });

    test('a failed rebuild leaves the original draft baseline in place', async () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockRejectedValue(new Error('fixture failure'));
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('rebuild failed');
                escapeSettings();
                expect(stored('bakeBorders')).toEqual({ local: null, session: null });
            });
        } finally {
            bake.mockRestore();
        }
    });
});

describe('prefs fingerprint invalidation shape', () => {
    test('prefsKey changes when any bake layer flips', () => {
        const a = localCache.prefsKeyFromBakePrefs(prefs());
        const b = localCache.prefsKeyFromBakePrefs(prefs({ labels: true }));
        const c = localCache.prefsKeyFromBakePrefs(prefs({ freemap: true }));
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        expect(b).not.toBe(c);
    });
});
