import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../execution/Execution.js';

/**
 * Coarse quest-list colour. `unknown` means the tab hasn't loaded yet.
 * @see docs/reference/quest-engine.md#quest-state
 */
export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

const COLOUR_NOT_STARTED = 0xf80000;
const COLOUR_IN_PROGRESS = 0xf8f800;
const COLOUR_COMPLETE = 0x00f800;

// Why: mid-progress stages are not on the wire as varps for almost every quest (`scope=perm` without `transmit`).
// Why: so the client sees list colour (3-way), total QP, inventory, and journal text only once this API opens the log modal.

/**
 * Quest tab + journal.
 * @see docs/reference/quest-engine.md#what-the-client-can-see
 * @see docs/reference/api-quests.md
 */
export const Quests = {
    /** Every quest-list row: display name + colour-derived status. */
    all(): { name: string; status: QuestStatus }[] {
        return reader.questStatuses().map(q => ({ name: q.name, status: toStatus(q.colour) }));
    },
    /** Coarse status from the quest-list name colour (red / yellow / green); yellow covers every in-progress stage. */
    status(name: string): QuestStatus {
        const hit = reader.questStatuses().find(q => q.name.toLowerCase() === name.toLowerCase());
        return hit ? toStatus(hit.colour) : 'unknown';
    },
    /**
     * Open the quest's journal scroll and return its text lines.
     * Why: it flashes the main modal, the only client view of mid-stage text, so prefer an item or message oracle when one proves progress.
     */
    async journal(name: string): Promise<string[]> {
        const entry = reader.questStatuses().find(q => q.name.toLowerCase() === name.toLowerCase());
        if (!entry) {
            return [];
        }

        const before = reader.modals().main;
        if (!actions.ifButton(entry.comId)) {
            return [];
        }

        const opened = await Execution.delayUntil(() => {
            const main = reader.modals().main;
            return main !== -1 && main !== before;
        }, 5000);
        return opened ? reader.mainModalTexts() : [];
    },
    /** Total quest points, transmitted varp `qp` (index 101). */
    points(): number {
        return reader.varp(101);
    }
};

function toStatus(colour: number): QuestStatus {
    if (colour === COLOUR_COMPLETE) return 'complete';
    if (colour === COLOUR_IN_PROGRESS) return 'inProgress';
    if (colour === COLOUR_NOT_STARTED) return 'notStarted';
    return 'unknown';
}
