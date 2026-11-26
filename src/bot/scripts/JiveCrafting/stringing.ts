import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import type { Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import type { Amulet } from '../../data/amulets.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';

export { AMULETS, type Amulet } from '../../data/amulets.js';
export const BALL_OF_WOOL = 1759;

interface Host {
    log(message: string): void;
    setStatus(status: string): void;
    noteMade(count: number): void;
    noteTrip(banked: number): void;
}

export class StringAmulets implements Task {
    constructor(private bot: Host, private amulet: Amulet) {}

    validate(): boolean {
        return !ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) return;
        const { bot, amulet } = this;
        if (Inventory.countById(amulet.unstrung) > 0 && Inventory.countById(BALL_OF_WOOL) > 0) {
            if (Bank.isOpen() && !(await Bank.close())) return;
            const wool = Inventory.items().find(item => item.id === BALL_OF_WOOL);
            const raw = Inventory.items().find(item => item.id === amulet.unstrung);
            if (!wool || !raw) return;
            bot.setStatus(`stringing ${amulet.label}`);
            const before = Inventory.countById(amulet.strung);
            if (!(await wool.useOn(raw))) return;
            await Execution.delayUntil(() => Inventory.countById(amulet.strung) > before || ChatDialog.canContinue() || EventSignal.pending(), 4000);
            bot.noteMade(Math.max(0, Inventory.countById(amulet.strung) - before));
            return;
        }

        bot.setStatus('banking amulets');
        if (!(await Banking.open({ log: message => bot.log(message) }))) return;
        const products = Inventory.countById(amulet.strung);
        await Bank.depositInventory();
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Inventory.used() === 0, 4000)) || !(await Bank.waitReady())) return;
        bot.noteTrip(products);
        const raw = Bank.countById(amulet.unstrung);
        const wool = Bank.countById(BALL_OF_WOOL);
        if (raw < 1 || wool < 1) {
            await Bank.close();
            bot.setStatus('stopped');
            ScriptRunner.stop(`[crafting] the bank has no ${raw < 1 ? `unstrung ${amulet.label}` : 'Ball of wool'}`);
            return;
        }
        const pairs = Math.min(14, raw, wool);
        bot.setStatus(`withdrawing ${pairs} amulets and balls of wool`);
        await Bank.setNoteMode(false);
        if (!(await Bank.withdrawXById(amulet.unstrung, pairs))) return;
        if (!(await Bank.withdrawXById(BALL_OF_WOOL, pairs))) return;
        await Bank.close();
    }
}
