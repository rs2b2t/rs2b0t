import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Shop } from '../../api/shop/Shop.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { AXES } from '../../api/acquisition/Tools.js';
import { AXE_SHOP_COSTS, BOB_VENDOR, BROKEN_AXE } from '../../api/acquisition/ToolAcquire.js';
import { hasAxe } from './kit.js';

async function walkToBob(log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(BOB_VENDOR.stand, {
        radius: 3,
        attempts: 2,
        timeoutMs: 120_000,
        log: m => log(`  ${m}`)
    });
}

/** Repair a broken axe at Bob, then fall back to buying if still missing. */
export async function repairAxeAtBob(log: (m: string) => void, status: (s: string) => void): Promise<boolean> {
    const broken = Inventory.first(BROKEN_AXE);
    if (!broken) {
        return false;
    }
    status('repairing axe at Bob');
    if (!(await walkToBob(log))) {
        return false;
    }
    const bob = Npcs.query().name('Bob').nearest();
    if (!bob) {
        return false;
    }
    await broken.useOn(bob);
    if (!(await Execution.delayUntilTicks(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 6))) {
        return false;
    }
    for (let i = 0; i < 10 && !hasAxe(); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        } else if (ChatDialog.options().some(option => /yes/i.test(option))) {
            await ChatDialog.chooseOption('Yes');
        } else {
            await Execution.delayTicks(1);
        }
    }
    return hasAxe();
}

/** Buy the best affordable Bob axe tier with coins already in the pack. */
export async function buyAxeAtBob(log: (m: string) => void, status: (s: string) => void): Promise<boolean> {
    const coins = Inventory.count('Coins');
    const best = AXES
        .map(axe => axe.name)
        .find(name => (AXE_SHOP_COSTS[name] ?? Number.POSITIVE_INFINITY) <= coins);
    if (!best) {
        return false;
    }
    status(`buying ${best} from Bob`);
    if (!(await walkToBob(log))) {
        return false;
    }
    if (!(await Shop.open('Bob'))) {
        return false;
    }
    try {
        await Shop.buy(best, 1);
        await Execution.delayUntilTicks(() => hasAxe(), 6);
    } finally {
        await Shop.close();
    }
    return hasAxe();
}

export async function acquireAxeAtBob(log: (m: string) => void, status: (s: string) => void): Promise<boolean> {
    if (hasAxe()) {
        return true;
    }
    if (Inventory.count(BROKEN_AXE) > 0 && (await repairAxeAtBob(log, status))) {
        return true;
    }
    return buyAxeAtBob(log, status);
}
