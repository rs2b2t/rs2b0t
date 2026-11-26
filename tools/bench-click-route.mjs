import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
const CollisionMap = load('#/client/dash3d/CollisionMap.js').default;
const { CollisionFlag } = load('#/client/dash3d/CollisionFlag.js');
const file = 'src/client/shell/Client.ts';
const baseline = execFileSync('git', ['show', '31bbfd8e:' + file], { encoding: 'utf8' });

function routeClass(source) {
    const imports = source.match(/^import .*from '.*\/(CollisionMap|CollisionFlag|DirectionFlag|LocShape|ClientProt)\.js';$/gm);
    const grids = source.match(/^ {4}private (dirMap|distMap|routeX|routeZ):.*;$/gm);
    const method = source.match(/^ {4}private tryMove\([\s\S]*?^ {4}}$/m);
    assert.equal(grids?.length, 4);
    assert.ok(method);
    return load.evalModule(`${imports.join('\n')}\nexport class Router {\n${grids.join('\n')}\n${method[0]}\n}`, { filename: resolve(file) }).Router;
}

const versions = [baseline, readFileSync(file, 'utf8')].map(routeClass);
function fixture(Router) {
    const map = new CollisionMap();
    map.flags.fill(CollisionFlag.WR_GRND);
    for (let x = 40; x <= 63; x++) {
        for (let z = 40; z <= 63; z++) {
            if (x !== 52 || z === 53) map.unblockGround(x, z);
        }
    }
    map.blockGround(59, 54);
    const writes = [];
    return Object.assign(new Router(), {
        collision: [map], minusedlevel: 0, keyHeld: new Uint8Array(10), mapBuildBaseX: 3200, mapBuildBaseZ: 3400,
        writes, out: {
            p1Enc: n => writes.push('p1Enc', n), p1: n => writes.push('p1', n), p2: n => writes.push('p2', n)
        }
    });
}

const clicks = [
    [42, 43, 47, 46, false],
    [48, 47, 57, 47, false],
    [57, 47, 59, 54, true],
    [57, 47, 59, 54, false]
];
function click(client, [x, z, dx, dz, nearest, width = 0, length = 0, angle = 0, shape = 0, approach = 0, type = 0]) {
    client.writes.length = 0;
    return client.tryMove(x, z, dx, dz, nearest, width, length, angle, shape, approach, type);
}

const clients = versions.map(fixture);
let checks = 0;
function compare(args, expected) {
    const [before, after] = clients.map(client => ({
        ok: click(client, args), path: client.lastWalkPathLocal, nearest: client.tryMoveNearest,
        flag: [client.minimapFlagX, client.minimapFlagZ], writes: client.writes
    }));
    assert.deepEqual(after, before);
    assert.equal(after.ok, expected);
    checks++;
    return after;
}

const visits = clicks.map((args, i) => {
    compare(args, i !== 3);
    return clients[1].dirMap.reduce((n, dir) => n + Number(dir !== 0), 0);
});
assert.deepEqual(visits, [79, 384, 552, 552]);
for (const client of clients) client.collision[0].blockGround(52, 53);
compare([48, 47, 57, 47, true], false);
for (const client of clients) client.collision[0].unblockGround(52, 53);
compare(clicks[1], true);
for (const client of clients) client.keyHeld[5] = 1;
compare([42, 43, 42, 43, false], true);
compare([42, 43, 47, 46, true, 0, 0, 0, 0, 0, 1], true);
compare([57, 47, 59, 54, false, 1, 1, 0, 0, 0, 2], true);
compare([57, 47, 59, 54, false, 0, 0, 0, 1, 0, 2], true);
compare([57, 47, 59, 54, false, 0, 0, 0, 7, 0, 2], true);
compare([42, 43, 0, 0, true], false);

for (const client of clients) {
    const map = client.collision[0];
    map.flags.fill(CollisionFlag.WR_GRND);
    for (let row = 0; row < 12; row++) {
        const z = 2 + row * 2;
        for (let x = 2; x <= 100; x++) map.unblockGround(x, z);
        if (row < 11) map.unblockGround(row % 2 ? 2 : 100, z + 1);
    }
}
assert.equal(compare([2, 2, 2, 24, false], true).path.length, 1199);
for (const client of clients) assert.equal(client.distMap[CollisionMap.index(2, 24)], 1198);
for (const client of clients) client.collision[0] = null;
compare(clicks[0], false);
console.log(`${checks} paired route outputs matched; visited ${visits.join(', ')}`);
const bytes = clients.map(client => client.dirMap.byteLength + client.distMap.byteLength);
console.log(`scratch bytes/client: ${bytes.join(' -> ')}`);

function sweep(batch) {
    const start = performance.now();
    for (const client of batch) {
        for (const args of clicks) click(client, args);
    }
    return performance.now() - start;
}
for (const count of [30, 61]) {
    const batches = versions.map(Router => Array.from({ length: count }, () => fixture(Router)));
    const samples = [[], []];
    for (let i = 0; i < 66; i++) {
        for (const version of i % 2 ? [1, 0] : [0, 1]) {
            const ms = sweep(batches[version]);
            if (i >= 15) samples[version].push(ms);
        }
    }
    const medians = samples.map(times => times.sort((a, b) => a - b)[25].toFixed(2));
    console.log(`${count} profiles, median ms/sweep: ${medians.join(' -> ')}`);
}
assert.ok(bytes[1] <= 32448);
