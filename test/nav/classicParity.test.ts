/**
 * Offline pack / WorldState honesty for the single world walker.
 * Without a live WorldState snapshot, search fails open on coin/skill gates
 * (pack tools). With WorldState, those gates fail closed.
 */
import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import { PathFinder } from '#/bot/nav/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/nav/loadTransportGraph.js';
import { meetsRequires, isEdgeAllowed, hasGatingRequires } from '#/bot/nav/requires.js';
import { specialRequiresAt } from '#/bot/nav/specialRequires.js';
import type { WorldStateData } from '#/bot/nav/worldStateData.js';

/** Ardougne dock → Brimhaven shore (#352): coin-gated ship + gangplank. */
const ARD_DOCK = { x: 2668, z: 3285, level: 0 } as const;
const BRIM_SHORE = { x: 2779, z: 3218, level: 0 } as const;

function loadFinder(): PathFinder | null {
    const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
    if (!fs.existsSync(packPath)) {
        return null;
    }
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes as Uint8Array);
    loadDefaultNavEdges(finder);
    return finder;
}

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

    test('findPath without state expands coin-gated ship (offline pack parity)', () => {
        const finder = loadFinder();
        if (!finder) {
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
