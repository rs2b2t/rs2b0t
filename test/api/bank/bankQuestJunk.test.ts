import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import { findQuestJunk, QUEST_JUNK } from '#/bot/api/bank/bankQuestJunk.js';
import { parseObjPack } from '../../../tools/items/parse.js';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const PACK = join(CONTENT, 'pack', 'obj.pack');
const SCRIPTS = join(CONTENT, 'scripts');

const entry = QUEST_JUNK[0];

/** Quest-tab strings from content `questlist.if`. `Quests.status` matches these, not the wiki title. */
const QUEST_TAB = new Set([
    "Black Knight's Fortress",
    "Cook's Assistant",
    'Demon Slayer',
    'Rune Mysteries Quest',
    "Doric's Quest",
    'The Restless Ghost',
    'Goblin Diplomacy',
    'Ernest the Chicken',
    'Imp Catcher',
    "Pirate's Treasure",
    'Prince Ali Rescue',
    'Romeo & Juliet',
    'Sheep Shearer',
    'Shield of Arrav',
    "The Knight's Sword",
    'Vampire Slayer',
    "Witch's Potion",
    'Watch Tower',
    'Waterfall Quest',
    "Witch's House",
    'Biohazard',
    'Clock Tower',
    'Digsite Quest',
    'Big Chompy Bird Hunting',
    'Dwarf Cannon',
    'Family Crest',
    'Fight Arena',
    'Fishing Contest',
    "Gertrude's Cat",
    'The Grand Tree',
    'Hazeel Cult',
    "Hero's Quest",
    'Jungle Potion',
    'Legends Quest',
    'Lost City',
    "Merlin's Crystal",
    "Monk's Friend",
    'Murder Mystery',
    'Observatory Quest',
    'Plague City',
    'Scorpion Catcher',
    'Sea Slug Quest',
    'Sheep Herder',
    'Shilo Village',
    'Temple of Ikov',
    'The Tourist Trap',
    'Tree Gnome Village',
    'Tribal Totem',
    'Underground Pass',
    'Dragon Slayer',
    'Elemental Workshop',
    'Druidic Ritual',
    'Priest in Peril',
    'Nature Spirit',
    'Death Plateau',
    'Troll Stronghold',
    "Eadgar's Ruse",
    'Tai Bwo Wannai Trio',
    'Regicide',
    'Shades of Mortton',
    'Throne of Miscellania',
    'The Fremennik Trials',
    'Holy Grail',
    'Horror from the Deep',
    'Haunted Mine',
    'Monkey Madness',
    'Troll Romance',
    'In Search of the Myreque'
]);

function statuses(map: Record<string, QuestStatus>) {
    return (quest: string): QuestStatus => map[quest] ?? 'unknown';
}

function filesUnder(dir: string, ext: string, out: string[] = []): string[] {
    for (const ent of readdirSync(dir)) {
        const p = join(dir, ent);
        if (statSync(p).isDirectory()) {
            filesUnder(p, ext, out);
        } else if (ent.endsWith(ext)) {
            out.push(p);
        }
    }
    return out;
}

function objNames(): Map<string, string> {
    const names = new Map<string, string>();
    for (const file of filesUnder(SCRIPTS, '.obj')) {
        let cur: string | null = null;
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-zA-Z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
                continue;
            }
            if (cur && line.startsWith('name=')) {
                names.set(cur, line.slice(5));
            }
        }
    }
    return names;
}

describe('findQuestJunk', () => {
    test('a complete quest makes its leftover droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({ [entry.quest]: 'complete' }));
        expect(found).toHaveLength(1);
        expect(found[0].droppable).toBe(true);
    });

    test('an in-progress quest is reported but never droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({ [entry.quest]: 'inProgress' }));
        expect(found[0].droppable).toBe(false);
    });

    test('a not-started quest is reported but never droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({ [entry.quest]: 'notStarted' }));
        expect(found[0].droppable).toBe(false);
    });

    test('an unknown status is reported but never droppable', () => {
        const found = findQuestJunk([{ id: entry.id }], statuses({}));
        expect(found[0].status).toBe('unknown');
        expect(found[0].droppable).toBe(false);
    });

    test('items not on the list are ignored', () => {
        expect(findQuestJunk([{ id: 31337 }], statuses({}))).toEqual([]);
    });

    test('an empty bank finds nothing', () => {
        expect(findQuestJunk([], statuses({}))).toEqual([]);
    });

    test('only the finished quests leftover is droppable', () => {
        const found = findQuestJunk([{ id: 2399 }, { id: 300 }], statuses({ 'Demon Slayer': 'complete', "Witch's Potion": 'inProgress' }));
        expect(found.find(f => f.id === 2399)?.droppable).toBe(true);
        expect(found.find(f => f.id === 300)?.droppable).toBe(false);
    });
});

describe('QUEST_JUNK', () => {
    test('the list has no duplicate ids', () => {
        expect(new Set(QUEST_JUNK.map(e => e.id)).size).toBe(QUEST_JUNK.length);
    });

    test("Witch's Potion leftover is id 300 Rat's tail", () => {
        const tail = QUEST_JUNK.find(item => item.id === 300);
        expect(tail?.name).toBe("Rat's tail");
        expect(tail?.quest).toBe("Witch's Potion");
    });

    test('every entry names an item and a quest-tab row', () => {
        for (const item of QUEST_JUNK) {
            expect(item.id).toBeGreaterThanOrEqual(0);
            expect(item.name.length).toBeGreaterThan(0);
            expect(item.quest.length).toBeGreaterThan(0);
            expect(QUEST_TAB.has(item.quest), item.quest).toBe(true);
        }
    });

    test('same display names stay distinct by id', () => {
        const keys = QUEST_JUNK.filter(item => item.name === 'Key');
        expect(keys.length).toBeGreaterThan(1);
        expect(new Set(keys.map(item => item.id)).size).toBe(keys.length);
    });

    test('Recycling Centre leftovers that exist at 289 are on the list', () => {
        expect(QUEST_JUNK.find(item => item.id === 0)).toEqual({
            id: 0,
            name: 'Dwarf remains',
            quest: 'Dwarf Cannon'
        });
        expect(QUEST_JUNK.find(item => item.id === 2399)?.quest).toBe('Demon Slayer');
        expect(QUEST_JUNK.find(item => item.id === 600)?.name).toBe('Astrology book');
        expect(QUEST_JUNK.find(item => item.id === 415)?.name).toBe('Ethanea');
        expect(QUEST_JUNK.find(item => item.id === 78)?.name).toBe('Ice arrows');
        expect(QUEST_JUNK.find(item => item.id === 3)?.name).toBe("Nulodion's notes.");
        expect(QUEST_JUNK.find(item => item.id === 3102)?.quest).toBe('Death Plateau');
    });

    test('skips noted variants, dummy ice-arrow stacks, fake coins and later-quest keys', () => {
        const ids = new Set(QUEST_JUNK.map(item => item.id));
        for (const id of [4, 79, 80, 81, 82, 85, 88, 294, 617]) {
            expect(ids.has(id), String(id)).toBe(false);
        }
    });
});

describe.skipIf(!existsSync(PACK) || !existsSync(SCRIPTS))('QUEST_JUNK content pack', () => {
    test('every id and display name matches obj.pack and the quest .obj', () => {
        const pack = parseObjPack(readFileSync(PACK, 'utf8'));
        const byId = new Map([...pack.entries()].map(([dbg, id]) => [id, dbg]));
        const names = objNames();
        for (const item of QUEST_JUNK) {
            const dbg = byId.get(item.id);
            expect(dbg, `#${item.id}`).toBeDefined();
            expect(dbg!.startsWith('cert_'), dbg).toBe(false);
            expect(dbg!.startsWith('ice_arrow_'), dbg).toBe(false);
            expect(names.get(dbg!), dbg).toBe(item.name);
        }
    });
});
