import { useBakeSettingsLocks } from '../fixtures/bakeSettingsLocks.js';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as basemapRegen from '#/bot/panel/basemapRegen.js';
import { prefsKeyFromBakePrefs } from '#/bot/panel/basemapLocalCache.js';
import { WorldMapPicker } from '#/bot/panel/WorldMapPicker.js';
import {
    prefsFingerprint,
    resolveBasemapBakePrefs,
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

describe('map picker bake settings drafts', () => {
    useBakeSettingsLocks();

    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });
    afterEach(() => {
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

    test.each([false, true])('a quota error restores both storage layers (previous values present: %p)', async seeded => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'skipRebuildConfirm', 'true');
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        if (seeded) {
            sessionStorage.setItem(labels, 'false');
            localStorage.setItem(labels, '0');
            sessionStorage.setItem(borders, '0');
        }
        const before = [stored('bakeLabels'), stored('bakeBorders')];
        const bake = spyOn(basemapRegen, 'regenerateBasemap').mockResolvedValue(rebuiltMap());
        const setItem = localStorage.setItem;
        Object.defineProperty(localStorage, 'setItem', {
            configurable: true,
            value: (id: string, value: string) => {
                if (id === borders) throw new DOMException('storage full', 'QuotaExceededError');
                setItem.call(localStorage, id, value);
            }
        });
        try {
            await withPicker(async () => {
                openSettings();
                bakeCheckbox('Stamp labels into rebuild').click();
                bakeCheckbox('Map-square borders').click();
                clickRebuild(true);
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toContain('rebuild failed: storage full');
                escapeSettings();
                expect([stored('bakeLabels'), stored('bakeBorders')]).toEqual(before);
            });
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
            bake.mockRestore();
        }
    });

    test("a quota error preserves another tab's label save during the batch", async () => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        const setItem = localStorage.setItem;
        Object.defineProperty(localStorage, 'setItem', {
            configurable: true,
            value: (id: string, value: string) => {
                if (id === borders) {
                    expect(localStorage.getItem(labels)).toBe('false');
                    setItem.call(localStorage, labels, 'true');
                    throw new DOMException('storage full', 'QuotaExceededError');
                }
                setItem.call(localStorage, id, value);
            }
        });
        try {
            const edits = new Map([['bakeLabels', 'false'], ['bakeBorders', 'true']]);
            await expect(async () => SettingsStore.saveBatch(MAP_PICKER_SETTINGS_NS, edits)).toThrow('storage full');
            expect(stored('bakeLabels')).toEqual({ local: 'true', session: null });
            expect(stored('bakeBorders')).toEqual({ local: null, session: null });
            sessionStorage.clear();
            expect(resolveBasemapBakePrefs().labels).toBe(true);
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
        }
    });

    test.each([null, '0'])('a save arriving after the rollback comparison survives restoration of %p', async previous => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        if (previous !== null) localStorage.setItem(labels, previous);
        const { setItem, removeItem } = localStorage;
        let competingSave: Promise<void> | undefined;
        const saveLabels = () => {
            competingSave = Promise.resolve(SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'true'));
        };
        Object.defineProperties(localStorage, {
            setItem: { configurable: true, value(id: string, value: string) {
                if (id === borders) throw new DOMException('storage full', 'QuotaExceededError');
                if (id === labels && value === previous) saveLabels();
                setItem.call(localStorage, id, value);
            } },
            removeItem: { configurable: true, value(id: string) {
                if (id === labels) saveLabels();
                removeItem.call(localStorage, id);
            } }
        });
        try {
            const edits = new Map([['bakeLabels', 'false'], ['bakeBorders', 'true']]);
            await expect(async () => SettingsStore.saveBatch(MAP_PICKER_SETTINGS_NS, edits)).toThrow('storage full');
            expect(competingSave).toBeDefined();
            await competingSave;
            sessionStorage.clear();
            expect(resolveBasemapBakePrefs().labels).toBe(true);
            expect(stored('bakeBorders')).toEqual({ local: null, session: null });
        } finally {
            Object.defineProperties(localStorage, { setItem: { value: setItem }, removeItem: { value: removeItem } });
        }
    });

    test('an incomplete quota rollback still restores the session copy', async () => {
        const labels = 'rs2b0t:set:MapPicker:bakeLabels';
        const borders = 'rs2b0t:set:MapPicker:bakeBorders';
        await SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'bakeLabels', 'false');
        const setItem = localStorage.setItem;
        Object.defineProperty(localStorage, 'setItem', {
            configurable: true,
            value: (id: string, value: string) => {
                if (id === borders) setItem.call(localStorage, 'other-tab', 'x');
                const usedByOtherKeys = [labels, borders, 'other-tab']
                    .filter(key => key !== id)
                    .reduce((size, key) => size + (localStorage.getItem(key)?.length ?? 0), 0);
                if (usedByOtherKeys + value.length > 5) throw new DOMException('storage full', 'QuotaExceededError');
                setItem.call(localStorage, id, value);
            }
        });
        try {
            const edits = new Map([['bakeLabels', 'true'], ['bakeBorders', 'true']]);
            await expect(async () => SettingsStore.saveBatch(MAP_PICKER_SETTINGS_NS, edits)).toThrow(/storage full.*rollback incomplete/i);
            expect(stored('bakeLabels')).toEqual({ local: 'true', session: 'false' });
            expect(stored('bakeBorders')).toEqual({ local: null, session: null });
            expect(localStorage.getItem('other-tab')).toBe('x');
        } finally {
            Object.defineProperty(localStorage, 'setItem', { value: setItem });
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
        const a = prefsKeyFromBakePrefs(prefs());
        const b = prefsKeyFromBakePrefs(prefs({ labels: true }));
        const c = prefsKeyFromBakePrefs(prefs({ freemap: true }));
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        expect(b).not.toBe(c);
    });
});
