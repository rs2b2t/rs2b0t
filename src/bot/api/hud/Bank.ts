import type { InvItemSnapshot, WorldTile } from '../../adapter/ClientAdapter.js';
import { reader, actions } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Reachability } from '../Reachability.js';
import { Traversal } from '../Traversal.js';
import { Locs } from '../queries/Locs.js';
import { ChatDialog } from './ChatDialog.js';
import { Inventory } from './Inventory.js';

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
        const invCount = (): number => Inventory.count(name);
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
     * Open a bank booth near `stand` (a booth-adjacent tile). Each attempt first
     * just CLICKS the booth's op: an OPLOC loc-op makes the server walk us to the
     * booth's own interactable tile and open it — the normal human click, robust
     * against the baked walker wedging a couple tiles off the stand and against a
     * stand that isn't quite adjacent to the nearest booth. Only if that doesn't
     * open the bank do we fall back to hand-walking exactly onto the stand and
     * operating the now-adjacent booth. Retries 4×, dismissing interrupting
     * dialogs; true once the bank screen is open.
     */
    async openBooth(stand: WorldTile, boothName: string, op: string, log?: (msg: string) => void): Promise<boolean> {
        // Prefer the requested op ("Use-quickly"), else any "Use…", else op 0.
        const pick = (acts: string[]): string | undefined =>
            acts.find(a => a.toLowerCase() === op.toLowerCase()) ?? acts.find(a => /^use/i.test(a)) ?? acts[0];

        for (let attempt = 0; attempt < 4 && !Bank.isOpen(); attempt++) {
            // Only REAL, operable booths — some banks have decorative same-named
            // booths with no ops that would wedge us if targeted.
            const booth = Locs.query().name(boothName).where(l => l.actions().length > 0).nearest()
                ?? Locs.query().name(boothName).nearest();
            if (!booth) {
                log?.(`no '${boothName}' in the scene — waiting`);
                await Execution.delayTicks(2);
                continue;
            }

            // 1) Click the booth op and let the server walk us to it (allow time
            //    for a multi-tile approach before deciding it didn't land).
            const chosen = pick(booth.actions());
            if (chosen) {
                await booth.interact(chosen);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 8000)) {
                    if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                    if (Bank.isOpen()) { return true; }
                }
            }

            // 2) Fallback: hand-walk exactly onto the stand and operate the booth
            //    from there (for booths behind a counter where OPLOC wanders).
            log?.(`booth didn't open from here — stepping onto (${stand.x}, ${stand.z}, ${stand.level})`);
            await Traversal.walkTo(stand, { radius: 0, timeoutMs: 15000, log });
            await Execution.delayTicks(1);
            const adj = Locs.query().name(boothName).where(l => l.actions().length > 0 && l.distance() <= 1).nearest();
            const adjOp = adj ? pick(adj.actions()) : undefined;
            if (adj && adjOp) {
                await adj.interact(adjOp);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 4000)) {
                    if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                }
            }
        }
        return Bank.isOpen();
    },

    /**
     * Open the nearest booth in the scene WITHOUT a hand-picked stand tile.
     * Like `openBooth`, each attempt first CLICKS the booth op and lets the
     * server walk us to it (OPLOC) — the robust path. Only if that doesn't open
     * the bank do we fall back to hand-walking onto a live-reachable tile beside
     * the booth (its customer side; the counter blocks the far side) and
     * operating the now-adjacent booth — needed for booths behind a counter/wall
     * where OPLOC wanders. Retries a few times. Use `openBooth` when you already
     * know the stand tile. True once open.
     */
    async openNearest(boothName: string, op: string, log?: (msg: string) => void): Promise<boolean> {
        const pick = (acts: string[]): string | undefined =>
            acts.find(a => a.toLowerCase() === op.toLowerCase()) ?? acts.find(a => /^use|^bank/i.test(a)) ?? acts[0];

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

            // 1) Click the booth op; the server walks us there and opens it.
            const chosen = pick(booth.actions());
            if (chosen) {
                await booth.interact(chosen);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 8000)) {
                    if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                    if (Bank.isOpen()) { return true; }
                }
            }

            // 2) Fallback: hand-walk onto a reachable tile beside the booth (its
            //    customer side; the wall/counter blocks the far side), then
            //    operate the now-adjacent booth.
            if (booth.distance() > 1) {
                const stand = bankStand(booth.tile());
                if (stand) {
                    log?.(`booth didn't open — stepping to the bank counter at (${stand.x}, ${stand.z})`);
                    await Traversal.walkTo(stand, { radius: 0, timeoutMs: 15000, log });
                } else {
                    log?.(`no reachable tile beside '${boothName}' yet — closing in`);
                    await Traversal.walkTo(booth.tile(), { radius: 1, timeoutMs: 15000, log });
                }
            }

            const adjacent = Locs.query().name(boothName).where(l => l.actions().length > 0 && l.distance() <= 1).nearest() ?? booth;
            const adjOp = pick(adjacent.actions());
            if (adjOp) {
                await adjacent.interact(adjOp);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 4000)) {
                    if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                }
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

    // Match the op tolerant of the hyphen/space split: callers pass the panel
    // form "Withdraw-1"/"Deposit-1", but the real bank interface labels are the
    // SPACE form "Withdraw 1"/"Deposit 1" (bank_main.if) — a strict `===` matched
    // nothing, silently dropping every withdraw (found live in the Task 7 clue
    // smoke: RockCrab never got a spade/food). Collapsing runs of spaces/hyphens
    // makes "withdraw-1" == "withdraw 1" without ever conflating "1" and "10".
    const norm = (s: string): string => s.toLowerCase().replace(/[\s-]+/g, ' ').trim();
    const opWanted = norm(opLabel);
    for (let i = 0; i < item.ops.length; i++) {
        const op = item.ops[i];
        if (op !== null && norm(op) === opWanted) {
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
