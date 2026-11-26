import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { createJiti } from 'jiti';

const file = 'src/client/dash3d/CollisionMap.ts';
const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
const source = execFileSync('git', ['show', (process.argv[2] ?? 'f9bc53fd') + ':' + file], { encoding: 'utf8' });
const Before = load.evalModule(source, { filename: resolve('src/client/dash3d/CollisionMap.baseline.ts') }).default;
const { default: After, BuildArea } = load(resolve(file));
const { LocShape } = load('#/client/dash3d/LocShape.js');
const { canReachLocal } = load('#/bot/event/webwalk/geometry/localReach.js');

const scene = new Before();
const clean = scene.flags.slice();
for (let i = 0; i < 32; i++) {
    const x = 8 + 2 * i;
    const z = 18 + i;
    scene.addWall(x, z, LocShape.WALL_STRAIGHT, i % 4, true);
    scene.addLoc(x, z + 5, 2, 3, i % 4, true);
    scene.blockGround(x, z + 10);
}
for (let i = 0; i < BuildArea.SIZE; i++) {
    const end = BuildArea.SIZE - 1;
    for (const [x, z] of [[0, i], [end, i], [i, 0], [i, end]]) scene.flags[Before.index(x, z)] = 0;
}
const dirty = scene.flags;
assert.equal(dirty.filter((flag, i) => flag !== clean[i]).length, 685);

function routes(map) {
    const flags = (x, z) => x >= 0 && z >= 0 && x < map.sizeX && z < map.sizeZ ? map.flags[Before.index(x, z)] : null;
    return [[70, 58], [70, 59], [0, 52]].map(([lx, lz]) =>
        canReachLocal(flags, { lx: 6, lz: 18 }, { lx, lz }, { maxSteps: clean.length })
    );
}

for (const MapType of [Before, After]) {
    const map = new MapType();
    const original = map.flags;
    assert.deepEqual(original, clean);
    original.set(dirty);
    assert.deepEqual(routes(map), [true, false, true]);
    for (let i = 0; i < 2; i++) {
        map.reset();
        assert.equal(map.flags, original);
        assert.deepEqual(map.flags, clean);
        assert.deepEqual(routes(map), [true, true, false]);
    }
}

function batch(MapType, count) {
    const maps = Array.from({ length: count * BuildArea.LEVELS }, () => new MapType());
    const samples = [];
    return {
        run(measured) {
            for (const map of maps) map.flags.set(dirty);
            const start = performance.now();
            for (const map of maps) map.reset();
            const elapsed = performance.now() - start;
            for (const map of maps) assert.deepEqual(map.flags, clean);
            if (measured) samples.push(elapsed);
        },
        median() {
            return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3);
        }
    };
}

for (const count of [30, 61]) {
    const before = batch(Before, count);
    const after = batch(After, count);
    for (let pair = 0; pair < 38; pair++) {
        for (const sweep of pair % 2 ? [after, before] : [before, after]) sweep.run(pair >= 7);
    }
    console.log(count, 'clients, median ms', before.median(), '->', after.median());
}
