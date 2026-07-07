import type { InvItemSnapshot, WorldTile } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Traversal } from '../Traversal.js';
import { Locs } from '../queries/Locs.js';
import { ChatDialog } from './ChatDialog.js';

/**
 * Bank access (read + component-button withdraw/deposit). The bank screen is
 * a main modal whose TYPE_INV child defines Withdraw-* ops; the side modal
 * swaps to a Deposit-* backpack view while it is open.
 */
export const Bank = {
    isOpen(): boolean {
        return reader.bankComId() !== -1;
    },

    items(): InvItemSnapshot[] {
        return reader.bankItems();
    },

    count(name: string): number {
        const wanted = name.toLowerCase();
        return reader
            .bankItems()
            .filter(i => i.name?.toLowerCase() === wanted)
            .reduce((sum, i) => sum + i.count, 0);
    },

    /** Click a Withdraw-* button on a bank item, e.g. withdraw('Logs', 'Withdraw-5'). */
    withdraw(name: string, op: string = 'Withdraw-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankItems(), name, op);
    },

    /** Click a Deposit-* button on a backpack item while the bank is open. */
    deposit(name: string, op: string = 'Deposit-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankSideItems(), name, op);
    },

    /** Deposit every slot (uses the highest Deposit op available per item). */
    async depositInventory(): Promise<void> {
        await Bank.depositAllMatching(() => true);
    },

    /**
     * Deposit every pack slot whose item name matches `match` (Deposit-all per
     * slot), leaving everything else — e.g. bank the loot but keep food/gear.
     */
    async depositAllMatching(match: (name: string) => boolean): Promise<void> {
        for (let guard = 0; guard < 32; guard++) {
            const items = reader.bankSideItems();
            const item = items.find(i => i.name !== null && match(i.name));
            if (!item) {
                return;
            }

            const allOp = item.ops.findIndex(op => op?.toLowerCase().includes('all'));
            const op = allOp !== -1 ? allOp + 1 : bestOpIndex(item.ops);
            if (op === -1) {
                return;
            }

            ActionRouter.driver.invButton(item.id, item.slot, item.comId, op);
            await Execution.delayUntil(() => !reader.bankSideItems().some(i => i.slot === item.slot && i.id === item.id), 2000);
        }
    },

    /**
     * Open a bank booth from `stand` (a booth-adjacent tile). A booth only
     * opens reliably when the op fires from a directly adjacent tile —
     * otherwise the approach pathing wanders the counter — so step exactly
     * onto the stand tile and operate the adjacent booth. Retries 4×,
     * dismissing interrupting dialogs; true once the bank screen is open.
     */
    async openBooth(stand: WorldTile, boothName: string, op: string, log?: (msg: string) => void): Promise<boolean> {
        for (let attempt = 0; attempt < 4 && !Bank.isOpen(); attempt++) {
            let booth = Locs.query().name(boothName).where(l => l.distance() <= 1).nearest();
            if (!booth) {
                const nearest = Locs.query().name(boothName).nearest();
                log?.(`no adjacent '${boothName}' (nearest: ${nearest ? `${nearest.tile()}` : 'none in scene'}) — stepping onto (${stand.x}, ${stand.z}, ${stand.level})`);
                await Traversal.walkTo(stand, { radius: 0, timeoutMs: 30000, log });
                await Execution.delayTicks(1);
                booth = Locs.query().name(boothName).where(l => l.distance() <= 1).nearest();
                if (!booth) {
                    continue;
                }
            }
            const chosen = booth.actions().find(a => a.toLowerCase() === op.toLowerCase()) ?? booth.actions().find(a => /^use/i.test(a)) ?? booth.actions()[0];
            if (chosen) {
                await booth.interact(chosen);
            }
            await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 4000);
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            }
        }
        return Bank.isOpen();
    }
};

function clickInvButton(items: InvItemSnapshot[], name: string, opLabel: string): boolean | Promise<boolean> {
    const wanted = name.toLowerCase();
    const item = items.find(i => i.name?.toLowerCase() === wanted);
    if (!item) {
        return false;
    }

    const opWanted = opLabel.toLowerCase();
    for (let i = 0; i < item.ops.length; i++) {
        if (item.ops[i]?.toLowerCase() === opWanted) {
            return ActionRouter.driver.invButton(item.id, item.slot, item.comId, i + 1);
        }
    }

    return false;
}

function bestOpIndex(ops: (string | null)[]): number {
    for (let i = ops.length - 1; i >= 0; i--) {
        if (ops[i]) {
            return i + 1;
        }
    }

    return -1;
}
