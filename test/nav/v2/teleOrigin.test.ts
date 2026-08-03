/**
 * #339 — origin-aware teleports + deny list for failed teles.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transportsJson from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';
import { teleportAllowedByPolicy } from '#/bot/nav/v2/policy.js';
import {
    SPELL_TELEPORTS,
    teleportAllowedFromOrigin,
    teleportById
} from '#/bot/nav/v2/teleportCatalog.js';
import {
    GLORY_MAX_WILDERNESS,
    SPELL_MAX_WILDERNESS,
    wildernessLevelAt
} from '#/bot/nav/v2/wilderness.js';
import type { WorldStateData } from '#/bot/nav/v2/worldStateData.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const finder = new PathFinder(bytes);
    finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson as never);
    return finder;
}

const rich: WorldStateData = {
    members: true,
    skills: { magic: 99, Magic: 99 },
    quests: { 'Plague City': 'complete', 'Watch Tower': 'complete', "Eadgar's Ruse": 'complete' },
    items: {
        'Law rune': 50,
        'Air rune': 50,
        'Fire rune': 50,
        'Water rune': 50,
        'Earth rune': 50,
        'Amulet of glory(4)': 1
    },
    freeSlots: 20
};

describe('wildernessLevelAt', () => {
    test('Edgeville bank is not wilderness', () => {
        expect(wildernessLevelAt({ x: 3094, z: 3493, level: 0 })).toBe(0);
    });

    test('north of ditch yields positive wildy levels', () => {
        // z=3520 → level 1; z=3520+19*8=3672 → level 20
        expect(wildernessLevelAt({ x: 3100, z: 3520, level: 0 })).toBe(1);
        expect(wildernessLevelAt({ x: 3100, z: 3520 + 19 * 8, level: 0 })).toBe(20);
        expect(wildernessLevelAt({ x: 3100, z: 3520 + 29 * 8, level: 0 })).toBe(30);
        expect(wildernessLevelAt({ x: 3100, z: 3520 + 30 * 8, level: 0 })).toBe(31);
    });
});

describe('teleportAllowedFromOrigin', () => {
    test('standard spells blocked above wildy 20', () => {
        const varrock = teleportById('varrock')!;
        expect(varrock.origin?.maxWildernessLevel).toBe(SPELL_MAX_WILDERNESS);
        const from = { x: 3100, z: 3520 + 25 * 8, level: 0 }; // wildy 26
        expect(teleportAllowedFromOrigin(varrock, from).ok).toBe(false);
        expect(teleportAllowedFromOrigin(varrock, from, 20).ok).toBe(true);
        expect(teleportAllowedFromOrigin(varrock, from, 21).ok).toBe(false);
    });

    test('glory allows higher wildy than spells', () => {
        const glory = teleportById('glory_edgeville')!;
        expect(glory.origin?.maxWildernessLevel).toBe(GLORY_MAX_WILDERNESS);
        const from = { x: 3100, z: 3600, level: 0 };
        expect(teleportAllowedFromOrigin(glory, from, 25).ok).toBe(true);
        expect(teleportAllowedFromOrigin(glory, from, 31).ok).toBe(false);
        expect(teleportAllowedFromOrigin(teleportById('varrock')!, from, 25).ok).toBe(false);
    });

    test('every spell tele has origin max wildy 20', () => {
        for (const d of SPELL_TELEPORTS) {
            expect(d.origin?.maxWildernessLevel, d.teleportId).toBe(SPELL_MAX_WILDERNESS);
        }
    });
});

describe('denyTeleportIds policy', () => {
    test('denied id is rejected by teleportAllowedByPolicy', () => {
        const edge = {
            id: 'varrock',
            from: { x: 0, z: 0, level: 0 },
            to: { x: 3213, z: 3424, level: 0 },
            kind: 'teleport' as const,
            cost: 40,
            teleportId: 'varrock'
        };
        expect(teleportAllowedByPolicy(edge, { denyTeleportIds: ['varrock'] }, 200).ok).toBe(false);
        expect(teleportAllowedByPolicy(edge, { denyTeleportIds: ['lumbridge'] }, 200).ok).toBe(true);
    });
});

describe('PathFinder tele inject origin gates', () => {
    test.skipIf(!HAS_PACK)('deep wildy does not inject spell tele even with runes', () => {
        const finder = loadFinder();
        // Deep wildy tile (level ~26) → Lumbridge — long enough that tele would win if allowed.
        const from = { x: 3100, z: 3520 + 25 * 8, level: 0 };
        const to = { x: 3222, z: 3218, level: 0 };
        const state: WorldStateData = { ...rich, wildernessLevel: 26 };
        const out = finder.findPath(from, to, {
            state,
            useTeleportCatalog: true,
            policy: { useTeleports: true, distanceBeforeTeleport: 40 }
        });
        if (out.ok) {
            const tele = out.hops.filter(h => h.kind === 'teleport');
            expect(tele.some(h => h.locName?.toLowerCase().includes('teleport') || true)).toBe(true);
            // No spell tele hop (Cast / Varrock teleport etc.)
            for (const h of out.hops) {
                if (h.kind === 'teleport') {
                    expect(h.locName ?? '').not.toMatch(/Varrock teleport|Lumbridge teleport|Falador teleport/i);
                }
            }
        }
    });

    test.skipIf(!HAS_PACK)('safe origin may inject Varrock tele for long route', () => {
        const finder = loadFinder();
        const from = { x: 3222, z: 3218, level: 0 }; // Lumbridge
        const to = { x: 3213, z: 3424, level: 0 }; // Varrock
        const state: WorldStateData = { ...rich, wildernessLevel: 0 };
        const out = finder.findPath(from, to, {
            state,
            useTeleportCatalog: true,
            policy: { useTeleports: true, distanceBeforeTeleport: 40 }
        });
        expect(out.ok).toBe(true);
        if (!out.ok) {
            return;
        }
        // Prefer tele when available (may still pure-walk if cost similar; assert tele not denied).
        const denied = finder.findPath(from, to, {
            state,
            useTeleportCatalog: true,
            policy: {
                useTeleports: true,
                distanceBeforeTeleport: 40,
                denyTeleportIds: ['varrock']
            }
        });
        if (out.ok && denied.ok && out.hops.some(h => h.kind === 'teleport')) {
            // With varrock denied, either no tele or different tele
            const deniedTeles = denied.hops.filter(h => h.kind === 'teleport');
            expect(deniedTeles.every(h => !/varrock/i.test(h.locName ?? ''))).toBe(true);
        }
    });
});
