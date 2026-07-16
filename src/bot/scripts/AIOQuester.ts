import { TaskBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Paint } from '../api/hud/Paint.js';
import { Quests } from '../api/hud/Quests.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { QuestEngine } from '../quests/engine/QuestEngine.js';
import { QUEST_DEFS } from '../quests/defs/index.js';
import type { QueueRow, QueueStatus } from '../quests/engine/queue.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

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

    // Paint mirror, published by the engine via noteState() each loop.
    private rows: QueueRow[] = [];
    private runningId: string | null = null;
    private stepDesc = '—';
    private noProgress = 0;
    private parkedCount = 0;

    // Skip button -> flag the engine consumes at the top of its next loop.
    private skipRequested = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const all = QUEST_DEFS.map(d => d.record.id);
        const chosen = this.settings.list('quests', []).filter(id => all.includes(id));
        // Empty selection = every implemented quest (design decision).
        this.picked = new Set(chosen.length > 0 ? chosen : all);

        this.log(`AIOQuester — queue: ${[...this.picked].join(', ') || '(none)'}`);
        this.add(new ContinueDialog(), new QuestEngine(this));
    }

    /** No combat grinding — Task 12 wires per-module grind lists (YAGNI here). */
    override grindTargets(): string[] {
        return [];
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
