import { describe, expect, test } from 'bun:test';

import { SPECIAL_CROSSINGS, specialCrossingAt } from '#/bot/event/webwalk/data/specialCrossings.js';
import transports from '#/bot/event/webwalk/data/transports.json';
import { allTransportRows } from '#/bot/event/webwalk/loadTransportGraph.js';
import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';

// tanothjump1 (loc 2830) needs Agility 25 plus a 20gp toll within 8 tiles of ogre_guard4; tanothjump2 (loc 2831) is ungated.
// Why: both rocks are shape 10 (blocking), so the stand is the tile beside the rock, never the rock's own tile.

const rows = transports as TransportEdgeData[];

const IN_STAND = { x: 2531, z: 3026, level: 0 } as const;
const OUT_STAND = { x: 2530, z: 3029, level: 0 } as const;

const jump = (debugName: string) => rows.find(e => e.debugName === debugName);

describe("Gu'Tanoth chasm", () => {
    test('each rock keeps its own loc tile, taken from the map', () => {
        expect(jump('tanothjump1')).toMatchObject({ locId: 2830, locX: 2530, locZ: 3026 });
        expect(jump('tanothjump2')).toMatchObject({ locId: 2831, locX: 2531, locZ: 3029 });
    });

    test('the pair is a closed round trip between the two stands', () => {
        // Each landing is the opposite rock's stand, so jumping back and forth
        // returns you to where you started rather than drifting a tile a time.
        expect(jump('tanothjump1')).toMatchObject({ from: IN_STAND, to: OUT_STAND });
        expect(jump('tanothjump2')).toMatchObject({ from: OUT_STAND, to: IN_STAND });
    });

    test('inbound is Agility 25 and spends the 20gp toll', () => {
        const req = jump('tanothjump1')?.requires;
        expect(req?.skills).toEqual([{ name: 'agility', level: 25 }]);
        expect(req?.items).toEqual([{ name: 'Coins', count: 20, consumed: true }]);
    });

    test('outbound is ungated — content checks nothing on the way back', () => {
        expect(jump('tanothjump2')?.requires).toBeUndefined();
    });

    test('both stands carry a special crossing keyed at the edge from-tile', () => {
        expect(specialCrossingAt(IN_STAND.x, IN_STAND.z, 0)?.label).toBe("Gu'Tanoth chasm jump in (#364)");
        expect(specialCrossingAt(OUT_STAND.x, OUT_STAND.z, 0)?.label).toBe("Gu'Tanoth chasm jump out (#364)");
        // The rocks themselves block walking, so nothing may stand on them.
        expect(specialCrossingAt(2530, 3026, 0)).toBeNull();
        expect(specialCrossingAt(2531, 3029, 0)).toBeNull();
    });

    test('only the inbound crossing gates on Agility, matching the content', () => {
        expect(specialCrossingAt(IN_STAND.x, IN_STAND.z, 0)?.requiresSkill).toEqual({
            name: 'agility',
            level: 25
        });
        expect(specialCrossingAt(OUT_STAND.x, OUT_STAND.z, 0)?.requiresSkill).toBeUndefined();
    });
});

describe('skill-gated crossings', () => {
    test('every one has a transport edge starting at its stand', () => {
        // Why: a skill-gated crossing whose stand is no edge's `from` can never be pruned, so the walker plans through a shortcut it has no level for.
        const graph = allTransportRows();
        const gated = SPECIAL_CROSSINGS.filter(sc => sc.requiresSkill);
        expect(gated.length).toBeGreaterThan(0);
        for (const sc of gated) {
            const edge = graph.find(
                t => t.from.x === sc.x && t.from.z === sc.z && t.from.level === sc.level
            );
            expect(edge, `no transport edge starts at ${sc.label} (${sc.x},${sc.z})`).toBeDefined();
        }
    });
});
