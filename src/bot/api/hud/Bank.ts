import type { InvItemSnapshot, WorldTile } from '../../adapter/ClientAdapter.js';
import { reader, actions } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';
import { Reachability } from '../Reachability.js';
import { Traversal } from '../Traversal.js';
import { Locs } from '../queries/Locs.js';
import { ChatDialog } from './ChatDialog.js';
import { Inventory } from './Inventory.js';

export { withdrawOp } from './bankOps.js';

export const Bank = {
    isOpen(): boolean {
        return reader.bankComId() !== -1;
    },

    // bank_main:com_93/94 (5386/5387) = Note/Item; opening the bank resets to Item, so set after opening
    async setNoteMode(on: boolean): Promise<void> {
        if (!Bank.isOpen()) {
            return;
        }
        actions.ifButton(on ? 5386 : 5387);
        await Execution.delayTicks(1);
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

    withdraw(name: string, op: string = 'Withdraw-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankItems(), name, op);
    },

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

    deposit(name: string, op: string = 'Deposit-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankSideItems(), name, op);
    },

    async depositInventory(): Promise<void> {
        await Bank.depositAllMatching(() => true);
    },

    async depositAllMatching(match: (name: string) => boolean, log?: (msg: string) => void): Promise<void> {
        for (let guard = 0; guard < 32; guard++) {
            let items = reader.bankSideItems();
            if (items.length === 0 && Bank.isOpen()) {
                log?.('deposit view not ready — waiting for the side backpack');
                await Execution.delayUntil(() => reader.bankSideItems().length > 0 || !Bank.isOpen(), 1200);
                items = reader.bankSideItems();
            }
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

    async openBooth(stand: WorldTile, boothName: string, op: string, log?: (msg: string) => void): Promise<boolean> {
        const pick = (acts: string[]): string | undefined =>
            acts.find(a => a.toLowerCase() === op.toLowerCase()) ?? acts.find(a => /^use/i.test(a)) ?? acts[0];

        for (let attempt = 0; attempt < 4 && !Bank.isOpen(); attempt++) {
            const booth = Locs.query().name(boothName).where(l => l.actions().length > 0).nearest()
                ?? Locs.query().name(boothName).nearest();
            if (!booth) {
                log?.(`no '${boothName}' in the scene — waiting`);
                await Execution.delayTicks(2);
                continue;
            }

            const chosen = pick(booth.actions());
            if (chosen) {
                await booth.interact(chosen);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 8000)) {
                    if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                    if (Bank.isOpen()) { return true; }
                }
            }

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

    async openNearest(boothName: string, op: string, log?: (msg: string) => void): Promise<boolean> {
        const pick = (acts: string[]): string | undefined =>
            acts.find(a => a.toLowerCase() === op.toLowerCase()) ?? acts.find(a => /^use|^bank/i.test(a)) ?? acts[0];

        for (let attempt = 0; attempt < 6 && !Bank.isOpen(); attempt++) {
            const booth = Locs.query().name(boothName).where(l => l.actions().length > 0).nearest();
            if (!booth) {
                log?.(`no usable '${boothName}' in the scene`);
                return false;
            }

            const chosen = pick(booth.actions());
            if (chosen) {
                await booth.interact(chosen);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 8000)) {
                    if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                    if (Bank.isOpen()) { return true; }
                }
            }

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
