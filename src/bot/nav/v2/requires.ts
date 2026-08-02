import type { QuestProgress, TransportRequires, WorldState } from './types.js';

const QUEST_RANK: Record<QuestProgress, number> = {
    not_started: 0,
    unknown: 0,
    started: 1,
    complete: 2
};

export type RequiresFailure =
    | { ok: true }
    | { ok: false; reason: string };

/**
 * Whether a planned edge is usable under the given world state.
 * Unknown quest status fails closed for quest-gated edges (safer than false opens).
 */
export function meetsRequires(requires: TransportRequires | undefined, state: WorldState): RequiresFailure {
    if (!requires) {
        return { ok: true };
    }

    if (requires.members === true && !state.members) {
        return { ok: false, reason: 'members-only' };
    }

    if (requires.freeSlots !== undefined && state.freeSlots < requires.freeSlots) {
        return { ok: false, reason: `need ${requires.freeSlots} free inventory slots (have ${state.freeSlots})` };
    }

    if (requires.skills) {
        for (const sk of requires.skills) {
            const have = state.skills[sk.name.toLowerCase()] ?? state.skills[sk.name] ?? 0;
            if (have < sk.level) {
                return { ok: false, reason: `need ${sk.name} ${sk.level} (have ${have})` };
            }
        }
    }

    if (requires.currency) {
        const have = state.itemCount(requires.currency.name);
        if (have < requires.currency.amount) {
            return {
                ok: false,
                reason: `need ${requires.currency.amount}× ${requires.currency.name} (have ${have})`
            };
        }
    }

    if (requires.items) {
        for (const it of requires.items) {
            const have = state.itemCount(it.name);
            if (have < it.count) {
                return { ok: false, reason: `need ${it.count}× ${it.name} (have ${have})` };
            }
        }
    }

    if (requires.quests) {
        for (const q of requires.quests) {
            const status = state.questStatus(q.quest);
            if (QUEST_RANK[status] < QUEST_RANK[q.minStatus]) {
                return {
                    ok: false,
                    reason: `need quest ${q.quest} ${q.minStatus} (have ${status})`
                };
            }
        }
    }

    return { ok: true };
}

/** Convenience for PathFinder filters. */
export function isEdgeAllowed(requires: TransportRequires | undefined, state: WorldState | undefined): boolean {
    if (!state || !requires) {
        return true;
    }
    return meetsRequires(requires, state).ok;
}
