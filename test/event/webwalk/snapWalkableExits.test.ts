import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { richTransportQuestMap } from '#/bot/event/webwalk/transportQuestReqs.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

// Why: zq_logbalance moves the player in two 2-tile teleports and the walker reads the midpoint, so a plan from that tile has to route rather than report the whole map unreachable.

/** Between the log's two 1x1 blocking locs: walkable, no exits, no transport edge. */
const LOG_MIDPOINT: NavPoint = { x: 2908, z: 3049, level: 0 };
const WEST_LANDING: NavPoint = { x: 2906, z: 3049, level: 0 };
const EAST_LANDING: NavPoint = { x: 2910, z: 3049, level: 0 };
/** Hard clue 3530, the Kharazi dig the sweep could not reach from the midpoint. */
const KHARAZI_DIG: NavPoint = { x: 2763, z: 2974, level: 0 };

function loadFinder(): PathFinder | null {
    const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
    if (!fs.existsSync(packPath)) {
        return null;
    }
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    return finder;
}

function kitted(): WorldStateData {
    return {
        ...emptyWorldStateData(),
        members: true,
        skills: Object.fromEntries(
            ['agility', 'prayer', 'mining', 'smithing', 'crafting', 'woodcutting', 'firemaking',
                'ranged', 'attack', 'strength', 'defence', 'hitpoints', 'magic', 'thieving', 'fishing',
                'cooking', 'runecraft', 'herblore', 'fletching', 'slayer', 'farming'].map(s => [s, 99])
        ),
        quests: richTransportQuestMap(),
        items: { Coins: 100_000, 'Shantay pass': 5, Rope: 5, Spade: 1, Machete: 1, 'Gas mask': 1, 'Climbing boots': 1 },
        worn: { 'Gas mask': 1, 'Climbing boots': 1 },
        freeSlots: 14,
        canSlashWeb: true
    };
}

const finder = loadFinder();
const maybe = finder ? describe : describe.skip;

maybe('an origin with no way out is snapped to one that has', () => {
    test('the Shilo log midpoint is walkable, exitless and edgeless', () => {
        expect(finder!.walkable(LOG_MIDPOINT.x, LOG_MIDPOINT.z, LOG_MIDPOINT.level)).toBe(true);
        expect(finder!.exitMask(LOG_MIDPOINT.x, LOG_MIDPOINT.z, LOG_MIDPOINT.level)).toBe(0);
        expect(finder!.edgesFrom(LOG_MIDPOINT.x, LOG_MIDPOINT.z, LOG_MIDPOINT.level)).toHaveLength(0);
    });

    test('snapWalkable moves off it onto a landing that has exits', () => {
        const snapped = finder!.snapWalkable(LOG_MIDPOINT, 2);
        expect(snapped).not.toBeNull();
        expect(finder!.exitMask(snapped!.x, snapped!.z, snapped!.level)).not.toBe(0);
        expect([WEST_LANDING.x, EAST_LANDING.x]).toContain(snapped!.x);
    });

    test('a plan off the log midpoint reaches the Kharazi dig', () => {
        expect(finder!.findPath(LOG_MIDPOINT, KHARAZI_DIG, { useTeleportCatalog: false, state: kitted() }).ok).toBe(true);
    });

    test('both real landings still snap to themselves', () => {
        for (const landing of [WEST_LANDING, EAST_LANDING]) {
            expect(finder!.snapWalkable(landing, 2)).toEqual(landing);
        }
    });
});
