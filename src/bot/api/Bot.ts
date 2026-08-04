import { bus, type EventMap } from '../events/EventBus.js';
import { SettingsBag } from '../runtime/Settings.js';
import type Tile from './Tile.js';

/**
 * Base class for every bot.
 * @see docs/API.md#bot-base-classes
 */
/**
 * How the runner schedules the next `loop()` after one finishes.
 * - `server-tick` (default): wait for N observed `Game.tick()` / PLAYER_INFO advances
 * - `frame`: eligible on the next client frame (~20 ms) — use for hot TaskBots that
 *   already guard against double-dispatch
 * - `time`: deliberate wall-clock pacing (dashboards, humanisation)
 *
 * Numeric `loopDelay` is still accepted for compatibility; see {@link resolveLoopCadence}.
 */
export type LoopCadence =
    | { kind: 'frame' }
    | { kind: 'server-tick'; ticks?: number }
    | { kind: 'time'; ms: number };

/**
 * Map legacy `loopDelay` ms to an explicit cadence.
 * - `0` → next client frame
 * - `600` (historical "one tick" default and most overrides) → next server tick
 * - any other value → wall-clock ms
 */
export function resolveLoopCadence(loopDelayMs: number, override?: LoopCadence | null): LoopCadence {
    if (override) {
        return override;
    }
    if (loopDelayMs <= 0) {
        return { kind: 'frame' };
    }
    // The long-standing default and the value ~30 scripts hardcode: meant "about one
    // game tick", not a free-running wall-clock timer that drifts vs PLAYER_INFO.
    if (loopDelayMs === 600) {
        return { kind: 'server-tick', ticks: 1 };
    }
    return { kind: 'time', ms: loopDelayMs };
}

export abstract class AbstractBot {
    /**
     * Legacy wall-clock-ish pacing between `loop()` calls.
     * Prefer {@link loopCadence}. The value `600` is interpreted as **one server tick**
     * (see {@link resolveLoopCadence}); use an explicit `loopCadence: { kind: 'time', ms }`
     * if you truly need wall-clock 600 ms.
     */
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

    bindLog(sink: (msg: string) => void): void {
        this.logSink = sink;
    }

    disposeSubscriptions(): void {
        for (const unsub of this.subscriptions) {
            unsub();
        }
        this.subscriptions = [];
    }
}

/**
 * Implement `loop()`; it runs repeatedly with `loopDelay` between iterations.
 * @see docs/API.md#loopingbot
 */
export abstract class LoopingBot extends AbstractBot {
    abstract loop(): number | void | Promise<number | void>;
}

/**
 * A guard and the action it guards.
 * @see docs/API.md#taskbot
 */
export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

/**
 * Runs the first task whose `validate()` passes, once per loop. Order is
 * priority.
 * @see docs/API.md#taskbot
 */
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

/**
 * A decision node in a behaviour tree.
 * @see docs/API.md#treebot
 */
export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

/**
 * An action node in a behaviour tree.
 * @see docs/API.md#treebot
 */
export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

export type TreeNode = BranchTask | LeafTask;

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
