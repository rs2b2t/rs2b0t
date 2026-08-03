import { describe, expect, test } from 'bun:test';

import type { TransportEdgeData } from '#/bot/nav/PathFinder.js';
import stairs from '#/bot/nav/data/stairEdges.json';
import transports from '#/bot/nav/data/transports.json';

const transportEdges = transports as TransportEdgeData[];
const stairEdges = stairs as TransportEdgeData[];
const all = [...transportEdges, ...stairEdges];

describe('ladder transport data', () => {
    test('includes all four Mining Guild entrances and matching exits', () => {
        const surfaceLocs = new Set(['3018,3339', '3019,3338', '3019,3340', '3020,3339']);
        const undergroundLocs = new Set(['3018,9739', '3019,9738', '3019,9740', '3020,9739']);

        const entrances = transportEdges.filter(edge => edge.locId === 2113 && !edge.disabledReason);
        const exits = transportEdges.filter(edge => edge.locId === 1755 && undergroundLocs.has(`${edge.locX},${edge.locZ}`) && !edge.disabledReason);

        expect(new Set(entrances.map(edge => `${edge.locX},${edge.locZ}`))).toEqual(surfaceLocs);
        expect(new Set(exits.map(edge => `${edge.locX},${edge.locZ}`))).toEqual(undergroundLocs);
        expect(entrances.every(edge => edge.kind === 'dungeon' && edge.to.z - edge.from.z === 6400)).toBe(true);
        expect(exits.every(edge => edge.kind === 'dungeon' && edge.from.z - edge.to.z === 6400)).toBe(true);
    });

    test('does not route through ladders that cannot be traversed', () => {
        const broken = all.filter(edge => edge.locId === 1752);
        const untrustedShipLadder = all.filter(edge => edge.locId === 287);

        expect(broken).not.toHaveLength(0);
        expect(untrustedShipLadder).not.toHaveLength(0);
        expect([...broken, ...untrustedShipLadder].every(edge => Boolean(edge.disabledReason))).toBe(true);
    });

    test('uses dungeon semantics for active same-plane ladder teleports', () => {
        const samePlaneLadders = all.filter(edge => edge.debugName?.includes('ladder') && edge.from.level === edge.to.level && !edge.disabledReason);
        expect(samePlaneLadders).not.toHaveLength(0);
        expect(samePlaneLadders.every(edge => edge.kind === 'dungeon')).toBe(true);
    });

    test('binds Entrana ship gangplanks for deck disembark (#368)', () => {
        const offEntrana = transportEdges.find(e => e.debugName === 'ship_from_entrana_off');
        const onEntrana = transportEdges.find(e => e.debugName === 'ship_from_entrana_on');
        const offSarim = transportEdges.find(e => e.debugName === 'ship_to_entrana_off');
        const onSarim = transportEdges.find(e => e.debugName === 'ship_to_entrana_on');

        expect(offEntrana).toMatchObject({
            locId: 2415,
            locX: 2834,
            locZ: 3333,
            action: 'Cross',
            kind: 'gangplank',
            from: { x: 2834, z: 3331, level: 1 },
            to: { x: 2834, z: 3335, level: 0 }
        });
        expect(onEntrana).toMatchObject({ locId: 2414, kind: 'gangplank' });
        expect(offSarim).toMatchObject({
            locId: 2413,
            locX: 3048,
            locZ: 3232,
            from: { x: 3048, z: 3231, level: 1 },
            to: { x: 3048, z: 3234, level: 0 }
        });
        expect(onSarim).toMatchObject({ locId: 2412, kind: 'gangplank' });
    });

    test('binds each Mage Arena web crossing to the web between its stand tiles', () => {
        const web = (fromX: number, toX: number): TransportEdgeData | undefined => transportEdges.find(edge =>
            edge.from.x === fromX && edge.from.z === 3957 && edge.to.x === toX && edge.to.z === 3957
        );

        expect(web(3096, 3094)?.locX).toBe(3095);
        expect(web(3094, 3096)?.locX).toBe(3095);
        expect(web(3094, 3092)?.locX).toBe(3093);
        expect(web(3092, 3094)?.locX).toBe(3093);
    });

    test('binds west Varrock sewer web (#370) N-S across the centrepiece tile', () => {
        const web = (fromZ: number, toZ: number): TransportEdgeData | undefined => transportEdges.find(edge =>
            edge.from.x === 3210 && edge.from.z === fromZ && edge.to.x === 3210 && edge.to.z === toZ
            && edge.debugName === 'bigweb_slashable'
        );

        expect(web(9897, 9899)).toMatchObject({
            locId: 733,
            locX: 3210,
            locZ: 9898,
            action: 'Slash',
            kind: 'door'
        });
        expect(web(9899, 9897)).toMatchObject({
            locId: 733,
            locX: 3210,
            locZ: 9898,
            action: 'Slash',
            kind: 'door'
        });
    });

    test('binds clustered outdoor stair reverses to their outdoor top locs', () => {
        const yanille = stairEdges.find(edge => edge.from.x === 2517 && edge.from.z === 3426
            && edge.from.level === 1 && edge.to.x === 2516 && edge.to.z === 3423 && edge.to.level === 0);
        // 2527,3293 rather than 3292: the tile one square south is walkable with
        // an exit mask of 0, so the old edge landed on a square the walker could
        // reach and never leave. The snap now refuses sealed tiles.
        const ardougne = stairEdges.find(edge => edge.from.x === 2527 && edge.from.z === 3293
            && edge.from.level === 1 && edge.to.x === 2526 && edge.to.z === 3290 && edge.to.level === 0);

        expect(yanille).toMatchObject({ locId: 1736, locX: 2516, locZ: 3425, debugName: 'loc_1736' });
        expect(ardougne).toMatchObject({ locId: 1736, locX: 2526, locZ: 3292, debugName: 'loc_1736' });
    });

    test('keeps state-dependent Watchtower climbs auditable but out of the active graph', () => {
        const climbs = stairEdges.filter(edge => edge.debugName === 'watchladderup');
        const descents = stairEdges.filter(edge => edge.debugName === 'watchladderdown');

        expect(climbs).not.toHaveLength(0);
        expect(climbs.every(edge => edge.disabledReason?.includes('state-aware transports'))).toBe(true);
        expect(descents).not.toHaveLength(0);
        expect(descents.every(edge => !edge.disabledReason)).toBe(true);
    });

    test('full pipeline leaves every active stair with exact loc metadata', () => {
        const active = stairEdges.filter(edge => !edge.disabledReason);
        expect(active.every(edge => edge.locId !== undefined && edge.locX !== undefined && edge.locZ !== undefined)).toBe(true);
    });
});
