// Why: the solver reports the reason and abandons rather than walking until the navigator gives up.
// Why: the audit allowlists these instead of counting them as findings.
// Why: a clue belongs here only when the gate is a quest or region the bot has no route through, not when it merely walks somewhere awkward.
// @see docs/reference/clues-gates.md#gated-clues

/** Clues behind a gate the bot cannot pass. */
export const CLUE_GATES: Record<number, string> = {
    // Isafdar / the elf camp is sealed behind Underground Pass + Regicide, and
    // neither quest is automated.
    3564: 'Lord Iorwerth is in the elf camp (requires Regicide)',
    3560: 'dig site is in Isafdar (requires Regicide)',
    3562: 'dig site is in Isafdar (requires Regicide)'
};

export function clueGate(id: number): string | null {
    return CLUE_GATES[id] ?? null;
}
