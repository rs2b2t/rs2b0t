import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { collisionPack } from '../../test/lib/syntheticCollisionPack.ts';

const bundles = process.argv.slice(2);
assert.equal(bundles.length, 2, 'pass the baseline and candidate PathFinder bundles');
const finders = await Promise.all(bundles.map(async file => (await import(pathToFileURL(resolve(file)))).PathFinder));

const start = { x: 3216, z: 3216, level: 0 };
const end = { x: 3184, z: 3184, level: 0 };
const upper = { ...start, level: 1 };
const island = { x: 3188, z: 3188, level: 0 };
const corridor = [];
for (let x = start.x; x >= end.x; x--) corridor.push({ x, z: start.z });
for (let z = start.z - 1; z >= end.z; z--) corridor.push({ x: end.x, z });
const v1 = collisionPack(corridor, [island, { ...island, z: island.z + 1 }]);

const v1Level = 4096 + 512;
const v2Level = v1Level + 2048;
const pack = new Uint8Array(new SharedArrayBuffer(v1.length + 3 * 2048 + v2Level));
pack.set(v1.subarray(0, 10));
pack[4] = 2;
let offset = 10;
for (let i = 10; i < v1.length; i += 3 + v1Level) {
    const duplicate = v1[i] === 50 && v1[i + 1] === 50;
    pack.set([v1[i], v1[i + 1], duplicate ? 3 : 1], offset);
    offset += 3;
    for (let level = 0; level < (duplicate ? 2 : 1); level++) {
        pack.set(v1.subarray(i + 3, i + 3 + v1Level), offset);
        offset += v2Level;
    }
}
assert.equal(offset, pack.length);

function measureConstruction(Finder, count) {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const held = Array.from({ length: count }, () => new Finder(pack));
    const ms = performance.now() - start;
    globalThis.gc();
    const mib = (process.memoryUsage().heapUsed - before) / 2 ** 20;
    for (const finder of held) assert.equal(finder.mapsquares, 3);
    return { ms, mib };
}

function median(samples) {
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3);
}

function pairedSamples(count, measure) {
    const samples = [[], []];
    for (let trial = 0; trial < count; trial++) {
        for (const i of trial % 2 ? [1, 0] : [0, 1]) samples[i].push(measure(i));
    }
    return samples;
}

for (const count of [4, 30, 61]) {
    const samples = pairedSamples(9, i => measureConstruction(finders[i], count));
    console.log(count, 'finders, retained MiB', samples.map(s => median(s.map(r => r.mib))),
        'constructor ms', samples.map(s => median(s.map(r => r.ms))));
}

const routes = [[start, end], [end, start], [end, upper], [start, island]];
const stair = { x: 3212, z: 3216, level: 0 };
const planners = finders.map(Finder => {
    const finder = new Finder(pack);
    finder.addEdges([], [], [{ from: stair, to: { ...stair, level: 1 }, kind: 'stair', locName: 'Staircase', action: 'Climb-up' }]);
    return finder;
});
const results = planners.map(f => routes.map(([from, to]) => f.findPath(from, to)));
assert.deepEqual(results[1], results[0]);
assert.deepEqual(results[0].map(r => r.ok ? r.cost : r.expanded), [63, 63, 69, 83]);
assert.deepEqual(results[0].map(r => r.ok), [true, true, true, false]);

function routeBatch(i) {
    const finder = planners[i];
    const started = performance.now();
    let expanded = 0;
    for (let j = 0; j < 500; j++) {
        const [from, to] = routes[j % routes.length];
        expanded += finder.findPath(from, to).expanded;
    }
    const ms = performance.now() - started;
    assert.equal(expanded, 125 * results[0].reduce((n, r) => n + r.expanded, 0));
    return ms;
}

pairedSamples(5, routeBatch);
console.log(pack.length, 'bytes, matching routes', results[0].map(r => ({ cost: r.cost, expanded: r.expanded })));
console.log('500 searches ms', pairedSamples(15, routeBatch).map(median));
