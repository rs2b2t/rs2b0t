import { Bank } from '../../api/bank/Bank.js';
import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { liveCatalog, notedId } from '../../api/market/catalog.js';
import { Trade } from '../../api/trade/Trade.js';
import { EMPTY_WITHDRAWAL_READS, type MuleDepotContext } from './MuleDepotContext.js';
import { describeLines, listedRows, pickBankRow, type BankRow } from './MuleDepotLogic.js';

// Why: the trade window swallows a bank click and the bank window swallows a trade click, so every
// pass below opens, works and closes, failure paths included.

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

interface BankPolicy {
    validate(): boolean;
    run(): Promise<void>;
}

/** Keeps `validate` beside the body that satisfies it, which matters once one file holds four trips. */
class BankTripTask implements Task {
    constructor(private readonly policy: BankPolicy) {}

    validate(): boolean {
        return this.policy.validate();
    }

    async execute(): Promise<void> {
        await this.policy.run();
    }
}

/**
 * The noted ids, once the catalog has unpacked. Why: an empty map means "cannot say" rather than
 * "nothing is noted", since the catalog is blank for the first moments after login.
 */
export function notedIds(): Set<number> {
    const catalog = liveCatalog();
    const out = new Set<number>();
    if (catalog.byId.size === 0) {
        return out;
    }
    for (const id of catalog.notedOf.values()) {
        out.add(id);
    }
    return out;
}

/** The bank as the planners want it: id, name, count. */
export function bankRows(): BankRow[] {
    return Bank.items().map(row => ({ id: row.id, name: row.name, count: row.count }));
}

/**
 * The op that takes a whole bank row, preferring Withdraw-All. Why: a dumper wants all of it, and
 * a Withdraw-X is slower, and some rows (coins) do not offer one at all.
 */
function wholeRowOp(row: { ops: (string | null)[] }): string | null {
    const ops = row.ops.filter((op): op is string => op !== null);
    return ops.find(op => /withdraw[\s-]*all/i.test(op))
        ?? ops.find(op => /withdraw[\s-]*x/i.test(op))
        ?? ops.find(op => /withdraw[\s-]*1\b/i.test(op))
        ?? null;
}

function rowOpsText(id: number): string {
    const row = Bank.items().find(r => r.id === id);
    return row ? row.ops.filter((op): op is string => op !== null).join('|') || 'none' : 'row gone';
}

async function openBank(bot: MuleDepotContext): Promise<boolean> {
    const log = (message: string): void => bot.log(`  ${message}`);
    const opened = await Bank.openBooth(bot.bankTile(), BOOTH.name, BOOTH.op, log)
        || await Bank.openNearest(BOOTH.name, BOOTH.op, log);
    if (!opened) {
        bot.log('could not open the bank — retrying');
    }
    return opened;
}

async function closeBank(bot: MuleDepotContext): Promise<void> {
    if (!(await Bank.close())) {
        bot.log('the bank did not close cleanly; retrying');
    }
}

/** Open, hand the body the bank, and close again whatever the body did. */
async function bankPass(bot: MuleDepotContext, body: () => Promise<boolean>): Promise<boolean> {
    if (!await openBank(bot)) {
        return false;
    }
    // Why: waitReady, not loaded. A bank with nothing in it reports an empty list forever, and the
    // supermule's bank is empty on the first run, so a loaded() check can never pass there.
    if (!await Bank.waitReady(8000, message => bot.log(`  ${message}`))) {
        bot.log('the bank never became ready, retrying');
        await closeBank(bot);
        return false;
    }
    const ok = await body();
    await closeBank(bot);
    return ok;
}

/**
 * The recovery path for a bank left open by a crash. Why: a lingering bank modal eats the incoming
 * Trade-with click, so a role stuck behind one looks like a depot nobody is trading with.
 */
export function createCloseBankTask(bot: MuleDepotContext): Task {
    return new BankTripTask({
        // Why: no pack condition. A bank left open swallows the trade click, and a mule waiting to
        // trade is carrying a full pack by definition, so requiring an empty one strands it.
        validate: () => Bank.isOpen() && !Trade.active(),
        run: async () => {
            bot.setStatus('closing the bank');
            await closeBank(bot);
        }
    });
}

/** Deposit everything the pack holds that the caller does not name. */
async function depositExcluding(bot: MuleDepotContext, keep: ReadonlySet<number>): Promise<number> {
    const before = bot.packUsed();
    await Bank.depositAllMatching(
        (name, id) => name.length > 0 && !keep.has(id),
        message => bot.log(`  ${message}`)
    );
    return before - bot.packUsed();
}

/** Dump Mule: bank anything that is not on the CSV, so the pack is the CSV and nothing else. */
export function createDumperBankTask(bot: MuleDepotContext): Task {
    let emptyReads = 0;

    return new BankTripTask({
        validate: () => bot.role() === 'Mule'
            && !Trade.active()
            && (bot.packStrays() || (bot.packUsed() === 0 && bot.atBank())),
        run: async () => {
            const carrying = bot.packStrays();
            if (!carrying && !bot.atBank()) {
                return;
            }
            bot.setStatus(carrying ? 'clearing items off the list' : 'withdrawing the list');
            await bankPass(bot, async () => {
                if (carrying) {
                    // Why: the keep set is the list's bank rows and never the withdrawal plan,
                    // which is empty on a full pack and would bank the haul it is carrying.
                    const keep = new Set(listedRows(bot.dumpItems(), bankRows(), notedIds()).map(line => line.id));
                    const before = bot.packUsed();
                    await Bank.depositAllMatching(
                        (name, id) => name.length > 0 && !keep.has(id),
                        message => bot.log(`  ${message}`)
                    );
                    const cleared = before - bot.packUsed();
                    if (cleared > 0) {
                        bot.log(`banked ${cleared} slot(s) that are not on the list`);
                    }
                    return true;
                }

                const plan = bot.planDumpWithdrawal();
                if (plan.length === 0) {
                    emptyReads++;
                    if (emptyReads >= EMPTY_WITHDRAWAL_READS) {
                        ScriptRunner.stop(`MuleDepot: the bank holds none of the ${bot.dumpItems().length} listed item(s) after ${emptyReads} reads`);
                    }
                    return true;
                }
                emptyReads = 0;

                // Why: note mode on, so a whole stack lands in one slot. The pack then holds the
                // noted form, which is the form the trade screen takes.
                await Bank.setNoteMode(true);
                for (const line of plan) {
                    const row = Bank.items().find(r => r.id === line.id);
                    const op = row ? wholeRowOp(row) : null;
                    if (op === null) {
                        bot.log(`no withdraw op for ${line.name} (${rowOpsText(line.id)})`);
                        return false;
                    }
                    const landsAs = notedId(liveCatalog(), line.id) ?? line.id;
                    bot.setStatus(`withdrawing ${line.name}`);
                    if (!(await Bank.withdrawById(line.id, op))
                        || !(await Execution.delayUntil(() => Inventory.countById(landsAs) > 0, 5000))) {
                        bot.log(`could not withdraw ${line.name} via '${op}' (ops: ${rowOpsText(line.id)}), retrying`);
                        return false;
                    }
                    bot.log(`withdrew ${Inventory.countById(landsAs)} ${line.name} into ${bot.packUsed()} used slot(s)`);
                }
                bot.log(`took ${describeLines(plan)}`);
                return true;
            });
        }
    });
}

/** Dump Supermule: take delivery of everything offered and bank it, forever. */
export function createSupermuleBankTask(bot: MuleDepotContext): Task {
    return new BankTripTask({
        validate: () => bot.role() === 'Supermule' && !Trade.active() && bot.packUsed() > 0,
        run: async () => {
            bot.setStatus('banking the delivery');
            await bankPass(bot, async () => {
                const before = bot.packUsed();
                await Bank.depositAllMatching(() => true, message => bot.log(`  ${message}`));
                const banked = before - bot.packUsed();
                bot.log(banked > 0 ? `banked ${banked} slot(s)` : 'nothing new to bank');
                return true;
            });
        }
    });
}

/** Supply Supplier: withdraw the batch it is on, one pack at a time. */
export function createSupplierBankTask(bot: MuleDepotContext): Task {
    let emptyReads = 0;

    return new BankTripTask({
        validate: () => bot.role() === 'Supplier'
            && !Trade.active()
            && bot.packUsed() === 0
            && bot.currentBatch() !== null,
        run: async () => {
            const batch = bot.currentBatch();
            if (!batch) {
                return;
            }
            bot.setStatus('withdrawing the batch');
            await bankPass(bot, async () => {
                // Why: note mode on, so a whole stack lands in one slot and the batch plan holds.
                await Bank.setNoteMode(true);
                for (const line of batch.lines) {
                    // Why: a name-only loadout line has no id, and the bank is addressed by id, so
                    // the name has to become a row before anything can be clicked.
                    const row = line.id >= 0
                        ? Bank.items().find(r => r.id === line.id)
                        : pickBankRow(line.name, bankRows(), notedIds());
                    if (!row?.name) {
                        const what = line.name.length > 0 ? line.name : `#${line.id}`;
                        emptyReads++;
                        bot.log(`the bank holds none of ${what} for batch ${batch.index + 1} (read ${emptyReads})`);
                        if (emptyReads >= EMPTY_WITHDRAWAL_READS) {
                            ScriptRunner.stop(`MuleDepot: the bank cannot supply batch ${batch.index + 1} (${what}) after ${emptyReads} reads`);
                        }
                        return false;
                    }
                    emptyReads = 0;
                    const landsAs = notedId(liveCatalog(), row.id) ?? row.id;
                    bot.setStatus(`withdrawing ${line.quantity} ${row.name}`);
                    if (!(await Bank.withdrawXById(row.id, line.quantity, landsAs))) {
                        bot.log(`could not withdraw ${line.quantity} ${row.name} of batch ${batch.index + 1} (ops: ${rowOpsText(row.id)}), retrying`);
                        return false;
                    }
                }
                const have = bot.packUsed();
                if (have === 0) {
                    emptyReads++;
                    if (emptyReads >= EMPTY_WITHDRAWAL_READS) {
                        ScriptRunner.stop(`MuleDepot: batch ${batch.index + 1} (${describeLines(batch.lines)}) left the pack empty after ${emptyReads} reads`);
                    }
                    return true;
                }
                emptyReads = 0;
                bot.log(`batch ${batch.index + 1} of ${bot.deliveries().length}: ${describeLines(batch.lines)}`);
                return true;
            });
        }
    });
}

/**
 * Supply Client: bank what it was handed. Why: doing it after every batch empties the pack again
 * before the supplier comes back with the next one, which is what makes multi-batch delivery work.
 */
export function createClientBankTask(bot: MuleDepotContext): Task {
    return new BankTripTask({
        validate: () => bot.role() === 'Client' && !Trade.active() && bot.packUsed() > 0,
        run: async () => {
            bot.setStatus('banking the loadout');
            await bankPass(bot, async () => {
                const before = bot.packUsed();
                await Bank.depositAllMatching(() => true, message => bot.log(`  ${message}`));
                const banked = before - bot.packUsed();
                bot.log(banked > 0 ? `banked ${banked} slot(s) of the loadout` : 'nothing new to bank');
                return true;
            });
        }
    });
}

/** Startup cleanup for a role that must not carry anything the depot did not plan. */
export async function cleanPack(bot: MuleDepotContext, keepIds: ReadonlySet<number>): Promise<boolean> {
    if (bot.packUsed() === 0) {
        return true;
    }
    bot.log(`the pack came with ${bot.packUsed()} slot(s); banking what the depot did not plan`);
    return bankPass(bot, async () => {
        const cleared = await depositExcluding(bot, keepIds);
        bot.log(`banked ${cleared} slot(s)`);
        return true;
    });
}
