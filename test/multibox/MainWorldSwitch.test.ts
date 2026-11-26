import { expect, spyOn, test } from 'bun:test';
import { VaultPrompt } from '#/bot/multibox/VaultPrompt.js';
import { ProfileVault, vault } from '#/bot/multibox/ProfileVault.js';
import { serializeProfileFile } from '#/bot/multibox/ProfileTransfer.js';
import { readBoxItem } from '#/bot/runtime/box.js';
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

type WallCheck = (wall: Wall) => Promise<void>;

async function withWall(mode: 'local' | 'proxy', check: WallCheck, reopen?: WallCheck): Promise<void> {
    vault.reset();
    try {
        await vault.setup('test-passphrase');
        await vault.upsert({ username: 'alice', password: 'a', world: 1 });
        await vault.upsert({ username: 'bob', password: 'b', world: 2 });
        await withWallPage(mode, check);
        if (reopen) {
            expect(await vault.unlock('test-passphrase')).toBe(true);
            await withWallPage(mode, reopen);
        }
    } finally {
        vault.reset();
    }
}

async function withWallPage(mode: 'local' | 'proxy', check: WallCheck): Promise<void> {
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

const pendingWipeKey = 'rs2b0t:pending-profile-wipe';
const marker = 'rs2b0t:set-profile-settings-v1';

const restoreFailures: ['localStorage' | 'sessionStorage', string][] = [
    ['localStorage', pendingWipeKey],
    ['localStorage', marker],
    ['sessionStorage', marker]
];

test.each(restoreFailures)('reopening the wall retries a restore after %s fails to write %s', async (layer, failedKey) => {
    const legacy = 'rs2b0t:set:set:Global:runEnergyMin';
    const orphan = 'rs2b0t:old:selectedScript';
    const backup = serializeProfileFile({ profiles: [{ username: 'eve', password: '' }], tabs: [], activeTab: 'Main', storage: {} });
    const open = spyOn(SettingsPanel.prototype, 'open');
    const restore = async () => {
        document.getElementById('mbx-settings')!.click();
        const panel = open.mock.contexts.at(-1) as SettingsPanel;
        await panel.importText(backup);
        return panel;
    };
    try {
        await withWall('local', async () => {
            await vault.upsert({ username: 'set', password: '' });
            localStorage.setItem(legacy, '42');
            localStorage.setItem(pendingWipeKey, '["old"]');
            localStorage.setItem(orphan, 'Miner');
            const store = window[layer];
            const write = store.setItem;
            Object.defineProperty(store, 'setItem', { configurable: true, value(key: string, value: string) {
                if (key === failedKey || key.startsWith(failedKey + '/')) throw new DOMException('storage full', 'QuotaExceededError');
                write.call(store, key, value);
            } });
            try {
                const panel = await restore();
                expect(panel.el.querySelector('#mbx-settings-error')!.textContent).toContain('storage full');
            } finally {
                Object.defineProperty(store, 'setItem', { configurable: true, value: write });
            }
        }, async () => {
            expect(vault.list().map(p => p.username)).toEqual(failedKey === pendingWipeKey ? ['alice', 'bob', 'set'] : ['eve']);
            const panel = await restore();
            expect(panel.el.hidden).toBe(true);
            expect(vault.list().map(p => p.username)).toEqual(['eve']);
            expect(localStorage.getItem(pendingWipeKey)).toBeNull();
            expect(Object.keys(localStorage).filter(key => key.startsWith(pendingWipeKey + '/'))).toEqual([]);
            expect(localStorage.getItem(orphan)).toBeNull();
            expect(sessionStorage.getItem(marker)).toBe('1');
            sessionStorage.clear();
            expect(readBoxItem('set:Global:runEnergyMin', 'set')).toBeNull();
            expect(localStorage.getItem(legacy)).toBe('42');
        });
    } finally {
        open.mockRestore();
        localStorage.removeItem(pendingWipeKey);
        localStorage.removeItem(orphan);
        localStorage.removeItem(legacy);
        localStorage.removeItem(marker);
        sessionStorage.removeItem(marker);
    }
});

test("a rejected import preserves another panel's pending wipe", async () => {
    const open = spyOn(SettingsPanel.prototype, 'open');
    const openPanel = () => {
        document.getElementById('mbx-settings')!.click();
        return open.mock.contexts.at(-1) as SettingsPanel;
    };
    const backup = serializeProfileFile({ profiles: [{ username: 'eve', password: '' }], tabs: [], activeTab: 'Main', storage: {} });
    const legacy = 'rs2b0t:set:set:Global:runEnergyMin';
    let first: SettingsPanel;
    try {
        await withWall('local', async () => {
            await vault.upsert({ username: 'set', password: '' });
            localStorage.setItem(legacy, '42');
            first = openPanel();
        }, async () => {
            const second = openPanel();
            const started = Promise.withResolvers<void>();
            const otherVault = new ProfileVault();
            expect(await otherVault.unlock('test-passphrase')).toBe(true);
            const replace = spyOn(vault, 'replaceAll').mockImplementationOnce(otherVault.replaceAll.bind(otherVault));
            const conflict = Promise.withResolvers<ArrayBuffer>();
            const encrypt = spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(() => {
                started.resolve();
                return conflict.promise;
            });
            const firstImport = first.importText(backup);
            try {
                await started.promise;
                const write = localStorage.setItem;
                Object.defineProperty(localStorage, 'setItem', { configurable: true, value(key: string, value: string) {
                    if (key === marker) throw new Error('storage full');
                    write.call(localStorage, key, value);
                } });
                try {
                    await second.importText(backup);
                    expect(second.el.querySelector('#mbx-settings-error')!.textContent).toBe('storage full');
                    expect(vault.list().map(p => p.username)).toEqual(['eve']);
                } finally {
                    Object.defineProperty(localStorage, 'setItem', { configurable: true, value: write });
                }
            } finally {
                conflict.reject(new Error('vault changed'));
                await firstImport;
                encrypt.mockRestore();
                replace.mockRestore();
            }
            expect(first.el.querySelector('#mbx-settings-error')!.textContent).toBe('vault changed');
            await second.importText(backup);
            expect(second.el.hidden).toBe(true);
            sessionStorage.clear();
            expect(readBoxItem('set:Global:runEnergyMin', 'set')).toBeNull();
            expect(localStorage.getItem(legacy)).toBe('42');
        });
    } finally {
        open.mockRestore();
        localStorage.removeItem(legacy);
        localStorage.removeItem(marker);
        sessionStorage.removeItem(marker);
    }
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
        pick();
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
