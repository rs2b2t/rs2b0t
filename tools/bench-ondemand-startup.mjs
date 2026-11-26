import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { createJiti } from 'jiti';

const baseline = process.argv[2];
assert.ok(baseline, 'pass the baseline revision');
globalThis.self = { addEventListener() {}, postMessage() {} };
globalThis.BroadcastChannel = undefined;
const { port1, port2 } = new MessageChannel();
globalThis.Worker = class {
    postMessage(...args) { port1.postMessage(...args); }
};

function constructors(revision) {
    const load = createJiti(import.meta.url, { fsCache: false, alias: { '#': resolve('src') } });
    function compile(name, extra = '') {
        const file = `src/client/io/${name}.ts`;
        const source = revision ? execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
        return load.evalModule(source + extra, { filename: resolve(file) }).default;
    }
    return { Loader: compile('OnDemand'), Receiver: compile('OnDemandWorker', '\nexport default WorkerOnDemand;') };
}

const revisions = [constructors(baseline), constructors()];
const counts = [4096, 512, 256, 1024];
const archives = ['model', 'anim', 'midi', 'map'];
const files = new Map();
for (const [a, count] of counts.entries()) {
    const versions = Buffer.alloc(2 * count);
    const crcs = Buffer.alloc(4 * count);
    for (let i = 0; i < count; i++) {
        versions.writeUInt16BE((a + i * 65535) & 0xffff, i * 2);
        crcs.writeInt32BE(Math.imul(i + a, 0x89abcdef), i * 4);
    }
    files.set(archives[a] + '_version', versions);
    files.set(archives[a] + '_crc', crcs);
}
files.get('model_crc').writeInt32BE(-873187034, 4);
const versionlist = { read: name => files.get(name) };
const payload = Buffer.from('123456789\xff\xff', 'latin1');

function verify(loader, receiver) {
    assert.equal(receiver.versions.length, counts.length);
    assert.equal(receiver.crcs.length, counts.length);
    for (const [a, count] of counts.entries()) {
        const versions = files.get(archives[a] + '_version');
        const crcs = files.get(archives[a] + '_crc');
        assert.equal(receiver.versions[a].length, count);
        assert.equal(receiver.crcs[a].length, count);
        for (let i = 0; i < count; i++) {
            assert.equal(receiver.versions[a][i], versions.readUInt16BE(i * 2));
            assert.equal(receiver.crcs[a][i], crcs.readInt32BE(i * 4));
        }
    }
    assert.equal(receiver.validFile(0, 0), false);
    assert.equal(receiver.validFile(0, 1), true);
    const validate = bytes => receiver.validate(bytes, receiver.crcs[0][1], receiver.versions[0][1]);
    assert.equal(validate(payload), true);
    for (const offset of [0, payload.length - 1]) {
        const altered = Buffer.from(payload);
        altered[offset] ^= 1;
        assert.equal(validate(altered), false);
    }
    receiver.versions[0][1] = receiver.crcs[0][1] = 0;
    assert.equal(loader.versions[0][1], 65535);
    assert.equal(loader.crcs[0][1], -873187034);
}

function sample({ Loader, Receiver }, clients) {
    const batch = [];
    const start = performance.now();
    for (let i = 0; i < clients; i++) {
        const loader = new Loader(versionlist, { ingame: false });
        const receiver = new Receiver(receiveMessageOnPort(port2).message);
        batch.push([loader, receiver]);
    }
    const elapsed = performance.now() - start;
    for (const [loader, receiver] of batch) verify(loader, receiver);
    return elapsed;
}

for (const clients of [30, 61]) {
    const times = [[], []];
    for (let pair = 0; pair < 15; pair++) {
        for (const i of pair % 2 ? [1, 0] : [0, 1]) {
            const elapsed = sample(revisions[i], clients);
            if (pair >= 4) times[i].push(elapsed);
        }
    }
    const medians = times.map(values => values.sort((a, b) => a - b)[5].toFixed(2));
    console.log(clients, 'clients, median ms', medians.join(' -> '), '(5888 pairs verified per client)');
}
port1.close();
port2.close();
