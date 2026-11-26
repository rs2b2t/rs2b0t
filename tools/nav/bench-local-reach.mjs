import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { CollisionFlag } from '../../src/client/dash3d/CollisionFlag.ts';
import { localReachProbe } from '../../src/bot/event/webwalk/geometry/localReach.ts';
import { selectClientWalkTarget } from '../../src/bot/event/webwalk/geometry/followMath.ts';
import { findForwardRecoveryIndex } from '../../src/bot/event/webwalk/routeRecovery.ts';

const { canReachLocal } = await import(pathToFileURL(resolve(process.argv[2])));
const probes = [
    (flags, from, maxSteps) => to => canReachLocal(flags, from, to, { maxSteps }),
    localReachProbe
];

function fixture(i) {
    const x = 32 + i % 3;
    const z = 48 + i % 9;
    const kind = i % 4;
    const grid = new Uint32Array(104 * 104);
    if (kind === 2) grid.fill(CollisionFlag.WALK_SCENERY, (x + 11) * 104, (x + 12) * 104);
    const flags = (lx, lz) => lx >= 0 && lx < 104 && lz >= 0 && lz < 104 ? grid[lx * 104 + lz] : null;
    const tiles = Array.from({ length: kind === 0 ? 11 : 50 }, (_, j) => ({ x: x + j, z, level: 0 }));
    return { tiles, flags, from: { lx: x, lz: z }, kind };
}

function decide(profile, probe, walk = () => true) {
    const { tiles, flags, from, kind } = profile;
    const reachable = probe(flags, from, 1200);
    const clickable = t => reachable({ lx: t.x, lz: t.z });
    return kind === 3
        ? findForwardRecoveryIndex(tiles, tiles[0], 3, clickable, { corridor: 3, window: 46 })
        : selectClientWalkTarget(tiles, 3, 20, tiles.length - 1, 0, clickable, walk);
}

const profiles = Array.from({ length: 61 }, (_, i) => fixture(i));
for (const probe of probes) {
    let reads = 0;
    const squares = new Set();
    const recovery = profiles[3];
    const index = decide({ ...recovery, flags(x, z) {
        reads++;
        squares.add(x * 104 + z);
        return recovery.flags(x, z);
    } }, probe);
    assert.equal(index, 17);
    const attempts = [];
    assert.equal(decide(profiles[1], probe, i => attempts.push(i) > 2), 15);
    assert.deepEqual(attempts, [17, 16, 15]);
    console.log({ index, reads, squares: squares.size, attempts });
}

for (const count of [30, 61]) {
    const batch = profiles.slice(0, count);
    const expected = batch.map(({ kind }) => [10, 17, 10, 17][kind]);
    const samples = [[], []];
    for (let trial = 0; trial < 14; trial++) {
        for (const i of trial % 2 ? [1, 0] : [0, 1]) {
            const start = performance.now();
            const indices = batch.map(profile => decide(profile, probes[i]));
            const ms = performance.now() - start;
            assert.deepEqual(indices, expected);
            if (trial >= 3) samples[i].push(ms);
        }
    }
    console.log(count, 'profiles, median ms', samples.map(s => s.sort((a, b) => a - b)[5].toFixed(2)));
}
