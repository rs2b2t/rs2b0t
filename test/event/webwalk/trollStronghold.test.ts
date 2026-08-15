import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import type { WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
/** Pack is gitignored — pack-dependent tests must skip, never silent-pass (#341). */
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadPack(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes as Uint8Array);
    loadDefaultNavEdges(finder);
    return finder;
}

function questReady(worn: Record<string, number> = { 'Climbing boots': 1 }): WorldStateData {
    return { ...emptyWorldStateData(true), skills: { agility: 70 }, worn };
}

const FALADOR_BANK = { x: 2946, z: 3369, level: 0 };
const DAD_ARENA = { x: 2911, z: 3612, level: 0 };
const TROLL_GENERAL = { x: 2831, z: 10086, level: 2 };
const GODRIC_CELL_DOOR = { x: 2833, z: 10078, level: 0 };
const DUNSTAN = { x: 2919, z: 3574, level: 0 };

describe.skipIf(!HAS_COLLISION_PACK)('Troll Stronghold route', () => {
    test('bank reaches Dad through the stile and the secret-way rock climbs', () => {
        const outcome = loadPack().findPath(FALADOR_BANK, DAD_ARENA, {
            state: questReady()
        });
        expect(outcome.ok).toBe(true);
        const hops = outcome.ok ? outcome.hops.map(h => `${h.action} ${h.locName}`) : [];
        expect(hops).toContain('Climb-over Stile');
        expect(hops.filter(h => h === 'Climb Rocks').length).toBe(3);
        expect(hops).toContain('Open Arena Entrance');
    });

    test('bank reaches a Troll General on the stronghold top floor', () => {
        const outcome = loadPack().findPath(FALADOR_BANK, TROLL_GENERAL, {
            state: questReady()
        });
        expect(outcome.ok).toBe(true);
        const hops = outcome.ok ? outcome.hops.map(h => `${h.action} ${h.locName}`) : [];
        expect(hops).toContain('Enter Cave Entrance');
        expect(hops).toContain('Exit Cave Exit');
        expect(hops).toContain('Enter Stronghold');
    });

    test('bank reaches the prison cells through the prison door and both staircases', () => {
        const outcome = loadPack().findPath(FALADOR_BANK, GODRIC_CELL_DOOR, {
            state: questReady()
        });
        expect(outcome.ok).toBe(true);
        const hops = outcome.ok ? outcome.hops.map(h => `${h.action} ${h.locName}`) : [];
        expect(hops).toContain('Unlock Prison Door');
        expect(hops.filter(h => h === 'Climb-down Stone Staircase').length).toBe(2);
    });

    test('the prison leaves by the back exit rather than retracing the stronghold', () => {
        const finder = loadPack();
        const outcome = finder.findPath(GODRIC_CELL_DOOR, DUNSTAN, {
            state: questReady()
        });
        expect(outcome.ok).toBe(true);
        const hops = outcome.ok ? outcome.hops.map(h => `${h.action} ${h.locName}`) : [];
        expect(hops).toContain('Open Exit');
        expect(hops).not.toContain('Enter Stronghold');
    });

    test('the secret-way ascent is gated on worn Climbing boots', () => {
        const outcome = loadPack().findPath(FALADOR_BANK, DAD_ARENA, {
            state: questReady({})
        });
        expect(outcome.ok).toBe(false);
    });

    test('the secret-way ascent is gated on Agility 15', () => {
        const state = { ...questReady(), skills: { agility: 14 } };
        const outcome = loadPack().findPath(FALADOR_BANK, DAD_ARENA, { state: state });
        expect(outcome.ok).toBe(false);
    });
});
