import { bus, type EventMap } from '../events/EventBus.js';
import { SettingsBag } from '../runtime/Settings.js';
import type Tile from './Tile.js';

/**
 * Script-facing base classes (RuneMate shape). Scripts subclass one of
 * LoopingBot / TaskBot / TreeBot and only sleep via Execution.*.
 */
export abstract class AbstractBot {
    /** Wall-clock ms between loop() iterations when loop() returns void. */
    loopDelay = 600;

    /**
     * Resolved parameters for this run (from the manifest's settingsSchema,
     * overlaid with panel edits and URL overrides). Empty until the runner
     * injects it just before onStart. Read with this.settings.bool('x') etc.
     */
    settings: SettingsBag = new SettingsBag({});

    /**
     * Input mode for this script: 'direct' (default, byte-identical packets
     * with zero mouse telemetry) or 'synthetic' (virtual cursor + real
     * minimenu, Slice 6). Applied by the runner at start; the page-level
     * `?inputmode=` override wins.
     */
    inputMode: 'direct' | 'synthetic' = 'direct';

    private logSink: ((msg: string) => void) | null = null;
    private subscriptions: (() => void)[] = [];

    /** Optional lifecycle hooks. onStop also runs after a crash or stop(). */
    onStart?(): void | Promise<void>;
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;

    /** Draw on the overlay canvas; called every client redraw while running. */
    onPaint?(ctx: CanvasRenderingContext2D): void;

    /**
     * Where recovery flows (watchdog, guarded restarts) should walk the bot
     * back to. Scripts with a working anchor implement this.
     */
    recoveryAnchor?(): Tile | null;

    /**
     * NPC names this bot legitimately fights — the runtime event guard never
     * treats them as hostile random events. Override in combat scripts.
     */
    grindTargets(): string[] {
        return [];
    }

    log(msg: string): void {
        if (this.logSink) {
            this.logSink(msg);
        } else {
            console.log(`[bot] ${msg}`);
        }
    }

    /**
     * Subscribe to a game event for the lifetime of this run (auto-removed on
     * stop/crash). Callbacks run synchronously during the frame — keep them
     * light; do real work in loop(). Public (not just for subclasses) so a
     * shared Task installed by a script — e.g. DeathRecovery — can arm its
     * own listener without the script wiring anything extra.
     */
    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void {
        this.subscriptions.push(bus.on(event, cb));
    }

    /** @internal runner wiring */
    bindLog(sink: (msg: string) => void): void {
        this.logSink = sink;
    }

    /** @internal runner teardown */
    disposeSubscriptions(): void {
        for (const unsub of this.subscriptions) {
            unsub();
        }
        this.subscriptions = [];
    }
}

export abstract class LoopingBot extends AbstractBot {
    /**
     * One iteration. Return a number to override loopDelay for the next
     * iteration. Launched only by the scheduler, never re-entered.
     */
    abstract loop(): number | void | Promise<number | void>;
}

export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

/** Runs the first task whose validate() returns true, once per loop. */
export abstract class TaskBot extends LoopingBot {
    private readonly tasks: Task[] = [];

    protected add(...tasks: Task[]): void {
        this.tasks.push(...tasks);
    }

    async loop(): Promise<number | void> {
        for (const task of this.tasks) {
            if (await task.validate()) {
                await task.execute();
                return;
            }
        }
    }
}

export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

export type TreeNode = BranchTask | LeafTask;

/** Walks branches by validate() until a leaf, executes it, once per loop. */
export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;

    async loop(): Promise<number | void> {
        let node = this.root();
        while (node instanceof BranchTask) {
            node = node.validate() ? node.success() : node.failure();
        }

        await node.execute();
    }
}
