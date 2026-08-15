import type { QuestSnapshot } from '../../engine/types.js';
import { MURDER_OBJ, suspectOrder, type Suspect } from './areas.js';

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

// Why: an unread bank is not an empty bank, and a bare count sends the bot to a booth for something it never saw.
export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankKnown ? (snap.bankIds?.get(id) ?? 0) : 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

const THREADS = [MURDER_OBJ.THREAD_GREEN, MURDER_OBJ.THREAD_RED, MURDER_OBJ.THREAD_BLUE];

/** The thread in the pack, or null when the window still has to be searched. */
export function heldThread(snap: QuestSnapshot): number | null {
    return THREADS.find(id => held(snap, id) > 0) ?? null;
}

// Why: the print hunt walks the suspects in one fixed order and stops at the match, so every keepsake taken belongs to a suspect at or before the murderer — and the last one held is the murderer.
// Why: this survives a restart, which a counter of who has been cleared does not.

/** Who the matched print convicts, or null while the keepsakes cannot say. */
export function accused(snap: QuestSnapshot, thread: number): Suspect | null {
    if (held(snap, MURDER_OBJ.KILLERS_PRINT) === 0) {
        return null;
    }
    const order = suspectOrder(thread);
    for (let i = order.length - 1; i >= 0; i--) {
        if (held(snap, order[i].silver) > 0) {
            return order[i];
        }
    }
    return null;
}
