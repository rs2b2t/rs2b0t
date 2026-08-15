/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to exercise modal closing without a live client. mock.module is deliberately avoided
   here: it is global in bun and poisons every later test file. */
import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';

// Why: `actions.closeModal()` only sends the close, so the modal stays up until the server answers.

const originals = {
    closeModal: actions.closeModal,
    modals: reader.modals,
    delayUntil: Execution.delayUntil
};

afterEach(() => {
    (actions as any).closeModal = originals.closeModal;
    (reader as any).modals = originals.modals;
    (Execution as any).delayUntil = originals.delayUntil;
});

/** Stand in for the client: `main` is whatever the fake server currently reports. */
function harness(opts: { open: number; clearsAfter: number | null; closeReturns?: boolean }): { closes: () => number } {
    let main = opts.open;
    let closes = 0;
    (reader as any).modals = () => ({ main, side: -1, chat: -1 });
    (actions as any).closeModal = () => {
        closes++;
        return opts.closeReturns ?? true;
    };
    (Execution as any).delayUntil = async (cond: () => boolean) => {
        for (let look = 0; look < 4; look++) {
            if (cond()) {
                return true;
            }
            if (opts.clearsAfter !== null && look >= opts.clearsAfter) {
                main = -1;
            }
        }
        return cond();
    };
    return { closes: () => closes };
}

describe('Modals.close', () => {
    test('sends nothing when no modal is open', async () => {
        const h = harness({ open: -1, clearsAfter: null });
        expect(await Modals.close()).toBe(true);
        expect(h.closes()).toBe(0);
    });

    test('waits for the modal to actually clear before reporting success', async () => {
        const h = harness({ open: 6675, clearsAfter: 1 });
        expect(await Modals.close()).toBe(true);
        expect(h.closes()).toBe(1);
    });

    test('reports failure when the modal never clears', async () => {
        const h = harness({ open: 6675, clearsAfter: null });
        expect(await Modals.close()).toBe(false);
        expect(h.closes()).toBe(1);
    });

    test('a root with no close button reports whether it is actually gone', async () => {
        const h = harness({ open: 6675, clearsAfter: null, closeReturns: false });
        expect(await Modals.close()).toBe(false);
        expect(h.closes()).toBe(1);
    });

    test('one call sends one close — the duplicate is what stomps a later modal', async () => {
        const h = harness({ open: 6675, clearsAfter: 0 });
        await Modals.close();
        expect(h.closes()).toBe(1);
    });
});

describe('Modals.closeIfOpen', () => {
    test('does nothing when nothing is open', async () => {
        const h = harness({ open: -1, clearsAfter: null });
        await Modals.closeIfOpen();
        expect(h.closes()).toBe(0);
    });

    test('closes and settles when something is open', async () => {
        const h = harness({ open: 6675, clearsAfter: 1 });
        await Modals.closeIfOpen();
        expect(h.closes()).toBe(1);
    });
});
