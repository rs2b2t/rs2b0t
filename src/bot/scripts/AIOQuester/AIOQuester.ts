import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { COIN_FLOAT, PROVISION_BANK, QuestEngine } from '../../api/ai/quests/engine/QuestEngine.js';
import type Tile from '../../geometry/Tile.js';
import { executeStep } from '../../api/ai/quests/exec/steps.js';
import { QUEST_DEFS, defById } from '../../api/ai/quests/defs/index.js';
import { QuestFood } from '../../api/ai/quests/food.js';
import { QuestLoadout } from '../../api/ai/quests/gear.js';
import { FOOD_OPTIONS } from '../../api/combat/food.js';
import { foodOf } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING, selectedLoadout } from '../../api/loadout/loadoutSetting.js';
import type { QueueRow, QueueStatus } from '../../api/ai/quests/engine/queue.js';
import type { QuestModule } from '../../api/ai/quests/engine/types.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    ARRAV_GANG_OPTIONS,
    applyArravSettings,
    resolveSustainPolicy,
    selectSustainConsumable,
    type ResolvedSustainPolicy,
    type SustainSelection
} from './AIOQuesterLogic.js';

const DEATH_RE = /oh dear.*you are dead/i;

export const QUEST_OPTION_LABELS: Record<string, string> = Object.fromEntries(
    QUEST_DEFS.map(def => [def.record.id, def.record.name])
);

const ICON: Record<QueueStatus, string> = {
    DONE: '✓',
    RUNNING: '▶',
    READY: '·',
    PARKED: '⏸',
    BLOCKED: '✗',
    UNKNOWN: '?'
};

const FALLBACK_FOOD = 'Lobster';

export const AIO_SETTINGS: SettingsSchema = {
    quests: {
        type: 'string[]',
        default: [],
        options: QUEST_DEFS.map(d => d.record.id),
        optionLabels: QUEST_OPTION_LABELS,
        label: 'Quest queue (empty = all)',
        help: 'which implemented quests to complete, run in the listed order; leave empty to run every implemented quest'
    },
    loadout: LOADOUT_SETTING,
    food: {
        type: 'string',
        default: FALLBACK_FOOD,
        options: FOOD_OPTIONS,
        label: 'Food',
        help: 'what the engine withdraws for any quest declaring a food count, and what the bot eats; a loadout carrying its own food wins over this'
    },
    arravGang: {
        type: 'string',
        default: 'random',
        options: [...ARRAV_GANG_OPTIONS],
        label: 'Shield of Arrav gang',
        group: 'Shield of Arrav',
        help: 'which gang to join; random picks one from a hash of the character name, so the same character always picks the same gang'
    },
    arravPartner: {
        type: 'string',
        default: '',
        label: 'Shield of Arrav partner',
        group: 'Shield of Arrav',
        help: 'character name of the bot running the other gang; the quest cannot be finished alone unless a certificate is already banked'
    },
    arravCerts: {
        type: 'number',
        default: 2,
        min: 1,
        max: 50,
        label: 'Shield of Arrav certificates',
        group: 'Shield of Arrav',
        help: 'how many certificates to mint before redeeming one; each pair costs both bots a fresh shield half, and the surplus banks for other bots'
    },
    verbose: {
        type: 'boolean',
        default: true,
        label: 'Verbose step log',
        help: 'log every engine tick with the step, attempt count, elapsed time and inventory delta, and stop de-duplicating sub-steps; off still heartbeats a repeating step'
    }
};

export default class AIOQuester extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private picked = new Set<string>();
    private rows: QueueRow[] = [];
    private runningId: string | null = null;
    private stepDesc = '—';
    private noProgress = 0;
    private parkedCount = 0;

    private skipRequested = false;

    private died = false;
    private deaths = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const all = QUEST_DEFS.map(d => d.record.id);
        const chosen = this.settings.list('quests', []).filter(id => all.includes(id));
        this.picked = new Set(chosen.length > 0 ? chosen : all);

        this.on('chat.message', e => {
            if (DEATH_RE.test(e.text)) {
                this.died = true;
                this.deaths++;
            }
        });

        QuestLoadout.current = selectedLoadout(this.settings);
        QuestFood.name = this.foodItem();
        applyArravSettings({
            gang: this.settings.str('arravGang', 'random'),
            partner: this.settings.str('arravPartner', ''),
            certs: this.settings.num('arravCerts', 2)
        });
        Sustain.set(async () => { if (this.shouldEat()) { await this.eatOnce(); } });
        // A death must release the active quest operation before the engine can recover it.
        EventSignal.setInterrupt(() => this.skipRequested || this.died);

        const queueNames = [...this.picked].map(id => defById(id)?.record.name ?? id);
        this.log(`AIOQuester — queue: ${queueNames.join(', ') || '(none)'}`);
        this.add(new ContinueDialog(), new EatFood(this), new StartupWithdraw(this), new QuestEngine(this));
    }

    override async onStop(): Promise<void> {
        EventSignal.setInterrupt(null);
        Sustain.set(null);
    }

    foodItem(): string | null {
        return foodOf(QuestLoadout.current, this.settings.str('food', FALLBACK_FOOD));
    }

    verbose(): boolean {
        return this.settings.bool('verbose', true);
    }

    sustainPolicy(): ResolvedSustainPolicy {
        const quest = this.runningId ? defById(this.runningId) : undefined;
        return resolveSustainPolicy(this.foodItem(), quest?.sustain);
    }

    shouldEat(): boolean {
        return this.selectFood() !== null;
    }

    async eatOnce(): Promise<void> {
        // Re-evaluate at execution time so a packet received after validation
        // cannot leave us interacting with a stale inventory slot or HP decision.
        const selected = this.selectFood();
        if (!selected) { return; }
        const { item: food, action } = selected;
        this.status = `consuming ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`;
        const before = Skills.effective('hitpoints');
        if (!(await food.interact(action))) { return; }
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
    }

    private selectFood(): SustainSelection<InvItem> | null {
        return selectSustainConsumable(
            Inventory.items(),
            this.sustainPolicy().foods,
            Skills.effective('hitpoints'),
            Skills.level('hitpoints')
        );
    }

    override grindTargets(): string[] {
        return this.runningId ? defById(this.runningId)?.grind ?? [] : [];
    }

    /** Undefined when the first quest banks wherever it happens to be standing. */
    firstQuestBank(): Tile | undefined {
        const bank = QUEST_DEFS.find(d => this.picked.has(d.record.id))?.bank;
        if (bank === 'nearest') {
            return undefined;
        }
        return bank ?? PROVISION_BANK;
    }

    private firstIncompleteQuest(): QuestModule | undefined {
        return QUEST_DEFS.find(d => this.picked.has(d.record.id) && Quests.status(d.record.name) !== 'complete');
    }

    firstIncompleteQuestOwnsInventory(): boolean {
        return this.firstIncompleteQuest()?.ownsInventory ?? false;
    }

    /** The float the next quest declares; `COIN_FLOAT` when it declares none. */
    firstIncompleteQuestCoinFloat(): number {
        return this.firstIncompleteQuest()?.coinFloat ?? COIN_FLOAT;
    }

    pickedIds(): Set<string> {
        return this.picked;
    }

    noteState(rows: QueueRow[], runningId: string | null, stepDesc: string, noProgress: number, parked: number): void {
        this.rows = rows;
        this.runningId = runningId;
        this.stepDesc = stepDesc;
        this.noProgress = noProgress;
        this.parkedCount = parked;
        const running = rows.find(r => r.id === runningId);
        this.status = running ? `running ${running.name}` : stepDesc;
    }

    requestSkip(): void {
        if (this.skipRequested) {
            return;
        }
        this.skipRequested = true;
        const name = this.rows.find(r => r.id === this.runningId)?.name ?? this.runningId ?? 'current quest';
        this.log(`Skip quest — abandoning ${name} after the current step yields`);
    }

    /** True while the player has pressed Skip and the engine has not yet applied it. */
    skipPending(): boolean {
        return this.skipRequested;
    }

    consumeSkip(): boolean {
        const s = this.skipRequested;
        this.skipRequested = false;
        return s;
    }

    consumeDeath(): boolean {
        const d = this.died;
        this.died = false;
        return d;
    }

    finish(reason: string): void {
        ScriptRunner.stop(reason);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const rows = this.rows;
        const doneCount = rows.filter(r => r.status === 'DONE').length;
        const running = rows.find(r => r.id === this.runningId);

        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c8a2ff' });
        p.title(`AIOQuester — ${this.status}`);

        const tab = p.tabs('aio', ['Queue', 'Current']);
        if (tab === 'Queue') {
            p.row(`QP: ${Quests.points()}`, `Done ${doneCount}/${rows.length}`);
            if (rows.length === 0) {
                p.text('no quests queued', '#8a919a');
            }
            for (const r of rows) {
                p.text(
                    `${ICON[r.status]} ${r.name}${r.reasons.length ? ' — ' + r.reasons[0] : ''}`,
                    r.status === 'RUNNING' ? undefined : '#8a919a'
                );
            }
        } else {
            p.row(`Quest: ${running?.name ?? '—'}`, `Step: ${this.stepDesc}`);
            p.row(`No-progress: ${this.noProgress}`, `Parked: ${this.parkedCount}`);
            p.row(`Deaths: ${this.deaths}`, '');
        }

        p.gap();
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'skip', label: 'Skip quest' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'skip') {
            this.requestSkip();
        } else if (clicked === 'stop') {
            ScriptRunner.stop('Stop button (quest overlay)');
        }
        p.end();
    }
}

class EatFood implements Task {
    constructor(private bot: AIOQuester) {}
    validate(): boolean { return this.bot.shouldEat(); }
    async execute(): Promise<void> { await this.bot.eatOnce(); }
}

class StartupWithdraw implements Task {
    private done = false;
    private tries = 0;
    constructor(private bot: AIOQuester) {}
    validate(): boolean { return !this.done; }
    async execute(): Promise<void> {
        if (this.bot.firstIncompleteQuestOwnsInventory()) {
            this.bot.log('quest module owns its startup loadout — skipping generic coin withdrawal');
            this.done = true;
            return;
        }
        // Why: a quest that declares no float buys nothing, and the walk to a pinned bank it does not need can be a route that does not exist — from inside the Dwarf Cannon goblin cave it costs a minute and a half of proving so before the quest starts.
        const float = this.bot.firstIncompleteQuestCoinFloat();
        if (float <= 0) {
            this.bot.log('quest declares no coin float — skipping generic coin withdrawal');
            this.done = true;
            return;
        }
        if (Inventory.count('Coins') >= float) {
            this.bot.log(`already holding ${float}+ coins — skipping startup withdraw`);
            this.done = true;
            return;
        }
        this.bot.log(`withdrawing ${float} starting coins`);
        const ok = await executeStep(
            { kind: 'withdraw', items: [{ name: 'Coins', qty: float }], bank: this.bot.firstQuestBank(), leaveOpen: true },
            [],
            m => this.bot.log(`  ${m}`)
        );
        if (ok || ++this.tries >= 3) { this.done = true; }
    }
}
