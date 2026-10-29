import type { Task } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Trade } from '../../api/trade/Trade.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { ESSENCE, ESSENCE_ID, type MuleCrafterContext } from './MuleCrafterContext.js';
import { essencePerTrade } from './MuleCrafterLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

export interface BankPolicy {
    validate(): boolean;
    run(): Promise<void>;
}

export class BankTripTask implements Task {
    constructor(private readonly policy: BankPolicy) {}

    validate(): boolean {
        return this.policy.validate();
    }

    async execute(): Promise<void> {
        await this.policy.run();
    }
}

async function openBank(bot: MuleCrafterContext): Promise<boolean> {
    const opened = await Bank.openBooth(bot.bankTile(), BOOTH.name, BOOTH.op, message => bot.log(`  ${message}`))
        || await Bank.openNearest(BOOTH.name, BOOTH.op, message => bot.log(`  ${message}`));
    if (!opened) {
        bot.log('could not open the bank — retrying');
    }
    return opened;
}

async function walkToBank(bot: MuleCrafterContext): Promise<void> {
    if (bot.atBank()) return;
    bot.setStatus('walking to the bank');
    await bot.walkTo(bot.bankTile(), 3);
}

async function ensureTalisman(bot: MuleCrafterContext): Promise<boolean> {
    if (Inventory.contains(bot.cfg().talisman)) return true;
    const talisman = Bank.items().find(item => item.name?.toLowerCase() === bot.cfg().talisman.toLowerCase());
    if (!talisman?.name) {
        bot.log(`no ${bot.cfg().talisman} in the bank`);
        return false;
    }
    await Bank.withdraw(bot.cfg().talisman, 'Withdraw-1');
    return Execution.delayUntil(() => Inventory.contains(bot.cfg().talisman), 3000);
}

export function createCloseBankTask(bot: MuleCrafterContext): Task {
    return new BankTripTask({
        validate: () => Bank.isOpen() && !Trade.active(),
        run: async () => {
            if (!await Bank.close()) {
                bot.log('bank did not close cleanly; retrying');
            }
        }
    });
}

export function createCrafterPrepareTask(bot: MuleCrafterContext): Task {
    return new BankTripTask({
        validate: () => bot.mode() === 'Crafter'
            && !bot.inTemple()
            && !Trade.active()
            && bot.bankVisitsEnabled()
            && bot.atBank()
            && (!Inventory.contains(bot.cfg().talisman) || bot.essenceCount() === 0),
        run: async () => {
            bot.setStatus('at bank - preparing');
            if (!await openBank(bot)) return;
            if (!await ensureTalisman(bot)) {
                throw new Error(`MuleCrafter: ${bot.cfg().talisman} not found`);
            }
            if (!bot.bankVisitsEnabled() || bot.essenceCount() > 0) {
                await Bank.close();
                return;
            }
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            const banked = Bank.count(ESSENCE);
            if (banked === 0) {
                await Bank.close();
                ScriptRunner.stop('MuleCrafter: no essence left in the bank (three reads)');
                return;
            }
            const amount = Math.min(Inventory.free(), essencePerTrade(28, true), banked);
            await Bank.withdrawX(ESSENCE, amount);
            await Execution.delayUntil(() => bot.essenceCount() > 0, 4000);
            bot.log(`withdrew ${bot.essenceCount()} essence from the bank`);
            await Bank.close();
        }
    });
}

export function createCrafterBankTask(bot: MuleCrafterContext): Task {
    return new BankTripTask({
        validate: () => bot.mode() === 'Crafter' && !bot.inTemple() && !Trade.active() && bot.bankDue(),
        run: async () => {
            await walkToBank(bot);
            if (!await openBank(bot)) return;
            const runesHeld = bot.runeCount();
            await Bank.depositAllMatching(name => name.toLowerCase() === bot.cfg().rune.toLowerCase(), message => bot.log(`  ${message}`));
            await Execution.delayTicks(1);
            if (runesHeld > 0) bot.log(`deposited ${runesHeld} ${bot.cfg().rune}s`);

            const talismanId = Bank.items().find(item => item.name?.toLowerCase() === bot.cfg().talisman.toLowerCase())?.id
                ?? Inventory.items().find(item => item.name?.toLowerCase() === bot.cfg().talisman.toLowerCase())?.id
                ?? -1;
            const keep = new Set([talismanId, ESSENCE_ID].filter(id => id !== -1));
            const before = Inventory.used();
            await Bank.depositAllMatching((name, id) => name.length > 0 && !keep.has(id), message => bot.log(`  ${message}`));
            if (Inventory.used() < before) bot.log(`cleared ${before - Inventory.used()} slot(s)`);

            if (!await ensureTalisman(bot)) {
                throw new Error(`MuleCrafter: ${bot.cfg().talisman} not found`);
            }
            if (bot.bankVisitsEnabled() && bot.essenceCount() === 0) {
                await Execution.delayUntil(() => Bank.loaded(), 3000);
                const banked = Bank.count(ESSENCE);
                if (banked === 0) {
                    await Bank.close();
                    ScriptRunner.stop('MuleCrafter: no essence left in the bank (three reads)');
                    return;
                }
                const amount = Math.min(Inventory.free(), essencePerTrade(28, true), banked);
                await Bank.withdrawX(ESSENCE, amount);
                await Execution.delayUntil(() => bot.essenceCount() > 0, 4000);
                bot.log(`withdrew ${bot.essenceCount()} essence from the bank`);
            }
            await Bank.close();
            bot.resetTradeCounter();
        }
    });
}

export function createMuleBankTask(bot: MuleCrafterContext): Task {
    return new BankTripTask({
        validate: () => bot.mode() === 'Mule'
            && !bot.inTemple()
            && !Trade.active()
            && (
                bot.runeCount() > 0
                || (bot.essenceCount() === 0 && !bot.atBank())
                || (bot.atBank() && (bot.runeCount() > 0 || bot.essenceCount() === 0))
            ),
        run: async () => {
            await walkToBank(bot);
            if (!await openBank(bot)) return;
            const runesHeld = bot.runeCount();
            if (runesHeld > 0) {
                await Bank.deposit(bot.cfg().rune, 'Deposit-All');
                await Execution.delayTicks(1);
                bot.log(`deposited ${runesHeld} ${bot.cfg().rune}s`);
                bot.recordMuleDelivery(0);
            }

            const keep = new Set([ESSENCE_ID]);
            if (bot.meetingPoint() === 'Altar (inside)') {
                const talismanId = Bank.items().find(item => item.name?.toLowerCase() === bot.cfg().talisman.toLowerCase())?.id
                    ?? Inventory.items().find(item => item.name?.toLowerCase() === bot.cfg().talisman.toLowerCase())?.id
                    ?? -1;
                if (talismanId !== -1) keep.add(talismanId);
            }
            const before = Inventory.used();
            await Bank.depositAllMatching((name, id) => name.length > 0 && !keep.has(id), message => bot.log(`  ${message}`));
            if (Inventory.used() < before) bot.log(`cleared ${before - Inventory.used()} slot(s)`);

            if (bot.meetingPoint() === 'Altar (inside)' && !await ensureTalisman(bot)) {
                throw new Error(`MuleCrafter: ${bot.cfg().talisman} not found`);
            }
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            const banked = Bank.count(ESSENCE);
            if (banked === 0 && bot.essenceCount() === 0) {
                await Bank.close();
                ScriptRunner.stop('MuleCrafter: out of essence in the bank (three reads)');
                return;
            }
            if (bot.essenceCount() > 0) {
                await Bank.close();
                return;
            }
            const amount = Math.min(Inventory.free(), essencePerTrade(28, false), banked);
            await Bank.withdrawX(ESSENCE, amount);
            await Execution.delayUntil(() => bot.essenceCount() > 0, 4000);
            bot.log(`withdrew ${bot.essenceCount()} essence from the bank`);
            await Bank.close();
        }
    });
}
