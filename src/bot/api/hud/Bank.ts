import type { InvItemSnapshot, WorldTile } from '../../adapter/ClientAdapter.js';
import { reader, actions } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Reachability } from '../Reachability.js';
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

    /**
     * Withdraw an EXACT quantity via the item's "Withdraw-X" op + the "Enter
     * amount" count dialog (clicks Withdraw-X, waits for the prompt, answers it
     * with `count`, waits for the pack to receive them). Unlike batching
     * Withdraw-10, this never over-withdraws — needed when the pack must hold a
     * precise mix (e.g. 14 copper + 14 tin for bronze). Returns true once the
     * pack gained the requested amount (or the bank ran dry / the pack filled).
     */
    async withdrawX(name: string, count: number): Promise<boolean> {
        if (count <= 0) {
            return true;
        }
        const wanted = name.toLowerCase();
        const invCount = (): number => reader.inventory().filter(i => i.name?.toLowerCase() === wanted).reduce((s, i) => s + i.count, 0);
        const item = reader.bankItems().find(i => i.name?.toLowerCase() === wanted);
        const xOp = item?.ops.find((o): o is string => o !== null && /withdraw[\s-]*x/i.test(o));
        if (!xOp) {
            return false;
        }
        const target = invCount() + count;
        await clickInvButton(reader.bankItems(), name, xOp);
        if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
            return false;
        }
        actions.answerCountDialog(count);
        return Execution.delayUntil(
            () => invCount() >= target || Bank.count(name) === 0 || reader.inventory().length >= reader.inventorySize(),
            4000
        );
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
    },

    /**
     * Open the nearest booth in the scene WITHOUT a hand-picked stand tile.
     * A booth sits behind a counter inside a building — interacting from outside
     * just wanders the wall and wedges. So we first walk ONTO a live-reachable
     * tile orthogonally adjacent to the booth (routing us through the doorway up
     * to the counter), then operate the now-adjacent booth. Retries a few times.
     * Use `openBooth` when you already know the stand tile. True once open.
     */
    async openNearest(boothName: string, op: string, log?: (msg: string) => void): Promise<boolean> {
        for (let attempt = 0; attempt < 6 && !Bank.isOpen(); attempt++) {
            // Only REAL booths: some banks (Seers) have decorative "Bank booth"
            // locs with the SAME name but NO op (loc_2214, "for private customers
            // only") sitting against the outer walls — locking onto those wedges
            // the bot outside. Require a usable op so we target an operable booth.
            const booth = Locs.query().name(boothName).where(l => l.actions().length > 0).nearest();
            if (!booth) {
                log?.(`no usable '${boothName}' in the scene`);
                return false;
            }

            // walk onto a reachable tile beside the real booth (its customer side;
            // the wall/counter blocks the far side, so canReach only returns the
            // usable side) unless we're already beside it
            if (booth.distance() > 1) {
                const stand = bankStand(booth.tile());
                if (stand) {
                    log?.(`stepping to the bank counter at (${stand.x}, ${stand.z})`);
                    await Traversal.walkTo(stand, { radius: 0, timeoutMs: 30000, log });
                } else {
                    log?.(`no reachable tile beside '${boothName}' yet — closing in`);
                    await Traversal.walkTo(booth.tile(), { radius: 1, timeoutMs: 30000, log });
                }
            }

            const adjacent = Locs.query().name(boothName).where(l => l.actions().length > 0 && l.distance() <= 1).nearest() ?? booth;
            const chosen = adjacent.actions().find(a => a.toLowerCase() === op.toLowerCase()) ?? adjacent.actions().find(a => /^use|^bank/i.test(a)) ?? adjacent.actions()[0];
            if (chosen) {
                await adjacent.interact(chosen);
            }
            await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 6000);
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            }
        }
        return Bank.isOpen();
    }
};

/**
 * A live-reachable tile orthogonally adjacent to the booth — the counter tile
 * you stand on to bank. Uses the LIVE collision map (doors in their current
 * open state) so it routes in through the doorway; returns the one nearest the
 * player, or null if none is reachable right now (caller falls back).
 */
function bankStand(booth: WorldTile): WorldTile | null {
    const me = reader.worldTile();
    const neighbours: WorldTile[] = [
        { x: booth.x + 1, z: booth.z, level: booth.level },
        { x: booth.x - 1, z: booth.z, level: booth.level },
        { x: booth.x, z: booth.z + 1, level: booth.level },
        { x: booth.x, z: booth.z - 1, level: booth.level }
    ];
    const reachable = neighbours.filter(t => Reachability.canReach(t));
    if (reachable.length === 0) {
        return null;
    }
    if (!me) {
        return reachable[0];
    }
    const cheb = (t: WorldTile) => Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z));
    return reachable.sort((a, b) => cheb(a) - cheb(b))[0];
}

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
