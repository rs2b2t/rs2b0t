import assert from 'node:assert/strict';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import '../../test/setup-dom.ts';
import { registerSilentAudio } from '../../test/client/shell/fixtures/silentAudio.ts';
import Pix3D from '../../src/client/dash3d/Pix3D.ts';
import Pix8 from '../../src/client/graphics/Pix8.ts';

registerSilentAudio();
globalThis.BroadcastChannel = undefined;
const { Client: Before } = await import(pathToFileURL(argv[2]));
const { Client: After } = await import('../../src/client/shell/Client.ts');

const ids = [17, 24];
const texels = ids.map(id => Int32Array.of(id));

function fixture(Client, seed, { widths = [128, 128], scratch = widths[0] ** 2, shared, missing } = {}) {
    const textures = [];
    for (const [i, id] of ids.entries()) {
        if (id !== missing) textures[id] = new Pix8(widths[i], widths[i], new Int32Array(0));
    }
    const textureBuffer = shared ? new Int8Array(scratch + 1).subarray(1) : new Int8Array(scratch);
    if (shared) textures[17].data = new Int8Array(textureBuffer.buffer, 0, scratch);
    const buffers = [textureBuffer, ...ids.filter(id => textures[id]).map(id => textures[id].data)];
    for (const buffer of buffers) {
        for (let i = 0; i < buffer.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            buffer[i] = seed >>> 24;
        }
    }
    const client = Object.assign(Object.create(Client.prototype), { textureBuffer, worldUpdateNum: 1 });
    return { client, textures, buffers, active: [], pool: [null, null] };
}

function frame(state) {
    Pix3D.textures = state.textures;
    Pix3D.activeTexels = state.active;
    Pix3D.texelPool = state.pool;
    Pix3D.poolSize = 0;
    state.pool.fill(null);
    state.active[17] = texels[0];
    state.active[24] = texels[1];
    state.client.textureRunAnims(1);
    state.poolSize = Pix3D.poolSize;
}

function compare(a, b) {
    for (const [i, buffer] of a.buffers.entries()) assert.deepEqual(b.buffers[i], buffer);
    assert.equal(b.client.textureBuffer, b.buffers[a.buffers.indexOf(a.client.textureBuffer)]);
    for (const id of ids) {
        assert.equal(b.textures[id]?.data, b.buffers[a.buffers.indexOf(a.textures[id]?.data)]);
        assert.equal(b.active[id], a.active[id]);
    }
    assert.equal(b.poolSize, a.poolSize);
    a.pool.forEach((buffer, i) => assert.equal(b.pool[i], buffer));
}

let checked = 0;
for (const options of [{}, { widths: [4, 8] }, { widths: [5, 3] }, { widths: [4, 4], scratch: 9 }, { widths: [8, 8], shared: true }, { missing: 17 }, { missing: 24 }]) {
    const a = fixture(Before, 17, options);
    const b = fixture(After, 17, options);
    for (const lowMem of [false, true]) {
        Before.lowMem = After.lowMem = lowMem;
        for (let mask = 0; mask < 4; mask++) {
            ids.forEach((id, i) => { Pix3D.texCycle[id] = (mask >> i) & 1; });
            for (const updates of [0, 1, 3, 64, 129]) {
                a.client.worldUpdateNum = b.client.worldUpdateNum = updates;
                frame(a);
                frame(b);
                compare(a, b);
                checked++;
            }
        }
    }
}
console.log(`${checked} frames matched`);

Before.lowMem = After.lowMem = false;
Pix3D.texCycle.fill(1);
function batch(states) {
    const start = performance.now();
    for (let i = 0; i < 80; i++) {
        for (const state of states) frame(state);
    }
    return (performance.now() - start) / 80;
}

for (const count of [1, 30, 61]) {
    const groups = [Before, After].map(Client => Array.from({ length: count }, (_, i) => fixture(Client, i + 1)));
    const times = [[], []];
    for (let i = 0; i < 16; i++) {
        for (const version of i % 2 ? [1, 0] : [0, 1]) {
            const ms = batch(groups[version]);
            if (i >= 5) times[version].push(ms);
        }
        groups[0].forEach((state, j) => compare(state, groups[1][j]));
    }
    const [before, after] = times.map(samples => samples.sort((a, b) => a - b)[5]);
    console.log(`${count} clients: ${before.toFixed(5)} -> ${after.toFixed(5)} ms/sweep`);
}
