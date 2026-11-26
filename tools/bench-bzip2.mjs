import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { bunzip2 } from '../src/client/io/BZip2.js';

assert(process.argv[2], 'Pass the baseline BZip2 module path');
const { bunzip2: baseline } = await import(pathToFileURL(process.argv[2]));
const grid = Buffer.alloc(128 * 256);
for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
        grid[y * 128 + x] = ((x >> 2) * 13 + (y >> 2) * 29 + ((x ^ y) & 7)) & 255;
    }
}

function compress(input) {
    return execFileSync('bzip2', ['-1c'], { input });
}

const packed = compress(grid);
const bytes = packed.subarray(4);
assert.equal(bytes.length, 5708);

const alphabet = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
for (const source of [Buffer.of(65), Buffer.alloc(65536, 65), alphabet, Buffer.concat([grid, grid, grid, grid])]) {
    const stream = compress(source);
    for (const decode of [baseline, bunzip2]) {
        assert(source.equals(decode(stream, true, true, source.length)));
        assert(source.equals(decode(stream.subarray(4), false, false, source.length)));
    }
}

function batch(decode, clients) {
    const outputs = new Array(clients);
    const start = performance.now();
    for (let i = 0; i < clients; i++) {
        outputs[i] = decode(bytes, false, false, grid.length);
    }
    const elapsed = performance.now() - start;
    for (const output of outputs) assert(grid.equals(output));
    return elapsed;
}

batch(baseline, 10);
batch(bunzip2, 10);
for (const clients of [30, 61]) {
    const samples = { baseline: [], patched: [] };
    const decoders = { baseline, patched: bunzip2 };
    for (let pair = 0; pair < 7; pair++) {
        for (const name of pair % 2 ? ['patched', 'baseline'] : ['baseline', 'patched']) {
            samples[name].push(batch(decoders[name], clients));
        }
    }
    for (const [name, times] of Object.entries(samples)) {
        const median = times.toSorted((a, b) => a - b)[3];
        console.log(`${clients} clients, ${name}: ${median.toFixed(1)} ms median`);
    }
}
