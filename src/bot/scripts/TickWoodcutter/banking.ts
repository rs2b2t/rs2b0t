import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { isFletchableLogName } from '../GatheringBot/TickManipLogic.js';
import { findCarrier } from './carrier.js';
import { AXE_NAMES, hasAxe, hasKnife } from './kit.js';

export async function openBank(stand: Tile, log: (m: string) => void): Promise<boolean> {
    if (!Bank.isOpen()) {
        if (!(await Traversal.walkResilient(stand, {
            radius: 2,
            attempts: 2,
            timeoutMs: 90_000,
            log: m => log(`  ${m}`)
        }))) {
            return false;
        }
        if (!(await Banking.open({ stand, log: m => log(`  ${m}`) }))) {
            return false;
        }
    }
    return Bank.waitReady(5000, m => log(`  ${m}`));
}

export async function closeBank(): Promise<void> {
    if (Bank.isOpen()) {
        await Bank.close();
    }
}

/** Deposit product logs (keep one normal Logs carrier) then withdraw any missing kit pieces. */
export async function restockKit(stand: Tile, log: (m: string) => void, preferred?: string): Promise<boolean> {
    if (!(await openBank(stand, log))) {
        return false;
    }
    const keep = (preferred ?? 'Logs').toLowerCase();
    await Bank.depositAllMatching(name => isFletchableLogName(name) && (name?.toLowerCase() ?? '') !== keep);

    if (!hasAxe()) {
        for (const name of AXE_NAMES) {
            if (Bank.count(name) < 1) {
                continue;
            }
            await Bank.withdrawX(name, 1);
            await Execution.delayUntilTicks(() => hasAxe(), 6);
            break;
        }
    }
    if (!hasKnife() && Bank.count('Knife') > 0) {
        await Bank.withdrawX('Knife', 1);
        await Execution.delayUntilTicks(() => hasKnife(), 6);
    }
    const wanted = preferred ?? 'Logs';
    if (!findCarrier(preferred) && Bank.count(wanted) > 0) {
        await Bank.withdrawX(wanted, 1);
        await Execution.delayUntilTicks(() => findCarrier(preferred) !== null, 6);
    }
    await closeBank();
    return true;
}

/** Withdraw coins for a shop trip. */
export async function withdrawCoins(stand: Tile, amount: number, log: (m: string) => void): Promise<boolean> {
    if (Inventory.count('Coins') >= amount) {
        return true;
    }
    if (!(await openBank(stand, log))) {
        return false;
    }
    const need = Math.max(0, amount - Inventory.count('Coins'));
    if (Bank.count('Coins') > 0) {
        await Bank.withdrawX('Coins', Math.min(need, Bank.count('Coins')));
    }
    await closeBank();
    return Inventory.count('Coins') >= amount;
}
