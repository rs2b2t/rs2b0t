import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../execution/Execution.js';

// Why: `actions.closeModal()` only sends the close — it is a CLOSE_BUTTON menu action, and the modal stays in `reader.modals().main` until the server answers a tick or more later.
// Why: code that closes and reads on with no wait sees the modal still up, and so does every other task in the loop, so the next one to poll "is a modal open?" fires a second close that lands a tick later on whatever modal is open by then.
// Why: that is how a journal read's stale close shuts a scroll a later step had opened.
// Why: the task loop is cooperative, so a closer that awaits its own close yields with the modal gone and nobody else has a reason to close anything.

/** One tick of server round-trip, plus room for a dropped action to be re-sent. */
const CLOSE_TIMEOUT_MS = 3000;

export const Modals = {
    main(): number {
        return reader.modals().main;
    },

    isOpen(): boolean {
        return reader.modals().main !== -1;
    },

    /**
     * Close the open main modal and wait for it to go away.
     * Why: true when nothing was open or the modal cleared, and false when it is still up after {@link CLOSE_TIMEOUT_MS} — a failure worth logging rather than a timing artefact.
     */
    async close(): Promise<boolean> {
        const before = reader.modals().main;
        if (before === -1) {
            return true;
        }
        if (!actions.closeModal()) {
            // No close button on this root: nothing more this can do, and the
            // caller's own oracle decides whether that matters.
            return reader.modals().main === -1;
        }
        return Execution.delayUntil(() => reader.modals().main !== before, CLOSE_TIMEOUT_MS);
    },

    /** Close whatever is up, if anything, and settle. Never reports failure. */
    async closeIfOpen(): Promise<void> {
        if (reader.modals().main !== -1) {
            await Modals.close();
        }
    }
};
