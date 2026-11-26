import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

const file = 'src/client/shell/ClientBuild.ts';
const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
const client = resolve('src/client/shell/Client.ts');
load.cache[client] = { id: client, filename: client, loaded: true, exports: { Client: class {} } };
const original = execFileSync('git', ['show', (process.argv[2] ?? '6415b87a') + ':' + file], { encoding: 'utf8' });
const Before = load.evalModule(original, { filename: resolve('src/client/shell/ClientBuild.baseline.ts') }).default;
const After = load(resolve(file)).default;
const { Int32Array3d, Uint8Array3d } = load(resolve('src/client/util/Arrays.ts'));

const square = new Uint8Array(4 * 64 * 64 * 6);
for (let i = 0; i < square.length / 6; i++) {
    square.set([2 + i % 48, i % 256, 50 + i % 32, 82 + i % 173, 1, i % 251], i * 6);
}

function terrain() {
    return [new Int32Array3d(4, 105, 105), new Uint8Array3d(4, 104, 104)];
}

function decode(Build, [heights, flags]) {
    const build = new Build(104, 104, heights, flags);
    build.loadGround(square, 0, 0, 20, 20);
    return build;
}

const before = decode(Before, terrain());
const after = decode(After, terrain());
const grids = ['floort1', 'floort2', 'floors', 'floorr', 'mapo', 'shadow', 'lightmap'];
for (const key of ['groundh', 'mapl', ...grids]) {
    assert.deepEqual([...after[key]], [...before[key]], key);
}
for (const key of ['huetot', 'sattot', 'ligtot', 'comtot', 'tot']) {
    assert.deepEqual(after[key], before[key], key);
}

function rowsOf(build, key) {
    return key === 'lightmap' ? build[key] : build[key].flat();
}

function layout(build) {
    const buffers = new Set();
    let rows = 0;
    for (const key of grids) {
        const field = rowsOf(build, key);
        const gridBuffers = new Set(field.map(row => row.buffer));
        if (build === after) assert.equal(gridBuffers.size, 1, key);
        for (const buffer of gridBuffers) buffers.add(buffer);
        rows += field.length;
    }
    const bytes = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
    return { rows, bytes, buffers: buffers.size };
}

assert.deepEqual(layout(before), { rows: 2609, bytes: 437656, buffers: 2609 });
assert.deepEqual(layout(after), { rows: 2609, bytes: 437656, buffers: 7 });

for (const build of [before, after]) {
    let index = 0;
    for (const key of grids) {
        for (const row of rowsOf(build, key)) {
            row.fill(++index % 251);
            row[0] = index & 255;
            row[1] = index >>> 8;
        }
    }
}
for (const key of grids) assert.deepEqual([...after[key]], [...before[key]], key);
console.log('Decoded cells and row writes match. Scratch grids: 2609 rows, 437656 bytes, 2609 -> 7 buffers.');

for (const count of [30, 61]) {
    const clients = new Map([Before, After].map(Build => [Build, Array.from({ length: count }, terrain)]));
    const times = new Map([[Before, []], [After, []]]);
    for (let batch = 0; batch < 14; batch++) {
        for (const Build of batch % 2 ? [After, Before] : [Before, After]) {
            const start = performance.now();
            for (const input of clients.get(Build)) decode(Build, input);
            const elapsed = performance.now() - start;
            if (batch >= 3) times.get(Build).push(elapsed);
        }
    }
    const median = Build => times.get(Build).sort((a, b) => a - b)[5].toFixed(2);
    console.log(count, 'clients, median ms', median(Before), '->', median(After));
}
