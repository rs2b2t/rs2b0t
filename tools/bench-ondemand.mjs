import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const loaders = await Promise.all(process.argv.slice(2).map(async path => (await import(pathToFileURL(resolve(path)))).default));
assert.equal(loaders.length, 2, 'pass the baseline and patched OnDemand bundles');

const requests = Array.from({ length: 512 }, (_, file) => ({ type: 'request', archive: 1, file }));
const events = requests.map(({ archive, file }) => ({ data: { type: 'completed', archive, file, urgent: true, data: null } }));
const versions = Uint8Array.from({ length: requests.length * 2 }, (_, i) => i % 2);
const versionlist = {
    read(name) {
        if (name === 'anim_version') return versions;
        return new Uint8Array(name === 'anim_crc' ? requests.length * 4 : 0);
    }
};

globalThis.Worker = class {
    posts = [];
    postMessage(message) {
        if (message.type !== 'init') this.posts.push(message);
    }
};

function sample(Loader, clients, countVisits = false) {
    const batch = Array.from({ length: clients }, () => ({
        loader: new Loader(versionlist, { ingame: false }), remaining: [], completed: []
    }));
    let visits = 0;
    if (countVisits) {
        for (const { loader } of batch) {
            for (const method of ['head', 'next']) {
                const list = loader.requests;
                const original = list[method];
                list[method] = () => {
                    const node = original.call(list);
                    if (node) visits++;
                    return node;
                };
            }
        }
    }

    const start = performance.now();
    for (const { loader, remaining, completed } of batch) {
        for (const { archive, file } of requests) loader.request(archive, file);
        remaining.push(loader.remaining());
        for (const event of events) loader.worker.onmessage(event);
        remaining.push(loader.remaining());
        for (let req = loader.loop(); req; req = loader.loop()) completed.push(req);
        remaining.push(loader.remaining());
    }
    const ms = performance.now() - start;

    for (const { loader, remaining, completed } of batch) {
        assert.deepEqual(loader.worker.posts, requests);
        assert.deepEqual(remaining, [512, 512, 0]);
        assert.equal(completed.length, requests.length);
        completed.forEach((req, i) => {
            assert.equal(req.archive, 1);
            assert.equal(req.file, i);
            assert.equal(req.urgent, true);
            assert.equal(req.data, null);
        });
    }
    return { ms, visits };
}

for (const clients of [30, 61]) {
    const times = [[], []];
    for (let pair = 0; pair < 15; pair++) {
        for (const i of pair % 2 ? [1, 0] : [0, 1]) {
            const { ms } = sample(loaders[i], clients);
            if (pair >= 4) times[i].push(ms);
        }
    }
    const medians = times.map(samples => samples.sort((a, b) => a - b)[5].toFixed(2));
    console.log(clients, 'clients, median ms', ...medians);
}
console.log('lookup visits per client', ...loaders.map(Loader => sample(Loader, 1, true).visits));
