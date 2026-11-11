import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { activateTransportRows } from '#/bot/event/webwalk/activateStateAware.js';
import stairsJson from '#/bot/event/webwalk/data/stairEdges.json';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import type { QuestProgress } from '#/bot/event/webwalk/types.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const quest = 'Horror from the Deep';
const bank = { x: 3092, z: 3243, level: 0 };
const camp = { x: 2522, z: 10023, level: 0 };
const packPath = 'out/collision.lcnav.gz';
const postquest = [
    { debugName: 'horror_ladder_down', from: { x: 2507, z: 3644, level: 0 }, to: { x: 2518, z: 9994, level: 1 } },
    { debugName: 'horror_ladder_top', from: { x: 2510, z: 3644, level: 0 }, to: { x: 2518, z: 9994, level: 1 } },
    { debugName: 'horror_ladder_base', from: { x: 2519, z: 9995, level: 1 }, to: { x: 2510, z: 3644, level: 0 } },
    { debugName: 'horror_ladder_base2', from: { x: 2515, z: 10008, level: 0 }, to: { x: 2515, z: 10005, level: 1 } }
];

function state(status: QuestProgress) {
    return {
        ...emptyWorldStateData(),
        skills: { agility: 40 },
        items: { Coins: 2000 },
        quests: { [quest]: status }
    };
}

describe('postquest Lighthouse transports', () => {
    test('activates only the postquest ladder sources and destinations', () => {
        const rows = (stairsJson as TransportEdgeData[]).filter(edge =>
            postquest.some(expected => expected.debugName === edge.debugName)
        );
        const active = activateTransportRows(rows);
        expect(active.filter(edge => !edge.disabledReason)).toHaveLength(4);
        for (const expected of postquest) {
            expect(active).toContainEqual(expect.objectContaining({
                ...expected,
                requires: { quests: [{ quest, minStatus: 'complete' }] }
            }));
        }
        for (const edge of active.filter(edge => edge.disabledReason)) {
            expect(edge.requires).toBeUndefined();
        }
    });

    describe.skipIf(!existsSync(packPath))('collision pack routes', () => {
        const finder = existsSync(packPath) ? new PathFinder(gunzipSync(readFileSync(packPath))) : undefined;
        if (finder) loadDefaultNavEdges(finder);

        test('routes from the bank to dagannoths and back after quest completion', () => {
            const options = { state: state('complete'), useTeleportCatalog: false };
            const out = finder!.findPath(bank, camp, options);
            expect(out.ok).toBe(true);
            if (!out.ok) return;
            expect(out.hops).toContainEqual(expect.objectContaining({
                to: { x: 2518, z: 9994, level: 1 }
            }));
            expect(out.hops).toContainEqual(expect.objectContaining({
                from: { x: 2509, z: 3635, level: 0 },
                to: { x: 2509, z: 3636, level: 0 },
                locId: 4577,
                action: 'Walk-through'
            }));
            expect(out.hops).toContainEqual(expect.objectContaining({
                from: { x: 2515, z: 10005, level: 1 },
                to: { x: 2515, z: 10008, level: 0 }
            }));
            const back = finder!.findPath(camp, bank, options);
            expect(back.ok).toBe(true);
            if (!back.ok) return;
            expect(back.hops).toContainEqual(expect.objectContaining({
                from: { x: 2509, z: 3636, level: 0 },
                to: { x: 2509, z: 3635, level: 0 },
                locId: 4577,
                action: 'Walk-through'
            }));
            for (const edge of postquest.slice(2)) {
                expect(back.hops).toContainEqual(expect.objectContaining({ from: edge.from, to: edge.to }));
            }
        }, 30_000);

        test.each(['not_started', 'started', 'unknown'] as const)('blocks the postquest entrance when quest status is %s', status => {
            expect(finder!.findPath(postquest[1]!.from, camp, {
                state: state(status),
                useTeleportCatalog: false
            }).ok).toBe(false);
            expect(finder!.findPath(camp, bank, {
                state: state(status),
                useTeleportCatalog: false
            }).ok).toBe(false);
        }, 30_000);

        test.each(['not_started', 'started', 'unknown'] as const)('blocks the surface doorway when quest status is %s', status => {
            const options = { state: state(status), useTeleportCatalog: false };
            const outside = { x: 2509, z: 3633, level: 0 };
            expect(finder!.findPath(outside, postquest[1]!.from, options).ok).toBe(false);
            expect(finder!.findPath(postquest[1]!.from, outside, options).ok).toBe(false);
        }, 30_000);
    });
});
