import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory, type InvItem } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Quests } from '../api/hud/Quests.js';
import { Skills } from '../api/hud/Skills.js';
import { Sustain } from '../api/Sustain.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { COIN_FLOAT, PROVISION_BANK, QuestEngine } from '../quests/engine/QuestEngine.js';
import type Tile from '../api/Tile.js';
import { executeStep } from '../quests/exec/steps.js';
import { QUEST_DEFS, defById } from '../quests/defs/index.js';
import { QuestFood } from '../quests/food.js';
import { QuestGear } from '../quests/gear.js';
import type { QueueRow, QueueStatus } from '../quests/engine/queue.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import {
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

export const AIO_SETTINGS: SettingsSchema = {
    quests: {
        type: 'string[]',
        default: [],
        options: QUEST_DEFS.map(d => d.record.id),
        optionLabels: QUEST_OPTION_LABELS,
        label: 'Quest queue (empty = all)',
        help: 'which implemented quests to complete, run in the listed order; leave empty to run every implemented quest'
    },
    food: {
        type: 'string',
        default: 'Trout',
        label: 'Food item',
        help: 'general food to withdraw and consume when HP dips; quest-specific survival items are added automatically; blank disables only the general food'
    },
    meleeWeapon: {
        type: 'string',
        default: 'Rune scimitar',
        label: 'Melee weapon',
        help: 'weapon withdrawn and wielded for fights that magic cannot win (the Dagannoth mother\'s melee form). Bank-only — nothing sells a rune scimitar; blank disables melee entirely'
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

        QuestFood.name = this.foodItem();
        QuestGear.meleeWeapon = this.meleeWeapon();
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
        const f = this.settings.str('food', '').trim();
        return f.length > 0 ? f : null;
    }

    verbose(): boolean {
        return this.settings.bool('verbose', true);
    }

    meleeWeapon(): string | null {
        const w = this.settings.str('meleeWeapon', '').trim();
        return w.length > 0 ? w : null;
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

    firstIncompleteQuestOwnsInventory(): boolean {
        return QUEST_DEFS.find(d => this.picked.has(d.record.id) && Quests.status(d.record.name) !== 'complete')?.ownsInventory ?? false;
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
        if (Inventory.count('Coins') >= COIN_FLOAT) {
            this.bot.log(`already holding ${COIN_FLOAT}+ coins — skipping startup withdraw`);
            this.done = true;
            return;
        }
        this.bot.log(`withdrawing ${COIN_FLOAT} starting coins`);
        const ok = await executeStep(
            { kind: 'withdraw', items: [{ name: 'Coins', qty: COIN_FLOAT }], bank: this.bot.firstQuestBank(), leaveOpen: true },
            [],
            m => this.bot.log(`  ${m}`)
        );
        if (ok || ++this.tries >= 3) { this.done = true; }
    }
}
