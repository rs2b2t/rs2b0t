import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import type JiveChests from './JiveChests.js';

const TOOTH = 985;
const LOOP = 987;
const KEY = 989;
const PAIRS_PER_LOAD = 14;
const PAIRS_PER_BATCH = 5;

export class CombineKeys implements Task {
    private banking = true;
    private done = false;
    private failures = 0;
    private pendingDeposit: Map<number, number> | null = null;

    constructor(private bot: JiveChests) {}

    validate(): boolean {
        return !this.done && Game.ingame();
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        if (!this.banking) {
            if (Bank.isOpen()) {
                await Bank.close();
                return;
            }
            const pack = Inventory.items();
            const teeth = pack.filter(i => i.id === TOOTH && !i.noted);
            const loops = pack.filter(i => i.id === LOOP && !i.noted);
            const pairs = Math.min(PAIRS_PER_BATCH, teeth.length, loops.length);
            if (pairs > 0) {
                bot.setStatus('combining crystal keys');
                const before = Inventory.countById(KEY);
                let sent = 0;
                for (let i = 0; i < pairs; i++) {
                    if (await teeth[i].useOn(loops[i])) sent++;
                }
                if (sent > 0) {
                    await Execution.delayUntilTicks(() => Inventory.countById(KEY) >= before + sent, 3);
                }
                const made = Inventory.countById(KEY) - before;
                if (made > 0) {
                    bot.combined += made;
                    this.failures = 0;
                } else if (++this.failures >= 3) {
                    this.finish('could not combine key halves after three attempts');
                }
                return;
            }
            this.banking = true;
        }

        bot.setStatus('banking crystal keys');
        if (!(await Banking.open({ log: m => bot.log(m) }))
            || !(await Bank.waitReady()) || !(await Bank.backpackReady())) return;
        this.pendingDeposit ??= new Map([TOOTH, LOOP, KEY]
            .filter(id => Inventory.countById(id) > 0)
            .map(id => [id, Bank.countById(id) + Inventory.countById(id)]));
        await Bank.depositInventory();
        if (Inventory.used() > 0) return;
        const expected = this.pendingDeposit;
        if (!(await Execution.delayUntil(() => Bank.isOpen()
            && [...expected].every(([id, count]) => Bank.countById(id) >= count), 4000))) return;
        this.pendingDeposit = null;

        const pairs = Math.min(PAIRS_PER_LOAD, Bank.countById(TOOTH), Bank.countById(LOOP));
        if (pairs === 0) {
            if (await Bank.close()) this.finish('no matching key halves left in the bank');
            return;
        }

        bot.setStatus(`withdrawing ${pairs} pairs of key halves`);
        await Bank.setNoteMode(false);
        this.pendingDeposit = new Map([TOOTH, LOOP].map(id => [id, Bank.countById(id)]));
        if (!(await Bank.withdrawXById(TOOTH, pairs)) || !(await Bank.withdrawXById(LOOP, pairs))) return;
        this.pendingDeposit = null;
        this.banking = false;
        bot.noteTrip();
        await Bank.close();
    }

    private finish(reason: string): void {
        this.done = true;
        this.bot.setStatus(reason);
        this.bot.log(`[chests] ${reason}; combined ${this.bot.combined} crystal keys`);
        this.bot.requestFinish(reason);
    }
}
