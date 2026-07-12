import type { QuestStatus } from '../api/hud/Quests.js';

// Quest items, exact display names from the quest configs
// (quest_runemysteries.obj). 'Notes' is deliberately matched as a FULL name:
// it is far too generic for substring matching.
const TALISMAN = 'air talisman';
const PACKAGE = 'research package';
const NOTES = 'notes';

export type Held = 'talisman' | 'package' | 'notes' | null;
export type StepId = 'DUKE' | 'SEDRIDOR' | 'AUBURY' | 'RECOVER' | 'DONE' | 'WAIT';

/** Which quest item the pack holds — most-advanced wins (can't co-occur
 *  server-side, but stay deterministic). Exact CI full-name equality. Pure. */
export function heldQuestItem(names: (string | null)[]): Held {
    const lower = names.filter((n): n is string => n !== null).map(n => n.toLowerCase());
    if (lower.includes(NOTES)) {
        return 'notes';
    }
    if (lower.includes(PACKAGE)) {
        return 'package';
    }
    if (lower.includes(TALISMAN)) {
        return 'talisman';
    }
    return null;
}

/**
 * The whole quest as one decision: journal colour (the only client-visible
 * quest progress — the varp is never transmitted, ADR-0007) + held item.
 * inProgress with empty hands is deliberately RECOVER: the fixed
 * Aubury → Sedridor → Duke probe order both performs the quest's natural
 * "talk to Aubury again" step and re-collects any lost item (each NPC's
 * dialogue re-gives its own — see the design spec). Pure.
 */
export function nextStep(journal: QuestStatus, held: Held): StepId {
    if (journal === 'complete') {
        return 'DONE';
    }
    if (journal === 'unknown') {
        return 'WAIT';
    }
    if (journal === 'notStarted') {
        return 'DUKE';
    }
    if (held === 'talisman' || held === 'notes') {
        return 'SEDRIDOR';
    }
    if (held === 'package') {
        return 'AUBURY';
    }
    return 'RECOVER';
}
