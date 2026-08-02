/**
 * Serializable world snapshot for the nav worker (no client imports).
 */

import type { QuestProgress, WorldState } from './types.js';

export interface WorldStateData {
    members: boolean;
    skills: Record<string, number>;
    quests: Record<string, QuestProgress>;
    /** Item display name → total count in backpack. */
    items: Record<string, number>;
    freeSlots: number;
}

export function worldStateFromData(data: WorldStateData): WorldState {
    return {
        members: data.members,
        skills: data.skills,
        freeSlots: data.freeSlots,
        questStatus: q => data.quests[q] ?? data.quests[q.toLowerCase()] ?? 'unknown',
        itemCount: name => data.items[name] ?? data.items[name.toLowerCase()] ?? 0
    };
}

export function emptyWorldStateData(members = true): WorldStateData {
    return { members, skills: {}, quests: {}, items: {}, freeSlots: 28 };
}
