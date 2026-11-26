import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { installDesktopStorage } from '#/bot/panel/desktopStorage.js';
import { replaceScriptSettings } from '#/bot/multibox/RosterStorage.js';
import type { DesktopStorage } from '#/bot/runtime/desktopStorage.js';

const require = createRequire(import.meta.url);
const { sharedStorage } = require('../../desktop/shared-storage.cjs');
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

class Frame {
    url = 'http://localhost:8081/bot.html';
    detached = false;
    destroyed = false;
    fails = false;
    framesInSubtree: Frame[] = [this];
    received: { version: number; data: Record<string, string> }[] = [];
    isDestroyed() { return this.destroyed; }
    send(_channel: string, snapshot: { version: number; data: Record<string, string> }) {
        if (this.fails) throw new Error('Render frame was disposed');
        this.received.push(snapshot);
    }
}

async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rs2b0t-storage-session-test-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = sharedStorage(join(directory, 'Shared Storage'));
    store.seed({});
    const ipcMain = new EventEmitter();
    const app = Object.assign(new EventEmitter(), { getPath: () => directory, setPath: () => {} });
    const main = new Frame(), child = new Frame(), nested = new Frame(), plain = new Frame();
    main.framesInSubtree = [main, child, nested, plain];
    child.framesInSubtree = [child, nested];
    const contents = Object.assign(new EventEmitter(), { mainFrame: main, isDestroyed: () => false });
    let watch!: (event: string, file: string) => void;
    const module = { exports: {} as { prepareStorage: (app: unknown) => { start: (url: string) => Promise<void> } } };
    runInNewContext(readFileSync(new URL('../../desktop/storage-session.cjs', import.meta.url), 'utf8'), {
        module, URL, process: { env: { B0T_PROFILE_DIR: directory, B0T_RUNTIME_DIR: directory } },
        require: (name: string) => name === 'electron' ? { ipcMain, webContents: { getAllWebContents: () => [contents] } }
            : name === 'node:fs' ? { ...fs, watch: (_dir: string, callback: typeof watch) => { watch = callback; return { close() {} }; } }
                : name === './shared-storage.cjs' ? { sharedStorage: () => store } : require(name)
    });
    await module.exports.prepareStorage(app).start('http://localhost:8081');
    cleanups.push(() => app.emit('quit'));
    const request = (frame: Frame, method: string, ...args: unknown[]) => {
        const event = { sender: contents, senderFrame: frame, returnValue: undefined as unknown as { error?: string; snapshot?: { version: number; data: Record<string, string> } } };
        ipcMain.emit('rs2b0t-storage', event, method, ...args);
        return event.returnValue;
    };
    return { main, child, nested, plain, contents, request, store, watch: () => watch('rename', 'storage.json') };
}
const key = 'rs2b0t:set:Fisher:method';

test('storage changes reach registered bridges only, with the writer updated by its response', async () => {
    const f = await fixture();
    f.request(f.main, 'snapshot');
    f.request(f.child, 'snapshot');
    const response = f.request(f.main, 'setItem', key, 'Shrimps');
    expect(response.snapshot?.data[key]).toBe('Shrimps');
    expect(f.child.received.at(-1)?.data[key]).toBe('Shrimps');
    expect(f.main.received).toEqual([]);
    expect(f.plain.received).toEqual([]);
    expect(f.nested.received).toEqual([]);
});

test('subframe navigation unregisters its subtree until the new document requests a snapshot', async () => {
    const f = await fixture();
    for (const frame of [f.main, f.child, f.nested]) f.request(frame, 'snapshot');
    f.contents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: false, frame: f.child });
    f.request(f.main, 'setItem', key, 'Trout');
    expect(f.child.received).toEqual([]);
    expect(f.nested.received).toEqual([]);
    expect(f.request(f.child, 'snapshot').snapshot?.data[key]).toBe('Trout');
    f.request(f.main, 'setItem', key, 'Salmon');
    expect(f.child.received.at(-1)?.data[key]).toBe('Salmon');
    expect(f.nested.received).toEqual([]);
});

test('same-document navigation keeps the subscription and external writes notify it', async () => {
    const f = await fixture();
    f.request(f.child, 'snapshot');
    f.contents.emit('did-start-navigation', { isSameDocument: true, isMainFrame: false, frame: f.child });
    f.store.setItem(key, 'Lobster');
    f.watch();
    expect(f.child.received.at(-1)?.data[key]).toBe('Lobster');
    expect(f.plain.received).toEqual([]);
});

test.each(['detached', 'destroyed', 'fails'] as const)('a %s peer cannot break a persisted settings write or delivery to other peers', async state => {
    const f = await fixture();
    for (const frame of [f.child, f.nested]) f.request(frame, 'snapshot');
    f.child[state] = true;
    const response = f.request(f.main, 'setItem', key, 'Shrimps');
    expect(response.error).toBeUndefined();
    expect(response.snapshot?.data[key]).toBe('Shrimps');
    expect(f.child.received).toEqual([]);
    expect(f.nested.received.at(-1)?.data[key]).toBe('Shrimps');
});

test.each(['navigation', 'destroyed'])('window %s removes all subscriptions', async action => {
    const f = await fixture();
    for (const frame of [f.main, f.child]) f.request(frame, 'snapshot');
    if (action === 'navigation') f.contents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true, frame: f.main });
    else f.contents.emit('destroyed');
    f.store.setItem(key, 'Trout');
    f.watch();
    expect(f.main.received).toEqual([]);
    expect(f.child.received).toEqual([]);
});

test('a frame that leaves the trusted origin loses access and stops receiving snapshots', async () => {
    const f = await fixture();
    f.request(f.child, 'snapshot');
    f.child.url = 'https://example.invalid/';
    expect(f.request(f.child, 'setItem', key, 'bad').error).toBe('Invalid storage request');
    f.request(f.main, 'setItem', key, 'Shrimps');
    expect(f.store.getItem(key)).toBe('Shrimps');
    expect(f.child.received).toEqual([]);
});

const rock = 'rs2b0t:target:set:Miner:rock';
const area = 'rs2b0t:target:set:Miner:area';
const depth = 'rs2b0t:target:set:Miner:depth';
const copy = () => replaceScriptSettings('target', 'Miner', { rock: 'coal', area: 'quarry' });

function failSecondWrite(store: Pick<Storage, 'setItem'>) {
    const set = store.setItem;
    Object.defineProperty(store, 'setItem', { configurable: true, value(key: string, value: string) {
        if (key === area) throw new Error('quota');
        set.call(store, key, value);
    } });
    try {
        expect(copy).toThrow('quota');
    } finally {
        Object.defineProperty(store, 'setItem', { configurable: true, writable: true, value: set });
    }
}

function installBridge(f: Awaited<ReturnType<typeof fixture>>, frame: Frame, batch: boolean, freshReads = true) {
    let deliver!: (channel: unknown, snapshot: Frame['received'][number]) => void;
    runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
        queueMicrotask,
        require: () => ({
            contextBridge: { exposeInMainWorld: (_: string, bridge: DesktopStorage) => {
                installDesktopStorage(freshReads ? bridge : { ...bridge, getItemFresh: undefined });
            } },
            ipcRenderer: {
                on: (_: string, callback: typeof deliver) => { deliver = callback; },
                sendSync: (_: string, method: string, ...args: unknown[]) => {
                    const response = f.request(frame, method, ...args);
                    return !batch && method === 'snapshot' ? { snapshot: response.snapshot } : response;
                }
            }
        })
    });
    return deliver;
}

async function copyFixture(batch = true, freshReads = true) {
    const f = await fixture();
    f.store.setItem(rock, 'iron');
    f.request(f.child, 'snapshot');
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    const deliverToWall = installBridge(f, f.main, batch, freshReads);
    cleanups.push(() => {
        Object.defineProperty(window, 'localStorage', original);
        sessionStorage.removeItem(rock);
        sessionStorage.removeItem(area);
        sessionStorage.removeItem(depth);
    });
    sessionStorage.setItem(rock, 'tin');
    return { ...f, deliverToWall, nativeStorage: original };
}

function failDurableWrite() {
    const files: typeof fs = require('node:fs');
    const write = files.writeFileSync;
    const quota = spyOn(files, 'writeFileSync').mockImplementation((path, data, options) => {
        if (typeof data === 'string' && Object.hasOwn(JSON.parse(data).data, area)) throw new Error('quota');
        write(path, data, options);
    });
    try {
        expect(copy).toThrow('quota');
    } finally {
        quota.mockRestore();
    }
}

test('failed desktop copy preserves the session value after queued mirrors run', async () => {
    const f = await copyFixture();
    failDurableWrite();
    await Promise.resolve();
    expect(localStorage.getItem(rock)).toBe('iron');
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(localStorage.getItem(area)).toBeNull();
    expect(sessionStorage.getItem(area)).toBeNull();
    expect(f.child.received).toEqual([]);
    copy();
    await Promise.resolve();
    for (const store of [localStorage, sessionStorage]) {
        expect(store.getItem(rock)).toBe('coal');
        expect(store.getItem(area)).toBe('quarry');
    }
    expect(f.child.received.map(snapshot => snapshot.data)).toEqual([{ [rock]: 'coal', [area]: 'quarry' }]);
});

test.each(['session', 'durable'])('legacy desktop copy preserves both stores after a %s failure and notifications in both frames', async limited => {
    const f = await copyFixture(false);
    const wallStore = localStorage;
    const top = Object.getOwnPropertyDescriptor(window, 'top')!;
    Object.defineProperty(window, 'top', { configurable: true, value: { localStorage: wallStore } });
    cleanups.push(() => Object.defineProperty(window, 'top', top));
    Object.defineProperty(window, 'localStorage', f.nativeStorage);
    const deliverToChild = installBridge(f, f.child, false);
    if (limited === 'session') failSecondWrite(sessionStorage);
    else failDurableWrite();
    await Promise.resolve();
    for (const [frame, deliver] of [[f.main, f.deliverToWall], [f.child, deliverToChild]] as const) {
        for (const snapshot of frame.received) {
            deliver(null, snapshot);
            await Promise.resolve();
        }
    }
    if (limited === 'session') expect(f.child.received).toEqual([]);
    expect(f.store.snapshot()).toEqual({ [rock]: 'iron' });
    expect(localStorage.getItem(rock)).toBe('iron');
    expect(localStorage.getItem(area)).toBeNull();
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(sessionStorage.getItem(area)).toBeNull();
    copy();
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({ [rock]: 'coal', [area]: 'quarry' });
    expect(sessionStorage.getItem(rock)).toBe('coal');
    expect(sessionStorage.getItem(area)).toBe('quarry');
});

test('desktop copy publishes the committed snapshot when the file cannot be reread', async () => {
    const f = await copyFixture();
    const snapshot = spyOn(f.store, 'snapshot').mockImplementation(() => { throw new Error('reread failed'); });
    try {
        copy();
    } finally {
        snapshot.mockRestore();
    }
    await Promise.resolve();
    const expected = { [rock]: 'coal', [area]: 'quarry' };
    expect(f.store.snapshot()).toEqual(expected);
    expect(f.child.received.map(change => change.data)).toEqual([expected]);
    expect(localStorage.getItem(rock)).toBe('coal');
    expect(sessionStorage.getItem(rock)).toBe('coal');
    expect(localStorage.getItem(area)).toBe('quarry');
    expect(sessionStorage.getItem(area)).toBe('quarry');
});

test('legacy desktop mirrors ordinary writes queued immediately after a failed copy', async () => {
    await copyFixture(false);
    failDurableWrite();
    localStorage.setItem(rock, 'copper');
    localStorage.setItem(rock, 'iron');
    await Promise.resolve();
    expect(sessionStorage.getItem(rock)).toBe('iron');
});

test('legacy copy restores a removal that committed before its snapshot reread failed', async () => {
    const f = await copyFixture(false);
    const read = f.store.snapshot;
    const snapshot = spyOn(f.store, 'snapshot').mockImplementation(() => {
        if (f.store.getItem(rock) === null) throw new Error('reread failed');
        return read();
    });
    try {
        expect(() => replaceScriptSettings('target', 'Miner', {})).toThrow('reread failed');
    } finally {
        snapshot.mockRestore();
    }
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({ [rock]: 'iron' });
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(sessionStorage.getItem(area)).toBeNull();
});

test('legacy copy preserves a peer edit with its notification still queued', async () => {
    const f = await copyFixture(false);
    f.request(f.child, 'setItem', rock, 'copper');
    failDurableWrite();
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({ [rock]: 'copper' });
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(sessionStorage.getItem(area)).toBeNull();
});

test.each(['window', 'instance'])('desktop copy replaces a setting added by another %s before commit', async writer => {
    const f = await copyFixture();
    if (writer === 'window') f.request(f.child, 'setItem', depth, 'deep');
    else f.store.setItem(depth, 'deep');
    copy();
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({ [rock]: 'coal', [area]: 'quarry' });
    expect(sessionStorage.getItem(depth)).toBeNull();
});

test('a cached-only legacy bridge rejects a stale undo value before replacing the key', async () => {
    const f = await copyFixture(false, false);
    f.request(f.child, 'setItem', rock, 'copper');
    expect(copy).toThrow('changed during copy');
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({ [rock]: 'copper' });
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(sessionStorage.getItem(area)).toBeNull();
});

test('conditional removal preserves a peer write between validation and the disk lock', async () => {
    const f = await copyFixture(false);
    const remove = f.store.removeItem;
    f.store.removeItem = (key: string, expected: string) => {
        f.store.setItem(rock, 'copper');
        return remove(key, expected);
    };
    expect(() => replaceScriptSettings('target', 'Miner', {})).toThrow('changed during copy');
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({ [rock]: 'copper' });
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(sessionStorage.getItem(area)).toBeNull();
});

test('legacy rollback preserves a peer removal after the first replacement', async () => {
    const f = await copyFixture(false);
    const swap = f.store.compareAndSet;
    f.store.compareAndSet = (key: string, expected: string | null, value: string) => {
        if (key === area && value === 'quarry') {
            f.store.removeItem(rock);
            throw new Error('quota');
        }
        return swap(key, expected, value);
    };
    expect(copy).toThrow('quota');
    await Promise.resolve();
    expect(f.store.snapshot()).toEqual({});
    expect(sessionStorage.getItem(rock)).toBe('tin');
    expect(sessionStorage.getItem(area)).toBeNull();
});
