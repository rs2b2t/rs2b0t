import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../Execution.js';

/**
 * Coarse quest-list colour only — not mid-stage.
 * `unknown` means the tab is not loaded yet; it is not `notStarted`.
 * @see docs/QUESTS.md#quest-state
 */
export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

const COLOUR_NOT_STARTED = 0xf80000;
const COLOUR_IN_PROGRESS = 0xf8f800;
const COLOUR_COMPLETE = 0x00f800;

/**
 * Quest tab + journal. Mid-progress stages are **not** on the wire as varps for
 * almost every quest (`scope=perm` without `transmit`). What the client has:
 * list colour (3-way), total QP, inventory, and journal text only after this
 * API opens the log modal.
 * @see docs/QUESTS.md#what-the-client-can-see
 * @see docs/API.md#quests
 */
export const Quests = {
    /** Every quest-list row: display name + colour-derived status. */
    all(): { name: string; status: QuestStatus }[] {
        return reader.questStatuses().map(q => ({ name: q.name, status: toStatus(q.colour) }));
    },
    /**
     * Coarse status from the quest-list name colour (red / yellow / green).
     * Yellow is any in-progress state — not a stage index.
     */
    status(name: string): QuestStatus {
        const hit = reader.questStatuses().find(q => q.name.toLowerCase() === name.toLowerCase());
        return hit ? toStatus(hit.colour) : 'unknown';
    },
    /**
     * Open the quest's journal scroll and return its text lines.
     * This flashes the main modal — the only durable client view of mid-stage
     * narrative. Prefer item/message oracles when they uniquely prove progress.
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
    /** Total quest points — transmitted varp `qp` (index 101). */
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
