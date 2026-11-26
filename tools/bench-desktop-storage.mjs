import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { argv } from 'node:process';
import { deserialize, serialize } from 'node:v8';
import { compileFunction } from 'node:vm';

const require = createRequire(import.meta.url);
function load(revision, name) {
    const path = `desktop/${name}.cjs`;
    const source = revision ? execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' }) : readFileSync(path, 'utf8');
    return compileFunction(source, ['require', 'module', 'process'], { filename: path });
}
const revisions = [argv[2] ?? 'HEAD', null].map(ref => ({
    session: load(ref, 'storage-session'), preload: load(ref, 'preload')
}));
const copy = value => deserialize(serialize(value));

async function sample({ session, preload }, profiles) {
    const keys = Array.from({ length: profiles * 8 }, (_, i) =>
        `rs2b0t:p${String(Math.floor(i / 8)).padStart(2, '0')}:set:Demo:k${i % 8}`);
    const data = Object.fromEntries(keys.map(key => [key, 'off']));
    const store = { initialized: () => true, snapshot: () => ({ ...data }), setItem: (key, value) => { data[key] = value; } };
    const ipcMain = new EventEmitter();
    const module = { exports: {} };
    session(name => {
        if (name === 'electron') return { ipcMain };
        if (name === './shared-storage.cjs') return { sharedStorage: () => store };
        if (name === 'node:fs') return { mkdirSync() {}, mkdtempSync: () => '/fixture', watch() {} };
        return require(name);
    }, module, { env: {} });
    const app = Object.assign(new EventEmitter(), { getPath: () => '/fixture', setPath() {} });
    const url = 'https://storage.invalid';
    await module.exports.prepareStorage(app).start(url);

    let peerBytes = 0;
    let messages = 0;
    const frames = Array.from({ length: profiles + 1 }, () => {
        const ipcRenderer = new EventEmitter();
        const sender = new EventEmitter();
        const senderFrame = {
            url, isDestroyed: () => false,
            send(channel, update) {
                const bytes = serialize(update);
                peerBytes += bytes.length;
                messages++;
                ipcRenderer.emit(channel, {}, deserialize(bytes));
            }
        };
        ipcRenderer.sendSync = (channel, ...args) => {
            const event = { sender, senderFrame };
            ipcMain.emit(channel, event, ...copy(args));
            return copy(event.returnValue);
        };
        let api;
        preload(() => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_, bridge) => { api = bridge; } } }), {}, {});
        const events = [];
        api.subscribe((...event) => events.push(event));
        return { api, events };
    });
    const writes = keys.filter((_, i) => i % 8 === 0);
    const start = performance.now();
    for (const key of writes) frames[0].api.setItem(key, 'on');
    await Promise.resolve();
    const ms = performance.now() - start;

    const expectedEvents = writes.map(key => [key, 'off', 'on']);
    const values = keys.map((_, i) => i % 8 === 0 ? 'on' : 'off');
    for (const { api, events } of frames) {
        assert.deepEqual(api.keys(), keys);
        assert.deepEqual(keys.map(key => api.getItem(key)), values);
        assert.deepEqual(events, expectedEvents);
    }
    assert.equal(messages, profiles ** 2);
    return { ms, peerBytes, messages, notifications: frames.reduce((sum, frame) => sum + frame.events.length, 0) };
}

for (const profiles of [30, 61]) {
    const samples = [[], []];
    for (let pair = 0; pair < 8; pair++) {
        for (const i of pair % 2 ? [1, 0] : [0, 1]) {
            const result = await sample(revisions[i], profiles);
            if (pair) samples[i].push(result);
        }
    }
    const [baseline, patched] = samples.map(runs => runs.sort((a, b) => a.ms - b.ms)[3]);
    console.log({ profiles, baseline, patched });
    if (profiles === 61) assert.ok(patched.peerBytes < 300_000);
}
