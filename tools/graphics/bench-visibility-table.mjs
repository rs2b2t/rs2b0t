import assert from 'node:assert/strict';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import Pix3D from '#/client/dash3d/Pix3D.js';
import { installVisibilityTableCache } from '#/client/dash3d/VisibilityTable.js';

const distances = Int32Array.from({ length: 9 }, (_, i) => {
    const angle = i * 32 + 143;
    return ((angle * 3 + 600) * Pix3D.sinTable[angle]) >> 16;
});
const startup = [distances, 500, 800, 512, 334];

function mountWall() {
    const wall = Object.create(null);
    installVisibilityTableCache(wall);
    Object.defineProperty(window, 'parent', { configurable: true, value: wall });
}

async function loadClients(source) {
    const clients = [];
    for (let i = 0; i < 61; i++) {
        const url = pathToFileURL(source);
        url.searchParams.set('client', i);
        clients.push((await import(url.href)).default);
    }
    return clients;
}

function sample(clients) {
    mountWall();
    const start = performance.now();
    for (const client of clients) client.resetVisCalc(...startup);
    const ms = performance.now() - start;
    assert.ok(clients.every(client => client.visBacking === clients[0].visBacking));
    return ms;
}

function median(samples) {
    samples.sort((a, b) => a - b);
    return (samples[5] + samples[6]) / 2;
}

const before = await loadClients(argv[2]);
const after = await loadClients('src/client/dash3d/World.ts');
const fixtures = [startup, [distances, 500, 800, 640, 334], [distances, 500, 800, 512, 480], [distances, 250, 800, 512, 334], [distances, 500, 400, 512, 334], [distances.with(8, 0), 500, 800, 512, 334]];
for (const args of fixtures) {
    for (const client of [before[0], after[0]]) {
        mountWall();
        client.resetVisCalc(...args);
    }
    assert.deepEqual(after[0].visBacking, before[0].visBacking);
    const cells = after[0].visBacking.flat(3);
    const visible = cells.filter(value => value === true).length;
    assert.equal(cells.length, 665856);
    if (args === startup) assert.equal(visible, 153696);
    console.log(`Matched ${cells.length} cells, ${visible} visible`);
}

for (const size of [30, 61]) {
    const groups = [before.slice(0, size), after.slice(0, size)];
    const samples = [[], []];
    for (let pair = 0; pair < 14; pair++) {
        for (const index of pair % 2 === 0 ? [0, 1] : [1, 0]) {
            const ms = sample(groups[index]);
            if (pair >= 2) samples[index].push(ms);
        }
    }
    console.log(`${size} clients: ${samples.map(times => median(times).toFixed(2)).join(' -> ')} ms (median)`);
}
