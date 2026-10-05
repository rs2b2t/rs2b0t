import { LoopingBot, TaskBot, resolveLoopCadence } from '../api/bot/Bot.js';
import { EventSignal } from '../api/execution/EventSignal.js';
import { Sustain } from '../api/sustain/Sustain.js';
import { BotHost } from './BotHost.js';
import { RunManager } from './RunManager.js';
import { Scheduler } from './Scheduler.js';
import { ScriptAborted } from './ScriptContext.js';
import type { ScriptMeta } from './ScriptRegistry.js';
import { SettingsBag } from './Settings.js';
import { RandomEvents } from './randomevents/RandomEvents.js';

export type ActivityOutcome = { kind: 'finished' | 'failed' | 'interrupted'; reason: string };

class ActivityFinished extends Error {}

export class ScriptActivity {
    child: LoopingBot | null = null;
    outcome: ActivityOutcome | null = null;
    private nextAt = 0;
    private nextTick = 0;
    private inFlight = false;
    private interrupted = false;

    constructor(private readonly log: (message: string) => void) {}

    get currentTask(): string | null { return this.child instanceof TaskBot ? this.child.activeTaskName : null; }

    async start(meta: ScriptMeta, overrides: Record<string, unknown>): Promise<void> {
        if (this.child || this.inFlight) throw new Error('An activity is already running');
        const child = meta.create();
        if (!(child instanceof LoopingBot)) throw new Error(`${meta.name} cannot run as an activity`);
        this.child = child;
        this.outcome = null;
        this.interrupted = false;
        this.nextAt = 0;
        this.nextTick = 0;
        child.settings = new SettingsBag({
            ...Object.fromEntries(Object.entries(meta.settingsSchema ?? {}).map(([key, value]) => [key, value.default])),
            ...overrides
        });
        child.bindLog(message => this.log(`[${meta.name}] ${message}`));
        child.bindFinish(reason => {
            this.outcome = { kind: 'finished', reason };
            throw new ActivityFinished(reason);
        });
        await this.run(async () => { await child.onStart?.(); });
        if (this.child) {
            RandomEvents.setGrindTargets(child.grindTargets());
            RandomEvents.setIgnoredRandoms(() => child.ignoredRandoms());
        }
    }

    async loop(): Promise<void> {
        const child = this.child;
        if (!child || this.inFlight || performance.now() < this.nextAt || BotHost.tickCount < this.nextTick) return;
        await this.run(async () => {
            const delay = await child.loop();
            const cadence = resolveLoopCadence(typeof delay === 'number' ? delay : child.loopDelay, child.loopCadence);
            this.nextAt = cadence.kind === 'time' ? performance.now() + Math.max(0, cadence.ms) : 0;
            this.nextTick = cadence.kind === 'server-tick' ? BotHost.tickCount + Math.max(1, cadence.ticks ?? 1) : 0;
        });
    }

    interrupt(reason: string): void {
        this.interrupted = true;
        this.outcome = { kind: 'interrupted', reason };
        if (this.inFlight) Scheduler.active?.abortWaiters();
        else this.stop();
    }

    stop(): void {
        if (this.inFlight) {
            this.interrupt('activity stopped');
            return;
        }
        const child = this.child;
        this.child = null;
        if (!child) return;
        try {
            child.onStop?.();
        } finally {
            child.disposeSubscriptions();
            Sustain.set(null);
            EventSignal.setInterrupt(null);
            RunManager.override(null);
            RandomEvents.setGrindTargets([]);
            RandomEvents.setIgnoredRandoms([]);
        }
    }

    private async run(operation: () => Promise<void>): Promise<void> {
        this.inFlight = true;
        try {
            await operation();
        } catch (error) {
            if (error instanceof ScriptAborted && (!this.interrupted || Scheduler.active?.aborted)) throw error;
            if (!this.interrupted) {
                this.outcome = {
                    kind: error instanceof ActivityFinished ? 'finished' : 'failed',
                    reason: error instanceof Error ? error.message : String(error)
                };
                this.log(`${this.outcome.kind}: ${this.outcome.reason}`);
            }
        } finally {
            this.inFlight = false;
            if (this.outcome) this.stop();
        }
    }
}
