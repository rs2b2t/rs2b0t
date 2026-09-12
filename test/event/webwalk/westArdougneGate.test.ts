import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { existsSync, readFileSync } from 'node:fs';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

function fixture(): PathFinder {
    const pack = new Uint8Array(10 + 3 + 4096 + 512);
    pack.set([0x4c, 0x43, 0x4e, 0x56, 1, 1, 0, 0, 1, 0, 39, 51, 1]);
    for (const x of [2556, 2559]) for (const z of [3299, 3300]) {
        const index = (x & 63) * 64 + (z & 63);
        pack[13 + 4096 + (index >> 3)] |= 1 << (index & 7);
    }
    const finder = new PathFinder(pack);
    loadDefaultNavEdges(finder);
    return finder;
}

const complete: WorldStateData = {
    ...emptyWorldStateData(),
    quests: { 'Plague City': 'complete', Biohazard: 'complete' }
};

for (const [x, toX, z, locX, locId] of [
    [2559, 2556, 3300, 2558, 2049],
    [2556, 2559, 3300, 2557, 2048],
    [2559, 2556, 3299, 2558, 2048],
    [2556, 2559, 3299, 2557, 2049]
]) {
    test(`Biohazard complete opens ${x},${z} to ${toX},${z} without a Gas mask`, () => {
        const result = fixture().findPath({ x, z, level: 0 }, { x: toX, z, level: 0 }, { state: complete });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.waypoints.at(-1)?.transport).toMatchObject({
            locId, locX, locZ: z, action: 'Open', toTile: { x: toX, z }
        });
    });
}

for (const status of ['not_started', 'started', 'unknown'] as const) {
    test(`the city gate stays closed while Biohazard is ${status}`, () => {
        const state = { ...complete, quests: { ...complete.quests, Biohazard: status } };
        for (const [x, toX] of [[2556, 2559], [2559, 2556]]) {
            expect(fixture().findPath({ x, z: 3300, level: 0 }, { x: toX, z: 3300, level: 0 }, { state }).ok).toBe(false);
        }
    });
}

for (const [Biohazard, allowed] of [['not_started', true], ['started', false], ['complete', false], ['unknown', false]] as const) {
    test(`the garden mud patch is ${allowed ? 'open' : 'closed'} with Biohazard ${Biohazard}`, () => {
        const from = { x: 2566, z: 3330, level: 0 };
        const to = { x: 2562, z: 9737, level: 0 };
        const size = 3 + 4096 + 512;
        const pack = new Uint8Array(10 + 2 * size);
        pack.set([0x4c, 0x43, 0x4e, 0x56, 1, 1, 0, 0, 2, 0]);
        for (const [i, tile] of [from, to].entries()) {
            const offset = 10 + i * size;
            pack.set([tile.x >> 6, tile.z >> 6, 1], offset);
            const index = (tile.x & 63) * 64 + (tile.z & 63);
            pack[offset + 3 + 4096 + (index >> 3)] |= 1 << (index & 7);
        }
        const finder = new PathFinder(pack);
        loadDefaultNavEdges(finder);
        const state = { ...complete, quests: { ...complete.quests, Biohazard }, items: { Spade: 1 } };
        expect(finder.findPath(from, to, { state }).ok).toBe(allowed);
    });
}

const packPath = 'out/collision.lcnav.gz';
describe.skipIf(!existsSync(packPath))('West Ardougne gate on the collision pack', () => {
    test('a completed account at the filled garden patch takes the city gate even with the sewer kit', () => {
        const finder = new PathFinder(gunzipSync(readFileSync(packPath)));
        loadDefaultNavEdges(finder);
        const state = { ...complete, items: { Spade: 1 }, worn: { 'Gas mask': 1 } };
        const result = finder.findPath({ x: 2566, z: 3330, level: 0 }, { x: 2488, z: 3308, level: 0 }, { state });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const crossings = result.waypoints.flatMap(point => point.transport ? [point.transport] : []);
        expect(crossings.some(crossing => [2048, 2049].includes(crossing.locId ?? -1))).toBe(true);
        expect(crossings.some(crossing => /sewer|mud|manhole/i.test(crossing.locName))).toBe(false);
    });

    test('routes from Ardougne bank to clue 3522 and returns through the gate without a mask', () => {
        const finder = new PathFinder(gunzipSync(readFileSync(packPath)));
        loadDefaultNavEdges(finder);
        const bank = { x: 2616, z: 3332, level: 0 };
        const clue = { x: 2488, z: 3308, level: 0 };
        for (const [from, to] of [[bank, clue], [clue, bank]]) {
            const result = finder.findPath(from, to, { state: complete, maxExpansions: 2_000_000 });
            expect(result.ok).toBe(true);
            if (!result.ok) continue;
            const crossings = result.waypoints.flatMap(point => point.transport ? [point.transport] : []);
            expect(crossings.some(crossing => [2048, 2049].includes(crossing.locId ?? -1))).toBe(true);
            expect(crossings.some(crossing => /sewer|mud|manhole/i.test(crossing.locName))).toBe(false);
        }
    });
});
