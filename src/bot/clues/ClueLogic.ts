import type { ClueRow, ClueStep } from '#/bot/clues/types.js';

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
