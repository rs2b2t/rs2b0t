import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { crc32, gzipSync } from 'node:zlib';
import { createJiti } from 'jiti';

const baseline = process.argv[2];
assert.ok(baseline, 'pass the baseline revision');
globalThis.BroadcastChannel = undefined;
globalThis.Worker = class {
    channel = new MessageChannel();
    postMessage(message) { this.channel.port1.postMessage(message); }
};
const load = createJiti(import.meta.url, { fsCache: false, alias: { '#': resolve('src') } });

function source(name, revision) {
    const file = `src/client/io/${name}.ts`;
    const code = revision ? execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
    return (extra = '') => load.evalModule(code + extra, { filename: resolve(file) });
}

function revision(rev) {
    const Loader = source('OnDemand', rev)().default;
    const worker = source('OnDemandWorker', rev);
    return Array.from({ length: 61 }, () => {
        const scope = {
            addEventListener(_, listener) { this.receive = listener; },
            postMessage(data) {
                if (data.type === 'error') throw Error(data.error);
                if (data.type === 'completed') this.loader.worker.onmessage({ data });
            }
        };
        globalThis.self = scope;
        const { queued, drain } = worker('\nexport const queued = () => messageQueue; export const drain = () => onDemand.handleQueue();');
        return { Loader, scope, queued, drain };
    });
}

function result(value) {
    const request = { result: value };
    queueMicrotask(() => request.onsuccess());
    return request;
}

const cache = new Map();
const cacheStore = { get: key => result(cache.get(key)?.slice()) };
const db = { close() {}, transaction: () => ({ objectStore: () => cacheStore }) };
globalThis.indexedDB = { open: () => result(db) };

function fixture(count) {
    const versions = Buffer.alloc(2 * count);
    const crcs = Buffer.alloc(4 * count);
    for (let id = 0; id < count; id++) {
        const gzip = gzipSync(Uint8Array.of(id, 255 - id));
        versions.writeUInt16BE(1, 2 * id);
        crcs.writeUInt32BE(crc32(gzip), 4 * id);
        cache.set(`2.${id}`, new Uint8Array(Buffer.concat([gzip, Buffer.from([0, 1])])));
    }
    return { read: name => name === 'anim_version' ? versions : name === 'anim_crc' ? crcs : new Uint8Array() };
}

function deliver(scope) {
    const port = scope.loader.worker.channel.port2;
    let count = 0;
    for (let packet; (packet = receiveMessageOnPort(port)); count++) scope.receive({ data: packet.message });
    return count;
}

async function sample(clients, versionlist, count, duplicate, batched) {
    for (const { Loader, scope, queued } of clients) {
        scope.loader = new Loader(versionlist, { ingame: false, db: true });
        deliver(scope);
        await queued();
    }
    const start = performance.now();
    for (const { scope } of clients) {
        const loader = scope.loader;
        for (let pass = 0; pass < (duplicate ? 2 : 1); pass++) {
            if (batched) {
                loader.requestStartupFiles(1);
            } else {
                const end = loader.getFileCount(1);
                for (let id = 0; id < end; id++) loader.request(1, id);
            }
        }
        if (duplicate) {
            loader.request(1, -1);
            loader.request(1, count);
        }
    }
    const posts = clients.map(({ scope }) => deliver(scope));
    await Promise.all(clients.map(client => client.queued()));
    const ms = performance.now() - start;
    for (const n of posts) assert.equal(n, batched ? Math.ceil(count / 32) : count);
    for (const { scope, drain, queued } of clients) {
        const loader = scope.loader;
        assert.equal(loader.remaining(), count);
        await drain();
        for (let id = 0; id < count; id++) {
            const req = loader.loop();
            assert.equal(req.archive, 1);
            assert.equal(req.file, id);
            assert.equal(req.urgent, true);
            assert.deepEqual(req.data, Uint8Array.of(id, 255 - id));
        }
        assert.equal(loader.loop(), null);
        assert.equal(loader.remaining(), 0);
        scope.receive({ data: { type: 'stop' } });
        await queued();
        loader.worker.channel.port1.close();
        loader.worker.channel.port2.close();
    }
    return { ms, messages: posts.reduce((sum, n) => sum + n, 0) };
}

const revisions = [revision(baseline), revision()];
const run = (i, clients, files, count, duplicate) => sample(revisions[i].slice(0, clients), files, count, duplicate, i === 1);
for (const clients of [30, 61]) {
    const files = fixture(256);
    const times = [[], []];
    const messages = [];
    for (let pair = 0; pair < 12; pair++) {
        for (const i of pair % 2 ? [1, 0] : [0, 1]) {
            const result = await run(i, clients, files, 256, false);
            messages[i] = result.messages;
            if (pair >= 3) times[i].push(result.ms);
        }
    }
    console.log(clients, 'clients, median ms', times.map(t => t.sort((a, b) => a - b)[4].toFixed(2)).join(' -> '), 'messages', messages.join(' -> '));
}
const files = fixture(35);
for (const i of [0, 1]) {
    const { messages } = await run(i, 61, files, 35, true);
    console.log(i ? 'batched' : 'baseline', '61 clients, 35 completions each, duplicate and out-of-range inputs, messages', messages);
}
