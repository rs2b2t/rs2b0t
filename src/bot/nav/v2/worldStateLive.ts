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
        // substring-friendly: also store lower
        items[name.toLowerCase()] = (items[name.toLowerCase()] ?? 0) + item.count;
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
