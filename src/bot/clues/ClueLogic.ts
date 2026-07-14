import type { ClueRow, ClueStep } from '#/bot/clues/types.js';

/** Pick the next actionable clue step from the held inventory. Pure — no
 *  client, no clock. A reward casket takes precedence over a clue scroll: if
 *  both are held you must open the casket to advance the trail. Unknown or
 *  empty ids yield null. */
export function identifyStep(
    heldIds: number[],
    db: Record<number, ClueRow>,
    casketIds: Record<number, string>
): ClueStep | null {
    for (const id of heldIds) {
        const casketObj = casketIds[id];
        if (casketObj !== undefined) return { type: 'open-casket', casketObj, casketId: id };
    }
    for (const id of heldIds) {
        const row = db[id];
        if (row !== undefined) return row;
    }
    return null;
}
