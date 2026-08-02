/**
 * Build WorldStateData from live client APIs (main thread only — not for NavWorker).
 */

import { reader } from '../../adapter/ClientAdapter.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests, type QuestStatus } from '../../api/hud/Quests.js';
import type { QuestProgress, WorldState } from './types.js';
import type { WorldStateData } from './worldStateData.js';
import { worldStateFromData } from './worldStateData.js';

function mapQuest(status: QuestStatus): QuestProgress {
    switch (status) {
        case 'notStarted':
            return 'not_started';
        case 'inProgress':
            return 'started';
        case 'complete':
            return 'complete';
        default:
            return 'unknown';
    }
}

export function snapshotWorldStateData(): WorldStateData {
    const skills: Record<string, number> = {};
    for (let i = 0; i < reader.skillCount(); i++) {
        const s = reader.stat(i);
        skills[s.name] = s.base;
        skills[s.name.toLowerCase()] = s.base;
    }

    const quests: Record<string, QuestProgress> = {};
    for (const q of Quests.all()) {
        const p = mapQuest(q.status);
        quests[q.name] = p;
        quests[q.name.toLowerCase()] = p;
    }

    const items: Record<string, number> = {};
    for (const item of Inventory.items()) {
        const name = item.name;
        if (!name) {
            continue;
        }
        items[name] = (items[name] ?? 0) + item.count;
        items[name.toLowerCase()] = (items[name.toLowerCase()] ?? 0) + item.count;
        items[name.toLowerCase().replace(/\s+/g, '')] =
            (items[name.toLowerCase().replace(/\s+/g, '')] ?? 0) + item.count;
    }
    // Explicit counts for tele-critical runes (names vary slightly by pack).
    for (const rune of ['Law rune', 'Air rune', 'Fire rune', 'Water rune', 'Earth rune']) {
        const c = Inventory.count(rune);
        if (c > 0) {
            items[rune] = Math.max(items[rune] ?? 0, c);
            items[rune.toLowerCase()] = Math.max(items[rune.toLowerCase()] ?? 0, c);
        }
    }

    return {
        members: true,
        skills,
        quests,
        items,
        freeSlots: Inventory.free()
    };
}

export function snapshotWorldState(): WorldState {
    return worldStateFromData(snapshotWorldStateData());
}
