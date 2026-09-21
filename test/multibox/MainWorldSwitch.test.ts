import { expect, spyOn, test } from 'bun:test';
import { VaultPrompt } from '#/bot/multibox/VaultPrompt.js';
import { vault } from '#/bot/multibox/ProfileVault.js';
import { ResourcePanel } from '#/bot/multibox/ResourcePanel.js';
import { DiagSampler } from '#/bot/multibox/DiagSampler.js';
import { FreezeWatch } from '#/bot/runtime/diag/FreezeWatch.js';
import type { MultiBoxController } from '#/bot/multibox/MultiBoxController.js';
import type { Account, SlotSnapshot } from '#/bot/multibox/types.js';
import type { WorldNumber } from '#/client/config/worlds.js';

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
        for (const id of ['build', 'start-all', 'stop-all', 'renderers-off', 'renderers-on', 'resource-bots', 'resource-cpu', 'resource-memory', 'resource-traffic', 'resource-cpu-row', 'resource-memory-row', 'settings', 'drawer']) {
            const el = document.createElement('button');
            el.id = `mbx-${id}`;
            document.body.appendChild(el);
        }
        const entry = `../../src/bot/multibox/main.ts?fixture=${mode}`;
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

            expect(await wall.setWorld(alice.id, 2)).toBe(false);
            expect(wall.slots()[0]).toMatchObject({ world: 1, targetWorld: 1, switchingWorld: 2 });
            expect(document.querySelector('iframe')).toBe(aliceFrame);
            expect(vault.list()[0].world).toBe(1);
            document.querySelector<HTMLButtonElement>('.mbx-world-cancel')!.click();
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
