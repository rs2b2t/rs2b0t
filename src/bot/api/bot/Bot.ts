import { bus, type EventMap } from '../events/EventBus.js';
import { SettingsBag } from '../../runtime/Settings.js';
import { Game } from '../game/Game.js';
import type Tile from '../../geometry/Tile.js';

// Why: `server-tick` (the default) waits for N observed `Game.tick()` / PLAYER_INFO advances.
// Why: `frame` is eligible on the next client frame (~20 ms), for hot TaskBots that already guard against double-dispatch.
// Why: `time` is wall-clock pacing, for dashboards and humanisation.
// Why: numeric `loopDelay` is still accepted for compatibility, via {@link resolveLoopCadence}.

/** How the runner schedules the next `loop()` after one finishes. */
export type LoopCadence =
    | { kind: 'frame' }
    | { kind: 'server-tick'; ticks?: number }
    | { kind: 'time'; ms: number };

/**
 * Map legacy `loopDelay` ms to an explicit cadence.
 * Why: `0` is the next client frame, `600` (the old "one tick" default) is the next server tick, anything else is wall-clock ms.
 */
export function resolveLoopCadence(loopDelayMs: number, override?: LoopCadence | null): LoopCadence {
    if (override) {
        return override;
    }
    if (loopDelayMs <= 0) {
        return { kind: 'frame' };
    }
    // About 30 scripts hardcode 600 to mean "one game tick", so keep it on the server tick; a wall-clock timer drifts from PLAYER_INFO.
    if (loopDelayMs === 600) {
        return { kind: 'server-tick', ticks: 1 };
    }
    return { kind: 'time', ms: loopDelayMs };
}

/**
 * Base class for every bot.
 * @see docs/reference/api-bots.md
 */
export abstract class AbstractBot {
    // Prefer `loopCadence`; legacy `600` maps to one server tick through `resolveLoopCadence`.
    // Why: pass `loopCadence: { kind: 'time', ms }` when you want wall-clock 600 ms.

    /** Legacy wall-clock-ish pacing between `loop()` calls. */
    loopDelay = 600;

    /** When set, overrides the cadence derived from {@link loopDelay}. */
    loopCadence: LoopCadence | null = null;

    settings: SettingsBag = new SettingsBag({});

    private logSink: ((msg: string) => void) | null = null;
    private subscriptions: (() => void)[] = [];

    onStart?(): void | Promise<void>;
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;

    onPaint?(ctx: CanvasRenderingContext2D): void;

    recoveryAnchor?(): Tile | null;

    grindTargets(): string[] {
        return [];
    }

    /** Random-event names this bot won't pause for. Re-read on each detect so a script can ignore Swarm only while on a 5x5 arena platform (#597). */
    ignoredRandoms(): string[] {
        return [];
    }

    log(msg: string): void {
        if (this.logSink) {
            this.logSink(msg);
        } else {
            console.log(`[bot] ${msg}`);
        }
    }

    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void {
        this.subscriptions.push(bus.on(event, cb));
    }

    /** @internal */
    bindLog(sink: (msg: string) => void): void {
        this.logSink = sink;
    }

    /** @internal */
    disposeSubscriptions(): void {
        for (const unsub of this.subscriptions) {
            unsub();
        }
        this.subscriptions = [];
    }
}

/**
 * Implement `loop()`; it runs repeatedly with `loopDelay` between iterations.
 * @see docs/reference/api-bots.md#loopingbot
 */
export abstract class LoopingBot extends AbstractBot {
    abstract loop(): number | void | Promise<number | void>;
}

/**
 * A guard and the action it guards.
 * @see docs/reference/api-bots.md#taskbot
 */
export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

/**
 * Runs the first task whose `validate()` passes, once per loop; order is priority.
 * @see docs/reference/api-bots.md#taskbot
 */
export abstract class TaskBot extends LoopingBot {
    private readonly tasks: Task[] = [];
    private lastSceneWaitLogAt = 0;

    protected add(...tasks: Task[]): void {
        this.tasks.push(...tasks);
    }

    async loop(): Promise<number | void> {
        // Mid-zone rebuilds leave ingame=true while sceneState is 0/1, and tasks that still validate thrash soft-failed injects (#445).
        if (!Game.sceneReady()) {
            const now = performance.now();
            if (now - this.lastSceneWaitLogAt > 2000) {
                this.lastSceneWaitLogAt = now;
                this.log(`waiting for scene (state=${Game.sceneState()}) before tasks`);
            }
            return;
        }
        for (const task of this.tasks) {
            if (await task.validate()) {
                await task.execute();
                return;
            }
        }
    }
}

/**
 * A decision node in a behaviour tree.
 * @see docs/reference/api-bots.md#treebot
 */
export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

/**
 * An action node in a behaviour tree.
 * @see docs/reference/api-bots.md#treebot
 */
export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

export type TreeNode = BranchTask | LeafTask;

export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;
    private lastSceneWaitLogAt = 0;

    async loop(): Promise<number | void> {
        if (!Game.sceneReady()) {
            const now = performance.now();
            if (now - this.lastSceneWaitLogAt > 2000) {
                this.lastSceneWaitLogAt = now;
                this.log(`waiting for scene (state=${Game.sceneState()}) before tree`);
            }
            return;
        }
        let node = this.root();
        while (node instanceof BranchTask) {
            node = node.validate() ? node.success() : node.failure();
        }

        await node.execute();
    }
}
