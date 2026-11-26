import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

let uploads = 0;
let rgba;
const ctx = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(img) { uploads++; rgba = img.data; }
};
globalThis.BroadcastChannel = undefined;
globalThis.document = { getElementById: () => ({ getContext: () => ctx }) };
globalThis.window = { location: { search: '' } };
const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
const Pix2D = load('#/client/graphics/Pix2D.js').default;
const Pix32 = load('#/client/graphics/Pix32.js').default;
const PixMap = load('#/client/graphics/PixMap.js').default;
const file = 'src/client/shell/Client.ts';
const baseline = execFileSync('git', ['show', (process.argv[2] ?? 'dd79fe7f') + ':' + file], { encoding: 'utf8' });
const versions = [baseline, readFileSync(file, 'utf8')].map(source => {
    const headless = source.replace(/^import .*from '#\/client\/(?:3rdparty\/.*|shell\/MobileKeyboard)\.js';$/gm, '');
    return load.evalModule(headless, { filename: resolve(file) }).Client;
});

const mask = new Int8Array(172 * 156).fill(1);
function circle(x, y, rows, cx, cy, radius) {
    const offsets = new Int32Array(rows);
    const lengths = new Int32Array(rows);
    for (let row = 0; row < rows; row++) {
        const halfWidth = Math.floor(Math.sqrt(radius ** 2 - (y + row - cy) ** 2));
        if (!Number.isFinite(halfWidth)) continue;
        offsets[row] = cx - halfWidth - x;
        lengths[row] = 2 * halfWidth + 1;
        const start = (y + row) * 172 + cx - halfWidth;
        mask.fill(0, start, start + lengths[row]);
    }
    return [offsets, lengths];
}
const [compassMaskLineOffsets, compassMaskLineLengths] = circle(0, 0, 33, 16, 16, 16);
const [minimapMaskLineOffsets, minimapMaskLineLengths] = circle(25, 5, 151, 98, 80, 72);
assert.equal(mask.filter(value => value === 0).length, 17038);

function sprite(size) {
    const image = new Pix32(size, size);
    for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 97) & 0xffffff;
    return image;
}
const minimap = sprite(512);
const groundObj = [Array.from({ length: 104 }, () => Array(104).fill(null))];
function fixture(Client) {
    return Object.assign(Object.create(Client.prototype), {
        localPlayer: { x: 6656, z: 6656 }, mapback: { data: mask.slice(), plotSprite() {} },
        areaMap: new PixMap(172, 156), areaGame: new PixMap(1, 1),
        compass: sprite(50), compassMaskLineOffsets, compassMaskLineLengths, minimap, minimapMaskLineOffsets, minimapMaskLineLengths,
        groundObj, minusedlevel: 0, activeMapFunctionCount: 0, playerCount: 0, npcCount: 0,
        hintType: 0, minimapFlagX: 0, macroMinimapAngle: 0, macroMinimapZoom: 0, minimapState: 2, orbitCameraYaw: 0
    });
}
function draw(client) {
    client.orbitCameraYaw = (client.orbitCameraYaw + 37) & 2047;
    client.minimapDraw();
    client.areaMap.draw(550, 4);
}
function sweep(batch, frames) {
    const start = performance.now();
    for (let frame = 0; frame < frames; frame++) {
        for (const client of batch) draw(client);
    }
    return (performance.now() - start) / frames;
}
for (const count of [30, 61]) {
    const batches = versions.map(Client => Array.from({ length: count }, () => fixture(Client)));
    const samples = [[], []];
    for (const batch of batches) sweep(batch, 32);
    for (let i = 0; i < 25; i++) {
        for (const v of i % 2 ? [1, 0] : [0, 1]) samples[v].push(sweep(batches[v], 12));
    }
    const medians = samples.map(times => times.sort((a, b) => a - b)[12].toFixed(3));
    console.log(`${count} clients: ${medians.join(' -> ')} ms/sweep`);
}

const clients = versions.map(fixture);
const scans = [0, 0];
for (const [v, client] of clients.entries()) {
    const bytes = Array.from(mask);
    Object.defineProperty(bytes, mask.length - 1, { get() { scans[v]++; return mask[mask.length - 1]; } });
    client.mapback.data = bytes;
    client.areaMap.data.fill(0xabcdef);
}
const normal = new Set([64, 65, 128]);
for (let frame = 0; frame < 256; frame++) {
    const outputs = clients.map(client => {
        if (frame === 192) {
            client.prepareGame();
            client.areaMap.data.fill(0x123456);
        }
        client.minimapState = normal.has(frame) ? 0 : 2;
        const previous = uploads;
        draw(client);
        assert.equal(uploads, previous + 1);
        assert.equal(Pix2D.pixels, client.areaGame.data);
        return rgba;
    });
    assert.deepEqual(clients[1].areaMap.data, clients[0].areaMap.data, `framebuffer at frame ${frame}`);
    assert.deepEqual(outputs[1], outputs[0], `RGBA at frame ${frame}`);
}
console.log(`256 matching frames and uploads per revision; full-mask scans: ${scans.join(' -> ')}`);
assert.deepEqual(scans, [253, 4]);
