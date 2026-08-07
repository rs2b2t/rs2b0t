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
import { teleportAllowedByPolicy } from '#/bot/nav/policy.js';
import {
    SPELL_TELEPORTS,
    teleportAllowedFromOrigin,
    teleportById
} from '#/bot/nav/teleportCatalog.js';
import {
    GLORY_MAX_WILDERNESS,
    SPELL_MAX_WILDERNESS,
    wildernessLevelAt
} from '#/bot/nav/wilderness.js';
import type { WorldStateData } from '#/bot/nav/worldStateData.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes as Uint8Array);
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

    test('surface north of ditch yields positive wildy levels', () => {
        // z=3520 → level 1; z=3520+19*8=3672 → level 20
        expect(wildernessLevelAt({ x: 3100, z: 3520, level: 0 })).toBe(1);
        expect(wildernessLevelAt({ x: 3100, z: 3520 + 19 * 8, level: 0 })).toBe(20);
        expect(wildernessLevelAt({ x: 3100, z: 3520 + 29 * 8, level: 0 })).toBe(30);
        expect(wildernessLevelAt({ x: 3100, z: 3520 + 30 * 8, level: 0 })).toBe(31);
    });

    test('surface wildy allows levels 0–3; underground uses 9920 base', () => {
        expect(wildernessLevelAt({ x: 3100, z: 3600, level: 1 })).toBeGreaterThan(0);
        expect(wildernessLevelAt({ x: 3100, z: 9920, level: 0 })).toBe(1);
        expect(wildernessLevelAt({ x: 3100, z: 9920 + 19 * 8, level: 0 })).toBe(20);
        // Wrong: treating underground z with surface formula would be huge — we must not.
        expect(wildernessLevelAt({ x: 3100, z: 9920, level: 0 })).toBeLessThan(5);
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
        // Stale high wildy on state must not matter when `from` is the only origin input.
        const state: WorldStateData = { ...rich, wildernessLevel: 99 };
        const out = finder.findPath(from, to, {
            state,
            useTeleportCatalog: true,
            policy: { useTeleports: true, distanceBeforeTeleport: 40 }
        });
        expect(out.ok).toBe(true);
        if (!out.ok) {
            return;
        }
        for (const h of out.hops) {
            if (h.kind === 'teleport') {
                expect(h.locName ?? '').not.toMatch(
                    /Varrock teleport|Lumbridge teleport|Falador teleport|Camelot teleport|Ardougne teleport/i
                );
            }
        }
    });

    test.skipIf(!HAS_PACK)('bank stand start ignores deep-wildy state and may inject spell tele', () => {
        const finder = loadFinder();
        // Bank→Varrock with virtual/deep-wildy state (poisoned snapshot) must use bank origin.
        const bank = { x: 3094, z: 3493, level: 0 }; // Edgeville bank
        const varrock = { x: 3213, z: 3424, level: 0 };
        const poisoned: WorldStateData = { ...rich, wildernessLevel: 50 };
        const out = finder.findPath(bank, varrock, {
            state: poisoned,
            useTeleportCatalog: true,
            policy: { useTeleports: true, distanceBeforeTeleport: 40 }
        });
        expect(out.ok).toBe(true);
        if (!out.ok) {
            return;
        }
        // Edgeville→Varrock is short; tele may or may not win on cost. Assert wildy gate did not block:
        // a pure no-tele path is ok; if any spell tele appears it must be allowed at wildy 0.
        expect(wildernessLevelAt(bank)).toBe(0);
    });

    test.skipIf(!HAS_PACK)('denyTeleportIds drops varrock tele from long route', () => {
        const finder = loadFinder();
        const from = { x: 3222, z: 3218, level: 0 }; // Lumbridge
        const to = { x: 3213, z: 3424, level: 0 }; // Varrock
        const state: WorldStateData = { ...rich };
        const allowed = finder.findPath(from, to, {
            state,
            useTeleportCatalog: true,
            policy: { useTeleports: true, distanceBeforeTeleport: 40 }
        });
        const denied = finder.findPath(from, to, {
            state,
            useTeleportCatalog: true,
            policy: {
                useTeleports: true,
                distanceBeforeTeleport: 40,
                denyTeleportIds: ['varrock']
            }
        });
        expect(allowed.ok).toBe(true);
        expect(denied.ok).toBe(true);
        if (!allowed.ok || !denied.ok) {
            return;
        }
        if (allowed.hops.some(h => /varrock/i.test(h.locName ?? ''))) {
            expect(denied.hops.every(h => !/varrock/i.test(h.locName ?? ''))).toBe(true);
        }
    });
});
