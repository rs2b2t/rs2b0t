import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Quests } from '../api/hud/Quests.js';
import { Skills } from '../api/hud/Skills.js';
import { Sustain } from '../api/Sustain.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { COIN_FLOAT, PROVISION_BANK, QuestEngine } from '../quests/engine/QuestEngine.js';
import { executeStep } from '../quests/exec/steps.js';
import { QUEST_DEFS, defById } from '../quests/defs/index.js';
import { QuestFood } from '../quests/food.js';
import type { QueueRow, QueueStatus } from '../quests/engine/queue.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// Death detection: the SAME loose regex the shared DeathRecovery task uses
// (src/bot/api/tasks/DeathRecovery.ts:8), matched loosely so upstream
// punctuation drift can't silently break recovery. Re-declared (not imported)
// because DeathRecovery keeps it module-local.
const DEATH_RE = /oh dear.*you are dead/i;

// Queue-status glyphs for the Queue tab (one per row).
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
        default: [], // empty = all implemented quests, in def order
        options: QUEST_DEFS.map(d => d.record.id),
        label: 'Quest queue (empty = all)',
        help: 'which implemented quests to complete, run in the listed order; leave empty to run every implemented quest'
    },
    food: {
        type: 'string',
        default: 'Trout',
        label: 'Food item',
        help: 'display name of the food to withdraw for quests that ask for it (e.g. Waterfall) and to eat when HP dips; blank = no food'
    },
    eatAtHp: {
        type: 'number',
        default: 50, min: 1, max: 99,
        label: 'Eat below HP%',
        help: 'eat one food whenever hitpoints drop below this percent, during walks and between steps'
    }
};

/**
 * All-in-one quest completer. Hosts the settings, live status, interactive
 * paint, and the Skip flag; all orchestration lives in QuestEngine, which the
 * bot installs as its sole decision Task (below ContinueDialog). The engine
 * feeds the paint through noteState() each loop — this class never decides
 * anything itself.
 */
export default class AIOQuester extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private picked = new Set<string>();
    private eatAt = 0.5; // HP fraction below which the eat hook/task fires (set in onStart)

    // Paint mirror, published by the engine via noteState() each loop.
    private rows: QueueRow[] = [];
    private runningId: string | null = null;
    private stepDesc = '—';
    private noProgress = 0;
    private parkedCount = 0;

    // Skip button -> flag the engine consumes at the top of its next loop.
    private skipRequested = false;

    // Death latch + lifetime tally. Death = an involuntary deposit-everything
    // plus a teleport (the engine re-provisions and resumes on consumeDeath).
    // `deaths` is cosmetic — surfaced on the Current tab.
    private died = false;
    private deaths = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const all = QUEST_DEFS.map(d => d.record.id);
        const chosen = this.settings.list('quests', []).filter(id => all.includes(id));
        // Empty selection = every implemented quest (design decision).
        this.picked = new Set(chosen.length > 0 ? chosen : all);

        // Latch a death the moment the chat line is matched; the engine consumes
        // it next loop (WildyAgility.ts:241 installs the identical subscription).
        this.on('chat.message', e => {
            if (DEATH_RE.test(e.text)) {
                this.died = true;
                this.deaths++;
            }
        });

        this.eatAt = this.settings.num('eatAtHp', 50) / 100;
        QuestFood.name = this.foodItem(); // defs (Waterfall) read the configured food from here
        // Sustain hook: awaited by the walker's follow/ladder loops (Sustain.run),
        // so the bot eats mid-walk past aggressive spawns. The EatFood task below
        // covers standing combat between engine steps. Both call eatOnce().
        Sustain.set(async () => { if (this.shouldEat()) { await this.eatOnce(); } });

        this.log(`AIOQuester — queue: ${[...this.picked].join(', ') || '(none)'}`);
        // StartupWithdraw runs BEFORE the engine: first thing on start, head to the
        // bank and pull the coin float so tolls/shop buys are always covered (the
        // per-quest float is the fallback if this bank trip fails).
        this.add(new ContinueDialog(), new EatFood(this), new StartupWithdraw(this), new QuestEngine(this));
    }

    override async onStop(): Promise<void> {
        Sustain.set(null); // the runner does not clear the hook for us
    }

    /** The configured food display name, or null when blank — read by the engine
     *  (food provisioning for quests that declare `food`) and the eat hook/task. */
    foodItem(): string | null {
        const f = this.settings.str('food', '').trim();
        return f.length > 0 ? f : null;
    }

    /** HP below the eat threshold with the configured food in the pack. */
    shouldEat(): boolean {
        const f = this.foodItem();
        return f !== null && Skills.hpFraction() < this.eatAt
            && Inventory.items().some(i => i.name?.toLowerCase() === f.toLowerCase());
    }

    /** Eat one of the configured food, waiting for the heal to land. */
    async eatOnce(): Promise<void> {
        const f = this.foodItem();
        if (!f) { return; }
        const food = Inventory.items().find(i => i.name?.toLowerCase() === f.toLowerCase());
        if (!food) { return; }
        this.status = `eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`;
        const before = Skills.effective('hitpoints');
        if (!(await food.interact('Eat'))) { return; }
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
    }

    /** The running quest's declared grind quarry (e.g. Romeo & Juliet's imps),
     *  so RandomEvents never flags them hostile. `runningId` is the engine's
     *  live selection, mirrored here each loop via noteState(). */
    override grindTargets(): string[] {
        return this.runningId ? defById(this.runningId)?.grind ?? [] : [];
    }

    // --- host accessors used by QuestEngine ---------------------------------

    pickedIds(): Set<string> {
        return this.picked;
    }

    /** Engine -> paint state feed, once per loop. `noProgress`/`parked` diverge
     *  from the brief's 3-arg sketch: the Current tab needs the watchdog count,
     *  which isn't derivable from the rows, so the engine passes it through. */
    noteState(rows: QueueRow[], runningId: string | null, stepDesc: string, noProgress: number, parked: number): void {
        this.rows = rows;
        this.runningId = runningId;
        this.stepDesc = stepDesc;
        this.noProgress = noProgress;
        this.parkedCount = parked;
        const running = rows.find(r => r.id === runningId);
        this.status = running ? `running ${running.name}` : stepDesc;
    }

    /** Paint's Skip button — parks the running quest on the engine's next pass. */
    requestSkip(): void {
        this.skipRequested = true;
    }

    consumeSkip(): boolean {
        const s = this.skipRequested;
        this.skipRequested = false;
        return s;
    }

    /** Read-and-clear the death latch (mirrors consumeSkip). The engine consumes
     *  it EVERY loop so a death with no running quest can't stay latched and fire
     *  recovery on the next quest picked (same unconditional-consume lesson as
     *  Skip). */
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
            ScriptRunner.stop();
        }
        p.end();
    }
}

/** Eat between engine steps (standing combat the walker's Sustain hook can't
 *  reach). Gated on HP + food so it never starves the QuestEngine task below it. */
class EatFood implements Task {
    constructor(private bot: AIOQuester) {}
    validate(): boolean { return this.bot.shouldEat(); }
    async execute(): Promise<void> { await this.bot.eatOnce(); }
}

/** First action on start: head to the nearest bank and withdraw the coin float,
 *  so tolls/shop buys are covered from the outset (reuses the withdraw executor's
 *  bank-walk). Runs once — bounded retries, then defers to the per-quest float. */
class StartupWithdraw implements Task {
    private done = false;
    private tries = 0;
    constructor(private bot: AIOQuester) {}
    validate(): boolean { return !this.done; }
    async execute(): Promise<void> {
        // Already carrying the float (coins carried over from a prior quest, or a
        // fresh account handed coins directly) -> skip the bank trip. Withdrawing
        // from an empty bank otherwise burns three failed attempts + a round-trip.
        if (Inventory.count('Coins') >= COIN_FLOAT) {
            this.bot.log(`already holding ${COIN_FLOAT}+ coins — skipping startup withdraw`);
            this.done = true;
            return;
        }
        this.bot.log(`withdrawing ${COIN_FLOAT} starting coins`);
        const ok = await executeStep(
            { kind: 'withdraw', items: [{ name: 'Coins', qty: COIN_FLOAT }], bank: PROVISION_BANK },
            [],
            m => this.bot.log(`  ${m}`)
        );
        if (ok || ++this.tries >= 3) { this.done = true; }
    }
}
