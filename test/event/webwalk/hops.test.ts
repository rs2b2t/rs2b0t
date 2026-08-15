import { describe, expect, test } from 'bun:test';
import { hopsFromWaypoints, formatHops } from '#/bot/event/webwalk/hops.js';
import type { Waypoint } from '#/bot/event/webwalk/PathFinder.js';

describe('hopsFromWaypoints (#337)', () => {
    test('door edge A→B reports from=A, to=B with edgeCost when set', () => {
        const waypoints: Waypoint[] = [
            { x: 100, z: 200, level: 0 },
            {
                x: 100,
                z: 201,
                level: 0,
                transport: {
                    locName: 'Door',
                    action: 'Open',
                    locX: 100,
                    locZ: 201,
                    kind: 'door',
                    edgeCost: 4
                }
            },
            { x: 100, z: 205, level: 0 }
        ];
        const hops = hopsFromWaypoints(waypoints);
        expect(hops).toHaveLength(1);
        expect(hops[0]!.from).toEqual({ x: 100, z: 200, level: 0 });
        expect(hops[0]!.to).toEqual({ x: 100, z: 201, level: 0 });
        expect(hops[0]!.cost).toBe(4);
        expect(hops[0]!.kind).toBe('door');
    });

    test('dungeon hop uses previous waypoint as from and toTile as to', () => {
        const waypoints: Waypoint[] = [
            { x: 3010, z: 3339, level: 0 },
            {
                x: 3020,
                z: 9739,
                level: 0,
                transport: {
                    locName: 'Ladder',
                    action: 'Climb-down',
                    locX: 3020,
                    locZ: 3339,
                    kind: 'dungeon',
                    toTile: { x: 3020, z: 9739 },
                    edgeCost: 10
                }
            }
        ];
        const hops = hopsFromWaypoints(waypoints);
        expect(hops).toHaveLength(1);
        expect(hops[0]!.from).toEqual({ x: 3010, z: 3339, level: 0 });
        expect(hops[0]!.to).toEqual({ x: 3020, z: 9739, level: 0 });
        expect(hops[0]!.cost).toBe(10);
        expect(formatHops(hops)).toContain('Ladder');
    });

    test('terminal transport is never B→B when previous waypoint exists', () => {
        const waypoints: Waypoint[] = [
            { x: 5, z: 5, level: 0 },
            {
                x: 6,
                z: 5,
                level: 0,
                transport: {
                    locName: 'Gate',
                    action: 'Open',
                    locX: 6,
                    locZ: 5,
                    kind: 'door',
                    edgeCost: 4
                }
            }
        ];
        const hops = hopsFromWaypoints(waypoints);
        expect(hops[0]!.from).toEqual({ x: 5, z: 5, level: 0 });
        expect(hops[0]!.to).toEqual({ x: 6, z: 5, level: 0 });
        expect(hops[0]!.from).not.toEqual(hops[0]!.to);
    });
});
