import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../execution/Execution.js';

// Why: Closing is asynchronous; wait for the modal to clear so the next task cannot send a second close to a newer modal.

/** One tick of server round-trip, plus room for a dropped action to be re-sent. */
const CLOSE_TIMEOUT_MS = 3000;

export const Modals = {
    main(): number {
        return reader.modals().main;
    },

    isOpen(): boolean {
        return reader.modals().main !== -1;
    },

    /** Close the main modal and wait for it to clear. Returns false on timeout. */
    async close(): Promise<boolean> {
        const before = reader.modals().main;
        if (before === -1) {
            return true;
        }
        if (!actions.closeModal()) {
            // No close button on this root; the caller's oracle decides whether that matters.
            return reader.modals().main === -1;
        }
        return Execution.delayUntil(() => reader.modals().main !== before, CLOSE_TIMEOUT_MS);
    },

    /** Close the current modal if present and wait for the server response. */
    async closeIfOpen(): Promise<void> {
        if (reader.modals().main !== -1) {
            await Modals.close();
        }
    }
};
