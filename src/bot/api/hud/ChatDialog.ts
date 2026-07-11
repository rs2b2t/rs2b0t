import { actions, reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';

export const ChatDialog = {
    /** A chat modal is open (dialog, make-x, etc.). */
    isOpen(): boolean {
        return reader.modals().chat !== -1;
    },

    /** A "Click here to continue" button is up. */
    canContinue(): boolean {
        return reader.chatContinueComId() !== -1;
    },

    /** Selectable option lines in the current dialog (text only). */
    options(): string[] {
        return reader.chatOptions().map(o => o.text);
    },

    /** A "What would you like to make?" skill-multi menu is open. */
    isMakeMenu(): boolean {
        return reader.makeProducts().length > 0;
    },

    /** Product names offered by the open make menu. */
    makeProducts(): string[] {
        return reader.makeProducts().map(p => p.name);
    },

    /**
     * In a skill-multi make menu, pick the product whose name contains `match`
     * (or the first product if omitted) at the largest fixed quantity offered
     * (prefer 10), clicking its resume button. Returns false if no product or
     * button matched.
     *
     * Watches whichever root `makeProducts()` actually read (chat OR main —
     * Task 10 found the tutorial's smithing menu is `if_openmain`, so a
     * chat-only watch never saw it close and always reported a false
     * timeout even though the click landed).
     */
    async make(match?: string): Promise<boolean> {
        const products = reader.makeProducts();
        if (products.length === 0) {
            return false;
        }

        const want = match?.toLowerCase();
        const product = want ? products.find(p => p.name.toLowerCase().includes(want)) : products[0];
        const btn = product?.buttons.filter(b => b.qty > 0).sort((a, b) => b.qty - a.qty)[0];
        if (!btn) {
            return false;
        }

        const modalsBefore = reader.modals();
        const usingChat = modalsBefore.chat !== -1;
        const before = usingChat ? modalsBefore.chat : modalsBefore.main;
        if (!actions.ifButton(btn.comId)) {
            return false;
        }

        return Execution.delayUntil(() => {
            const m = reader.modals();
            return (usingChat ? m.chat : m.main) !== before;
        }, 3000);
    },

    /** A MAIN-modal skill-multi panel (TYPE_INV columns, e.g. the tutorial's smithing anvil) is open. */
    isMainMakePanel(): boolean {
        return reader.mainSkillMultiItems().length > 0;
    },

    /** Product names offered by the open MAIN-modal skill-multi panel. */
    mainMakeProducts(): string[] {
        return reader.mainSkillMultiItems().map(i => i.name ?? '');
    },

    /**
     * Click a Make-style op on a MAIN-modal skill-multi panel item (see
     * `reader.mainSkillMultiItems()` — the tutorial anvil's `if_openmain`
     * smithing interface is the confirmed live case, Task 10) whose name
     * contains `match` (case-insensitive). Picks the first available op
     * (index 0, "Make"/"Make set" — qty 1) unless `op` names a specific one
     * ("Make 5"/"Make 10"/...). Returns false if no item/op matched.
     */
    async makeFromPanel(match: string, op?: string): Promise<boolean> {
        const items = reader.mainSkillMultiItems();
        const wanted = match.toLowerCase();
        const item = items.find(i => i.name?.toLowerCase().includes(wanted));
        if (!item) {
            return false;
        }

        const opWanted = op?.toLowerCase();
        const opIndex = opWanted ? item.ops.findIndex(o => o?.toLowerCase() === opWanted) : item.ops.findIndex(o => o !== null);
        if (opIndex === -1) {
            return false;
        }

        const before = reader.modals().main;
        if (!(await ActionRouter.driver.invButton(item.id, item.slot, item.comId, opIndex + 1))) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().main !== before, 5000);
    },

    /**
     * Like `makeFromPanel` but clicks the LARGEST-quantity make op for the
     * matched product — "Make 10" over "Make 5" over "Make" (qty parsed from the
     * op label, bare "Make" = 1). Used for bulk smithing at the anvil.
     */
    async makeFromPanelMax(match: string): Promise<boolean> {
        const items = reader.mainSkillMultiItems();
        const wanted = match.toLowerCase();
        const item = items.find(i => i.name?.toLowerCase().includes(wanted));
        if (!item) {
            return false;
        }

        let bestIdx = -1;
        let bestQty = -1;
        item.ops.forEach((o, i) => {
            if (o && /make/i.test(o)) {
                const m = o.match(/(\d+)/);
                const qty = m ? parseInt(m[1], 10) : 1;
                if (qty > bestQty) {
                    bestQty = qty;
                    bestIdx = i;
                }
            }
        });
        if (bestIdx === -1) {
            return false;
        }

        const before = reader.modals().main;
        if (!(await ActionRouter.driver.invButton(item.id, item.slot, item.comId, bestIdx + 1))) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().main !== before, 5000);
    },

    /** Press continue and wait for the dialog page to change. */
    async continue(): Promise<boolean> {
        const before = reader.modals().chat;
        // direct resolves synchronously; synthetic spans the mouse gesture
        if (!(await ActionRouter.driver.continueDialog())) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before || reader.chatContinueComId() !== -1, 3000);
    },

    /**
     * Pick a dialog option whose text contains `match` (case-insensitive), or
     * the first option if `match` is omitted. Returns false if no option
     * matched.
     */
    async chooseOption(match?: string): Promise<boolean> {
        const opts = reader.chatOptions();
        if (opts.length === 0) {
            return false;
        }

        const wanted = match?.toLowerCase();
        const pick = wanted ? opts.find(o => o.text.toLowerCase().includes(wanted)) : opts[0];
        if (!pick) {
            return false;
        }

        const before = reader.modals().chat;
        if (!actions.ifButton(pick.comId)) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before || reader.chatContinueComId() !== -1, 3000);
    }
};
