import { describe, expect, test } from 'bun:test';

import transports from '#/bot/nav/data/transports.json';
import { specialCrossingAt } from '#/bot/nav/data/specialCrossings.js';
import type { TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { specialRequiresAt } from '#/bot/nav/v2/specialRequires.js';
import { mageArenaBarrierEdges } from '#/bot/nav/v2/travelCatalog.js';
import { emptyWorldStateData, worldStateFromData } from '#/bot/nav/v2/worldStateData.js';
import { meetsRequires } from '#/bot/nav/v2/requires.js';

/**
 * Direction-inferred transports (#403): one loc placement, content picks side from
 * player/NPC tile. Graph must expose **two directed edges** (or proven one-way).
 */

const rows = transports as TransportEdgeData[];

function directed(
    locName: string,
    from: { x: number; z: number },
    to: { x: number; z: number }
): TransportEdgeData | undefined {
    return rows.find(
        e =>
            e.locName === locName
            && e.from.x === from.x
            && e.from.z === from.z
            && e.to.x === to.x
            && e.to.z === to.z
    );
}

describe('direction-inferred dual edges (#403)', () => {
    test('Shantay pass: dual edges; only southbound plan-requires a pass', () => {
        const south = directed('Shantay pass', { x: 3304, z: 3118 }, { x: 3304, z: 3114 });
        const north = directed('Shantay pass', { x: 3304, z: 3114 }, { x: 3304, z: 3118 });
        expect(south).toBeDefined();
        expect(north).toBeDefined();
        // specialCrossing + specialRequiresAt only on the north approach (into desert).
        expect(specialCrossingAt(3304, 3118, 0)?.requires?.item).toBe('Shantay pass');
        expect(specialCrossingAt(3304, 3114, 0)).toBeNull();
        const southReq = specialRequiresAt(3304, 3118, 0);
        expect(southReq?.items?.some(i => i.name === 'Shantay pass')).toBe(true);
        expect(specialRequiresAt(3304, 3114, 0)).toBeUndefined();
    });

    test('Gnome Stronghold areagate: dual Open edges on same loc', () => {
        const enter = rows.filter(
            e =>
                e.debugName === 'gnome_areagate'
                && e.from.x === 2461
                && e.from.z === 3382
                && e.to.z === 3385
        );
        const leave = rows.filter(
            e =>
                e.debugName === 'gnome_areagate'
                && e.from.x === 2461
                && e.from.z === 3385
                && e.to.z === 3382
        );
        expect(enter.length).toBeGreaterThanOrEqual(1);
        expect(leave.length).toBeGreaterThanOrEqual(1);
        // Femi box dialog only when entering from south (specialCrossing).
        expect(specialCrossingAt(2461, 3382, 0)?.label).toMatch(/Femi/i);
        expect(specialCrossingAt(2461, 3385, 0)).toBeNull();
    });

    test("McGrubor's loose railing: dual Squeeze-through edges", () => {
        expect(directed('Loose Railing', { x: 2661, z: 3500 }, { x: 2662, z: 3500 })).toBeDefined();
        expect(directed('Loose Railing', { x: 2662, z: 3500 }, { x: 2661, z: 3500 })).toBeDefined();
    });

    test('Mage Arena mystic portal: dual curated edges, inbound gear-gated', () => {
        const edges = mageArenaBarrierEdges();
        expect(edges).toHaveLength(2);
        const inbound = edges.find(e => e.debugName === 'magearena_scan_in');
        const outbound = edges.find(e => e.debugName === 'magearena_scan_out');
        expect(inbound).toMatchObject({
            from: { x: 3105, z: 3954, level: 0 },
            to: { x: 3105, z: 3952, level: 0 },
            locName: 'Mystic portal',
            action: 'Walk-through',
            locId: 2880
        });
        expect(outbound).toMatchObject({
            from: { x: 3105, z: 3952, level: 0 },
            to: { x: 3105, z: 3954, level: 0 }
        });
        expect(inbound?.requires?.forbidEntranaRestricted).toBe(true);
        expect(outbound?.requires?.forbidEntranaRestricted).toBeUndefined();

        const bare = worldStateFromData({ ...emptyWorldStateData(), members: true });
        const geared = worldStateFromData({
            ...emptyWorldStateData(),
            members: true,
            entranaRestrictedGear: true
        });
        expect(meetsRequires(inbound?.requires, bare).ok).toBe(true);
        expect(meetsRequires(inbound?.requires, geared).ok).toBe(false);
        expect(meetsRequires(outbound?.requires, geared).ok).toBe(true);
    });
});
