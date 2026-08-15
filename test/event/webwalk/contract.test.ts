import { describe, expect, test } from 'bun:test';

import {
    activeEdges,
    compileV1Graph,
    doorToTransportEdges,
    ensureEdgeId,
    inventoryNameMatchesJewellery,
    JEWELLERY_TELEPORTS,
    kindAllowedByPolicy,
    isEdgeAllowed,
    meetsRequires,
    routeSpanChebyshev,
    SPELL_TELEPORTS,
    teleportAllowedByPolicy,
    teleportDestinationsToEdges,
    transportEdgeId,
    v1TransportToEdge,
    type TransportEdge,
    type WorldState
} from '#/bot/event/webwalk/index.js';

function state(partial: Partial<{
    members: boolean;
    skills: Record<string, number>;
    quests: Record<string, 'not_started' | 'started' | 'complete' | 'unknown'>;
    items: Record<string, number>;
    worn: Record<string, number>;
    freeSlots: number;
    entranaRestrictedGear: boolean;
}> = {}): WorldState {
    const quests = partial.quests ?? {};
    const items = partial.items ?? {};
    const worn = partial.worn ?? {};
    return {
        members: partial.members ?? true,
        skills: partial.skills ?? {},
        freeSlots: partial.freeSlots ?? 28,
        entranaRestrictedGear: partial.entranaRestrictedGear ?? false,
        questStatus: q => quests[q] ?? 'unknown',
        itemCount: name => items[name] ?? 0,
        wornCount: name => worn[name] ?? 0
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

    test('toll coins via currency field', () => {
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

    test('worn Chef hat required (Cooking Guild)', () => {
        const req = { worn: [{ name: "Chef's hat", count: 1 }] };
        expect(meetsRequires(req, state({ worn: {} })).ok).toBe(false);
        expect(meetsRequires(req, state({ items: { "Chef's hat": 1 } })).ok).toBe(false);
        expect(meetsRequires(req, state({ worn: { "Chef's hat": 1 } })).ok).toBe(true);
    });

    test('forbidEntranaRestricted blocks when flag set', () => {
        const req = { members: true, forbidEntranaRestricted: true };
        expect(meetsRequires(req, state({ entranaRestrictedGear: true })).ok).toBe(false);
        expect(meetsRequires(req, state({ entranaRestrictedGear: false })).ok).toBe(true);
    });

    test('essenceExitReturn fail closed when state known and mismatched', () => {
        const req = { essenceExitReturn: 'aubury' };
        expect(meetsRequires(req, state()).ok).toBe(true); // unset → fail open
        expect(meetsRequires(req, { ...state(), essenceExitReturn: 'aubury' }).ok).toBe(true);
        expect(meetsRequires(req, { ...state(), essenceExitReturn: 'sedridor' }).ok).toBe(false);
    });
});

describe('nav v2 isEdgeAllowed', () => {
    test('no requires always allowed', () => {
        expect(isEdgeAllowed(undefined, undefined)).toBe(true);
        expect(isEdgeAllowed({}, undefined)).toBe(true);
    });
    test('requires without WorldState fail closed (match PathFinder)', () => {
        expect(isEdgeAllowed({ members: true }, undefined)).toBe(false);
        expect(isEdgeAllowed({ skills: [{ name: 'agility', level: 10 }] }, undefined)).toBe(false);
    });
    test('requires with state delegate to meetsRequires', () => {
        expect(isEdgeAllowed({ members: true }, state({ members: false }))).toBe(false);
        expect(isEdgeAllowed({ members: true }, state({ members: true }))).toBe(true);
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

    test('default distanceBeforeTeleport is 0 — cost decides, no hard floor', () => {
        // Unset → DEFAULT_DISTANCE_BEFORE_TELEPORT (0); short spans still admit the edge.
        expect(teleportAllowedByPolicy(varrockTele, { useTeleports: true }, 20).ok).toBe(true);
        expect(teleportAllowedByPolicy(varrockTele, undefined, 5).ok).toBe(true);
        expect(teleportAllowedByPolicy(varrockTele, { useTeleports: true, distanceBeforeTeleport: 40 }, 20).ok).toBe(
            false
        );
        expect(teleportAllowedByPolicy(varrockTele, { useTeleports: true, distanceBeforeTeleport: 40 }, 50).ok).toBe(
            true
        );
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

describe('nav v2 teleport catalog (Server scan)', () => {
    test('includes core spell destinations with magic+rune requires', () => {
        const ids = SPELL_TELEPORTS.map(t => t.teleportId);
        expect(ids).toEqual(
            expect.arrayContaining(['varrock', 'lumbridge', 'falador', 'camelot', 'ardougne', 'watchtower', 'trollheim'])
        );
        const varrock = SPELL_TELEPORTS.find(t => t.teleportId === 'varrock')!;
        expect(varrock.to).toEqual({ x: 3213, z: 3424, level: 0 });
        expect(varrock.requires?.skills?.[0]).toEqual({ name: 'magic', level: 25 });
    });

    test('jewellery matches Server single-dest duel ring and games neck', () => {
        const duel = JEWELLERY_TELEPORTS.find(t => t.teleportId === 'dueling_arena')!;
        const games = JEWELLERY_TELEPORTS.find(t => t.teleportId === 'games_burthorpe')!;
        expect(duel.to).toEqual({ x: 3315, z: 3235, level: 0 });
        expect(games.to).toEqual({ x: 2207, z: 4940, level: 0 });
        expect(inventoryNameMatchesJewellery('Ring of dueling(5)', duel)).toBe(true);
        expect(inventoryNameMatchesJewellery('Games necklace(8)', games)).toBe(true);
        expect(inventoryNameMatchesJewellery('Amulet of glory(4)', duel)).toBe(false);
    });

    test('glory has four destinations; uncharged name does not match charged prefix', () => {
        const glory = JEWELLERY_TELEPORTS.filter(t => t.teleportId.startsWith('glory_'));
        expect(glory).toHaveLength(4);
        expect(inventoryNameMatchesJewellery('Amulet of glory(2)', glory[0]!)).toBe(true);
        // uncharged "Amulet of glory" has no '(' — inventory matcher requires charged form
        expect(inventoryNameMatchesJewellery('Amulet of glory', glory[0]!)).toBe(false);
    });

    test('originless edges compile with kind teleport and acceptAnyLanding', () => {
        const edges = teleportDestinationsToEdges();
        expect(edges.length).toBe(SPELL_TELEPORTS.length + JEWELLERY_TELEPORTS.length);
        expect(edges.every(e => e.kind === 'teleport')).toBe(true);
        expect(edges.every(e => e.landing?.acceptAnyLanding === true)).toBe(true);
        expect(edges.some(e => e.teleportId === 'dueling_arena')).toBe(true);
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
        // edgeCosts: dungeon ≈ 4 ticks × 2 run-tiles/tick
        expect(edge.cost).toBe(8);
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
