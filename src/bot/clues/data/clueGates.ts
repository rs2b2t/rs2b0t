/**
 * Clues behind a gate the bot cannot pass. The solver reports the reason and
 * abandons rather than walking until the navigator gives up, and the audit
 * allowlists them instead of counting them as findings.
 *
 * A clue belongs here only when the gate is a *quest or region* the bot has no
 * route through. A clue that merely walks somewhere awkward does not.
 *
 * @see docs/CLUES.md#gated-clues
 */
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
