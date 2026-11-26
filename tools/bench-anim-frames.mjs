import assert from 'node:assert/strict';
import process from 'node:process';
import AnimFrame from '../src/client/dash3d/AnimFrame.ts';
import Model from '../src/client/dash3d/Model.ts';

const frames = 11229;
const records = 242631;
const types = [0, 1, 2, 3, 5];
const word = n => [n >> 8, n & 255];

function archive(first, count) {
    const head = [];
    const flags = [];
    const values = [];
    const delays = [];
    for (let id = first; id < first + count; id++) {
        const groups = 21 + Number(id < records % frames);
        head.push(...word(id * 2), groups);
        delays.push(id % 9);
        for (let g = 0; g < groups; g++) {
            const type = types[g % types.length];
            let flag = type === 5 ? 1 : 1 << ((g + id) % 3);
            if (type === 0 && g + 1 < groups) flag = 0;
            flags.push(flag);
            if (flag) {
                const delta = (id + g) % 19 - 9;
                if (type === 3) values.push(...word(0xc000 + 128 + delta));
                else values.push(64 + delta);
            }
        }
    }
    const base = [22, ...Array.from({ length: 22 }, (_, g) => types[g % types.length])];
    for (let g = 0; g < 22; g++) base.push(1, g % 8);
    return Uint8Array.from([...word(count), ...head, ...flags, ...values, ...delays, ...base, ...[head, flags, values, delays].flatMap(section => word(section.length))]);
}

const archives = [];
for (let i = 0; i < frames; i += 64) archives.push(archive(i, Math.min(64, frames - i)));

function memory() {
    globalThis.gc();
    globalThis.gc();
    return process.memoryUsage();
}

const catalogs = Number(process.argv[2] || 1);
assert([1, 30, 61].includes(catalogs));
const initial = memory();
const tables = [];
for (let n = 1; n <= catalogs; n++) {
    AnimFrame.init(2 * frames - 1);
    for (const bytes of archives) AnimFrame.unpack(bytes);
    tables.push([AnimFrame.list, AnimFrame.opaque]);
    if ([1, 30, 61].includes(n)) {
        const usage = memory();
        const deltaMiB = key => ((usage[key] - initial[key]) / 2 ** 20).toFixed(2);
        console.log(n, 'catalogs, retained MiB', { heap: deltaMiB('heapUsed'), buffers: deltaMiB('arrayBuffers') });
    }
}
for (const [list] of tables) assert.equal(list.reduce((sum, frame) => sum + frame.size, 0), records);

const columns = ['ti', 'tx', 'ty', 'tz'];
let transformsHash = 2166136261;
for (const frame of AnimFrame.list) {
    if (!frame) continue;
    for (let i = 0; i < frame.size; i++) {
        for (let axis = 0; axis < 4; axis++) {
            const value = frame.transforms ? frame.transforms[4 * i + axis] : frame[columns[axis]][i];
            transformsHash = Math.imul(transformsHash ^ value, 16777619);
        }
    }
}
assert.equal(transformsHash >>> 0, 2092929264);
console.log('transform digest', transformsHash >>> 0);

const x = Int32Array.from({ length: 32 }, (_, i) => i * 3 - 17);
const y = x.map(v => 10 - v);
const z = x.map(v => v * 2);
const model = new Model();
model.pointX = x.slice();
model.pointY = y.slice();
model.pointZ = z.slice();
model.faceAlpha = new Int32Array(8);
model.labelVertices = Array.from({ length: 8 }, (_, i) => Int32Array.of(i, i + 8, i + 16, i + 24));
model.labelFaces = Array.from({ length: 8 }, (_, i) => Int32Array.of(i));
const mask = Int32Array.of(1, 3, 4, 8, 13, 16, 19, 999);

function sweep(blended, check) {
    let hash = 2166136261;
    for (let i = 0; i < frames; i++) {
        model.pointX.set(x);
        model.pointY.set(y);
        model.pointZ.set(z);
        model.faceAlpha.fill(100);
        if (blended) model.maskAnimate(i * 2, ((i + 1) % frames) * 2, mask);
        else model.animate(i * 2);
        if (check) {
            for (const axis of [model.pointX, model.pointY, model.pointZ, model.faceAlpha]) {
                for (const value of axis) hash = Math.imul(hash ^ value, 16777619);
            }
        }
    }
    return hash >>> 0;
}

for (const blended of [false, true]) {
    const digest = sweep(blended, true);
    assert.equal(digest, blended ? 3489605551 : 2376993663);
    for (let i = 0; i < 3; i++) sweep(blended, false);
    const samples = [];
    for (let i = 0; i < 9; i++) {
        const start = performance.now();
        sweep(blended, false);
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(blended ? 'maskAnimate' : 'animate', { poses: frames, digest, medianMs: samples[4].toFixed(2) });
}
