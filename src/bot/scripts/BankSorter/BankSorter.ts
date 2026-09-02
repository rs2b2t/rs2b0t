import { reader } from '../../adapter/ClientAdapter.js';
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

    private async dropAll(found: readonly QuestJunkFinding[]): Promise<number> {
        let dropped = 0;
        for (const item of found) {
            if (!(await Bank.withdrawById(item.id, 'Withdraw All'))) {
                continue;
            }
            if (!(await Execution.delayUntil(() => Inventory.countById(item.id) > 0, 3000))) {
                continue;
            }

            await Bank.close();
            const held = Inventory.items().find(i => i.id === item.id);
            if (held && (await held.interact('Drop'))) {
                if (await Execution.delayUntil(() => Inventory.countById(item.id) === 0, 3000)) {
                    dropped += 1;
                }
            }
            if (!(await Banking.open())) {
                break;
            }
        }

        return dropped;
    }

    private async run(): Promise<void> {
        this.done = true;
        const statuses = await this.questStatuses();

        this.status = 'walking to the bank';
        if (!(await Banking.open())) {
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
