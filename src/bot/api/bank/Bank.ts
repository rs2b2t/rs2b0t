import type { InvItemSnapshot, WorldTile } from '../../adapter/ClientAdapter.js';
import { reader, actions } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import type { BankNpcAccess, BankObjectAccess } from './BankLocations.js';
import { Execution } from '../execution/Execution.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Traversal } from '../walking/Traversal.js';
import { Locs } from '../locs/Locs.js';
import { Npcs } from '../npcs/Npcs.js';
import { ChatDialog } from '../ui/dialogue/ChatDialog.js';
import { backpackCapacity, backpackSnapshots } from '../inventory/Inventory.js';

export { withdrawOp } from './bankOps.js';

function backpackFull(): boolean {
    const size = backpackCapacity();
    return size > 0 && backpackSnapshots().length >= size;
}

export type BackpackItem = Pick<InvItemSnapshot, 'slot' | 'id' | 'name' | 'count'>;

function sameBackpack(
    left: readonly BackpackItem[],
    right: readonly BackpackItem[]
): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every(item => right.some(candidate =>
        candidate.slot === item.slot
        && candidate.id === item.id
        && candidate.count === item.count
    ));
}

async function bankBackpackReady(): Promise<boolean> {
    if (reader.bankComId() === -1) {
        return false;
    }
    if (reader.modals().side === -1) {
        await Execution.delayUntil(() => reader.modals().side !== -1 || reader.bankComId() === -1, 2000);
    }
    if (reader.bankComId() === -1 || reader.modals().side === -1) {
        return false;
    }
    await Execution.delayTicks(1);
    return reader.bankComId() !== -1 && reader.modals().side !== -1;
}

async function continueObjectBankDialog(log?: (msg: string) => void): Promise<boolean> {
    if (!(await ChatDialog.continue())) {
        log?.('bank: failed to Continue the object dialogue');
        return false;
    }
    if (!(await Execution.delayUntil(() => Bank.isOpen(), 4000))) {
        log?.('bank: object dialogue completed without opening the bank');
        return false;
    }
    return true;
}

/**
 * The bank interface.
 * Why: `isOpen()` only means the component exists — the item list fills a beat later and the deposit side view lags the main modal by a tick, so a count of zero is not proof of an empty bank.
 * @see docs/reference/api-items.md#bank
 */
export const Bank = {
    isOpen(): boolean {
        return reader.bankComId() !== -1;
    },

    // isOpen only says the component exists — its item list fills a beat later, and again after a
    // deposit. Until then every count() reads 0, which is indistinguishable from an empty bank.
    loaded(): boolean {
        return reader.bankItems().length > 0;
    },

    snapshotReady(): boolean {
        return reader.bankSnapshotReady();
    },

    snapshotGeneration(): number {
        return reader.bankSnapshotGeneration();
    },

    async waitSnapshotAfter(generation: number, timeoutMs = 4000): Promise<boolean> {
        if (generation < 0) {
            return false;
        }
        await Execution.delayUntil(
            () => !Bank.isOpen() || reader.bankSnapshotGeneration() > generation,
            timeoutMs
        );
        return Bank.isOpen()
            && reader.bankSnapshotReady()
            && reader.bankSnapshotGeneration() > generation;
    },

    normalBackpackSnapshot(): BackpackItem[] | null {
        if (Bank.isOpen() || reader.inventorySize() !== 28 || !reader.inventorySnapshotReady()) {
            return null;
        }
        return reader.inventory().map(({ slot, id, name, count }) => ({ slot, id, name, count }));
    },

    async backpackReady(
        expected: readonly BackpackItem[],
        log?: (msg: string) => void
    ): Promise<boolean> {
        if (!(await bankBackpackReady())) {
            log?.('bank: side backpack modal did not become ready');
            return false;
        }
        await Execution.delayUntil(
            () => !Bank.isOpen()
                || (reader.bankSideSnapshotReady() && sameBackpack(reader.bankSideItems(), expected)),
            4000
        );
        const ready = Bank.isOpen()
            && reader.bankSideSnapshotReady()
            && sameBackpack(reader.bankSideItems(), expected);
        if (!ready) {
            log?.('bank: side backpack did not match the pre-open backpack');
        }
        return ready;
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

    countById(id: number): number {
        return reader
            .bankItems()
            .filter(i => i.id === id)
            .reduce((sum, i) => sum + i.count, 0);
    },

    withdraw(name: string, op: string = 'Withdraw-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankItems(), name, op);
    },

    withdrawById(id: number, op: string = 'Withdraw-1'): boolean | Promise<boolean> {
        return clickInvButtonById(reader.bankItems(), id, op);
    },

    async withdrawX(name: string, count: number): Promise<boolean> {
        if (count <= 0) {
            return true;
        }
        if (!(await bankBackpackReady())) {
            return false;
        }
        const wanted = name.toLowerCase();
        const invCount = (): number => backpackSnapshots()
            .filter(item => item.name?.toLowerCase() === wanted)
            .reduce((sum, item) => sum + item.count, 0);
        const item = reader.bankItems().find(i => i.name?.toLowerCase() === wanted);
        if (!item) {
            return false;
        }
        const before = invCount();
        const available = Math.max(0, item.count);
        if (available === 0) {
            return false;
        }
        const take = Math.min(count, available);
        const target = before + take;
        // Withdraw-1 / Withdraw-5 / Withdraw-10 skip the count dialog (more reliable than X).
        if (take === 1 || take === 5 || take === 10) {
            const fixedOp = item.ops.find(
                (o): o is string => o !== null && new RegExp(`withdraw[\\s-]*${take}\\b`, 'i').test(o)
            );
            if (fixedOp) {
                if (!(await clickInvButton(reader.bankItems(), name, fixedOp))) {
                    return false;
                }
                return Execution.delayUntil(
                    () => invCount() >= target || (invCount() > before && backpackFull()),
                    4000
                );
            }
        }
        if (take <= 50) {
            const fixed = [10, 5, 1].map(quantity => ({
                quantity,
                operation: item.ops.find(
                    (o): o is string => o !== null && new RegExp(`withdraw[\\s-]*${quantity}\\b`, 'i').test(o)
                )
            }));
            let remaining = take;
            const plan: { quantity: number; operation: string }[] = [];
            for (const candidate of fixed) {
                const clicks = Math.floor(remaining / candidate.quantity);
                if (clicks > 0 && !candidate.operation) {
                    plan.length = 0;
                    break;
                }
                for (let click = 0; click < clicks; click++) {
                    plan.push({ quantity: candidate.quantity, operation: candidate.operation! });
                }
                remaining %= candidate.quantity;
            }
            if (plan.length > 0 && remaining === 0) {
                for (const action of plan) {
                    const beforeClick = invCount();
                    if (!(await clickInvButton(reader.bankItems(), name, action.operation))) {
                        return false;
                    }
                    if (!(await Execution.delayUntil(
                        () => invCount() >= beforeClick + action.quantity || (invCount() > beforeClick && backpackFull()),
                        4000
                    ))) {
                        return false;
                    }
                    if (backpackFull() && invCount() < target) {
                        return true;
                    }
                }
                return invCount() >= target;
            }
        }
        const xOp = item.ops.find((o): o is string => o !== null && /withdraw[\s-]*x/i.test(o));
        if (!xOp) {
            return false;
        }
        if (!(await clickInvButton(reader.bankItems(), name, xOp))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
            return false;
        }
        if (!actions.answerCountDialog(take)) {
            return false;
        }
        return Execution.delayUntil(
            () => invCount() >= target || (invCount() > before && backpackFull()),
            4000
        );
    },

    async withdrawXById(id: number, count: number): Promise<boolean> {
        if (count <= 0) {
            return true;
        }
        if (!(await bankBackpackReady())) {
            return false;
        }
        const invCount = (): number => backpackSnapshots()
            .filter(item => item.id === id)
            .reduce((sum, item) => sum + item.count, 0);
        const item = reader.bankItems().find(i => i.id === id);
        const xOp = item?.ops.find((o): o is string => o !== null && /withdraw[\s-]*x/i.test(o));
        if (!item || !xOp) {
            return false;
        }
        const before = invCount();
        const available = Math.max(0, item.count);
        if (available === 0) {
            return false;
        }
        const target = before + Math.min(count, available);
        if (!(await clickInvButtonById(reader.bankItems(), id, xOp))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
            return false;
        }
        if (!actions.answerCountDialog(count)) {
            return false;
        }
        return Execution.delayUntil(
            () => invCount() >= target || (invCount() > before && backpackFull()),
            4000
        );
    },

    deposit(name: string, op: string = 'Deposit-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankSideItems(), name, op);
    },

    async depositInventory(): Promise<void> {
        await Bank.depositAllMatching(() => true);
    },

    async depositAllMatching(match: (name: string, id: number) => boolean, log?: (msg: string) => void): Promise<void> {
        for (let guard = 0; guard < 32; guard++) {
            let items = reader.bankSideItems();
            if (items.length === 0 && Bank.isOpen()) {
                log?.('deposit view not ready — waiting for the side backpack');
                await Execution.delayUntil(() => reader.bankSideItems().length > 0 || !Bank.isOpen(), 1200);
                items = reader.bankSideItems();
            }
            // a nameless obj (cache miss) is still an item taking a slot — let the matcher decide
            const item = items.find(i => match(i.name ?? '', i.id));
            if (!item) {
                return;
            }

            const allOp = item.ops.findIndex(op => op?.toLowerCase().includes('all'));
            const op = allOp !== -1 ? allOp + 1 : bestOpIndex(item.ops);
            if (op === -1) {
                return;
            }

            Input.invButton(item.id, item.slot, item.comId, op);
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
                    if (ChatDialog.canContinue() && await continueObjectBankDialog(log)) { return true; }
                    if (Bank.isOpen()) { return true; }
                }
            }

            log?.(`booth didn't open from here — stepping near (${stand.x}, ${stand.z}, ${stand.level})`);
            // radius 1: adjacent is enough to click the booth; exact-tile pin looks robotic.
            // 90s — 15s was too short for long camp→bank legs (Rimmington→Fally E).
            await Traversal.walkTo(stand, { radius: 1, timeoutMs: 90_000, log });
            await Execution.delayTicks(1);
            const adj = Locs.query().name(boothName).where(l => l.actions().length > 0 && l.distance() <= 1).nearest();
            const adjOp = adj ? pick(adj.actions()) : undefined;
            if (adj && adjOp) {
                await adj.interact(adjOp);
                if (await Execution.delayUntil(() => Bank.isOpen() || ChatDialog.canContinue(), 4000)) {
                    if (ChatDialog.canContinue() && await continueObjectBankDialog(log)) { return true; }
                }
            }
        }
        return Bank.isOpen();
    },

    /**
     * Open a bank that lives behind a conversation rather than a booth.
     * Why: Gundai chats, offers two options, and only runs `@openbank` once the right one is picked, so this drives the dialogue rather than waiting on a single op.
     */
    async openNpcAccess(access: BankNpcAccess, log?: (msg: string) => void): Promise<boolean> {
        for (let attempt = 0; attempt < 3 && !Bank.isOpen(); attempt++) {
            if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
                const banker = Npcs.query().name(access.name).action(access.op).nearest();
                if (!banker) {
                    log?.(`no '${access.name}' in the scene to bank with`);
                    await Execution.delayTicks(1);
                    continue;
                }
                await banker.interact(access.op);
                if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue() || Bank.isOpen(), 6000))) {
                    log?.(`'${access.name}' never opened a dialogue`);
                    continue;
                }
            }
            for (let guard = 0; guard < 12 && !Bank.isOpen(); guard++) {
                if (ChatDialog.options().some(o => o.toLowerCase().includes(access.choose.toLowerCase()))) {
                    await ChatDialog.chooseOption(access.choose);
                } else if (ChatDialog.canContinue()) {
                    await ChatDialog.continue();
                } else {
                    break;
                }
            }
            await Execution.delayUntil(() => Bank.isOpen(), 3000);
        }
        if (!Bank.isOpen()) {
            log?.(`could not get ${access.name} to open the bank`);
        }
        return Bank.isOpen();
    },

    async openNearestAccess(access: BankObjectAccess, log?: (msg: string) => void): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }

        if (access.openFirst && !locWithAction(access.name, access.op)) {
            const opener = access.openFirst;
            for (let attempt = 0; attempt < 3 && !Bank.isOpen(); attempt++) {
                const closed = locWithAction(opener.name, opener.op);
                if (!closed) {
                    log?.(`no '${opener.name}' with '${opener.op}' in the scene`);
                    await Execution.delayTicks(1);
                    continue;
                }

                log?.(`opening '${opener.name}' before banking`);
                if (!(await closed.interact(opener.op))) {
                    log?.(`could not '${opener.op}' '${opener.name}'`);
                    await Execution.delayTicks(1);
                    continue;
                }

                if (await Execution.delayUntil(() => Bank.isOpen() || locWithAction(access.name, access.op) !== null, 8000)) {
                    break;
                }
            }

            if (!Bank.isOpen() && !locWithAction(access.name, access.op)) {
                log?.(`'${access.name}' never became usable`);
                return false;
            }
        }

        return Bank.isOpen() || Bank.openNearest(access.name, access.op, log);
    },

    /** Close the bank modal so inventory ops (Wield, Use, Bury, …) hit the backpack again. */
    async close(timeoutMs = 3000): Promise<boolean> {
        if (!Bank.isOpen()) {
            return true;
        }
        const bankSide = reader.modals().side;
        if (!actions.closeModal()) {
            return false;
        }
        // The server closes the main and side bank components separately. The
        // normal backpack is authoritative again only after both are gone.
        return Execution.delayUntil(
            () => !Bank.isOpen() && (bankSide === -1 || reader.modals().side !== bankSide),
            timeoutMs
        );
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
                    if (ChatDialog.canContinue() && await continueObjectBankDialog(log)) { return true; }
                    if (Bank.isOpen()) { return true; }
                }
            }

            if (booth.distance() > 1) {
                const stand = bankStand(booth.tile());
                if (stand) {
                    log?.(`booth didn't open — stepping to the bank counter at (${stand.x}, ${stand.z})`);
                    await Traversal.walkTo(stand, { radius: 1, timeoutMs: 15000, log });
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
                    if (ChatDialog.canContinue() && await continueObjectBankDialog(log)) { return true; }
                }
            }
        }
        return Bank.isOpen();
    }
};

function locWithAction(name: string, op: string) {
    const wanted = op.toLowerCase();
    return Locs.query()
        .name(name)
        .where(loc => loc.actions().some(action => action.toLowerCase() === wanted))
        .nearest();
}

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
    return clickInvButtonMatching(items, i => i.name?.toLowerCase() === wanted, opLabel);
}

function clickInvButtonById(items: InvItemSnapshot[], id: number, opLabel: string): boolean | Promise<boolean> {
    return clickInvButtonMatching(items, i => i.id === id, opLabel);
}

function clickInvButtonMatching(
    items: InvItemSnapshot[],
    matches: (item: InvItemSnapshot) => boolean,
    opLabel: string
): boolean | Promise<boolean> {
    const item = items.find(matches);
    if (!item) {
        return false;
    }

    const norm = (s: string): string => s.toLowerCase().replace(/[\s-]+/g, ' ').trim();
    const opWanted = norm(opLabel);
    for (let i = 0; i < item.ops.length; i++) {
        const op = item.ops[i];
        if (op !== null && norm(op) === opWanted) {
            return Input.invButton(item.id, item.slot, item.comId, i + 1);
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
