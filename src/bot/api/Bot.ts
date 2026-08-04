import { bus, type EventMap } from '../events/EventBus.js';
import { SettingsBag } from '../runtime/Settings.js';
import { Game } from './Game.js';
import type Tile from './Tile.js';

/**
 * Base class for every bot.
 * @see docs/API.md#bot-base-classes
 */
export abstract class AbstractBot {
    loopDelay = 600;

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
    private lastSceneWaitLogAt = 0;

    protected add(...tasks: Task[]): void {
        this.tasks.push(...tasks);
    }

    async loop(): Promise<number | void> {
        // Mid-zone rebuilds leave ingame=true while sceneState is 0/1 — tasks that
        // still validate would thrash soft-failed injects (#445).
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
