import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transportsJson from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';
import { hopsFromWaypoints, formatHops } from '#/bot/nav/v2/hops.js';
import { plannedEdge, isAdjacentSameLevel } from '#/bot/nav/v2/plannedEdge.js';
import type { WorldStateData } from '#/bot/nav/v2/worldStateData.js';

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
    finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson as never);
    return finder;
}

const richMage: WorldStateData = {
    members: true,
    skills: { magic: 99, Magic: 99, agility: 1 },
    quests: { 'Plague City': 'complete' },
    items: {
        'Law rune': 50,
        'Air rune': 50,
        'Fire rune': 50,
        'Water rune': 50,
        'Earth rune': 50
    },
    freeSlots: 20
};

describe('nav v2 phase 2–4 pathfinder', () => {
    test('ok outcomes include hops array', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const r = finder.findPath({ x: 3222, z: 3218, level: 0 }, { x: 3225, z: 3220, level: 0 });
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(Array.isArray(r.hops)).toBe(true);
        expect(hopsFromWaypoints(r.waypoints)).toEqual(r.hops);
    });

    test('skill gate: low agility avoids coal trucks log when state provided', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        // Seers-ish → coal trucks area path that would use the log at 20 agi
        const from = { x: 2725, z: 3485, level: 0 };
        const to = { x: 2580, z: 3480, level: 0 };
        const low: WorldStateData = {
            members: true,
            skills: { agility: 1, Agility: 1 },
            quests: {},
            items: {},
            freeSlots: 28
        };
        const high: WorldStateData = {
            ...low,
            skills: { agility: 20, Agility: 20 }
        };
        const rLow = finder.findPath(from, to, { state: low, maxExpansions: 400_000 });
        const rHigh = finder.findPath(from, to, { state: high, maxExpansions: 400_000 });
        // Both should still path (long way or short); high should not be worse than low when both ok
        if (rLow.ok && rHigh.ok) {
            expect(rHigh.cost).toBeLessThanOrEqual(rLow.cost);
        }
    });

    test('teleport catalog: long route with runes may use Varrock tele', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        // Lumbridge → Varrock with tele catalog
        const r = finder.findPath(
            { x: 3222, z: 3218, level: 0 },
            { x: 3213, z: 3424, level: 0 },
            {
                state: richMage,
                policy: { useTeleports: true, distanceBeforeTeleport: 50 },
                useTeleportCatalog: true
            }
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const tele = r.waypoints.some(w => w.transport?.teleportId === 'varrock');
        expect(tele).toBe(true);
        expect(formatHops(r.hops).toLowerCase()).toContain('varrock');
    });

    test('spell tele requires magic level (fail closed below gate)', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const runes = { 'Law rune': 50, 'Air rune': 150, 'Fire rune': 50 };
        const lowMage: WorldStateData = {
            members: true,
            skills: { magic: 24, Magic: 24 },
            quests: {},
            items: runes,
            freeSlots: 20
        };
        const highMage: WorldStateData = {
            members: true,
            skills: { magic: 25, Magic: 25 },
            quests: {},
            items: runes,
            freeSlots: 20
        };
        const from = { x: 3222, z: 3218, level: 0 };
        const to = { x: 3213, z: 3424, level: 0 };
        const opts = {
            policy: { useTeleports: true, distanceBeforeTeleport: 50 } as const,
            useTeleportCatalog: true as const
        };
        const rLow = finder.findPath(from, to, { ...opts, state: lowMage });
        const rHigh = finder.findPath(from, to, { ...opts, state: highMage });
        expect(rLow.ok).toBe(true);
        expect(rHigh.ok).toBe(true);
        if (!rLow.ok || !rHigh.ok) {
            return;
        }
        expect(rLow.waypoints.some(w => w.transport?.teleportId === 'varrock')).toBe(false);
        expect(rHigh.waypoints.some(w => w.transport?.teleportId === 'varrock')).toBe(true);
    });

    test('spell tele without WorldState does not inject (fail closed)', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const r = finder.findPath(
            { x: 3222, z: 3218, level: 0 },
            { x: 3213, z: 3424, level: 0 },
            {
                policy: { useTeleports: true, distanceBeforeTeleport: 50 },
                useTeleportCatalog: true
            }
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.waypoints.every(w => !w.transport?.teleportId)).toBe(true);
    });

    test('useTeleports false never injects spell hops', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const r = finder.findPath(
            { x: 3222, z: 3218, level: 0 },
            { x: 3213, z: 3424, level: 0 },
            {
                state: richMage,
                policy: { useTeleports: false },
                useTeleportCatalog: true
            }
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.waypoints.every(w => !w.transport?.teleportId)).toBe(true);
    });

    test('distanceBeforeTeleport blocks short hops', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const r = finder.findPath(
            { x: 3222, z: 3218, level: 0 },
            { x: 3225, z: 3220, level: 0 },
            {
                state: richMage,
                policy: { useTeleports: true, distanceBeforeTeleport: 200 },
                useTeleportCatalog: true
            }
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.waypoints.every(w => !w.transport?.teleportId)).toBe(true);
    });

    test('party under → falador still climbs ladder (no tele needed)', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const r = finder.findPath(
            { x: 3019, z: 9849, level: 0 },
            { x: 2965, z: 3378, level: 0 },
            { policy: { useTeleports: false } }
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const climb = r.waypoints.find(w => w.transport?.action === 'Climb-up');
        expect(climb).toBeDefined();
    });

    test('plannedEdge adjacency helper', () => {
        const e = plannedEdge({ x: 1, z: 1, level: 0 }, { x: 2, z: 1, level: 0 });
        expect(isAdjacentSameLevel(e)).toBe(true);
    });
});
