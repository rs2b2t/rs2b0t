import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { TALK_ANCHORS } from '#/bot/api/ai/clues/data/talkAnchors.js';
import { PACK_UNREACHABLE } from '#/bot/api/ai/clues/data/unreachable.js';
import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { richTransportQuestMap } from '#/bot/event/webwalk/transportQuestReqs.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

// Why: audit-clues.ts plans with no world state, which fails open on every gated edge; this asks what is still shut with the quests done and the gate kit in the pack.

/** Both origins the clue audit plans from. */
const STARTS: readonly NavPoint[] = [
    { x: 3253, z: 3420, level: 0 },
    { x: 2725, z: 3491, level: 0 }
];

const SKILLS = Object.fromEntries(
    [
        'agility', 'prayer', 'mining', 'smithing', 'crafting', 'woodcutting', 'firemaking',
        'ranged', 'attack', 'strength', 'defence', 'hitpoints', 'magic', 'thieving', 'fishing',
        'cooking', 'runecraft', 'herblore', 'fletching', 'slayer', 'farming'
    ].map(s => [s, 99])
);

/** What e2e/clues/hardclue-nav-live.ts puts in the pack before it walks. */
const KIT: Record<string, number> = {
    Coins: 100_000,
    'Shantay pass': 5,
    Rope: 5,
    Spade: 1,
    Machete: 1,
    'Gas mask': 1,
    'Climbing boots': 1
};

function kitted(quests: boolean): WorldStateData {
    return {
        ...emptyWorldStateData(),
        members: true,
        skills: SKILLS,
        quests: quests ? richTransportQuestMap() : {},
        items: KIT,
        worn: { 'Gas mask': 1, 'Climbing boots': 1 },
        freeSlots: 14,
        canSlashWeb: true
    };
}

const HARD = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].obj.includes('_hard_'))
    .sort((a, b) => a - b);

function destination(id: number): NavPoint | null {
    const row = CLUE_DB[id];
    if (row.coord) {
        return row.coord;
    }
    const anchor = TALK_ANCHORS[id];
    return anchor ? { x: anchor.x, z: anchor.z, level: anchor.level } : null;
}

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

function unreachable(finder: PathFinder, state: WorldStateData): number[] {
    const out: number[] = [];
    for (const id of HARD) {
        const to = destination(id);
        if (!to) {
            out.push(id);
            continue;
        }
        const ok = STARTS.some(from => finder.findPath(from, to, { useTeleportCatalog: false, state }).ok);
        if (!ok) {
            out.push(id);
        }
    }
    return out;
}

describe('hard clue destinations, quests complete and the gate kit carried', () => {
    test('every hard clue has a coord or a talk anchor', () => {
        expect(HARD.length).toBe(64);
        expect(HARD.filter(id => destination(id) === null)).toEqual([]);
    });

    test('nothing is shut that PACK_UNREACHABLE does not already diagnose', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const shut = unreachable(finder, kitted(true));
        const undiagnosed = shut.filter(id => PACK_UNREACHABLE[id] === undefined);
        expect(
            undiagnosed.map(id => `${id} ${CLUE_DB[id].obj} → ${JSON.stringify(destination(id))}`)
        ).toEqual([]);
    }, 120_000);

    test('the quests are what open the gnome and Karamja destinations', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const withQuests = new Set(unreachable(finder, kitted(true)));
        const without = unreachable(finder, kitted(false));
        const opened = without.filter(id => !withQuests.has(id));
        expect(opened.length).toBeGreaterThan(0);
    }, 240_000);
});
