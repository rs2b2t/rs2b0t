import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const path = 'src/client/dash3d/Model.ts';
const original = execFileSync('git', ['show', '762ccd25:' + path], { encoding: 'utf8' });
const modelURL = new URL('../../' + path, import.meta.url);
const baselineURL = modelURL.href + '?baseline';
registerHooks({
    resolve(specifier, context, next) {
        if (specifier.startsWith('#/')) {
            return { url: new URL('../../src/' + specifier.slice(2).replace(/\.js$/, '.ts'), import.meta.url).href, shortCircuit: true };
        }
        return next(specifier, context);
    },
    load(url, context, next) {
        if (url !== baselineURL && !url.endsWith('.ts')) return next(url, context);
        const source = url === baselineURL ? original : readFileSync(fileURLToPath(url), 'utf8');
        const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
        return { format: 'module', source: outputText, shortCircuit: true };
    }
});
const { default: Before } = await import(baselineURL);
const { default: After } = await import(modelURL);
const { default: AnimFrame } = await import('#/client/dash3d/AnimFrame.js');
const labels = Array.from({ length: 16 }, (_, g) => Int32Array.from({ length: 24 }, (_, i) => g * 24 + i));
const axes = ['pointX', 'pointY', 'pointZ'];
const base = {
    type: Uint8Array.from({ length: 32 }, (_, i) => (i % 2) * 2),
    labels: Array.from({ length: 32 }, (_, i) => Uint8Array.of(i >> 1))
};
for (let id = 0; id < 4; id++) {
    const transforms = [];
    for (let g = 0; g < labels.length; g++) {
        const mask = 1 + (g + id) % 7;
        transforms.push(2 * g, id - g, g + 3, -9);
        transforms.push(2 * g + 1, mask & 1 ? 17 + g : 0, mask & 2 ? -31 - id : 0, mask & 4 ? 63 - g : 0);
    }
    AnimFrame.list.push(Object.assign(new AnimFrame(Int16Array.from(transforms)), { base }));
}

function model(version, groups = labels, length = 384) {
    const m = new version();
    m.numPoints = length;
    m.labelVertices = groups;
    for (const axis of axes) m[axis] = new Int32Array(length);
    return m;
}

const poses = Array.from({ length: 61 * 8 }, (_, i) => ({
    id: (i + Math.floor(i / 8)) % 4,
    coords: axes.map((_, a) => Int32Array.from({ length: 384 }, (_, v) => ((i * 29 + v * (7 + 11 * a)) % 1021) - 510))
}));

function restore(m, coords) {
    m.pointX.set(coords[0]);
    m.pointY.set(coords[1]);
    m.pointZ.set(coords[2]);
}

function compare(a, b) {
    for (const axis of axes) assert.deepEqual(new Uint8Array(a[axis].buffer), new Uint8Array(b[axis].buffer));
}

const before = model(Before);
const after = model(After);
const blend = Int32Array.of(1, 5, 9, 13, 17, 21, 25, 29, 999);
for (const { id, coords } of poses) {
    for (const masked of [false, true]) {
        for (const m of [before, after]) {
            restore(m, coords);
            if (masked) m.maskAnimate(id, (id + 1) % 4, blend);
            else m.animate(id);
        }
        compare(before, after);
        assert.notDeepEqual(after.pointX, coords[0]);
    }
}

function measure(m, count, sweeps) {
    const start = performance.now();
    for (let s = 0; s < sweeps; s++) {
        for (let i = 0; i < count * 8; i++) {
            restore(m, poses[i].coords);
            m.animate(poses[i].id);
        }
    }
    return (performance.now() - start) / sweeps;
}

for (const count of [30, 61]) {
    const samples = new Map([[before, []], [after, []]]);
    for (const m of samples.keys()) measure(m, count, 20);
    for (let i = 0; i < 25; i++) {
        for (const m of i % 2 ? [after, before] : [before, after]) samples.get(m).push(measure(m, count, 5));
    }
    const wins = samples.get(after).filter((ms, i) => ms < samples.get(before)[i]).length;
    const median = m => samples.get(m).sort((a, b) => a - b)[12].toFixed(3);
    console.log(count, 'profiles, median ms/sweep', median(before), '->', median(after), '(' + wins + '/25 faster)');
}

const edgeBase = { type: Uint8Array.of(0, 2), labels: [Uint8Array.of(0), Uint8Array.of(1, 2, 1, 3, 9)] };
const edgeGroups = [Int32Array.of(0), Int32Array.of(1, 2), Int32Array.of(2, 3), null];
const limits = Int32Array.of(2147483647, -2147483648, -97, 123);
const edges = [model(Before, edgeGroups, 4), model(After, edgeGroups, 4)];
for (let mask = 0; mask < 8; mask++) {
    for (const angle of [-257, -64, 73, 256]) {
        const transforms = Int16Array.of(0, 13, -23, 5, 1, mask & 1 ? angle : 0, mask & 2 ? angle : 0, mask & 4 ? angle : 0);
        AnimFrame.list[4] = Object.assign(new AnimFrame(transforms), { base: edgeBase });
        for (const m of edges) {
            restore(m, [limits, limits.map(v => ~v), limits.map(v => v >> 1)]);
            m.animate(4);
        }
        compare(...edges);
    }
}
console.log('XYZ bytes matched for 488 poses, 488 masked poses and 32 edge cases');
