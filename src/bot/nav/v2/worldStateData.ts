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

function lookupItem(items: Record<string, number>, name: string): number {
    if (items[name] !== undefined) {
        return items[name]!;
    }
    const lower = name.toLowerCase();
    if (items[lower] !== undefined) {
        return items[lower]!;
    }
    // "Law rune" ↔ "lawrune" style
    const compact = lower.replace(/\s+/g, '');
    for (const [k, v] of Object.entries(items)) {
        if (k.toLowerCase() === lower || k.toLowerCase().replace(/\s+/g, '') === compact) {
            return v;
        }
    }
    return 0;
}

export function worldStateFromData(data: WorldStateData): WorldState {
    return {
        members: data.members,
        skills: data.skills,
        freeSlots: data.freeSlots,
        questStatus: q => data.quests[q] ?? data.quests[q.toLowerCase()] ?? 'unknown',
        itemCount: name => lookupItem(data.items, name)
    };
}

export function emptyWorldStateData(members = true): WorldStateData {
    return { members, skills: {}, quests: {}, items: {}, freeSlots: 28 };
}
