import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { createJiti } from 'jiti';

const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
globalThis.document = { getElementById: () => ({ style: {}, getContext: () => ({ fillRect() {} }) }) };
const file = 'src/client/mapview/MapView.ts';
const source = execFileSync('git', ['show', (process.argv[2] ?? 'c7eef2c5') + ':' + file], { encoding: 'utf8' });
const before = load.evalModule(source, { filename: resolve('src/client/mapview/MapView.baseline.ts') }).MapView;
const after = load(resolve(file)).MapView;
const Pix8 = load('#/client/graphics/Pix8.js').default;
const Pix32 = load('#/client/graphics/Pix32.js').default;
const { TypedArray2d } = load('#/client/util/Arrays.js');
const fields = ['floort1', 'floorsr', 'locWall', 'locMapscene', 'locMapfunction'];

const underlay = [33, 45];
const overlay = [33, 45];
const loc = [33, 45];
for (let i = 0; i < 4096; i++) {
    underlay.push(i & 255);
    if (i % 4 === 0) overlay.push(0);
    else overlay.push(1 + i % 255, 4 * (1 + i % 8) + ((i >> 2) & 3));
    if (i % 5 === 0) loc.push(1 + i % 28);
    if (i % 13 === 0) loc.push(29 + i % 131);
    if (i % 17 === 0) loc.push(160 + i % 96);
    loc.push(0);
}
const payloads = {
    'labels.dat': new Uint8Array(2),
    'floorcol.dat': new Uint8Array(2),
    'underlay.dat': Uint8Array.from(underlay),
    'overlay.dat': Uint8Array.from(overlay),
    'loc.dat': Uint8Array.from(loc)
};
assert.deepEqual([underlay.length, overlay.length, loc.length], [4098, 7170, 5475]);

const endOfTiles = Symbol();
function headless(MapView) {
    return class extends MapView {
        resize() {}
        run() {}
        drawProgress() {}
        loadWorldmap() {
            return { read: name => payloads[name] };
        }
        loadUnderlay(packet) {
            super.loadUnderlay(packet);
            assert.equal(packet.available, 0);
        }
        loadOverlay(packet) {
            super.loadOverlay(packet);
            assert.equal(packet.available, 0);
        }
        loadLoc(packet) {
            super.loadLoc(packet);
            assert.equal(packet.available, 0);
            throw endOfTiles;
        }
    };
}

async function decode(view) {
    try {
        await view.maininit();
    } catch (err) {
        if (err === endOfTiles) return;
        throw err;
    }
    assert.fail('loc decoder did not run');
}

function retained() {
    globalThis.gc();
    globalThis.gc();
    const { heapUsed, arrayBuffers } = process.memoryUsage();
    return heapUsed + arrayBuffers;
}

function output(view) {
    const hash = createHash('sha256');
    const add = array => hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    for (const field of [...fields, 'floort2']) {
        for (const column of view[field]) add(Int32Array.from(column));
    }
    assert.equal(view.activeMapFunctionCount, 241);
    for (const field of ['activeMapFunctions', 'activeMapFunctionX', 'activeMapFunctionZ']) {
        add(view[field].subarray(0, view.activeMapFunctionCount));
    }

    view.blendedGroundColour = new TypedArray2d(view.mapWidth, view.mapHeight, 0);
    view.getBlendedGroundColour();
    view.mapscene = Array.from({ length: 131 }, (_, i) => {
        const sprite = new Pix8(1, 1, Int32Array.of(0, 0x223300 + i));
        sprite.data[0] = 1;
        return sprite;
    });
    view.mapfunction = Array.from({ length: 96 }, (_, i) => {
        const sprite = new Pix32(3, 3);
        sprite.data.fill(0x990000 + i);
        return sprite;
    });
    const raster = new Pix32(256, 256);
    raster.setPixels();
    view.renderWorldMap(64, view.mapHeight - 128, 128, view.mapHeight - 64, 0, 0, 256, 256);
    add(raster.data);
    return hash.digest('hex');
}

async function measure(View, width, height, count, checkOutput) {
    const views = Array.from({ length: count }, () => Object.assign(new View(), {
        mapWidth: width, mapHeight: height,
        floorcol1: Array.from({ length: 256 }, (_, i) => i * 1025),
        floorcol2: Array.from({ length: 256 }, (_, i) => i * 65793)
    }));
    retained();
    const start = performance.now();
    for (const view of views) await decode(view);
    const ms = performance.now() - start;
    const digest = checkOutput ? output(views[0]) : undefined;
    const withLayers = retained();
    for (const view of views) {
        for (const field of fields) view[field] = [];
    }
    const mib = (withLayers - retained()) / 2 ** 20;
    assert.equal(views.at(-1).floort2.length, width);
    return { ms, mib, digest };
}

const versions = [headless(before), headless(after)];
const median = values => values.sort((a, b) => a - b)[2];
for (const [width, height, count] of [[1600, 1216, 1], [192, 192, 30], [192, 192, 61]]) {
    const samples = [[], []];
    for (let pair = 0; pair < 5; pair++) {
        for (const v of pair % 2 ? [1, 0] : [0, 1]) {
            samples[v].push(await measure(versions[v], width, height, count, pair === 0));
        }
    }
    assert.equal(samples[0][0].digest, samples[1][0].digest);
    const ms = samples.map(rows => median(rows.map(r => r.ms)).toFixed(2));
    const mib = samples.map(rows => median(rows.map(r => r.mib)));
    console.log(`${count} x ${width}x${height}: ${ms.join(' -> ')} ms, ${mib.map(n => n.toFixed(2)).join(' -> ')} MiB, sha256 ${samples[1][0].digest}`);
    if (count === 1) assert.ok(mib[1] < 12, 'five full-size tile layers exceed 12 MiB');
}
