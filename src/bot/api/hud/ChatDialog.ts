import { actions, reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';

export const ChatDialog = {
    isOpen(): boolean {
        return reader.modals().chat !== -1;
    },

    canContinue(): boolean {
        return reader.chatContinueComId() !== -1;
    },

    options(): string[] {
        return reader.chatOptions().map(o => o.text);
    },

    isMakeMenu(): boolean {
        return reader.makeProducts().length > 0;
    },

    makeProducts(): string[] {
        return reader.makeProducts().map(p => p.name);
    },

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

    async makeX(match: string, count: number): Promise<boolean> {
        const products = reader.makeProducts();
        const want = match.toLowerCase();
        const product = products.find(p => p.name.toLowerCase().includes(want));
        const xBtn = product?.buttons.find(b => b.qty === -1);
        if (!xBtn) {
            return false;
        }
        if (!actions.ifButton(xBtn.comId)) {
            return false;
        }
        if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
            return false;
        }
        return actions.answerCountDialog(count);
    },

    isMainMakePanel(): boolean {
        return reader.mainSkillMultiItems().length > 0;
    },

    mainMakeProducts(): string[] {
        return reader.mainSkillMultiItems().map(i => i.name ?? '');
    },

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

    async continue(): Promise<boolean> {
        const before = reader.modals().chat;
        if (!(await ActionRouter.driver.continueDialog())) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before || reader.chatContinueComId() !== -1, 3000);
    },

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
