import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { createJiti } from 'jiti';

const file = 'src/client/shell/ClientBuild.ts';
const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
const client = resolve('src/client/shell/Client.ts');
load.cache[client] = { id: client, filename: client, loaded: true, exports: { Client: class {} } };
const original = execFileSync('git', ['show', (process.argv[2] ?? 'f7d0f120') + ':' + file], { encoding: 'utf8' });
const Before = load.evalModule(original, { filename: resolve('src/client/shell/ClientBuild.baseline.ts') }).default;
const After = load(resolve(file)).default;
const { Int32Array3d, Uint8Array3d } = load(resolve('src/client/util/Arrays.ts'));

function mapsquare(mixed) {
    const bytes = [];
    for (let level = 0; level < 4; level++) {
        for (let x = 0; x < 64; x++) {
            for (let z = 0; z < 64; z++) {
                const q = x + 3 * z + level;
                bytes.push(82 + q % 20);
                if (q % 8 === 0) bytes.push(6, 4, 50);
                if (mixed && q % 4 === 0) bytes.push(0);
                else bytes.push(1, 2 + q % 35);
            }
        }
    }
    return Uint8Array.from(bytes);
}

function scene(Build) {
    return new Build(104, 104, new Int32Array3d(4, 105, 105), new Uint8Array3d(4, 104, 104));
}

function decode(build, square, i) {
    const x = 3200 + 64 * (i % 8);
    const z = 3200 + 64 * Math.floor(i / 8);
    build.loadGround(square, x, z, 0, 0);
    build.loadGround(square, x, z, 0, 64);
    build.loadGround(square, x, z, 64, 0);
    build.loadGround(square, x, z, 64, 64);
}

const edges = [-2147483648, -1, 0, 1, 2147483647];
for (const x of edges) {
    for (const y of edges) assert.equal(After.noise(x, y), Before.noise(x, y));
}
let seed = 1224;
function coordinate() {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return seed;
}
for (let i = 0; i < 100000; i++) {
    const x = coordinate();
    const y = coordinate();
    assert.equal(After.noise(x, y), Before.noise(x, y));
}
console.log('100025 signed coordinate pairs matched');

function measure(build, square, count) {
    const start = performance.now();
    for (let i = 0; i < count; i++) decode(build, square, i);
    return performance.now() - start;
}

for (const mixed of [true, false]) {
    const square = mapsquare(mixed);
    const before = scene(Before);
    const after = scene(After);
    const label = mixed ? 'mixed' : 'explicit';
    for (let i = 0; i < 61; i++) {
        decode(before, square, i);
        decode(after, square, i);
        for (const field of ['groundh', 'mapl', 'floort1', 'floort2', 'floors', 'floorr']) {
            assert.deepEqual(after[field], before[field], `${label}, origin ${i}, ${field}`);
        }
    }
    console.log(label, square.length * 4, 'bytes/scene, all six arrays matched across 61 origins');
    for (const count of mixed ? [1, 30, 61] : [30]) {
        const samples = new Map([[before, []], [after, []]]);
        for (let i = 0; i < 9; i++) {
            for (const build of i % 2 ? [after, before] : [before, after]) {
                samples.get(build).push(measure(build, square, count));
            }
        }
        const median = build => samples.get(build).sort((a, b) => a - b)[4].toFixed(2);
        console.log(label, count, 'scenes, median ms', median(before), '->', median(after));
    }
}
