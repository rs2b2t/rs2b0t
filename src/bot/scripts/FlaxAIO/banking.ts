import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { Task } from '../../api/bot/Bot.js';
import { nearestStand, travelTo } from './walking.js';
import type FlaxAIO from './flaxaio.js';

const BOOTH = { op: 'Use-quickly' };

export async function bankRun(bot: FlaxAIO): Promise<boolean> {
    const log = (m: string): void => bot.log(`  ${m}`);
    const stand = nearestStand(bot);
    bot.setStatus('stepping to the bank counter');
    if (!(await travelTo(bot, stand, 0))) {
        return false;
    }
    const opened = (await Bank.openBooth(stand, bot.boothLocName(), BOOTH.op, log))
        || (await Bank.openNearest(bot.boothLocName(), BOOTH.op, log));
    if (!opened) {
        bot.log('could not open the bank — will retry');
        return false;
    }
    await Bank.depositInventory();
    await Execution.delayTicks(1);

    // Why: in spin-only mode the bank is the flax source, so refill after depositing product.
    if (bot.spinning && !bot.picking && bot.fibreCount() === 0) {
        const flaxBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(bot.flaxName().toLowerCase()));
        if (!flaxBank || flaxBank.name === null || Bank.count(flaxBank.name) === 0) {
            bot.setStatus(`out of ${bot.flaxName()} — stopped`);
            ScriptRunner.stop(`out of '${bot.flaxName()}' in the bank`);
            return false;
        }
        const flaxName = flaxBank.name;
        const allOp = withdrawOp(flaxBank.ops, 'all') ?? withdrawOp(flaxBank.ops, 'any') ?? 'Withdraw-All';
        bot.setStatus(`withdrawing ${flaxName}`);
        await Bank.withdraw(flaxName, allOp);
        await Execution.delayUntil(() => bot.fibreCount() > 0 || Bank.count(flaxName) === 0, 4000);
    }
    return true;
}

export class BankTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.needsBank();
    }
    async execute(): Promise<void> {
        await bankRun(this.bot);
    }
}
