import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { rebaseGroundItems } from '../src/client/shell/rebaseGroundItems.ts';
import { TypedArray3d } from '../src/client/util/Arrays.ts';

const source = execFileSync('git', ['show', '6aacb55f:src/client/shell/Client.ts'], { encoding: 'utf8' });
const start = source.indexOf('let startTileX: number');
const end = source.indexOf('for (let loc = this.locChanges.head()', start);
assert(start >= 0 && end > start);
const baseline = new Function('BuildArea', 'dx', 'dz', '"use strict";\n' + stripTypeScriptTypes(source.slice(start, end)));
const area = { SIZE: 104, LEVELS: 4 };
const before = (grid, dx, dz) => baseline.call({ groundObj: grid }, area, dx, dz);
const shifts = [[32, 0], [0, 32], [32, -32], [-32, 0], [0, -32], [-32, 32]];

function fixture(dense = false) {
    const original = new TypedArray3d(4, 104, 104, null);
    const updated = new TypedArray3d(4, 104, 104, null);
    for (let p = 0; p < 4; p++) {
        if (dense) {
            for (let x = 0; x < 104; x++) {
                for (let z = 0; z < 104; z++) {
                    original[p][x][z] = updated[p][x][z] = {};
                }
            }
        } else {
            for (let i = 0; i < 24; i++) {
                const x = (17 * i + 3 * p) % 104;
                const z = (31 * i + 5 * p) % 104;
                original[p][x][z] = updated[p][x][z] = {};
            }
        }
    }
    return { original, updated };
}

function compare(expected, actual) {
    for (let p = 0; p < 4; p++) {
        for (let x = 0; x < 104; x++) {
            for (let z = 0; z < 104; z++) {
                if (actual[p][x][z] !== expected[p][x][z]) assert.fail(`pile mismatch at ${p},${x},${z}`);
            }
        }
    }
}

const cases = [...shifts, [0, 0], [1, 1], [-1, -1], [103, -103], [-103, 103], [104, 0], [-104, 0], [0, 104], [0, -104], [105, -1], [1, -105]];
for (const [dx, dz] of cases) {
    const { original: expected, updated: actual } = fixture(true);
    const rows = Array.from(actual, level => new Set(level));
    before(expected, dx, dz);
    rebaseGroundItems(actual, dx, dz);
    compare(expected, actual);
    actual.forEach((level, p) => {
        assert.equal(new Set(level).size, 104);
        assert(level.every(row => rows[p].has(row)));
    });
}
console.log(`${cases.length} dense shifts matched by identity, all original rows reused`);

function timeShift(rebase, grids, dx, dz) {
    const start = performance.now();
    for (const grid of grids) rebase(grid, dx, dz);
    return performance.now() - start;
}

for (const count of [30, 61]) {
    const samples = [[], []];
    for (let batch = 0; batch < 12; batch++) {
        const pairs = Array.from({ length: count }, () => fixture());
        const original = pairs.map(pair => pair.original);
        const updated = pairs.map(pair => pair.updated);
        const times = [0, 0];
        for (const [dx, dz] of shifts) {
            for (const version of batch % 2 ? [1, 0] : [0, 1]) {
                times[version] += version ? timeShift(rebaseGroundItems, updated, dx, dz) : timeShift(before, original, dx, dz);
            }
            original.forEach((grid, profile) => compare(grid, updated[profile]));
        }
        if (batch >= 3) times.forEach((ms, version) => samples[version].push(ms));
    }
    const [base, patch] = samples.map(times => times.sort((a, b) => a - b)[4]);
    console.log(`${count} profiles: ${base.toFixed(2)} -> ${patch.toFixed(2)} ms`);
}
