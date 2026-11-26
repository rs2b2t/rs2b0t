import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

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
                : name === './shared-storage.cjs' ? { sharedStorage } : require(name)
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
