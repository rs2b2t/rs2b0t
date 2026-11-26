import { reader, type InvItemSnapshot } from '../../adapter/ClientAdapter.js';
import { TaskBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { sortBank, type BankSortResult } from '../../api/bank/bankSort.js';
import { findQuestJunk, type QuestJunkFinding } from '../../api/bank/bankQuestJunk.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Quests, type QuestStatus } from '../../api/ui/questlog/Quests.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { droppableOf, questCategories, reportLine, summaryLine } from './BankSorterLogic.js';

const QUEST_TAB = 2;
const DROPS_PER_TICK = 5;

export const BANKSORTER_SETTINGS: SettingsSchema = {
    sortBank: { type: 'boolean', default: true, label: 'Sort the bank' },
    reportQuestJunk: {
        type: 'boolean',
        default: true,
        label: 'Report obsolete quest items',
        help: 'logs what a finished quest left behind, and changes nothing'
    },
    dropQuestJunk: {
        type: 'boolean',
        default: false,
        label: 'Drop what the report found',
        help: 'withdraws and drops them. There is no bank-side destroy, and a drop cannot be undone'
    }
};

export default class BankSorter extends TaskBot {
    override loopDelay = 600;

    private sort = true;
    private report = true;
    private drop = false;
    private status = 'starting';
    private moves = 0;
    private done = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.sort = this.settings.bool('sortBank', true);
        this.report = this.settings.bool('reportQuestJunk', true);
        this.drop = this.settings.bool('dropQuestJunk', false);
        this.add({ validate: () => !this.done, execute: () => this.run() });
    }

    // Why: the quest tab and the bank are both modals, so every status has to be read before the bank opens.
    private async questStatuses(): Promise<Map<string, QuestStatus>> {
        await Game.openSideTab(QUEST_TAB);
        await Execution.delayUntil(() => Quests.all().length > 0, 3000);
        return new Map(Quests.all().map(q => [q.name, q.status]));
    }

    private async dropLoad(load: readonly InvItemSnapshot[]): Promise<number> {
        const matches = (a: Pick<InvItemSnapshot, 'slot' | 'id' | 'count'>, b: InvItemSnapshot) =>
            a.slot === b.slot && a.id === b.id && a.count === b.count;
        const ready = () => {
            const pack = Bank.normalBackpackSnapshot();
            return pack !== null && load.every(item => pack.some(slot => matches(slot, item)));
        };
        if (!ready() && !(await Execution.delayUntil(ready, 3000))) return 0;

        const sent = new Set<number>();
        const queue = load.map(item => ({ item, attempts: 0 }));
        while (queue.length && !Bank.isOpen() && reader.inventorySnapshotReady()) {
            const batch = queue.splice(0, DROPS_PER_TICK);
            const pack = Inventory.items();
            for (const { item } of batch) {
                const held = pack.find(slot => matches(slot, item));
                if (held && await held.interact('Drop')) sent.add(item.slot);
            }
            await Execution.delayTicks(1);
            const after = Bank.normalBackpackSnapshot();
            if (!after) return 0;
            for (const entry of batch) {
                entry.attempts++;
                if (entry.attempts < 3 && after.some(slot => matches(slot, entry.item))) queue.push(entry);
            }
        }

        const pack = Bank.normalBackpackSnapshot();
        if (!pack) return 0;
        const removed = load.filter(item => sent.has(item.slot) && !pack.some(slot => slot.slot === item.slot && slot.id === item.id));
        return removed.reduce((total, item) => total + item.count, 0);
    }

    private async dropAll(found: readonly QuestJunkFinding[]): Promise<number> {
        const pending = new Set(found.map(item => item.id));
        if (!pending.size || !(await Bank.backpackReady())) return 0;
        const carried = Inventory.items().filter(item => pending.has(item.id));
        if (carried.length) {
            const catalog = reader.objCatalog();
            for (const item of carried) {
                if (catalog.find(obj => obj.id === item.id)?.stackable !== false) {
                    pending.delete(item.id);
                    this.log(`Keeping the carried stack of ${item.name} separate from bank junk`);
                }
            }
        }

        let dropped = 0;
        while (pending.size && Bank.isOpen() && await Bank.waitReady() && await Bank.backpackReady()) {
            if (Inventory.isFull()) {
                this.log('No free backpack slots for bank junk');
                break;
            }
            await Bank.setNoteMode(false);
            const occupied = new Set(Inventory.items().map(item => item.slot));
            const withdrawn = new Set<number>();
            for (const id of pending) {
                if (!Bank.isOpen() || Inventory.isFull()) break;
                const banked = Bank.countById(id);
                const before = Inventory.countById(id);
                const ok = banked > 0 && await Bank.withdrawLoad(id);
                const gained = Inventory.countById(id) - before;
                if (gained > 0) withdrawn.add(id);
                if (!ok || gained <= 0 || gained >= banked) pending.delete(id);
            }
            const load = reader.bankSideItems().filter(item => withdrawn.has(item.id) && !occupied.has(item.slot));
            if (!load.length || !(await Bank.close())) break;
            const cleared = await this.dropLoad(load);
            dropped += cleared;
            if (cleared < load.reduce((total, item) => total + item.count, 0)) {
                const pack = Bank.normalBackpackSnapshot();
                if (!pack) break;
                for (const item of load) {
                    if (pack.some(slot => slot.slot === item.slot && slot.id === item.id)) pending.delete(item.id);
                }
                this.log('Some quest junk could not be dropped');
            }
            if (pending.size && !(await Banking.open())) break;
        }
        if (this.sort && !Bank.isOpen()) await Banking.open();
        return dropped;
    }

    private async run(): Promise<void> {
        this.done = true;
        const statuses = await this.questStatuses();

        this.status = 'walking to the bank';
        if (!(await Banking.open()) || !(await Bank.waitReady())) {
            ScriptRunner.stop('BankSorter: could not open a bank');
            return;
        }

        let found: QuestJunkFinding[] = [];
        if (this.report || this.drop) {
            this.status = 'reading quest leftovers';
            found = findQuestJunk(reader.bankItems(), quest => statuses.get(quest) ?? 'unknown');
            this.log(reportLine(found));
        }

        this.status = 'dropping quest leftovers';
        const dropped = this.drop ? await this.dropAll(droppableOf(found, true)) : 0;

        this.status = 'sorting';
        const result: BankSortResult = this.sort
            ? await sortBank({
                log: msg => this.log(msg),
                categoryOverrides: questCategories(found)
            })
            : { sorted: false, moves: 0, mode: null, unmatched: [], reason: 'sorting turned off' };

        this.moves = result.moves;
        this.status = result.reason;
        this.log(summaryLine(result, found, dropped));
        await Bank.close();
        ScriptRunner.stop(`BankSorter: ${result.reason}`);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.done ? '#9be05b' : '#6cb6ff' });
        p.title(`BankSorter — ${this.status}`);
        p.row(`Moves sent: ${this.moves}`, this.sort ? 'sorting on' : 'sorting off');
        p.row(`Quest report: ${this.report ? 'on' : 'off'}`, `Drop: ${this.drop ? 'ARMED' : 'off'}`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
