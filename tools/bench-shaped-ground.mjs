import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [source, count] = process.argv.slice(2);
const constructors = [];
for (let client = 0; client < Number(count); client++) {
    const url = pathToFileURL(source);
    url.searchParams.set('client', client);
    constructors.push((await import(url)).default);
}
assert(constructors.length > 0);

function buildGrid(Ground, client) {
    const tiles = [];
    for (let i = 0; i < 22 * 24; i++) {
        const n = client * 528 + i;
        const h = n % 97;
        const slope = i % 5;
        tiles.push(new Ground(
            i % 22, Math.floor(i / 22), 2 + i % 11, Math.floor(i / 11) % 4, i % 2 ? -1 : n % 13,
            h, h + slope, h - slope, h + 2 * slope,
            n, n + 3, n + 5, n + 7, n + 11, n + 13, n + 17, n + 19, n + 23, n + 29
        ));
    }
    return tiles;
}

global.gc();
const initialHeap = process.memoryUsage().heapUsed;
const start = performance.now();
const grids = constructors.map(buildGrid);
const ms = performance.now() - start;
global.gc();
const retainedMiB = (process.memoryUsage().heapUsed - initialHeap) / 2 ** 20;

const hash = createHash('sha256');
const counts = grids.map(tiles => {
    const indices = new Set();
    for (const tile of tiles) {
        indices.add(tile.faceVertexA).add(tile.faceVertexB).add(tile.faceVertexC);
        hash.update(JSON.stringify(tile));
    }
    return indices.size;
});
assert(counts.every(count => count === counts[0]));
console.log(JSON.stringify({ clients: grids.length, ms, retainedMiB, arraysPerClient: counts[0], sha256: hash.digest('hex') }));
