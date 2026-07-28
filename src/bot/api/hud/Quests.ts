import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../Execution.js';

/**
 * A quest's journal colour. `unknown` means not yet loaded — it is not
 * `notStarted`.
 * @see docs/QUESTS.md#quest-state
 */
export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

const COLOUR_NOT_STARTED = 0xf80000;
const COLOUR_IN_PROGRESS = 0xf8f800;
const COLOUR_COMPLETE = 0x00f800;

/**
 * The quest tab — the authoritative source of quest progress.
 * @see docs/QUESTS.md#quest-state
 */
export const Quests = {
    all(): { name: string; status: QuestStatus }[] {
        return reader.questStatuses().map(q => ({ name: q.name, status: toStatus(q.colour) }));
    },
    status(name: string): QuestStatus {
        const hit = reader.questStatuses().find(q => q.name.toLowerCase() === name.toLowerCase());
        return hit ? toStatus(hit.colour) : 'unknown';
    },
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
