import assert from 'node:assert/strict';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

const [before, after] = await Promise.all(argv.slice(2).map(async path => (await import(pathToFileURL(path))).default));
const seed = 0x123456;

function checkBounds(renderer, width, height, cleared) {
    const storage = new Int32Array(12).fill(seed);
    const view = storage.subarray(2, 10);
    renderer.setPixels(view, width, height);
    renderer.setClipping(1, 1, 2, 2);
    const state = { ...renderer };
    renderer.cls();
    assert.equal(renderer.pixels, view);
    assert.deepEqual({ ...renderer }, state);
    assert.deepEqual(storage, new Int32Array(12).fill(seed).fill(0, 2, 2 + cleared));
}

const width = 512;
const height = 334;
const area = width * height;
const expected = new Int32Array(area + 1);
expected[area] = seed;

function sweep(renderer, buffers) {
    for (const pixels of buffers) pixels.fill(seed);
    const start = performance.now();
    for (const pixels of buffers) {
        renderer.setPixels(pixels, width, height);
        renderer.cls();
    }
    const elapsed = performance.now() - start;
    for (const pixels of buffers) assert.deepEqual(pixels, expected);
    return elapsed;
}

for (const clients of [30, 61]) {
    const buffers = Array.from({ length: clients }, () => new Int32Array(area + 1));
    const times = new Map([[before, []], [after, []]]);
    for (let pair = 0; pair < 40; pair++) {
        for (const renderer of pair % 2 === 0 ? [before, after] : [after, before]) {
            const elapsed = sweep(renderer, buffers);
            if (pair >= 9) times.get(renderer).push(elapsed);
        }
    }
    const [oldMs, newMs] = Array.from(times.values(), samples => samples.sort((a, b) => a - b)[15]);
    console.log(`${clients} clients: ${oldMs.toFixed(3)} ms -> ${newMs.toFixed(3)} ms per sweep (median)`);
}

for (const renderer of [before, after]) {
    for (const [width, height, cleared] of [[3, 2, 6], [0, 2, 0], [3, 0, 0], [3, 3, 8], [-1, 2, 0], [1.25, 2, 3]]) {
        checkBounds(renderer, width, height, cleared);
    }

    const pixels = new Int32Array(4).fill(seed);
    renderer.setPixels(pixels, 2, 2);
    const transferred = pixels.buffer.transfer();
    renderer.cls();
    assert.deepEqual(new Int32Array(transferred), new Int32Array(4).fill(seed));

    const buffer = new ArrayBuffer(16, { maxByteLength: 16 });
    const fixed = new Int32Array(buffer, 0, 4).fill(seed);
    renderer.setPixels(fixed, 2, 2);
    buffer.resize(8);
    renderer.cls();
    assert.deepEqual(new Int32Array(buffer), new Int32Array(2).fill(seed));
}
