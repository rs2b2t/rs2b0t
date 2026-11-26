import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const count = Number(argv[3]);
assert.ok([30, 61].includes(count), 'Usage: bun tools/bench-roster-selections.mjs <baseline directory> <30|61>');
const profiles = Array.from({ length: count }, (_, i) => ({ username: 'p' + i, tab: 'Main', world: 1 }));
const data = {};
const expected = profiles.map(({ username }, i) => {
    for (let j = 0; j < 8; j++) data[`rs2b0t:${username}:set:Miner:k${j}`] = 'x'.repeat(24);
    if (i % 4 === 0) return '';
    const value = i % 2 ? 'NatureCrafter' : 'Fisher';
    data[`rs2b0t:${username}:selectedScript`] = value;
    return value === 'NatureCrafter' ? 'JiveRC' : value;
});
let file = JSON.stringify({ initialized: true, data });

async function fixture(root) {
    let reads = 0, calls = 0;
    const fs = { mkdirSync() {}, mkdtempSync: () => '/fixture', watch() {}, readFileSync() { reads++; return file; } };
    const ipcMain = new EventEmitter();
    const ipcRenderer = new EventEmitter();
    const url = 'https://roster.invalid';
    const frame = { url, isDestroyed: () => false };
    const sender = new EventEmitter();
    ipcRenderer.sendSync = (channel, ...args) => {
        calls++;
        const event = { senderFrame: frame, sender };
        ipcMain.emit(channel, event, ...args);
        return event.returnValue;
    };
    let bridge;
    const electron = { ipcMain, ipcRenderer, contextBridge: { exposeInMainWorld: (_, api) => { bridge = api; } } };
    function load(name) {
        const path = resolve(root, 'desktop', name);
        const module = { exports: {} };
        runInNewContext(readFileSync(path, 'utf8'), {
            module, URL, process: { env: {} },
            require(id) {
                if (id === 'node:fs') return fs;
                if (id === 'electron') return electron;
                if (id === './shared-storage.cjs') return load('shared-storage.cjs');
                return require(id);
            }
        }, { filename: path });
        return module.exports;
    }
    const app = Object.assign(new EventEmitter(), { getPath: () => '/fixture', setPath() {} });
    await load('storage-session.cjs').prepareStorage(app).start(url);
    load('preload.cjs');
    globalThis.rs2b0tDesktopStorage = bridge;
    const { RosterActions } = await import(resolve(root, 'src/bot/multibox/RosterActions.ts'));
    const actions = new RosterActions({ profiles: () => profiles, client: () => null });
    return () => {
        globalThis.localStorage = bridge;
        reads = calls = 0;
        const start = performance.now();
        const catalog = actions.scriptCatalog?.(profiles);
        const scripts = catalog?.scripts ?? actions.scripts();
        const labels = profiles.map(p => actions.selectedScript(p, catalog?.selections));
        const ms = performance.now() - start;
        assert.deepEqual(labels, expected);
        assert.deepEqual(scripts, ['Miner', ...new Set(expected.filter(Boolean))].sort());
        return { ms, calls, reads };
    };
}

globalThis.sessionStorage = { length: 0 };
const revisions = [await fixture(argv[2]), await fixture('.')];
const samples = [[], []];
for (let pair = 0; pair < 111; pair++) {
    expected[1] = pair % 2 ? 'CraftA' : 'CraftB';
    data['rs2b0t:p1:selectedScript'] = expected[1];
    file = JSON.stringify({ initialized: true, data });
    for (const i of pair % 2 ? [1, 0] : [0, 1]) {
        const { ms, calls, reads } = revisions[i]();
        assert.equal(calls, i ? 1 : 2 * count);
        assert.equal(reads, calls);
        if (pair >= 10) samples[i].push(ms);
    }
}
const medianMs = samples.map(times => times.sort((a, b) => a - b)[50].toFixed(3));
console.log({ profiles: count, bytes: Buffer.byteLength(file), pairs: 101, readsPerRefresh: [2 * count, 1], medianMs });
