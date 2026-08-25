// Why: the solver reports the reason and abandons rather than walking until the navigator gives up.
// Why: the audit allowlists these instead of counting them as findings.
// Why: a clue belongs here only when a quest seals its destination, not when it merely walks somewhere awkward.
// Why: the journal is read at solve time, so an account that has finished the quest walks the clue instead of abandoning it.
// @see docs/reference/clues-gates.md#gated-clues

import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';

export interface ClueGate {
    /** Quest-list display name, as `Quests.status` matches it. */
    quest: string;
    /** What the quest is holding shut. */
    reason: string;
}

/** Clues whose destination a quest seals off. */
export const CLUE_GATES: Record<number, ClueGate> = {
    // Isafdar and the elf camp open at Regicide; the seams themselves are
    // REGICIDE_SEAMS, which the baked nav pack still does not carry.
    3564: { quest: 'Regicide', reason: 'Lord Iorwerth is in the elf camp' },
    3560: { quest: 'Regicide', reason: 'dig site is in Isafdar' },
    3562: { quest: 'Regicide', reason: 'dig site is in Isafdar' }
};

// Why: `unknown` is the quest tab not loaded yet, so only `complete` opens the gate.
export function clueGate(id: number, status: (quest: string) => QuestStatus): string | null {
    const gate = CLUE_GATES[id];
    if (gate === undefined) {
        return null;
    }
    const journal = status(gate.quest);
    return journal === 'complete' ? null : `${gate.reason} (${gate.quest} reads ${journal})`;
}
