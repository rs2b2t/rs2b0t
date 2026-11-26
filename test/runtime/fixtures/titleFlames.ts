import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type TitleFlames from '#/client/shell/TitleFlames.js';
import '../../setup-dom.js';

Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined });
const { Client } = await import('#/client/shell/Client.js');
const { default: Pix8 } = await import('#/client/graphics/Pix8.js');
const { default: PixMap } = await import('#/client/graphics/PixMap.js');
const [source, screens, frames] = process.argv.slice(2);
const { default: Flames }: { default: typeof TitleFlames } = await import(pathToFileURL(resolve(source)).href);
const grids = ['flameBuffer0', 'flameBuffer1', 'flameBuffer2', 'flameBuffer3'] as const;

const panels = createHash('sha256');
const values = createHash('sha256');
let draws = 0;
const context = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(image: ImageData, x: number, y: number) {
        panels.update(`${x},${y}:`).update(image.data);
        draws++;
    }
} as unknown as CanvasRenderingContext2D;
const runes = Array.from({ length: 12 }, (_, i) => {
    const rune = new Pix8(2, 2, Int32Array.of(0, 1));
    rune.data.set([1, 0, 0, 1]);
    rune.xof = i;
    return rune;
});
const roster = Array.from({ length: Number(screens) }, () => {
    const left = new PixMap(128, 265, context);
    const right = new PixMap(128, 265, context);
    left.data.fill(0x123456);
    right.data.fill(0x654321);
    return { flames: new Flames(runes), left, right };
});

let seed = 1235;
Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
};
const start = performance.now();
for (const { flames, left, right } of roster) {
    flames.setupFire(left, right);
    flames.active = true;
    for (let i = 0; i < Number(frames); i++) {
        Client.loopCycle = i;
        flames.renderFlames();
    }
}
const ms = performance.now() - start;

let bytes = 0;
for (const { flames } of roster) {
    for (const key of grids) {
        const grid = flames[key]!;
        bytes += grid.buffer.byteLength;
        values.update(Int32Array.from(grid));
    }
    flames.close();
    for (const key of grids) {
        assert.equal(flames[key], null);
    }
}
console.log(JSON.stringify({ bytes, draws, panels: panels.digest('hex'), grids: values.digest('hex'), coolingCycle: roster[0].flames.coolingCycle, ms }));
