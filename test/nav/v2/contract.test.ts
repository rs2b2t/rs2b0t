import { describe, expect, test } from 'bun:test';

import {
    activeEdges,
    compileV1Graph,
    doorToTransportEdges,
    ensureEdgeId,
    kindAllowedByPolicy,
    meetsRequires,
    routeSpanChebyshev,
    teleportAllowedByPolicy,
    transportEdgeId,
    v1TransportToEdge,
    type TransportEdge,
    type WorldState
} from '#/bot/nav/v2/index.js';

function state(partial: Partial<{
    members: boolean;
    skills: Record<string, number>;
    quests: Record<string, 'not_started' | 'started' | 'complete' | 'unknown'>;
    items: Record<string, number>;
    freeSlots: number;
}> = {}): WorldState {
    const quests = partial.quests ?? {};
    const items = partial.items ?? {};
    return {
        members: partial.members ?? true,
        skills: partial.skills ?? {},
        freeSlots: partial.freeSlots ?? 28,
        questStatus: q => quests[q] ?? 'unknown',
        itemCount: name => items[name] ?? 0
    };
}

describe('nav v2 edge ids', () => {
    test('stable for same endpoints and loc', () => {
        const a = transportEdgeId({
            kind: 'dungeon',
            from: { x: 3019, z: 9849, level: 0 },
            to: { x: 3019, z: 3451, level: 0 },
            locId: 1755,
            action: 'Climb-up'
        });
        const b = transportEdgeId({
            kind: 'dungeon',
            from: { x: 3019, z: 9849, level: 0 },
            to: { x: 3019, z: 3451, level: 0 },
            locId: 1755,
            action: 'Climb-up'
        });
        expect(a).toBe(b);
        expect(a).toContain('dungeon');
        expect(a).toContain('loc1755');
    });
});

describe('nav v2 meetsRequires', () => {
    test('empty requires always ok', () => {
        expect(meetsRequires(undefined, state()).ok).toBe(true);
        expect(meetsRequires({}, state()).ok).toBe(true);
    });

    test('skill gate (coal trucks log style)', () => {
        const req = { skills: [{ name: 'agility', level: 20 }] };
        expect(meetsRequires(req, state({ skills: { agility: 19 } })).ok).toBe(false);
        expect(meetsRequires(req, state({ skills: { agility: 20 } })).ok).toBe(true);
    });

    test('toll coins via items', () => {
        const req = { items: [{ name: 'Coins', count: 10, consumed: true }] };
        expect(meetsRequires(req, state({ items: { Coins: 9 } })).ok).toBe(false);
        expect(meetsRequires(req, state({ items: { Coins: 10 } })).ok).toBe(true);
    });

    test('toll coins via currency (Microbot-style field)', () => {
        const req = { currency: { name: 'Coins', amount: 10 } };
        expect(meetsRequires(req, state({ items: { Coins: 9 } })).ok).toBe(false);
        expect(meetsRequires(req, state({ items: { Coins: 10 } })).ok).toBe(true);
    });

    test('quest minStatus started', () => {
        const req = { quests: [{ quest: 'Nature Spirit', minStatus: 'started' as const }] };
        expect(meetsRequires(req, state({ quests: { 'Nature Spirit': 'not_started' } })).ok).toBe(false);
        expect(meetsRequires(req, state({ quests: { 'Nature Spirit': 'started' } })).ok).toBe(true);
        expect(meetsRequires(req, state({ quests: { 'Nature Spirit': 'complete' } })).ok).toBe(true);
        // unknown fails closed
        expect(meetsRequires(req, state()).ok).toBe(false);
    });

    test('freeSlots (Drezel pies)', () => {
        const req = { freeSlots: 6 };
        expect(meetsRequires(req, state({ freeSlots: 5 })).ok).toBe(false);
        expect(meetsRequires(req, state({ freeSlots: 6 })).ok).toBe(true);
    });

    test('members-only', () => {
        const req = { members: true };
        expect(meetsRequires(req, state({ members: false })).ok).toBe(false);
        expect(meetsRequires(req, state({ members: true })).ok).toBe(true);
    });
});

describe('nav v2 path policy (teleports)', () => {
    const varrockTele: TransportEdge = {
        id: 'teleport|varrock',
        from: { x: 0, z: 0, level: 0 },
        to: { x: 3213, z: 3424, level: 0 },
        kind: 'teleport',
        cost: 40,
        teleportId: 'varrock',
        requires: {
            skills: [{ name: 'magic', level: 25 }],
            items: [
                { name: 'Law rune', count: 1, consumed: true },
                { name: 'Air rune', count: 3, consumed: true },
                { name: 'Fire rune', count: 1, consumed: true }
            ]
        }
    };

    test('useTeleports false blocks teleport kind', () => {
        expect(kindAllowedByPolicy('teleport', { useTeleports: false })).toBe(false);
        expect(kindAllowedByPolicy('teleport', { useTeleports: true })).toBe(true);
        expect(kindAllowedByPolicy('dungeon', { useTeleports: false })).toBe(true);
    });

    test('distanceBeforeTeleport blocks short routes, allows long ones', () => {
        const policy = { distanceBeforeTeleport: 100 };
        const short = routeSpanChebyshev({ x: 3222, z: 3218, level: 0 }, { x: 3225, z: 3220, level: 0 });
        const long = routeSpanChebyshev({ x: 3222, z: 3218, level: 0 }, { x: 2965, z: 3378, level: 0 });
        expect(short).toBeLessThan(100);
        expect(long).toBeGreaterThan(100);
        expect(teleportAllowedByPolicy(varrockTele, policy, short).ok).toBe(false);
        expect(teleportAllowedByPolicy(varrockTele, policy, long).ok).toBe(true);
    });

    test('allowTeleportIds restrict to escape tele only', () => {
        const policy = { allowTeleportIds: ['varrock'] as const };
        expect(teleportAllowedByPolicy(varrockTele, policy, 500).ok).toBe(true);
        const camelot = { ...varrockTele, id: 'teleport|camelot', teleportId: 'camelot' };
        expect(teleportAllowedByPolicy(camelot, policy, 500).ok).toBe(false);
    });

    test('non-teleport edges ignore tele distance gate', () => {
        const ladder = v1TransportToEdge({
            from: { x: 3019, z: 9851, level: 0 },
            to: { x: 3019, z: 3451, level: 0 },
            locName: 'Ladder',
            action: 'Climb-up',
            kind: 'dungeon',
            locId: 1755,
            locX: 3019,
            locZ: 9850
        });
        expect(teleportAllowedByPolicy(ladder, { distanceBeforeTeleport: 9999 }, 1).ok).toBe(true);
    });
});

describe('nav v2 v1 adapters', () => {
    test('door becomes bidirectional edges with default cost 4', () => {
        const edges = doorToTransportEdges({
            x: 3000,
            z: 3000,
            level: 0,
            locId: 1,
            locName: 'Door',
            dir: 'N'
        });
        expect(edges).toHaveLength(2);
        expect(edges[0]!.cost).toBe(4);
        expect(edges[0]!.to).toEqual({ x: 3000, z: 3001, level: 0 });
        expect(edges[1]!.from).toEqual(edges[0]!.to);
        expect(edges[0]!.id).not.toBe(edges[1]!.id);
    });

    test('dungeon ladder carries openLocId and toTile landing', () => {
        const edge = v1TransportToEdge({
            from: { x: 3019, z: 9851, level: 0 },
            to: { x: 3019, z: 3451, level: 0 },
            locName: 'Ladder',
            action: 'Climb-up',
            kind: 'dungeon',
            locId: 1755,
            locX: 3019,
            locZ: 9850
        });
        expect(edge.kind).toBe('dungeon');
        expect(edge.cost).toBe(10);
        expect(edge.loc?.locId).toBe(1755);
        expect(edge.landing?.toTile).toEqual({ x: 3019, z: 3451, level: 0 });
        expect(ensureEdgeId(edge)).toBe(edge.id);
    });

    test('compileV1Graph drops nothing; activeEdges strips disabled', () => {
        const all = compileV1Graph({
            transports: [
                {
                    from: { x: 1, z: 1, level: 0 },
                    to: { x: 2, z: 2, level: 0 },
                    locName: 'Ladder',
                    action: 'Climb-up',
                    kind: 'stair',
                    disabledReason: 'state-aware deferred'
                },
                {
                    from: { x: 3, z: 3, level: 0 },
                    to: { x: 4, z: 4, level: 0 },
                    locName: 'Ladder',
                    action: 'Climb-up',
                    kind: 'dungeon',
                    locId: 1755,
                    locX: 3,
                    locZ: 3
                }
            ]
        });
        expect(all).toHaveLength(2);
        const live = activeEdges(all);
        expect(live).toHaveLength(1);
        expect(live[0]!.loc?.locId).toBe(1755);
    });

    test('party trapdoor openLocId survives compile', () => {
        const edge: TransportEdge = v1TransportToEdge({
            from: { x: 3019, z: 3449, level: 0 },
            to: { x: 3019, z: 9849, level: 0 },
            locName: 'Trapdoor',
            action: 'Climb-down',
            kind: 'dungeon',
            locId: 1568,
            openLocId: 1570,
            locX: 3019,
            locZ: 3449
        });
        expect(edge.loc?.locId).toBe(1568);
        expect(edge.loc?.openLocId).toBe(1570);
    });
});
