/**
 * Serializable world snapshot for the nav worker (no client imports).
 */

import type { QuestProgress, WorldState } from './types.js';
import { canonicalQuestName } from './transportQuestReqs.js';

export interface WorldStateData {
    members: boolean;
    skills: Record<string, number>;
    quests: Record<string, QuestProgress>;
    /** Item display name → total count in backpack. */
    items: Record<string, number>;
    /** Worn equipment display name → count (usually 1). */
    worn?: Record<string, number>;
    freeSlots: number;
    /** Live Entrana restricted-gear heuristic (weapons/armour names). */
    entranaRestrictedGear?: boolean;
    /**
     * Knife or slash blade available (inv/worn). Set on live snapshot + after
     * bank virtualization. Undefined = offline / unknown → slashTool fail open.
     */
    canSlashWeb?: boolean;
    // Why: used for origin-aware teleport admission (#339); when omitted, planners compute it from the path start tile via `wildernessLevelAt`.

    /** Current wilderness combat level, 0 outside the wild. */
    wildernessLevel?: number;
    /**
     * Active essence-mine return id (`aubury`|`sedridor`|…) from
     * `%exit_essence_mine_coord` (varp 64). Omitted when unknown.
     */
    essenceExitReturn?: string;
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
    const worn = data.worn ?? {};
    return {
        members: data.members,
        skills: data.skills,
        freeSlots: data.freeSlots,
        entranaRestrictedGear: data.entranaRestrictedGear === true,
        ...(data.canSlashWeb !== undefined ? { canSlashWeb: data.canSlashWeb } : {}),
        ...(data.essenceExitReturn !== undefined ? { essenceExitReturn: data.essenceExitReturn } : {}),
        questStatus: q => {
            const canon = canonicalQuestName(q);
            return (
                data.quests[q]
                ?? data.quests[q.toLowerCase()]
                ?? data.quests[canon]
                ?? data.quests[canon.toLowerCase()]
                ?? 'unknown'
            );
        },
        itemCount: name => lookupItem(data.items, name),
        wornCount: name => lookupItem(worn, name)
    };
}

export function emptyWorldStateData(members = true): WorldStateData {
    return {
        members,
        skills: {},
        quests: {},
        items: {},
        worn: {},
        freeSlots: 28,
        entranaRestrictedGear: false
    };
}
