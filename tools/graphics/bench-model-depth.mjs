import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { createJiti } from 'jiti';

const path = 'src/client/dash3d/Model.ts';
const load = createJiti(import.meta.url, { fsCache: false, alias: { '#': resolve('src') } });
const source = execFileSync('git', ['show', (argv[2] ?? '31bbfd8e') + ':' + path], { encoding: 'utf8' });
const before = load.evalModule(source, { filename: resolve('src/client/dash3d/Model.baseline.ts') }).default;
const after = load(resolve(path)).default;
const Pix2D = load(resolve('src/client/graphics/Pix2D.ts')).default;
const Pix3D = load(resolve('src/client/dash3d/Pix3D.ts')).default;

const pixels = new Int32Array(512 * 334);
Pix2D.setPixels(pixels, 512, 334);
Pix3D.setRenderClipping();
for (let i = 1; i <= 65; i++) Pix3D.colourTable[i] = i * 0x030201;

function cuboid() {
    const points = Array.from({ length: 8 }, (_, i) => [i & 1 ? 64 : -64, i & 2 ? 0 : -120, i & 4 ? 12 : -12]);
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3]];
    return { points, faces: quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]) };
}

function layers() {
    const points = [], faces = [];
    for (let z = -32; z <= 32; z++) {
        const i = points.length;
        points.push([-6, -6, z], [-6, 6, z], [6, -6, z]);
        faces.push([i, i + 1, i + 2]);
    }
    return { points, faces };
}

function scene(Model, { points, faces }) {
    return Array.from({ length: 64 }, (_, index) => {
        const model = new Model();
        model.numPoints = points.length;
        model.numFaces = faces.length;
        [model.pointX, model.pointY, model.pointZ] = [0, 1, 2].map(k => Int32Array.from(points, p => p[k]));
        [model.faceVertexA, model.faceVertexB, model.faceVertexC] = [0, 1, 2].map(k => Int32Array.from(faces, f => f[k]));
        model.faceRenderType = new Int32Array(faces.length).fill(1);
        model.faceColourA = Int32Array.from(faces, (_, i) => i + 1);
        if (index % 2) model.facePriority = Int32Array.from(faces, (_, i) => i % 12);
        model.calcBoundingCylinder();
        return model;
    });
}

function drawModel(model, i, yaw) {
    model.worldRender(yaw, 0, 65536, 0, 65536, (i % 8) * 160 - 560, (i >> 3) * 132 - 402, 1800, 0);
}

function draw(models, yaw) {
    Pix2D.cls();
    for (let i = 0; i < models.length; i++) drawModel(models[i], i, yaw);
}

function measure(models, angles, viewports) {
    const start = performance.now();
    for (const yaw of angles) {
        for (let v = 0; v < viewports; v++) draw(models, yaw);
    }
    return (performance.now() - start) / angles.length;
}

function trace(Model, mesh) {
    const order = [];
    const models = scene(Model, mesh);
    for (const [index, model] of models.entries()) {
        const render = model.render3;
        model.render3 = function(face) {
            order.push(index * model.numFaces + face);
            render.call(this, face);
        };
    }
    return yaw => {
        order.length = 0;
        let full = 0, span = 0;
        Pix2D.cls();
        for (const [i, model] of models.entries()) {
            const start = order.length;
            drawModel(model, i, yaw);
            const counts = Model.tmpDepthFaceCount.subarray(0, model.maxDepth);
            const first = counts.findIndex(n => n > 0);
            assert.ok(first >= 0 && order.length > start);
            assert.equal(order.length - start, counts.reduce((a, b) => a + b, 0));
            full += model.maxDepth;
            span += counts.findLastIndex(n => n > 0) - first + 1;
        }
        assert.ok(pixels.some(colour => colour !== 0));
        return { order: order.slice(), pixels: pixels.slice(), full, span };
    };
}

for (const [name, mesh, step] of [['cuboid', cuboid(), 128], ['layers', layers(), 2]]) {
    const angles = Array.from({ length: 16 }, (_, i) => i * step);
    const scenes = [scene(before, mesh), scene(after, mesh)];
    for (const viewports of [30, 61]) {
        const samples = [[], []];
        for (let pair = 0; pair < 10; pair++) {
            for (const version of pair % 2 ? [1, 0] : [0, 1]) {
                const ms = measure(scenes[version], angles, viewports);
                if (pair > 0) samples[version].push(ms);
            }
        }
        const [oldMs, newMs] = samples.map(times => times.sort((a, b) => a - b)[4].toFixed(2));
        console.log(name, viewports, 'viewports, median ms/sweep', oldMs, '->', newMs);
    }
    const oldTrace = trace(before, mesh), newTrace = trace(after, mesh);
    let faces = 0, full = 0, span = 0;
    for (const yaw of angles) {
        const reference = oldTrace(yaw);
        assert.deepEqual(newTrace(yaw), reference);
        faces += reference.order.length;
        full += reference.full;
        span += reference.span;
    }
    console.log(name, faces, 'face calls and 16 framebuffers matched; full range / occupied span:', full, span);
}
