import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { argv } from 'node:process';
import { resolve } from 'node:path';
import Pix2D from '../../src/client/graphics/Pix2D.ts';
import Pix8 from '../../src/client/graphics/Pix8.ts';

const [source, count, mode] = argv.slice(2);
assert(['standard', 'low'].includes(mode) && [30, 61].includes(Number(count)));
const renderers = [];
for (let i = 0; i < Number(count); i++) {
    renderers.push((await import(`${resolve(source)}?client=${i}`)).default);
}
assert.equal(new Set(renderers).size, Number(count));

const output = createHash('sha256');
const retained = new Set();
const start = performance.now();
for (const renderer of renderers) {
    renderer.lowMem = mode === 'low';
    renderer.initPool(20);
    const pixels = new Int32Array(16);
    Pix2D.setPixels(pixels, 4, 4);
    renderer.setRenderClipping();
    for (const id of [0, 1]) {
        const palette = Int32Array.of(0, id ? 0x0000ff : 0xf80000, 0xf8f800);
        const texture = new Pix8(64, 64, palette);
        for (let i = 0; i < texture.data.length; i++) texture.data[i] = 1 + ((i + id) % 2);
        renderer.textures[id] = texture;
        renderer.texPal[id] = palette;
    }
    for (let pass = 0; pass < 2; pass++) {
        if (pass === 1) {
            renderer.texPal[0][1] = 0x00f800;
            renderer.clearTexels();
            renderer.initPool(20);
        }
        for (const id of [0, 1]) {
            pixels.fill(0);
            renderer.textureTriangle(0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, id);
            assert.equal(pixels[0], renderer.texPal[id][1 + id]);
            output.update(pixels);
            output.update(renderer.activeTexels[id]);
        }
    }
    for (const data of [...renderer.texelBuffers, ...renderer.texelPool, ...renderer.activeTexels]) {
        if (data) retained.add(data.buffer);
    }
}
const ms = performance.now() - start;
const mib = [...retained].reduce((sum, buffer) => sum + buffer.byteLength, 0) / 2 ** 20;
console.log(JSON.stringify({ clients: renderers.length, mode, ms, mib, sha256: output.digest('hex') }));
