import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

const file = 'src/client/dash3d/Model.ts';
const load = createJiti(import.meta.url, { fsCache: false, alias: { '#': resolve('src') } });
const original = execFileSync('git', ['show', 'd29d100c:' + file], { encoding: 'utf8' });
const Before = load.evalModule(original, { filename: resolve('src/client/dash3d/Model.baseline.ts') }).default;
const After = load(resolve(file)).default;
const scratch = ['tmpVertexX', 'tmpVertexY', 'tmpVertexZ', 'tempFTran'];
const fields = ['pointX', 'pointY', 'pointZ', 'faceAlpha'];

function actor(i, profile) {
    const src = new After();
    src.numPoints = 384 + 16 * i;
    src.numFaces = 512 + 24 * i;
    const length = src.numPoints + (i % 2) * 64;
    const seed = 1009 * profile + 37 * i;
    src.pointX = Int32Array.from({ length }, (_, v) => seed - v);
    src.pointY = src.pointX.map(x => x * 3 + 1);
    src.pointZ = src.pointX.map(x => 2 - x);
    if (i % 3 !== 2) src.faceAlpha = Int32Array.from({ length: src.numFaces }, (_, f) => (seed + f) & 255);
    return { src, share: i % 3 === 0 };
}

function compare({ src, share }) {
    const saved = fields.map(key => src[key]?.slice() ?? null);
    for (const version of [Before, After]) {
        const tmp = version.tempModel;
        tmp.set(src, share);
        assert.equal(tmp.faceAlpha, share ? src.faceAlpha : version.tempFTran);
        for (let i = 0; i < 3; i++) assert.equal(tmp[fields[i]], version[scratch[i]]);
    }
    for (const key of scratch) assert.deepEqual(After[key], Before[key]);
    fields.forEach((key, i) => assert.deepEqual(src[key], saved[i]));
}

const actors = Array.from({ length: 61 * 12 }, (_, i) => actor(i % 12, Math.floor(i / 12)));
for (const version of [Before, After]) {
    scratch.forEach((key, i) => version[key].fill(-100 - i));
}
actors.forEach(compare);
console.log(actors.length, 'actor calls matched');

function measure(version, batch, passes) {
    const tmp = version.tempModel;
    const start = performance.now();
    for (let pass = 0; pass < passes; pass++) {
        for (const { src, share } of batch) tmp.set(src, share);
    }
    return (performance.now() - start) * 1000 / passes;
}

for (const profiles of [1, 30, 61]) {
    const batch = actors.slice(0, profiles * 12);
    const passes = profiles === 1 ? 4096 : 128;
    const samples = new Map([[Before, []], [After, []]]);
    for (const version of samples.keys()) measure(version, batch, passes);
    for (let i = 0; i < 11; i++) {
        for (const version of i % 2 ? [After, Before] : [Before, After]) {
            samples.get(version).push(measure(version, batch, passes));
        }
    }
    const median = version => samples.get(version).sort((a, b) => a - b)[5].toFixed(2);
    console.log(profiles, 'profiles, median us/pass', median(Before), '->', median(After));
}

const large = actor(112, 0);
compare(large);
large.src.numFaces -= 100;
large.src.numPoints -= 100;
compare(large);
large.src.pointX = large.src.pointX.subarray(0, large.src.numPoints - 1);
large.src.faceAlpha = large.src.faceAlpha.subarray(0, large.src.numFaces - 1);
compare(large);
for (const share of [false, true]) compare({ src: new After(), share });
console.log('growth, oversized and short sources, empty models matched');
