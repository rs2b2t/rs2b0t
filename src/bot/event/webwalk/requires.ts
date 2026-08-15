import type { QuestProgress, TransportRequires, WorldState } from './types.js';

const QUEST_RANK: Record<QuestProgress, number> = {
    not_started: 0,
    unknown: 0,
    started: 1,
    complete: 2
};

type RequiresFailure =
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

    if (requires.worn) {
        for (const it of requires.worn) {
            const have = state.wornCount(it.name);
            if (have < it.count) {
                return { ok: false, reason: `need to wear ${it.name} (have ${have})` };
            }
        }
    }

    if (requires.forbidEntranaRestricted === true && state.entranaRestrictedGear) {
        return { ok: false, reason: 'remove weapons/armour before Entrana' };
    }

    // Web slash (content web.rs2): Knife use-on or bladed weapon. Fail open when
    // canSlashWeb is unset (offline pack probes without a live snapshot).
    if (requires.slashTool === true && state.canSlashWeb === false) {
        return { ok: false, reason: 'need Knife or a bladed weapon to slash webs' };
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

    // Why: an essence exit is a session dest, so a state carrying a known return that does not match fails closed, while an unset `essenceExitReturn` fails open for the offline pack.
    // Why: PathFinder re-checks this against the path-local return after entry hops.
    if (requires.essenceExitReturn !== undefined) {
        const live = state.essenceExitReturn;
        if (live !== undefined && live !== requires.essenceExitReturn) {
            return {
                ok: false,
                reason: `essence exit returns to ${live}, not ${requires.essenceExitReturn}`
            };
        }
    }

    // essenceEntrySetsReturn is a PathFinder path-state effect, not a usability gate.

    return { ok: true };
}

/** True when `requires` has at least one gate (not `{}`). */
export function hasGatingRequires(requires: TransportRequires | undefined): boolean {
    if (!requires) {
        return false;
    }
    return (
        requires.members === true
        || requires.freeSlots !== undefined
        || (requires.skills !== undefined && requires.skills.length > 0)
        || (requires.items !== undefined && requires.items.length > 0)
        || (requires.worn !== undefined && requires.worn.length > 0)
        || requires.currency !== undefined
        || (requires.quests !== undefined && requires.quests.length > 0)
        || requires.forbidEntranaRestricted === true
        || requires.slashTool === true
        || requires.essenceExitReturn !== undefined
    );
}

// Why: this matches search policy — no gates means allowed, while gated without state fails closed, the same as PathFinder skipping gated edges when WorldState is omitted.

/** Convenience predicate for PathFinder filters. */
export function isEdgeAllowed(requires: TransportRequires | undefined, state: WorldState | undefined): boolean {
    if (!hasGatingRequires(requires)) {
        return true;
    }
    if (!state) {
        return false;
    }
    return meetsRequires(requires, state).ok;
}
