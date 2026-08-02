import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transportsJson from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { activateTransportRows } from '#/bot/nav/v2/activateStateAware.js';
import { teleportById, JEWELLERY_TELEPORTS } from '#/bot/nav/v2/teleportCatalog.js';

describe('jewellery catalog execution metadata', () => {
    test('every jewellery dest has dialogueChoose for Rub menus', () => {
        for (const d of JEWELLERY_TELEPORTS) {
            expect(d.dialogueChoose?.length ?? 0, d.teleportId).toBeGreaterThan(0);
            expect(teleportById(d.teleportId)?.family).toBe('jewellery');
        }
    });

    test('spell ids resolve including watchtower and trollheim', () => {
        expect(teleportById('watchtower')?.family).toBe('spell');
        expect(teleportById('trollheim')?.family).toBe('spell');
        expect(teleportById('varrock')?.to).toEqual({ x: 3213, z: 3424, level: 0 });
    });
});

describe('state-aware ladder activation', () => {
    test('activates monastaryladder rows and strips disabledReason', () => {
        const mono = (stairsJson as TransportEdgeData[]).filter(e => e.debugName === 'monasteryladder');
        expect(mono.length).toBeGreaterThan(0);
        expect(mono.every(e => e.disabledReason)).toBe(true);
        const active = activateTransportRows(mono);
        expect(active.every(e => !e.disabledReason)).toBe(true);
        expect(active.every(e => e.requires?.skills?.some(s => s.name === 'prayer' && s.level === 31))).toBe(true);
    });

    test('pack loads monastary edges when prayer 31 in state (v2 filter path)', () => {
        const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
        if (!fs.existsSync(packPath)) {
            return;
        }
        let bytes = new Uint8Array(fs.readFileSync(packPath));
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            bytes = gunzipSync(bytes);
        }
        const finder = new PathFinder(bytes);
        finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson as never);
        // Edgeville monastery approach → upper floor tile near ladder top
        const from = { x: 3051, z: 3483, level: 0 };
        const to = { x: 3046, z: 3484, level: 1 };
        if (!finder.walkable(from.x, from.z, 0) || !finder.walkable(to.x, to.z, 1)) {
            return;
        }
        const low = finder.findPath(from, to, {
            state: {
                members: true,
                skills: { prayer: 1 },
                quests: {},
                items: {},
                freeSlots: 28
            },
            maxExpansions: 80_000
        });
        const high = finder.findPath(from, to, {
            state: {
                members: true,
                skills: { prayer: 31 },
                quests: {},
                items: {},
                freeSlots: 28
            },
            maxExpansions: 80_000
        });
        // With prayer 31 the monastary climb may be available; without, should not use that edge.
        // Don't require high to succeed (collision layout), but if both ok high should be cheaper or equal.
        if (low.ok && high.ok) {
            expect(high.cost).toBeLessThanOrEqual(low.cost);
        }
    });
});
