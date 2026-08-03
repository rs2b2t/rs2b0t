/**
 * Classic / pre-v2 parity guards.
 * Baseline: bce3c6e (before nav-v2 dual-run). Classic must not lose ships/skill
 * doors when WorldState is omitted (pack tools, snapshot failure).
 */
import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import { PathFinder } from '#/bot/nav/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/nav/loadTransportGraph.js';
import { meetsRequires, isEdgeAllowed, hasGatingRequires } from '#/bot/nav/v2/requires.js';
import { specialRequiresAt } from '#/bot/nav/v2/specialRequires.js';
import type { WorldStateData } from '#/bot/nav/v2/worldStateData.js';
import { resolveNavEngine, isNavV2, NAV_ENGINE_CLASSIC } from '#/bot/nav/navEngine.js';

/** Ardougne dock → Brimhaven shore (#352): coin-gated ship + gangplank. */
const ARD_DOCK = { x: 2668, z: 3285, level: 0 } as const;
const BRIM_SHORE = { x: 2779, z: 3218, level: 0 } as const;

function loadFinder(): PathFinder | null {
    const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
    if (!fs.existsSync(packPath)) {
        return null;
    }
    let bytes = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    return finder;
}

describe('classic engine default', () => {
    test('resolveNavEngine defaults to classic', () => {
        expect(resolveNavEngine(undefined)).toBe(NAV_ENGINE_CLASSIC);
        expect(resolveNavEngine(null)).toBe(NAV_ENGINE_CLASSIC);
        expect(isNavV2(undefined)).toBe(false);
        expect(isNavV2('classic')).toBe(false);
        expect(isNavV2('v2')).toBe(true);
    });
});

describe('requires without WorldState (pre-v2 pack parity)', () => {
    test('isEdgeAllowed stays fail-closed without state (helper policy; not PathFinder search)', () => {
        // Explicit "allowed right now?" helper is fail-closed. Search fail-open is
        // covered by findPath tests below.
        expect(isEdgeAllowed(undefined, undefined)).toBe(true);
        expect(hasGatingRequires({ currency: { name: 'Coins', amount: 30 } })).toBe(true);
        expect(isEdgeAllowed({ currency: { name: 'Coins', amount: 30 } }, undefined)).toBe(false);
    });

    test('ship pier and guild doors still carry requires for live state filtering', () => {
        // Plan-time metadata exists so live WorldState can filter — not removed for classic.
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

    test('findPath without state expands coin-gated ship (offline pack parity)', () => {
        const finder = loadFinder();
        if (!finder) {
            // CI without collision pack still runs helper tests above.
            return;
        }
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

    test('findPath with zero coins fails closed on ship (live honesty)', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
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
        // Pure walk around is not viable; without the fare the route is unreachable.
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
