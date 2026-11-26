import { expect, spyOn, test } from 'bun:test';
import { VaultPrompt } from '#/bot/multibox/VaultPrompt.js';
import { type Profile, ProfileVault, vault } from '#/bot/multibox/ProfileVault.js';
import { serializeProfileFile, type ProfileSnapshot } from '#/bot/multibox/ProfileTransfer.js';
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
    addTab(name: string): boolean;
    renameTab(from: string, to: string): boolean;
    removeTab(name: string): boolean;
    setSlotTab(id: number, tab: string): boolean;
    importProfiles(profiles: Profile[]): Promise<number>;
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
        await vault.reset();
        await vault.setup('test-passphrase');
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        await vault.upsert({ username: 'bob', password: 'b', world: 2 });
        document.body.innerHTML = '<div id="mbx-app"><div id="mbx-rail"><div id="mbx-tabs"></div><div id="mbx-add"></div></div></div>';
        for (const id of ['build', 'start-all', 'stop-all', 'renderers-off', 'renderers-on', 'resource-bots', 'resource-cpu', 'resource-memory', 'resource-traffic', 'resource-cpu-row', 'resource-memory-row', 'settings', 'manage', 'drawer']) {
            const el = document.createElement('button');
            el.id = `mbx-${id}`;
            document.body.appendChild(el);
        }
        const entry = `../../src/bot/multibox/main.ts?fixture=${crypto.randomUUID()}`;
        await import(entry);
        if (!Reflect.get(globalThis, 'multibox')) document.dispatchEvent(new Event('DOMContentLoaded'));
        wall = Reflect.get(globalThis, 'multibox') as Wall;
        await check(wall);
        await vault.refresh();
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
        await vault.reset();
        Reflect.deleteProperty(globalThis, 'multibox');
        document.body.innerHTML = '';
        browser.setURL(previousUrl);
        if (previousMode === undefined) delete process.env.RS2B0T_TARGET;
        else process.env.RS2B0T_TARGET = previousMode;
    }
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
        const open = spyOn(SettingsPanel.prototype, 'open');
        try {
            document.getElementById('mbx-settings')!.click();
            const panel = open.mock.contexts[0] as SettingsPanel;
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
            open.mockRestore();
            spawning.mockRestore();
        }
    });
});

test('overlapping settings imports remove the superseded profile settings from both stores', async () => {
    await withWall('local', async () => {
        const open = spyOn(SettingsPanel.prototype, 'open');
        const profileFile = (username: string, selectedScript: string) => serializeProfileFile({
            profiles: [{ username, password: 'fixture' }], tabs: [], activeTab: 'Main',
            storage: { [username]: { selectedScript } }
        });
        const firstKey = 'rs2b0t:first:selectedScript';
        const secondKey = 'rs2b0t:second:selectedScript';
        try {
            document.getElementById('mbx-settings')!.click();
            const panel = open.mock.contexts[0] as SettingsPanel;
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
            open.mockRestore();
            for (const store of [localStorage, sessionStorage]) {
                store.removeItem(firstKey);
                store.removeItem(secondKey);
            }
        }
    });
});

async function waitFor(done: () => boolean): Promise<void> {
    const deadline = performance.now() + 2000;
    while (!done()) {
        if (performance.now() >= deadline) throw new Error('wall did not finish updating');
        await Bun.sleep(5);
    }
}

function chooserRow(username: string): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>('.mbx-chooser-overlay:not([hidden]) .mbx-profile-name')).find(el => el.textContent === username);
}

async function loadChooserRow(username: string): Promise<void> {
    const key = 'rs2b0t:multibox:profiles';
    const before = localStorage.getItem(key);
    chooserRow(username)!.click();
    await waitFor(() => localStorage.getItem(key) !== before);
}

function submitChooserProfile(username: string, password: string): void {
    document.querySelector<HTMLInputElement>('#mbx-new-user')!.value = username;
    document.querySelector<HTMLInputElement>('#mbx-new-pass')!.value = password;
    document.querySelector('.mbx-chooser-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

async function importSettings(data: ProfileSnapshot): Promise<void> {
    const open = spyOn(SettingsPanel.prototype, 'open');
    try {
        document.getElementById('mbx-settings')!.click();
        const panel = open.mock.contexts[0] as SettingsPanel;
        await panel.importText(serializeProfileFile(data));
        expect(panel.el.hidden).toBe(true);
    } finally {
        open.mockRestore();
    }
}

test('settings import moves an already loaded profile to its imported group', async () => {
    await withWall('local', async wall => {
        await vault.assignGroup(['alice'], 'Old');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');
        const [loaded] = wall.slots();
        expect(loaded.tab).toBe('Old');

        await importSettings({
            profiles: [{ username: 'alice', password: 'a', tab: 'Fleet' }],
            tabs: ['Fleet'], activeTab: 'Fleet', storage: {}
        });
        await vault.refresh();
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().map(p => p.tab)).toEqual(['Fleet']);
        expect(reopened.tabState()).toEqual({ tabs: ['Fleet'], activeTab: 'Fleet' });
        expect(wall.slots()[0]).toMatchObject({ id: loaded.id, tab: 'Fleet' });
        expect(wall.controller.tabs()).toEqual(['Main', 'Fleet']);
        expect(wall.controller.activeTab()).toBe('Fleet');
    });
});

test('settings import preserves the group and selection of an omitted live slot', async () => {
    await withWall('local', async wall => {
        await vault.saveTabState(['Work'], new Map([['alice', 'Work']]), 'Work');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');
        const [loaded] = wall.slots();
        const profiles = [{ username: 'bob', password: 'b', tab: 'Fleet' }];
        await importSettings({ profiles, tabs: ['Fleet'], activeTab: 'Fleet', storage: {} });

        expect(wall.slots()).toMatchObject([{ id: loaded.id, tab: 'Work' }, { username: 'bob', tab: 'Fleet' }]);
        expect(wall.controller.activeTab()).toBe('Work');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({ profiles, tabs: ['Fleet'], activeTab: 'Fleet' });

        const bob = wall.slots()[1];
        expect(wall.setSlotTab(bob.id, 'Work')).toBe(true);
        await waitFor(() => vault.list()[0].tab === 'Work' || wall.slots()[1].tab !== 'Work');
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.snapshot()).toEqual({
            profiles: [{ ...profiles[0], tab: 'Work' }], tabs: ['Work', 'Fleet'], activeTab: 'Fleet'
        });
    });
});

test('adding a group preserves the active tab selected in another wall', async () => {
    await withWall('local', async wall => {
        await vault.saveTabState(['Fleet'], new Map(), 'Main');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.saveTabState(['Fleet'], new Map(), 'Fleet');
        expect(wall.controller.activeTab()).toBe('Main');
        expect(wall.addTab('Work')).toBe(true);
        await waitFor(() => vault.tabState().tabs.includes('Work'));
        expect(await other.unlock('test-passphrase')).toBe(true);
        expect(other.tabState()).toEqual({ tabs: ['Fleet', 'Work'], activeTab: 'Fleet' });

        expect(wall.renameTab('Fleet', 'Renamed')).toBe(true);
        await waitFor(() => vault.tabState().tabs.includes('Renamed'));
        expect(await other.unlock('test-passphrase')).toBe(true);
        expect(other.tabState()).toEqual({ tabs: ['Renamed', 'Work'], activeTab: 'Renamed' });
    });
});

test('a group edit retries a failed recovery before accepting another change', async () => {
    await withWall('local', async wall => {
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        const lock = spyOn(navigator.locks, 'request').mockRejectedValueOnce(new Error('write denied'));
        const refresh = spyOn(vault, 'refresh').mockRejectedValueOnce(new Error('refresh failed'));
        try {
            expect(wall.addTab('Rejected')).toBe(true);
            await waitFor(() => refresh.mock.calls.length > 0);
            expect(wall.addTab('Work')).toBe(false);
            expect(wall.controller.tabs()).not.toContain('Work');
            await waitFor(() => !wall.controller.tabs().includes('Rejected'));
            expect(wall.addTab('Work')).toBe(true);
            await waitFor(() => vault.tabState().tabs.includes('Work'));

            const reopened = new ProfileVault();
            expect(await reopened.unlock('test-passphrase')).toBe(true);
            expect(reopened.tabState().tabs).toEqual(['Work']);
        } finally {
            refresh.mockRestore();
            lock.mockRestore();
        }
    });
});

test('a rejected group creation restores the wall and allows a retry', async () => {
    await withWall('local', async wall => {
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');
        const [loaded] = wall.slots();
        const lock = spyOn(navigator.locks, 'request').mockRejectedValueOnce(new Error('write denied'));
        try {
            expect(wall.addTab('Mining')).toBe(true);
            expect(wall.setSlotTab(loaded.id, 'Mining')).toBe(true);
            await waitFor(() => !wall.controller.tabs().includes('Mining'));
            expect(wall.slots()[0].tab).toBe('Main');
        } finally {
            lock.mockRestore();
        }

        expect(wall.addTab('Mining')).toBe(true);
        expect(wall.setSlotTab(loaded.id, 'Mining')).toBe(true);
        await waitFor(() => vault.list()[0].tab === 'Mining');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.tabState().tabs).toEqual(['Mining']);
        expect(reopened.list()[0].tab).toBe('Mining');
    });
});

test('adding a tab while a roster move is saving preserves both groups', async () => {
    await withWall('local', async wall => {
        document.getElementById('mbx-manage')!.click();
        await waitFor(() => !document.getElementById('mbx-roster')!.hidden);
        document.querySelector<HTMLInputElement>('[aria-label="Select alice"]')!.click();
        const name = document.querySelector<HTMLInputElement>('[aria-label="Profile group name"]')!;
        name.value = 'Fleet';
        name.dispatchEvent(new Event('input'));
        document.getElementById('mbx-roster-move-group')!.click();
        document.getElementById('mbx-roster-done')!.click();
        expect(wall.addTab('Mining')).toBe(true);
        await waitFor(() => vault.tabState().tabs.includes('Mining'));

        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'alice')?.tab).toBe('Fleet');
        expect(reopened.tabState().tabs).toEqual(['Fleet', 'Mining']);
        expect(wall.controller.tabs()).toEqual(['Main', 'Fleet', 'Mining']);
    });
});

test('loading a stale chooser row keeps a remotely deleted group deleted', async () => {
    await withWall('local', async wall => {
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['bob'], 'Fleet');
        await vault.setWorld('alice', 2);
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('bob'));
        await other.saveTabState([], new Map(), 'Main');
        await loadChooserRow('bob');
        expect(wall.slots().map(slot => slot.username)).toEqual(['alice', 'bob']);

        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.tabState()).toEqual({ tabs: [], activeTab: 'Main' });
        expect(reopened.list().find(p => p.username === 'bob')?.tab).toBe('Main');
    });
});

test('loading a stale chooser row preserves a group edit from another tab', async () => {
    await withWall('local', async wall => {
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('bob'));

        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['bob'], 'Fleet');
        await loadChooserRow('bob');
        expect(wall.slots().map(slot => slot.username)).toEqual(['alice', 'bob']);
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'bob')?.tab).toBe('Fleet');
    });
});

test('loading an imported profile from a stale chooser preserves its new group', async () => {
    await withWall('local', async wall => {
        expect(await wall.importProfiles([{ username: 'carol', password: 'fixture' }])).toBe(1);
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('carol'));

        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['carol'], 'Fleet');
        await loadChooserRow('carol');

        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'carol')?.tab).toBe('Fleet');
    });
});

test('loading a profile discovered during another save preserves its remote group', async () => {
    await withWall('local', async wall => {
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.upsert({ username: 'remote', password: 'fixture' });
        await wall.importProfiles([{ username: 'local', password: 'fixture' }]);
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('remote'));

        await other.assignGroup(['remote'], 'Fleet');
        await loadChooserRow('remote');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'remote')?.tab).toBe('Fleet');

        const key = 'rs2b0t:multibox:profiles';
        const before = localStorage.getItem(key);
        expect(wall.addTab('Mining')).toBe(true);
        await waitFor(() => localStorage.getItem(key) !== before);
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'remote')?.tab).toBe('Fleet');
    });
});

test('a stale chooser re-saves and loads a profile in its remotely created group', async () => {
    await withWall('local', async wall => {
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.upsert({ username: 'fleet1', password: 'old', world: 2 });
        await other.assignGroup(['fleet1'], 'Fleet');

        submitChooserProfile('fleet1', 'updated');
        await waitFor(() => wall.slots().some(slot => slot.username === 'fleet1'));
        await vault.refresh();

        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'fleet1')).toEqual({ username: 'fleet1', password: 'updated', world: 2, tab: 'Fleet' });
        expect(wall.slots()[0].tab).toBe('Fleet');
    });
});

test('a stale wall renames only the current members of a group', async () => {
    await withWall('local', async wall => {
        await vault.assignGroup(['alice', 'bob'], 'Original');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');

        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['alice', 'bob'], 'Remote');
        await other.upsert({ username: 'carol', password: 'fixture' });
        await other.assignGroup(['carol'], 'Original');

        const key = 'rs2b0t:multibox:profiles';
        const before = localStorage.getItem(key);
        expect(wall.renameTab('Original', 'Renamed')).toBe(true);
        await waitFor(() => localStorage.getItem(key) !== before);
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().map(p => [p.username, p.tab])).toEqual([
            ['alice', 'Remote'], ['bob', 'Remote'], ['carol', 'Renamed']
        ]);
        expect(reopened.tabState().tabs.sort()).toEqual(['Remote', 'Renamed']);
    });
});

test('a stale wall discards a deletion queued after a conflicting rename', async () => {
    await withWall('local', async wall => {
        await vault.saveTabState(['Old'], new Map([['alice', 'Old']]), 'Old');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');

        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['bob'], 'Fleet');
        expect(wall.renameTab('Old', 'Fleet')).toBe(true);
        expect(wall.removeTab('Fleet')).toBe(true);
        await waitFor(() => wall.controller.tabs().includes('Old'));

        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.tabState()).toEqual({ tabs: ['Old', 'Fleet'], activeTab: 'Old' });
        expect(reopened.list().map(p => [p.username, p.tab])).toEqual([['alice', 'Old'], ['bob', 'Fleet']]);
        expect(wall.controller.tabs()).toEqual(['Main', 'Old', 'Fleet']);
        expect(wall.controller.activeTab()).toBe('Old');
        expect(wall.slots()[0].tab).toBe('Old');

        expect(wall.setSlotTab(wall.slots()[0].id, 'Fleet')).toBe(true);
        await waitFor(() => vault.list()[0].tab === 'Fleet');
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().map(p => p.tab)).toEqual(['Fleet', 'Fleet']);
    });
});

test('deleting a stale group moves only its remaining loaded members to the prior group', async () => {
    await withWall('local', async wall => {
        await vault.upsert({ username: 'carol', password: 'fixture' });
        await vault.saveTabState(['Prior', 'Old'], new Map([['alice', 'Old'], ['bob', 'Old']]), 'Old');
        for (const username of ['alice', 'bob', 'carol']) {
            document.getElementById('mbx-add')!.click();
            await waitFor(() => !!chooserRow(username));
            await loadChooserRow(username);
        }

        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['alice'], 'Remote');
        await other.assignGroup(['carol'], 'Old');
        const key = 'rs2b0t:multibox:profiles';
        const before = localStorage.getItem(key);
        expect(wall.removeTab('Old')).toBe(true);
        await waitFor(() => localStorage.getItem(key) !== before);

        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.tabState().tabs).toEqual(['Prior', 'Remote']);
        expect(reopened.list().map(p => [p.username, p.tab])).toEqual([['alice', 'Remote'], ['bob', 'Prior'], ['carol', 'Prior']]);
    });
});

test('a chooser re-save focuses an already loaded profile in its saved group', async () => {
    await withWall('local', async wall => {
        await vault.assignGroup(['alice'], 'Original');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        await loadChooserRow('alice');
        const loaded = wall.slots()[0];
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.assignGroup(['alice'], 'Remote');
        submitChooserProfile('alice', 'updated');
        await waitFor(() => !chooserRow('alice'));
        expect(wall.slots()).toHaveLength(1);
        expect(wall.slots()[0]).toMatchObject({ id: loaded.id, tab: 'Remote', focused: true });
        expect(wall.controller.activeTab()).toBe('Remote');
        await waitFor(() => vault.tabState().activeTab === 'Remote');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.tabState().activeTab).toBe('Remote');
        expect(reopened.list()[0].tab).toBe('Remote');

        const key = 'rs2b0t:multibox:profiles';
        const before = localStorage.getItem(key);
        expect(wall.setSlotTab(wall.slots()[0].id, 'Original')).toBe(true);
        await waitFor(() => localStorage.getItem(key) !== before);
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list()[0]).toEqual({ username: 'alice', password: 'updated', world: 1, tab: 'Original' });
    });
});

test('creating a profile in the chooser saves its active group', async () => {
    await withWall('local', async wall => {
        await vault.saveTabState(['Mining'], new Map(), 'Mining');
        document.getElementById('mbx-add')!.click();
        await waitFor(() => !!chooserRow('alice'));
        submitChooserProfile('miner', 'fixture');
        await waitFor(() => vault.list().some(p => p.username === 'miner' && p.tab === 'Mining'));
        expect(wall.slots()[0].tab).toBe('Mining');
        const reopened = new ProfileVault();
        expect(await reopened.unlock('test-passphrase')).toBe(true);
        expect(reopened.list().find(p => p.username === 'miner')?.tab).toBe('Mining');
    });
});

test('a shared import can load from the open chooser and reveal its tile', async () => {
    await withWall('proxy', async wall => {
        const openChooser = async () => {
            document.getElementById('mbx-add')!.click();
            await waitFor(() => !!chooserRow('alice'));
        };
        await openChooser();
        const alice = wall.add(vault.list()[0]);
        const original = document.querySelector('iframe');
        const tab = 'Fleet Levelers';
        const other = new ProfileVault();
        expect(await other.unlock('test-passphrase')).toBe(true);
        await other.replaceAll({
            tabs: [tab], activeTab: 'Main',
            profiles: [...vault.list(), { username: 'fleet1', password: 'test', tab }]
        });
        window.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:multibox:profiles' }));
        await waitFor(() => wall.controller.tabs().includes(tab) && !!chooserRow('fleet1'));
        const pick = () => chooserRow('fleet1')!.click();
        expect(wall.controller.activeTab()).toBe('Main');
        pick();
        expect(wall.controller.activeTab()).toBe(tab);
        expect(wall.slots()).toHaveLength(2);
        wall.controller.focus(alice.id);
        await openChooser();
        document.getElementById('mbx-load-all')!.click();
        expect(wall.controller.activeTab()).toBe('Main');
        await openChooser();
        pick();
        expect(wall.controller.activeTab()).toBe(tab);
        expect(document.querySelectorAll('iframe')).toHaveLength(3);
        expect(document.querySelector('iframe')).toBe(original);
    });
});

test('a relocked wall closes the roster and preserves replacement groups on its next load', async () => {
    await withWall('proxy', async wall => {
        await vault.assignGroup(['bob'], 'Old');
        document.getElementById('mbx-manage')!.click();
        const roster = document.getElementById('mbx-roster')!;
        await waitFor(() => !roster.hidden);
        wall.add(vault.list().find(p => p.username === 'bob')!);

        const other = new ProfileVault();
        await other.reset();
        await other.setup('replacement');
        const profiles = [
            { username: 'alice', password: 'a', tab: 'Main' },
            { username: 'bob', password: 'b', tab: 'Fleet' },
            { username: 'unused', password: 'c', tab: 'Fleet' }
        ];
        await other.replaceAll({ profiles, tabs: ['Fleet'], activeTab: 'Fleet' });
        const key = 'rs2b0t:multibox:profiles';
        const beforeLoad = localStorage.getItem(key);
        window.dispatchEvent(new StorageEvent('storage', { key }));
        await waitFor(() => roster.hidden);
        expect(vault.status()).toBe('locked');

        document.getElementById('mbx-add')!.click();
        document.querySelector<HTMLInputElement>('#mbx-vault-pass')!.value = 'replacement';
        document.getElementById('mbx-vault-go')!.click();
        await waitFor(() => !!chooserRow('alice'));
        chooserRow('alice')!.click();
        await waitFor(() => localStorage.getItem(key) !== beforeLoad);

        const reopened = new ProfileVault();
        expect(await reopened.unlock('replacement')).toBe(true);
        expect(reopened.snapshot()).toEqual({ profiles, tabs: ['Fleet'], activeTab: 'Main' });
    });
});

test('a reset during the unlock prompt cancels the pending wall action', async () => {
    await withWall('local', async wall => {
        const other = new ProfileVault();
        await other.reset();
        await vault.refresh();
        await other.setup('replacement');

        document.getElementById('mbx-add')!.click();
        const importing = wall.importProfiles([{ username: 'carol', password: 'fixture' }]);
        document.querySelector<HTMLInputElement>('#mbx-vault-pass')!.value = 'replacement';
        document.getElementById('mbx-vault-go')!.click();
        await other.reset();
        await vault.refresh();
        expect(await importing).toBe(0);
        expect(vault.status()).toBe('empty');
        expect(document.querySelector('#mbx-new-user')!.closest<HTMLElement>('.mbx-chooser-overlay')!.hidden).toBe(true);
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
