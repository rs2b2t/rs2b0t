import { expect, mock, spyOn, test } from 'bun:test';
import { VaultPrompt } from '#/bot/multibox/VaultPrompt.js';
import { ProfileVault, vault } from '#/bot/multibox/ProfileVault.js';
import { serializeProfileFile } from '#/bot/multibox/ProfileTransfer.js';
import { SettingsPanel } from '#/bot/multibox/SettingsPanel.js';
import { ResourcePanel } from '#/bot/multibox/ResourcePanel.js';
import { DomSlotOps } from '#/bot/multibox/DomSlotOps.js';
import { DiagSampler } from '#/bot/multibox/DiagSampler.js';
import { FreezeWatch } from '#/bot/runtime/diag/FreezeWatch.js';
import type { MultiBoxController } from '#/bot/multibox/MultiBoxController.js';
import type { Account, SlotSnapshot } from '#/bot/multibox/types.js';
import type { WorldNumber } from '#/client/config/worlds.js';
// Why: TARGET captures the environment on first import, before withWall overrides it for the fixture.
import '#/client/config/target.js';

interface Wall {
    controller: MultiBoxController;
    add(account: Account): SlotSnapshot;
    addTab(name: string): boolean | Promise<boolean>;
    renameTab(from: string, to: string): boolean | Promise<boolean>;
    removeTab(name: string): boolean | Promise<boolean>;
    setActiveTab(name: string): boolean | Promise<boolean>;
    setSlotTab(id: number, tab: string): boolean | Promise<boolean>;
    slots(): SlotSnapshot[];
    setWorld(id: number, world: WorldNumber): Promise<boolean>;
}

function captureListeners(target: EventTarget): () => void {
    const listeners: Parameters<EventTarget['addEventListener']>[] = [];
    const add = target.addEventListener.bind(target);
    const spy = spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
        if (!listener) return;
        listeners.push([type, listener, options]);
        add(type, listener, options);
    });
    return () => {
        for (const args of listeners) target.removeEventListener(...args);
        spy.mockRestore();
    };
}

let fixtureId = 0;

async function withWall(mode: 'local' | 'proxy', check: (wall: Wall) => Promise<void>): Promise<void> {
    const previousMode = process.env.RS2B0T_TARGET;
    process.env.RS2B0T_TARGET = mode;
    const interval = Object.getOwnPropertyDescriptor(window, 'setInterval');
    Object.defineProperty(window, 'setInterval', { configurable: true, writable: true, value: () => 0 });
    const removeWindowListeners = captureListeners(window);
    const removeDocumentListeners = captureListeners(document);
    const resources = spyOn(ResourcePanel.prototype, 'start').mockImplementation(() => {});
    const diagnostics = spyOn(DiagSampler.prototype, 'start').mockImplementation(() => {});
    const freeze = spyOn(FreezeWatch.prototype, 'run').mockResolvedValue();
    const observer = Object.getOwnPropertyDescriptor(window, 'PerformanceObserver');
    Object.defineProperty(window, 'PerformanceObserver', { configurable: true, value: class {
        static supportedEntryTypes = ['event'];
        observe(): void {}
        disconnect(): void {}
    } });
    let wall: Wall | undefined;
    const previousUrl = location.href;
    const browser = Reflect.get(window, 'happyDOM') as { setURL(url: string): void };
    try {
        browser.setURL(mode === 'proxy' ? 'https://w1.rs2b2t.com/rs2b0t/wall' : 'http://localhost:8890/multibox.html?nodeid=42&world=2');
        vault.reset();
        await vault.setup('test-passphrase');
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        await vault.upsert({ username: 'bob', password: 'b', world: 2 });
        document.body.innerHTML = '<div id="mbx-app"><div id="mbx-rail"><div id="mbx-tabs"></div><div id="mbx-add"></div></div></div>';
        for (const id of ['build', 'start-all', 'stop-all', 'renderers-off', 'renderers-on', 'resource-bots', 'resource-cpu', 'resource-memory', 'resource-traffic', 'resource-cpu-row', 'resource-memory-row', 'settings', 'manage', 'drawer']) {
            const el = document.createElement('button');
            el.id = `mbx-${id}`;
            document.body.appendChild(el);
        }
        const entry = `../../src/bot/multibox/main.ts?fixture=${mode}-${fixtureId++}`;
        await import(entry);
        if (!Reflect.get(globalThis, 'multibox')) document.dispatchEvent(new Event('DOMContentLoaded'));
        wall = Reflect.get(globalThis, 'multibox') as Wall;
        await check(wall);
    } finally {
        for (const slot of wall?.slots() ?? []) {
            wall!.controller.cancelSlotWorldSwitch(slot.id);
            wall!.controller.remove(slot.id);
        }
        window.dispatchEvent(new Event('pagehide'));
        removeWindowListeners();
        removeDocumentListeners();
        if (interval) Object.defineProperty(window, 'setInterval', interval);
        else Reflect.deleteProperty(window, 'setInterval');
        resources.mockRestore();
        diagnostics.mockRestore();
        freeze.mockRestore();
        if (observer) Object.defineProperty(window, 'PerformanceObserver', observer);
        else Reflect.deleteProperty(window, 'PerformanceObserver');
        vault.reset();
        Reflect.deleteProperty(globalThis, 'multibox');
        document.body.innerHTML = '';
        browser.setURL(previousUrl);
        if (previousMode === undefined) delete process.env.RS2B0T_TARGET;
        else process.env.RS2B0T_TARGET = previousMode;
    }
}

function openSettings(): SettingsPanel {
    const open = spyOn(SettingsPanel.prototype, 'open');
    try {
        document.getElementById('mbx-settings')!.click();
        return open.mock.contexts[0] as SettingsPanel;
    } finally {
        open.mockRestore();
    }
}

async function waitFor(done: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !done(); i++) await Bun.sleep(5);
    expect(done()).toBe(true);
}

test.each([0, 4])('settings import applies modes once with %i profiles already loaded', async loaded => {
    await withWall('local', async wall => {
        const profiles = Array.from({ length: 24 }, (_, i) => ({
            username: `fixture${i}`, password: 'fixture', tab: i % 2 === 0 ? 'Main' : 'Fleet'
        }));
        const file = (count: number) => serializeProfileFile({
            profiles: profiles.slice(0, count), tabs: ['Fleet'], activeTab: 'Main', storage: {}
        });
        const modeCalls: string[] = [];
        const spawn = DomSlotOps.prototype.spawn;
        const spawning = spyOn(DomSlotOps.prototype, 'spawn').mockImplementation(function (this: DomSlotOps, account) {
            const handle = spawn.call(this, account);
            const apply = handle.setRenderMode.bind(handle);
            handle.setRenderMode = mode => {
                modeCalls.push(account.username);
                apply(mode);
            };
            return handle;
        });
        try {
            const panel = openSettings();
            if (loaded) await panel.importText(file(loaded));
            expect(wall.slots()).toHaveLength(loaded);
            modeCalls.length = 0;
            const all = file(profiles.length);
            await panel.importText(all);
            const slots = wall.slots();
            expect(slots.map(slot => [slot.username, slot.tab])).toEqual(profiles.map(p => [p.username, p.tab]));
            expect(slots.filter(slot => slot.focused).map(slot => slot.username)).toEqual(['fixture22']);
            expect(modeCalls).toHaveLength(24);
            expect(modeCalls).toEqual(profiles.map(profile => profile.username));

            modeCalls.length = 0;
            spawning.mockClear();
            await panel.importText(all);
            expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toBe('');
            expect(spawning).not.toHaveBeenCalled();
            expect(modeCalls).toHaveLength(0);
            expect(wall.slots()).toEqual(slots);
        } finally {
            spawning.mockRestore();
        }
    });
});

test.each([30, 61])('settings import moves %i loaded profiles to the saved tab', async count => {
    await withWall('local', async wall => {
        const profiles = Array.from({ length: count }, (_, i) => ({ username: `fixture${i}`, password: 'fixture' }));
        const tabs = ['Empty', 'Fleet', 'Reserve'];
        const imported = profiles.map(p => ({ ...p, tab: 'Fleet' }));
        const assignments = imported.map(p => [p.username, p.tab]);
        const saves = spyOn(vault, 'saveTabState');
        try {
            const panel = openSettings();
            await panel.importText(serializeProfileFile({
                profiles: profiles.map(p => ({ ...p, tab: 'Old' })),
                tabs: ['Old', 'Reserve', 'Empty'], activeTab: 'Old', storage: {}
            }));
            await Promise.all(saves.mock.results.map(result => result.value));
            const original = wall.slots();
            expect(original.map(s => [s.username, s.tab])).toEqual(imported.map(p => [p.username, 'Old']));

            wall.addTab('Local1');
            wall.addTab('Local2');
            await panel.importText(serializeProfileFile({ profiles: imported, tabs, activeTab: 'Fleet', storage: {} }));
            expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toBe('');
            await Promise.all(saves.mock.results.map(result => result.value));
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.list().map(p => [p.username, p.tab])).toEqual(assignments);
            expect(reopened.tabState()).toEqual({ tabs, activeTab: 'Fleet' });
            expect(wall.controller.tabs()).toEqual(['Main', ...tabs]);
            expect(wall.controller.activeTab()).toBe('Fleet');
            expect(wall.slots().map(s => s.id)).toEqual(original.map(s => s.id));
            expect(wall.slots().map(s => [s.username, s.tab])).toEqual(assignments);
        } finally {
            saves.mockRestore();
        }
    });
});

test('adding a tab preserves an imported tab name with surrounding spaces', async () => {
    await withWall('local', async wall => {
        const tab = ' Fleet ';
        const profiles = [{ username: 'fixture', password: 'fixture', tab }];
        const backup = { profiles, tabs: [tab], activeTab: tab };
        await openSettings().importText(serializeProfileFile({ ...backup, storage: {} }));
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual(backup);

        expect(await wall.addTab('Local')).toBe(true);
        await waitFor(() => vault.tabState().tabs.includes('Local'));
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({ ...backup, tabs: [tab, 'Local'] });
    });
});

test.each([
    ['Fixture', 'Fleet'],
    ['fixture', 'Work']
])('import and refresh keep the exact tab for loaded %s', async (username, tab) => {
    await withWall('local', async wall => {
        const panel = openSettings();
        const tabs = ['Work', 'Fleet'];
        const profiles = [
            { username: 'fixture', password: 'fixture', tab: 'Work' },
            { username: 'Fixture', password: 'fixture', tab: 'Fleet' }
        ];
        await panel.importText(serializeProfileFile({
            profiles: [{ username, password: 'fixture', tab }], tabs, activeTab: tab, storage: {}
        }));
        const [original] = wall.slots();
        await panel.importText(serializeProfileFile({ profiles, tabs, activeTab: 'Fleet', storage: {} }));
        expect(wall.slots().map(s => [s.id, s.username, s.tab])).toEqual([[original.id, username, tab]]);

        wall.controller.addTab('Stale');
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => !wall.controller.tabs().includes('Stale'));
        expect(wall.slots().map(s => [s.id, s.username, s.tab])).toEqual([[original.id, username, tab]]);

        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.addTab('Local')).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ profiles, tabs: [...tabs, 'Local'], activeTab: 'Fleet' });
        } finally {
            saves.mockRestore();
        }
    });
});

test('refresh keeps the first imported row for an exact duplicate username', async () => {
    await withWall('local', async wall => {
        const profiles = ['A', 'B'].map(tab => ({ username: 'fixture', password: 'fixture', tab }));
        const backup = { profiles, tabs: ['A', 'B'], activeTab: 'B' };
        await openSettings().importText(serializeProfileFile({ ...backup, storage: {} }));
        const [slot] = wall.slots();
        expect(slot.tab).toBe('A');
        wall.controller.addTab('Stale');
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => !wall.controller.tabs().includes('Stale'));
        expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[slot.id, 'A']]);
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual(backup);
    });
});

test('a mixed import keeps an omitted slot in Work and saves a reused slot moved there', async () => {
    await withWall('local', async wall => {
        const panel = openSettings();
        const included = { username: 'Fixture', password: 'fixture' };
        const guest = { username: 'guest', password: 'fixture', tab: 'Work' };
        await panel.importText(serializeProfileFile({
            profiles: [{ ...included, tab: 'Old' }, guest], tabs: ['Old', 'Work'], activeTab: 'Work', storage: {}
        }));
        const ids = wall.slots().map(s => s.id);
        const saved = { ...included, username: 'fixture', tab: 'Fleet' };
        const backup = { profiles: [saved], tabs: ['Fleet'], activeTab: 'Fleet' };
        await panel.importText(serializeProfileFile({ ...backup, storage: {} }));
        expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toBe('');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual(backup);
        wall.controller.addTab('Stale');
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => !wall.controller.tabs().includes('Stale'));
        expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[ids[0], 'Fleet'], [ids[1], 'Work']]);
        expect(wall.controller.tabs()).toEqual(['Main', 'Fleet', 'Work']);
        expect(wall.controller.activeTab()).toBe('Fleet');
        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.setSlotTab(ids[0], 'Work')).toBe(true);
            await Promise.all(saves.mock.results.map(result => result.value));
            expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[ids[0], 'Work'], [ids[1], 'Work']]);
            const afterMove = new ProfileVault();
            expect(await afterMove.unlock('test-passphrase')).toBe(true);
            expect(afterMove.snapshot()).toEqual({
                profiles: [{ ...saved, tab: 'Work' }], tabs: ['Fleet', 'Work'], activeTab: 'Fleet'
            });
        } finally {
            saves.mockRestore();
        }
    });
});

test.each([
    { match: 'only the normalized username matches', rows: ['fixture'], expected: ['Work'], tabs: ['Fleet', 'Work'] },
    { match: 'both spellings exist', rows: ['fixture', 'Fixture'], expected: ['Fleet', 'Work'], tabs: ['Fleet', 'Work'] },
    { match: 'the slot is absent', rows: ['other'], expected: ['Fleet'], tabs: ['Fleet'] }
])('a stale wall preserves the replacement roster on a move when $match', async ({ rows, expected, tabs }) => {
    await withWall('local', async wall => {
        const loaded = { username: 'Fixture', password: 'fixture', tab: 'Fleet' };
        await openSettings().importText(serializeProfileFile({
            profiles: [loaded], tabs: ['Fleet', 'Work'], activeTab: 'Fleet', storage: {}
        }));
        const [slot] = wall.slots();
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        const profiles = rows.map(username => ({ ...loaded, username }));
        const backup = { profiles, tabs, activeTab: 'Fleet' };
        await other.replaceAll(backup);

        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.setSlotTab(slot.id, 'Work')).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ ...backup, profiles: profiles.map((p, i) => ({ ...p, tab: expected[i] })) });
        } finally {
            saves.mockRestore();
        }
    });
});

async function failTabWrite(edit: () => boolean | Promise<boolean>): Promise<void> {
    const saves = spyOn(vault, 'saveTabState');
    const write = localStorage.setItem;
    const failOnce = mock(write.bind(localStorage)).mockImplementationOnce(() => { throw new Error('fixture storage full'); });
    try {
        Object.defineProperty(localStorage, 'setItem', { configurable: true, value: failOnce });
        expect(await edit()).toBe(true);
        await expect(saves.mock.results[0].value).rejects.toThrow('fixture storage full');
    } finally {
        Object.defineProperty(localStorage, 'setItem', { configurable: true, value: write });
        saves.mockRestore();
    }
}

test('the save alert retries a failed move without moving the slot again', async () => {
    await withWall('local', async wall => {
        const profile = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
        const backup = { profiles: [profile], tabs: ['Fleet', 'Work'], activeTab: 'Fleet' };
        await openSettings().importText(serializeProfileFile({ ...backup, storage: {} }));
        const [slot] = wall.slots();
        await failTabWrite(() => wall.setSlotTab(slot.id, 'Work'));
        expect(wall.slots()[0].tab).toBe('Work');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual(backup);

        const alert = document.querySelector('#mbx-rail [role="alert"]');
        const retry = alert?.querySelector('button');
        expect(retry?.textContent ?? '').toMatch(/retry/i);
        retry!.click();
        await waitFor(() => !alert!.isConnected);
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({ ...backup, profiles: [{ ...profile, tab: 'Work' }] });
    });
});

test('moving a slot retries a failed tab creation after the rail detaches', async () => {
    await withWall('local', async wall => {
        const profile = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
        await openSettings().importText(serializeProfileFile({ profiles: [profile], tabs: ['Fleet'], activeTab: 'Fleet', storage: {} }));
        const [slot] = wall.slots();
        document.getElementById('mbx-rail')!.remove();
        await failTabWrite(() => wall.addTab('Work'));
        expect(await wall.setSlotTab(slot.id, 'Work')).toBe(true);
        await waitFor(() => vault.list()[0].tab === 'Work');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({ profiles: [{ ...profile, tab: 'Work' }], tabs: ['Fleet', 'Work'], activeTab: 'Fleet' });
    });
});

test.each([
    { outcome: 'is saved with the next tab edit', replace: false, expectedTab: 'Work', expectedTabs: ['Fleet', 'Work', 'Local'] },
    { outcome: 'is superseded by a settings import', replace: true, expectedTab: 'Fleet', expectedTabs: ['Fleet', 'Local'] }
])('a failed profile move $outcome', async ({ replace, expectedTab, expectedTabs }) => {
    await withWall('local', async wall => {
        const profile = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
        const tabs = ['Fleet', 'Work'];
        const panel = openSettings();
        await panel.importText(serializeProfileFile({ profiles: [profile], tabs, activeTab: 'Fleet', storage: {} }));
        const [slot] = wall.slots();
        await failTabWrite(() => wall.setSlotTab(slot.id, 'Work'));
        if (replace) {
            await panel.importText(serializeProfileFile({ profiles: [profile], tabs: ['Fleet'], activeTab: 'Fleet', storage: {} }));
        }
        expect(await wall.addTab('Local')).toBe(true);
        await waitFor(() => vault.tabState().tabs.includes('Local'));
        expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[slot.id, expectedTab]]);
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({
            profiles: [{ ...profile, tab: expectedTab }], tabs: expectedTabs, activeTab: 'Fleet'
        });
        expect(document.querySelector('#mbx-rail [role="alert"]')).toBeNull();
    });
});

test('a storage refresh rolls a failed move back to the imported group', async () => {
    await withWall('local', async wall => {
        const profile = { username: 'fixture', password: 'fixture', tab: 'Old' };
        await openSettings().importText(serializeProfileFile({ profiles: [profile], tabs: ['Old', 'Work'], activeTab: 'Old', storage: {} }));
        const [slot] = wall.slots();
        await failTabWrite(() => wall.setSlotTab(slot.id, 'Work'));
        const backup = { profiles: [{ ...profile, tab: 'Fleet' }], tabs: ['Fleet'], activeTab: 'Fleet' };
        await vault.replaceAll(backup);
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => wall.controller.tabs().includes('Fleet'));
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual(backup);
        expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[slot.id, 'Fleet']]);
        const alert = document.querySelector('#mbx-rail [role="alert"]');
        expect(alert?.textContent).toContain('retry');
        expect(alert?.querySelector('button')).toBeNull();
    });
});

test('renaming and deleting an imported tab move only its members', async () => {
    await withWall('local', async wall => {
        const profiles = [
            { username: 'fixture', password: 'fixture', tab: 'Work' },
            { username: 'fixture', password: 'fixture', tab: 'Reserve' },
            { username: 'unloaded', password: 'fixture', tab: 'Work' }
        ];
        await openSettings().importText(serializeProfileFile({
            profiles, tabs: ['Fleet', 'Work', 'Reserve'], activeTab: 'Work', storage: {}
        }));
        wall.controller.remove(wall.slots().find(s => s.username === 'unloaded')!.id);
        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.renameTab('Work', 'Ops')).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.list().map(p => p.tab)).toEqual(['Ops', 'Reserve', 'Ops']);
            expect(reopened.tabState()).toEqual({ tabs: ['Fleet', 'Ops', 'Reserve'], activeTab: 'Ops' });

            expect(await wall.removeTab('Ops')).toBe(true);
            await saves.mock.results[1].value;
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.list().map(p => p.tab)).toEqual(['Fleet', 'Reserve', 'Main']);
            expect(reopened.tabState()).toEqual({ tabs: ['Fleet', 'Reserve'], activeTab: 'Fleet' });
        } finally {
            saves.mockRestore();
        }
    });
});

test.each([
    { edit: 'delete', tabs: ['Fleet'] },
    { edit: 'delete', tabs: ['Fleet', 'Work'] },
    { edit: 'delete', tabs: ['Fleet', 'Old'] },
    { edit: 'delete', tabs: ['Fleet', 'Work', 'Old'] },
    { edit: 'rename', tabs: ['Fleet'] }
])('a stale $edit of Old preserves unrelated state after importing $tabs', async ({ edit, tabs }) => {
    await withWall('local', async wall => {
        const profile = { username: 'fixture', password: 'fixture', tab: 'Old' };
        await openSettings().importText(serializeProfileFile({
            profiles: [profile], tabs: ['Work', 'Old'], activeTab: 'Old', storage: {}
        }));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        const backup = { profiles: [{ ...profile, tab: 'Fleet' }], tabs, activeTab: 'Fleet' };
        await other.replaceAll(backup);

        const saves = spyOn(vault, 'saveTabState');
        try {
            const changed = edit === 'rename' ? await wall.renameTab('Old', 'Ops') : await wall.removeTab('Old');
            expect(changed).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ ...backup, tabs: tabs.filter(tab => tab !== 'Old') });
        } finally {
            saves.mockRestore();
        }
    });
});

test.each([
    { local: 'Fleet', imported: 'Old', selected: 'Ops' },
    { local: 'Old', imported: 'Fleet', selected: 'Fleet' }
])('renaming Old after another window selects $imported preserves the stored tab order and selection', async ({ local, imported, selected }) => {
    await withWall('local', async wall => {
        const profile = { username: 'included', password: 'fixture', tab: 'Old' };
        await openSettings().importText(serializeProfileFile({
            profiles: [profile], tabs: ['Old', 'Fleet'], activeTab: local, storage: {}
        }));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.replaceAll({ profiles: [profile], tabs: ['Fleet', 'Old'], activeTab: imported });

        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.renameTab('Old', 'Ops')).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({
                profiles: [{ ...profile, tab: 'Ops' }], tabs: ['Fleet', 'Ops'], activeTab: selected
            });
        } finally {
            saves.mockRestore();
        }
    });
});

test('moving a loaded slot preserves the second imported row for its username', async () => {
    await withWall('local', async wall => {
        const profiles = ['Fleet', 'Reserve'].map(tab => ({ username: 'fixture', password: 'fixture', tab }));
        const backup = { profiles, tabs: ['Work', 'Fleet', 'Reserve'], activeTab: 'Fleet' };
        await openSettings().importText(serializeProfileFile({ ...backup, storage: {} }));
        const [slot] = wall.slots();
        expect(wall.slots()).toHaveLength(1);
        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.setSlotTab(slot.id, 'Work')).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ ...backup, profiles: [{ ...profiles[0], tab: 'Work' }, profiles[1]] });
        } finally {
            saves.mockRestore();
        }
    });
});

test.each([
    { active: 'Work', tabs: ['Fleet'] },
    { active: 'Main', tabs: ['Fleet'] },
    { active: 'Work', tabs: ['Fleet', 'Work'] }
])('adding a tab while viewing $active keeps Fleet selected in the saved tabs $tabs', async ({ active, tabs }) => {
    await withWall('local', async wall => {
        const guest = { username: 'guest', password: 'fixture', tab: 'Work' };
        await openSettings().importText(serializeProfileFile({
            profiles: [guest], tabs: ['Work'], activeTab: active, storage: {}
        }));
        const saved = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
        await vault.replaceAll({ profiles: [saved], tabs, activeTab: 'Fleet' });
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => wall.controller.tabs().includes('Fleet'));
        expect(wall.controller.activeTab()).toBe(active);

        const saves = spyOn(vault, 'saveTabState');
        try {
            expect(await wall.addTab('Local')).toBe(true);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ profiles: [saved], tabs: [...tabs, 'Local'], activeTab: 'Fleet' });
            expect(wall.controller.activeTab()).toBe(active);
            expect(wall.slots().map(slot => [slot.username, slot.tab])).toEqual([['guest', 'Work']]);
            expect(await wall.setActiveTab('Local')).toBe(true);
            await saves.mock.results[1].value;
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.tabState().activeTab).toBe('Local');
        } finally {
            saves.mockRestore();
        }
    });
});

test('a world-only refresh preserves the order of groups retained by running slots', async () => {
    await withWall('local', async wall => {
        const panel = openSettings();
        const saved = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
        await panel.importText(serializeProfileFile({
            profiles: [
                { username: 'ops', password: 'fixture', tab: 'Ops' },
                { username: 'worker', password: 'fixture', tab: 'Work' }
            ], tabs: ['Work', 'Ops'], activeTab: 'Work', storage: {}
        }));
        await panel.importText(serializeProfileFile({ profiles: [saved], tabs: ['Fleet'], activeTab: 'Fleet', storage: {} }));
        expect(wall.controller.tabs()).toEqual(['Main', 'Fleet', 'Work', 'Ops']);

        await vault.setWorld(saved.username, 2);
        wall.controller.addTab('Stale');
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => !wall.controller.tabs().includes('Stale'));
        expect(wall.controller.tabs()).toEqual(['Main', 'Fleet', 'Work', 'Ops']);
    });
});

test('selecting a retained tab renamed during import saves its new name and selection', async () => {
    await withWall('local', async wall => {
        const panel = openSettings();
        const guest = { username: 'guest', password: 'fixture', tab: 'Work' };
        await panel.importText(serializeProfileFile({ profiles: [guest], tabs: ['Work'], activeTab: 'Work', storage: {} }));
        const [omitted] = wall.slots();
        const saved = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
        const backup = { profiles: [saved], tabs: ['Fleet'], activeTab: 'Fleet' };
        let renamed: ReturnType<Wall['renameTab']> | undefined;
        const replaceAll = vault.replaceAll.bind(vault);
        const replace = spyOn(vault, 'replaceAll').mockImplementationOnce(data => {
            const replacing = replaceAll(data);
            renamed = wall.renameTab('Work', 'Ops');
            return replacing;
        });
        const saves = spyOn(vault, 'saveTabState');
        try {
            await panel.importText(serializeProfileFile({ ...backup, storage: {} }));
            expect(await renamed).toBe(true);
            await saves.mock.results[0].value;
            expect(wall.slots().find(slot => slot.id === omitted.id)?.tab).toBe('Ops');
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual(backup);

            document.querySelector<HTMLElement>('.mbx-tabchip[data-tab="Ops"]')!.click();
            expect(wall.controller.activeTab()).toBe('Ops');
            await waitFor(() => saves.mock.results.length === 2);
            await saves.mock.results[1].value;
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ ...backup, tabs: ['Fleet', 'Ops'], activeTab: 'Ops' });
        } finally {
            saves.mockRestore();
            replace.mockRestore();
        }
    });
});

async function prepareRosterMove(username: string, group: string) {
    document.getElementById('mbx-manage')!.click();
    await waitFor(() => !document.getElementById('mbx-roster')!.hidden);
    document.querySelector<HTMLInputElement>(`[aria-label="Select ${username}"]`)!.click();
    const name = document.querySelector<HTMLInputElement>('[aria-label="Profile group name"]')!;
    name.value = group;
    name.dispatchEvent(new Event('input'));
    const move = document.querySelector<HTMLButtonElement>('#mbx-roster-move-group')!;
    expect(move.disabled).toBe(false);
    return { move, message: document.getElementById('mbx-roster-message')! };
}

test('a roster move from an older window edits only the imported roster', async () => {
    await withWall('local', async wall => {
        const included = { username: 'Included', password: 'fixture', tab: 'Work' };
        const guest = { username: 'guest', password: 'fixture', tab: 'Work' };
        await openSettings().importText(serializeProfileFile({
            profiles: [included, guest], tabs: ['Work'], activeTab: 'Work', storage: {}
        }));
        const [running, omitted] = wall.slots();
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        const saved = { ...included, username: 'included', tab: 'Fleet' };
        await other.replaceAll({ profiles: [saved], tabs: ['Fleet'], activeTab: 'Fleet' });
        wall.controller.addTab('Stale');
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => !wall.controller.tabs().includes('Stale'));

        const { move, message } = await prepareRosterMove('Included', 'Ops');
        move.click();
        await waitFor(() => !!message.textContent);
        expect(message.textContent).toBe('Moved 1 profile to Ops.');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({
            profiles: [{ ...saved, tab: 'Ops' }], tabs: ['Fleet', 'Ops'], activeTab: 'Fleet'
        });
        expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[running.id, 'Ops'], [omitted.id, 'Work']]);
    });
});

test('a roster move queued during replacement uses the imported username', async () => {
    await withWall('local', async wall => {
        const panel = openSettings();
        await panel.importText(serializeProfileFile({
            profiles: [{ username: 'Fixture', password: 'fixture', tab: 'Old' }],
            tabs: ['Old'], activeTab: 'Old', storage: {}
        }));
        const [original] = wall.slots();
        const { move, message } = await prepareRosterMove('Fixture', 'Work');
        const replaceAll = vault.replaceAll.bind(vault);
        const replace = spyOn(vault, 'replaceAll').mockImplementationOnce(data => {
            const replacing = replaceAll(data);
            move.click();
            return replacing;
        });
        try {
            const saved = { username: 'fixture', password: 'fixture', tab: 'Fleet' };
            await panel.importText(serializeProfileFile({ profiles: [saved], tabs: ['Fleet'], activeTab: 'Fleet', storage: {} }));
            expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toBe('');
            await waitFor(() => !!message.textContent);
            expect(message.textContent).toBe('Moved 1 profile to Work.');
            expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[original.id, 'Work']]);
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({
                profiles: [{ ...saved, tab: 'Work' }], tabs: ['Fleet', 'Work'], activeTab: 'Fleet'
            });
        } finally {
            replace.mockRestore();
        }
    });
});

test.each([
    ['succeeds', ''],
    ['exceeds quota', 'settings storage full'],
    ['fails to spawn', 'fixture spawn failed']
])('a queued tab edit preserves imported memberships when the import %s', async (result, expectedError) => {
    await withWall('local', async wall => {
        const panel = openSettings();
        const profile = { username: 'fixture', password: 'fixture' };
        await panel.importText(serializeProfileFile({
            profiles: [{ ...profile, tab: 'Old' }, { username: 'guest', password: 'fixture', tab: 'Work' }],
            tabs: ['Old', 'Work'], activeTab: 'Old', storage: {}
        }));
        const [reused, omitted] = wall.slots();
        const profiles = [{ ...profile, tab: 'Fleet' }, { ...profile, tab: 'Reserve' }, { username: 'new', password: 'fixture', tab: 'Fleet' }];
        let added: ReturnType<Wall['addTab']> | undefined;
        const replaceAll = vault.replaceAll.bind(vault);
        const replace = spyOn(vault, 'replaceAll').mockImplementationOnce(data => {
            const replacing = replaceAll(data);
            added = wall.addTab('Local');
            return replacing;
        });
        const saves = spyOn(vault, 'saveTabState');
        const spawn = spyOn(DomSlotOps.prototype, 'spawn');
        const setItem = sessionStorage.setItem;
        const file = serializeProfileFile({
            profiles, tabs: ['Fleet', 'Reserve'], activeTab: 'Fleet', storage: { new: { selectedScript: 'Miner' } }
        });
        try {
            if (result === 'fails to spawn') {
                spawn.mockImplementationOnce(() => { throw new Error(expectedError); });
            }
            if (result === 'exceeds quota') {
                Object.defineProperty(sessionStorage, 'setItem', {
                    configurable: true,
                    value() { throw new DOMException(expectedError, 'QuotaExceededError'); }
                });
            }
            await panel.importText(file);
            expect(await added).toBe(true);
            expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toBe(expectedError);
            await Promise.all(saves.mock.results.map(result => result.value));
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({
                profiles, tabs: ['Fleet', 'Reserve', 'Local'], activeTab: 'Fleet'
            });
            expect(wall.controller.tabs()).toEqual(['Main', 'Fleet', 'Reserve', 'Work', 'Local']);
            expect(wall.controller.activeTab()).toBe('Fleet');
            const expectedSlots = [['fixture', 'Fleet'], ['guest', 'Work']];
            if (result === 'succeeds') expectedSlots.push(['new', 'Fleet']);
            expect(wall.slots().map(s => [s.username, s.tab])).toEqual(expectedSlots);
            expect(wall.slots().slice(0, 2).map(s => s.id)).toEqual([reused.id, omitted.id]);
            if (result === 'exceeds quota') {
                expect(spawn).not.toHaveBeenCalled();
                Object.defineProperty(sessionStorage, 'setItem', { configurable: true, value: setItem });
                await panel.importText(file);
                expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toBe('');
                expect(sessionStorage.getItem('rs2b0t:new:selectedScript')).toBe('Miner');
                expect(spawn).toHaveBeenCalledTimes(1);
                expect(wall.slots().map(s => [s.username, s.tab])).toEqual([...expectedSlots, ['new', 'Fleet']]);
            }
        } finally {
            spawn.mockRestore();
            Object.defineProperty(sessionStorage, 'setItem', { configurable: true, value: setItem });
            for (const store of [localStorage, sessionStorage]) store.removeItem('rs2b0t:new:selectedScript');
            replace.mockRestore();
            saves.mockRestore();
        }
    });
});

test('overlapping settings imports remove the superseded profile settings from both stores', async () => {
    await withWall('local', async () => {
        const profileFile = (username: string, selectedScript: string) => serializeProfileFile({
            profiles: [{ username, password: 'fixture' }], tabs: [], activeTab: 'Main',
            storage: { [username]: { selectedScript } }
        });
        const firstKey = 'rs2b0t:first:selectedScript';
        const secondKey = 'rs2b0t:second:selectedScript';
        try {
            const panel = openSettings();
            await Promise.all([
                panel.importText(profileFile('first', 'Miner')),
                panel.importText(profileFile('second', 'Fisher'))
            ]);
            expect(panel.el.hidden).toBe(true);

            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.list().map(p => p.username)).toEqual(['second']);
            for (const store of [localStorage, sessionStorage]) {
                expect(store.getItem(firstKey)).toBeNull();
                expect(store.getItem(secondKey)).toBe('Fisher');
            }
        } finally {
            for (const store of [localStorage, sessionStorage]) {
                store.removeItem(firstKey);
                store.removeItem(secondKey);
            }
        }
    });
});

test('loading Work from the chooser keeps it active after adding a tab and reopening', async () => {
    await withWall('local', async wall => {
        await vault.replaceAll({
            profiles: [{ username: 'worker', password: 'fixture', tab: 'Work' }],
            tabs: ['Fleet', 'Work'], activeTab: 'Fleet'
        });
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!document.querySelector('.mbx-load-group'));
        expect(wall.controller.activeTab()).toBe('Fleet');
        const group = document.querySelector<HTMLButtonElement>('.mbx-load-group')!;
        expect(group.textContent).toBe('Load group: Work (1)');
        const saves = spyOn(vault, 'saveTabState');
        try {
            group.click();
            expect(wall.controller.activeTab()).toBe('Work');
            expect(await wall.addTab('Local')).toBe(true);
            await waitFor(() => vault.tabState().tabs.includes('Local'));
            await Promise.all(saves.mock.results.map(result => result.value));
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.tabState()).toEqual({ tabs: ['Fleet', 'Work', 'Local'], activeTab: 'Work' });
        } finally {
            saves.mockRestore();
        }
    });
});

test('loading Work from a stale chooser preserves a newer saved assignment', async () => {
    await withWall('local', async wall => {
        const bob = { username: 'bob', password: 'fixture', tab: 'Work' };
        await openSettings().importText(serializeProfileFile({
            profiles: [bob], tabs: ['Work', 'Fleet'], activeTab: 'Fleet', storage: {}
        }));
        wall.controller.remove(wall.slots()[0].id);
        const key = 'rs2b0t:multibox:profiles';
        const beforeAdd = localStorage.getItem(key);
        expect(await wall.addTab('Local')).toBe(true);
        await waitFor(() => localStorage.getItem(key) !== beforeAdd);
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!document.querySelector('.mbx-load-group'));
        const group = document.querySelector<HTMLButtonElement>('.mbx-load-group')!;
        expect(group.textContent).toBe('Load group: Work (1)');
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['bob'], 'Fleet');
        const beforeSelection = localStorage.getItem(key);
        group.click();
        expect(wall.controller.activeTab()).toBe('Work');
        await waitFor(() => localStorage.getItem(key) !== beforeSelection);
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({
            profiles: [{ ...bob, tab: 'Fleet' }], tabs: ['Work', 'Fleet', 'Local'], activeTab: 'Work'
        });
        const beforeEdit = localStorage.getItem(key);
        expect(await wall.addTab('Extra')).toBe(true);
        await waitFor(() => localStorage.getItem(key) !== beforeEdit);
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({
            profiles: [{ ...bob, tab: 'Fleet' }], tabs: ['Work', 'Fleet', 'Local', 'Extra'], activeTab: 'Work'
        });
    });
});

test('clicking a removed tab chip keeps the replacement active tab', async () => {
    await withWall('local', async wall => {
        await openSettings().importText(serializeProfileFile({
            profiles: [], tabs: ['Work'], activeTab: 'Main', storage: {}
        }));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        const backup = { profiles: [{ username: 'fixture', password: 'fixture', tab: 'Fleet' }], tabs: ['Fleet'], activeTab: 'Fleet' };
        await other.replaceAll(backup);
        document.querySelector<HTMLElement>('.mbx-tabchip[data-tab="Work"]')!.click();
        expect(wall.controller.activeTab()).toBe('Work');
        await waitFor(() => vault.tabState().tabs.includes('Fleet'));
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual(backup);
        document.querySelector<HTMLElement>('.mbx-tabchip[data-tab="Main"]')!.click();
        await waitFor(() => vault.tabState().activeTab === 'Main');
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({ ...backup, activeTab: 'Main' });
    });
});

test('creating a profile in the active tab preserves the imported rows', async () => {
    await withWall('local', async () => {
        const profiles = ['Work', 'Fleet'].map(tab => ({ username: 'fixture', password: 'fixture', tab }));
        await openSettings().importText(serializeProfileFile({
            profiles, tabs: ['Work', 'Fleet'], activeTab: 'Fleet', storage: {}
        }));
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !document.querySelector<HTMLElement>('.mbx-chooser-overlay')!.hidden);
        document.querySelector<HTMLInputElement>('#mbx-new-user')!.value = 'new';
        const saves = spyOn(vault, 'saveTabState');
        try {
            document.querySelector('.mbx-chooser-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
            await waitFor(() => saves.mock.results.length > 0);
            await saves.mock.results[0].value;
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.list().map(p => [p.username, p.tab])).toEqual([['fixture', 'Work'], ['fixture', 'Fleet'], ['new', 'Fleet']]);
        } finally {
            saves.mockRestore();
        }
    });
});

test.each([
    { pick: '.mbx-profile-row', active: 'Work', tabs: ['Fleet'], expected: 'Fleet' },
    { pick: '.mbx-profile-row', active: 'Main', tabs: ['Fleet'], expected: 'Fleet' },
    { pick: '.mbx-profile-row', active: 'Main', tabs: ['Fleet', 'Work'], expected: 'Work' },
    { pick: '.mbx-load-group', active: 'Work', tabs: ['Fleet', 'Work'], expected: 'Fleet' }
])('picking $pick from $active preserves a replacement with tabs $tabs through the next edit', async ({ pick, active, tabs, expected }) => {
    await withWall('local', async wall => {
        await openSettings().importText(serializeProfileFile({
            profiles: [{ username: 'earlier', password: 'fixture', tab: 'Work' }],
            tabs: ['Work'], activeTab: active, storage: {}
        }));
        const [slot] = wall.slots();
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!document.querySelector(pick));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        const backup = { profiles: [{ username: 'saved', password: 'fixture', tab: 'Fleet' }], tabs, activeTab: 'Fleet' };
        await other.replaceAll(backup);
        const key = 'rs2b0t:multibox:profiles';
        const beforePick = localStorage.getItem(key);
        const selections = spyOn(vault, 'saveActiveTab');
        try {
            document.querySelector<HTMLElement>(pick)!.click();
            await Promise.resolve();
            await Promise.all(selections.mock.results.map(result => result.value));
            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ ...backup, activeTab: expected });
            if (active === 'Work') expect(localStorage.getItem(key)).toBe(beforePick);

            const beforeEdit = localStorage.getItem(key);
            expect(await wall.addTab('Local')).toBe(true);
            await waitFor(() => localStorage.getItem(key) !== beforeEdit);
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.snapshot()).toEqual({ ...backup, tabs: [...tabs, 'Local'], activeTab: expected });

            wall.controller.addTab('Stale');
            window.dispatchEvent(new StorageEvent('storage', { key }));
            await waitFor(() => !wall.controller.tabs().includes('Stale'));
            expect(wall.slots().map(s => [s.id, s.tab])).toEqual([[slot.id, 'Work']]);
            expect(wall.controller.activeTab()).toBe('Work');
        } finally {
            selections.mockRestore();
        }
    });
});

test('a shared import can load from the open chooser and reveal its tile', async () => {
    await withWall('proxy', async wall => {
        const openChooser = async () => {
            document.getElementById('mbx-add')!.click();
            await new Promise(resolve => setTimeout(resolve, 0));
        };
        await openChooser();
        const alice = wall.add(vault.list()[0]);
        const original = document.querySelector('iframe');
        const tab = 'Fleet Levelers';
        await vault.replaceAll({
            tabs: [tab], activeTab: 'Main',
            profiles: [...vault.list(), { username: 'fleet1', password: 'test', tab }]
        });
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await new Promise(resolve => setTimeout(resolve, 0));
        const pick = () => Array.from(document.querySelectorAll<HTMLElement>('.mbx-profile-name')).find(el => el.textContent === 'fleet1')!.click();
        expect(wall.controller.tabs()).toContain(tab);
        expect(wall.controller.activeTab()).toBe('Main');
        pick();
        expect(wall.controller.activeTab()).toBe(tab);
        expect(wall.slots()).toHaveLength(2);
        wall.controller.focus(alice.id);
        await openChooser();
        document.getElementById('mbx-load-all')!.click();
        expect(wall.controller.activeTab()).toBe('Main');
        await openChooser();
        const selection = spyOn(vault, 'saveActiveTab');
        try {
            pick();
            await waitFor(() => selection.mock.results.length > 0);
            await selection.mock.results[0].value;
        } finally {
            selection.mockRestore();
        }
        expect(wall.controller.activeTab()).toBe(tab);
        expect(document.querySelectorAll('iframe')).toHaveLength(3);
        expect(document.querySelector('iframe')).toBe(original);
    });
});

test('roster closes when shared profiles are reset or relocked', async () => {
    await withWall('proxy', async () => {
        document.getElementById('mbx-manage')!.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        const roster = document.getElementById('mbx-roster')!;
        expect(roster.hidden).toBe(false);
        const refresh = spyOn(vault, 'refresh').mockImplementation(async () => { vault.reset(); });
        try {
            window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(roster.hidden).toBe(true);
        } finally {
            refresh.mockRestore();
        }
    });
});

test('wall wiring preserves pending slots and retries persistence after a successful frame switch', async () => {
    await withWall('proxy', async wall => {
        let save: ReturnType<typeof spyOn<typeof vault, 'setWorld'>> | undefined;
        try {
            const alice = wall.add({ username: 'alice', password: 'a', world: 1 });
            wall.add({ username: 'bob', password: 'b', world: 2 });
            const [aliceFrame, bobFrame] = Array.from(document.querySelectorAll('iframe'));
            let ingame = true;
            let cancelled = 0;
            const runtime = (world: WorldNumber) => ({
                world,
                reader: { ingame: () => world === 1 && ingame, localPlayerName: () => null },
                client: { constructor: { loopCycle: 0 } },
                renderGate: { drawn: 0, backgroundIntervalMs: 0 },
                runner: { state: 'idle' },
                prepareWorldSwitch: () => !ingame,
                cancelWorldSwitch: () => { cancelled++; },
                setRenderMode: () => {}, setLoginCoordination: () => {}, setCredentials: () => {}, setAutoLogin: () => {}
            });
            Reflect.set(aliceFrame.contentWindow!, 'rs2b0t', runtime(1));
            Reflect.set(bobFrame.contentWindow!, 'rs2b0t', runtime(2));
            await new Promise(resolve => setTimeout(resolve, 75));

            const pending = wall.setWorld(alice.id, 2);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(wall.slots()[0]).toMatchObject({ world: 1, targetWorld: 1, switchingWorld: 2 });
            expect(document.querySelector('iframe')).toBe(aliceFrame);
            expect(vault.list()[0].world).toBe(1);
            document.querySelector<HTMLButtonElement>('.mbx-world-cancel')!.click();
            expect(await pending).toBe(false);
            expect(cancelled).toBe(1);
            expect(wall.slots()[0].switchingWorld).toBeNull();

            ingame = false;
            save = spyOn(vault, 'setWorld').mockRejectedValueOnce(new Error('storage unavailable'));
            expect(await wall.setWorld(alice.id, 2)).toBe(false);
            save.mockRestore();
            save = undefined;
            const replacement = document.querySelector('iframe')!;
            expect(replacement).not.toBe(aliceFrame);
            expect(new URL(replacement.src).searchParams.get('autologin')).toBe('0');
            expect(wall.slots()[0]).toMatchObject({ world: null, targetWorld: 2, switchingWorld: null });
            expect(vault.list()[0].world).toBe(1);
            expect(await wall.setWorld(alice.id, 2)).toBe(true);
            expect(document.querySelector('iframe')).toBe(replacement);
            expect(document.querySelectorAll('iframe')[1]).toBe(bobFrame);
            expect(vault.list().map(profile => profile.world)).toEqual([2, 2]);

            Reflect.set(replacement.contentWindow!, 'rs2b0t', runtime(2));
            await new Promise(resolve => setTimeout(resolve, 75));
            expect(await wall.setWorld(alice.id, 3)).toBe(true);
            const world3Frame = document.querySelector('iframe')!;
            expect(new URL(world3Frame.src).searchParams.get('world')).toBe('3');
            expect(new URL(world3Frame.src).searchParams.get('nodeid')).toBe('12');
            expect(wall.slots()[0]).toMatchObject({ world: null, targetWorld: 3, switchingWorld: null });
            expect(document.querySelector<HTMLSelectElement>('.mbx-world-select')!.value).toBe('3');
            expect(document.querySelectorAll('iframe')[1]).toBe(bobFrame);
            expect(vault.list().map(profile => profile.world)).toEqual([3, 2]);
        } finally {
            save?.mockRestore();
        }
    });
});

test('local wall refuses assignment before preparation, unlock, or profile writes', async () => {
    await withWall('local', async wall => {
        const alice = wall.add({ username: 'alice', password: 'a', world: 2 });
        const frame = document.querySelector('iframe')!;
        expect(new URL(frame.src).searchParams.has('world')).toBe(false);
        expect(new URL(frame.src).searchParams.get('nodeid')).toBe('42');
        expect(document.querySelector('.mbx-world-select')).toBeNull();
        const prepare = spyOn(wall.controller, 'switchWorld');
        const save = spyOn(vault, 'setWorld');
        const unlock = spyOn(VaultPrompt.prototype, 'ensureUnlocked').mockResolvedValue(false);
        try {
            expect(await wall.setWorld(alice.id, 1)).toBe(false);
            expect(prepare).not.toHaveBeenCalled();
            expect(save).not.toHaveBeenCalled();
            expect(wall.slots()[0]).toMatchObject({ switchingWorld: null, targetWorld: 2, world: null });
            expect(document.querySelector('iframe')).toBe(frame);
            expect(vault.list()[0].world).toBe(1);
            expect(unlock).not.toHaveBeenCalled();
        } finally {
            unlock.mockRestore();
            prepare.mockRestore();
            save.mockRestore();
        }
    });
});
