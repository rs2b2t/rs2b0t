/**
 * Clone WorldStateData with virtual inventory counts (e.g. bank items assumed held).
 */

import type { WorldStateData } from './worldStateData.js';

/** Return a shallow clone with extra item counts merged (max of existing + add). */
export function virtualizeWithItems(state: WorldStateData, add: Record<string, number>): WorldStateData {
    const items = { ...state.items };
    for (const [name, count] of Object.entries(add)) {
        if (count <= 0) {
            continue;
        }
        const cur = lookupLoose(items, name);
        items[name] = cur + count;
        // Keep a canonical key if we only had a loose match under another spelling.
        for (const k of Object.keys(items)) {
            if (k !== name && namesMatch(k, name)) {
                items[k] = items[name]!;
            }
        }
    }
    return {
        members: state.members,
        skills: { ...state.skills },
        quests: { ...state.quests },
        items,
        freeSlots: state.freeSlots
    };
}

function namesMatch(a: string, b: string): boolean {
    const na = a.toLowerCase().replace(/\s+/g, '');
    const nb = b.toLowerCase().replace(/\s+/g, '');
    return na === nb;
}

function lookupLoose(items: Record<string, number>, name: string): number {
    if (items[name] !== undefined) {
        return items[name]!;
    }
    const lower = name.toLowerCase();
    if (items[lower] !== undefined) {
        return items[lower]!;
    }
    const compact = lower.replace(/\s+/g, '');
    for (const [k, v] of Object.entries(items)) {
        if (k.toLowerCase() === lower || k.toLowerCase().replace(/\s+/g, '') === compact) {
            return v;
        }
    }
    return 0;
}
