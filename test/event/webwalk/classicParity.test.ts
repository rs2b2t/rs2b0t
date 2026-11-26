// Coin and skill gates fail open without a WorldState snapshot and fail closed with one.
import { describe, expect, test } from 'bun:test';

import { meetsRequires, isEdgeAllowed, hasGatingRequires } from '#/bot/event/webwalk/requires.js';
import { specialRequiresAt } from '#/bot/event/webwalk/specialRequires.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { fullMapFinder, hasCollisionPack, isolatedLandingFinder } from '../../lib/navCollision.js';

/** Ardougne dock → Brimhaven shore (#352): coin-gated ship + gangplank. */
const ARD_DOCK = { x: 2668, z: 3285, level: 0 } as const;
const BRIM_SHORE = { x: 2779, z: 3218, level: 0 } as const;

describe('requires without WorldState (pack fail-open)', () => {
    test('isEdgeAllowed stays fail-closed without state (helper policy; not PathFinder search)', () => {
        expect(isEdgeAllowed(undefined, undefined)).toBe(true);
        expect(hasGatingRequires({ currency: { name: 'Coins', amount: 30 } })).toBe(true);
        expect(isEdgeAllowed({ currency: { name: 'Coins', amount: 30 } }, undefined)).toBe(false);
    });

    test('ship pier and guild doors still carry requires for live state filtering', () => {
        expect(specialRequiresAt(3027, 3218, 0)?.currency?.amount).toBe(30);
        expect(specialRequiresAt(2611, 3394, 0)?.skills?.[0]?.level).toBe(68);
    });

    test('meetsRequires still fails closed when state is present and short', () => {
        const state = {
            members: true,
            skills: {},
            freeSlots: 28,
            entranaRestrictedGear: false,
            questStatus: () => 'unknown' as const,
            itemCount: () => 0,
            wornCount: () => 0
        };
        expect(meetsRequires({ currency: { name: 'Coins', amount: 30 } }, state).ok).toBe(false);
        expect(
            meetsRequires(
                { currency: { name: 'Coins', amount: 30 } },
                { ...state, itemCount: () => 30 }
            ).ok
        ).toBe(true);
    });

    test('Captain Barnaby charges 30 coins when a world state is supplied', () => {
        const dock = { x: 2683, z: 3272, level: 0 };
        const deck = { x: 2775, z: 3234, level: 1 };
        const shore = { x: 2772, z: 3234, level: 0 };
        const finder = isolatedLandingFinder([dock, deck, shore]);
        const route = (coins?: number) => finder.findPath(dock, shore, {
            useTeleportCatalog: false,
            state: coins === undefined ? undefined : { ...emptyWorldStateData(), items: { Coins: coins } }
        });

        expect(route(29).ok).toBe(false);
        for (const trip of [route(), route(30)]) {
            expect(trip).toMatchObject({ ok: true, hops: [{ kind: 'ship', locName: 'Captain Barnaby' }, { kind: 'gangplank' }] });
        }
    });

    test.skipIf(!hasCollisionPack)('findPath without state expands coin-gated ship (offline pack parity)', () => {
        const finder = fullMapFinder();
        const out = finder.findPath(ARD_DOCK, BRIM_SHORE, { useTeleportCatalog: false });
        expect(out.ok).toBe(true);
        if (!out.ok) {
            return;
        }
        const kinds = out.hops.map(h => h.kind);
        expect(kinds).toContain('ship');
        expect(kinds).toContain('gangplank');
        expect(out.hops.some(h => h.locName === 'Captain Barnaby')).toBe(true);
    });

    test.skipIf(!hasCollisionPack)('findPath with zero coins fails closed on ship (live honesty)', () => {
        const finder = fullMapFinder();
        const broke: WorldStateData = {
            members: true,
            skills: {},
            quests: {},
            items: { Coins: 0 },
            freeSlots: 28
        };
        const out = finder.findPath(ARD_DOCK, BRIM_SHORE, {
            state: broke,
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(false);

        const rich: WorldStateData = { ...broke, items: { Coins: 5000 } };
        const funded = finder.findPath(ARD_DOCK, BRIM_SHORE, {
            state: rich,
            useTeleportCatalog: false
        });
        expect(funded.ok).toBe(true);
        if (funded.ok) {
            expect(funded.hops.some(h => h.locName === 'Captain Barnaby')).toBe(true);
        }
    });
});
