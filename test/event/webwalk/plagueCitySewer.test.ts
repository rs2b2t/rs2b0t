import { describe, expect, test } from 'bun:test';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const SEWER = { x: 2530, z: 9703, level: 0 };
const CITY = { x: 2529, z: 3304, level: 0 };
const MUD_PILE = { x: 2562, z: 9737, level: 0 };
const GARDEN = { x: 2566, z: 3330, level: 0 };

function route(state: WorldStateData, from = SEWER, to = CITY): boolean {
    const size = 3 + 4096 + 512;
    const pack = new Uint8Array(10 + 4 * size);
    pack.set([0x4c, 0x43, 0x4e, 0x56, 1, 1, 0, 0, 4, 0]);
    for (const [i, tile] of [SEWER, CITY, MUD_PILE, GARDEN].entries()) {
        const offset = 10 + i * size;
        pack.set([tile.x >> 6, tile.z >> 6, 1], offset);
        const index = (tile.x & 63) * 64 + (tile.z & 63);
        pack[offset + 3 + 4096 + (index >> 3)] |= 1 << (index & 7);
    }
    const finder = new PathFinder(pack);
    loadDefaultNavEdges(finder);
    return finder.findPath(from, to, { state }).ok;
}

describe('West Ardougne sewer route', () => {
    test('wearing the only Gas mask opens the pipe after starting Plague City', () => {
        expect(route({
            ...emptyWorldStateData(),
            quests: { 'Plague City': 'started' },
            worn: { 'Gas mask': 1 }
        })).toBe(true);
    });

    test('carrying a Gas mask without wearing it does not open the pipe', () => {
        expect(route({
            ...emptyWorldStateData(),
            quests: { 'Plague City': 'complete' },
            items: { 'Gas mask': 1 }
        })).toBe(false);
    });

    test('masks do not replace the Plague City requirement', () => {
        expect(route({
            ...emptyWorldStateData(),
            items: { 'Gas mask': 1 },
            worn: { 'Gas mask': 1 }
        })).toBe(false);
    });

    test('the mud pile returns to a walkable garden stand beside the blocked patch', () => {
        expect(route(emptyWorldStateData(), MUD_PILE, GARDEN)).toBe(true);
    });
});
