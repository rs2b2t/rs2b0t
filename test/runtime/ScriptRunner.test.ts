import { afterEach, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';
import { loopReadyOrDetached, ScriptRunner, stopReasonOf } from '#/bot/runtime/ScriptRunner.js';
import type { ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';

class SelfStoppingBot extends LoopingBot {
    starts = 0;
    stops = 0;

    override onStart(): void {
        this.starts++;
        ScriptRunner.stop('test: self-stopping bot');
    }

    override onStop(): void {
        this.stops++;
    }

    override loop(): void {
        throw new Error('loop must not run after onStart stops the script');
    }
}

class StartProbeBot extends LoopingBot {
    starts = 0;

    override onStart(): void {
        this.starts++;
    }

    override loop(): void {}
}

class IgnoreSwarmBot extends LoopingBot {
    override ignoredRandoms(): string[] {
        return ['swarm'];
    }

    override loop(): void {}
}

class AsyncStartPaintProbeBot extends LoopingBot {
    starts = 0;
    paints = 0;
    private releaseStart!: () => void;
    private readonly startGate = new Promise<void>(resolve => {
        this.releaseStart = resolve;
    });

    override onStart(): Promise<void> {
        this.starts++;
        return this.startGate;
    }

    override onPaint(): void {
        this.paints++;
    }

    finishStart(): void {
        this.releaseStart();
    }

    override loop(): void {}
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

afterEach(async () => {
    ScriptRunner.stop('test teardown');
    await settle();
});

test('a script can restart after stopping itself during onStart', async () => {
    const instances: SelfStoppingBot[] = [];
    const meta: ScriptMeta = {
        name: 'Self-stopping test bot',
        description: 'runner regression fixture',
        create: () => {
            const bot = new SelfStoppingBot();
            instances.push(bot);
            return bot;
        }
    };

    ScriptRunner.start(meta);
    await settle();

    expect(ScriptRunner.state).toBe('stopped');
    expect(Scheduler.active).toBeNull();
    expect(instances[0]?.starts).toBe(1);
    expect(instances[0]?.stops).toBe(1);
    // Tail, not the log: ScriptRunner is a singleton, so whether a line
    // about an earlier run is carried in depends on what ran before this file.
    expect(ScriptRunner.ctx?.log.map(line => line.msg).slice(-3)).toEqual([
        'Self-stopping test bot started',
        'stopping — test: self-stopping bot',
        'stopped — test: self-stopping bot'
    ]);

    expect(() => ScriptRunner.start(meta)).not.toThrow();
    await settle();

    expect(ScriptRunner.state).toBe('stopped');
    expect(Scheduler.active).toBeNull();
    expect(instances).toHaveLength(2);
    expect(instances[1]?.starts).toBe(1);
    expect(instances[1]?.stops).toBe(1);
    // Why: a restart replaces the context and its log, so without this carry-over the reason the previous run ended is gone.
    expect(ScriptRunner.ctx?.log.map(line => line.msg)).toContain(
        "previous run of 'Self-stopping test bot' ended (stopped) — test: self-stopping bot"
    );
});

test('runner applies ignoredRandoms after onStart and clears them on stop (#597)', async () => {
    ScriptRunner.start({
        name: 'Ignore swarm probe',
        description: 'runner ignoredRandoms wiring',
        create: () => new IgnoreSwarmBot()
    });
    await settle();
    expect(RandomEvents.isIgnored('swarm')).toBe(true);
    ScriptRunner.stop('test: clear ignored randoms');
    await settle();
    expect(RandomEvents.isIgnored('swarm')).toBe(false);
});

test('a stop with a blank reason still says so instead of reading as no reason', async () => {
    const meta: ScriptMeta = {
        name: 'Blank reason bot',
        description: 'runner regression fixture',
        create: () => new (class extends LoopingBot {
            loop(): void {}
        })()
    };

    ScriptRunner.start(meta);
    await settle();
    ScriptRunner.stop('   ');
    await settle();

    expect(ScriptRunner.ctx?.log.map(line => line.msg)).toContain(
        'stopped — no reason given by the caller (bug — please report)'
    );
});

test('onPaint remains hidden until asynchronous onStart establishes its baseline', async () => {
    const instance = new AsyncStartPaintProbeBot();
    ScriptRunner.start({
        name: 'Paint startup probe',
        description: 'runner paint readiness regression fixture',
        create: () => instance
    });
    await settle();

    expect(instance.starts).toBe(1);
    expect(ScriptRunner.paintBot).toBeNull();
    expect(instance.paints).toBe(0);

    instance.finishStart();
    await settle();

    expect(ScriptRunner.paintBot).toBe(instance);
    ScriptRunner.paintBot?.onPaint?.({} as CanvasRenderingContext2D);
    expect(instance.paints).toBe(1);
});

test('an attached script waits for the login stat snapshot before reading XP', () => {
    const original = {
        attached: reader.attached,
        ingame: reader.ingame,
        sceneState: reader.sceneState,
        worldTile: reader.worldTile,
        statsReady: reader.statsReady
    };

    try {
        reader.attached = () => true;
        reader.ingame = () => true;
        reader.sceneState = () => 2;
        reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
        reader.statsReady = () => false;
        expect(loopReadyOrDetached()).toBe(false);

        reader.statsReady = () => true;
        expect(loopReadyOrDetached()).toBe(true);
    } finally {
        reader.attached = original.attached;
        reader.ingame = original.ingame;
        reader.sceneState = original.sceneState;
        reader.worldTile = original.worldTile;
        reader.statsReady = original.statsReady;
    }
});

test('onStart remains blocked until the stat snapshot is ready', async () => {
    const originalReader = {
        attached: reader.attached,
        ingame: reader.ingame,
        sceneState: reader.sceneState,
        worldTile: reader.worldTile,
        statsReady: reader.statsReady
    };
    const originalDelayUntil = Execution.delayUntil;
    let statsReady = false;
    const pending: { waitedFor?: () => boolean; release?: (ready: boolean) => void } = {};
    const instance = new StartProbeBot();

    try {
        reader.attached = () => true;
        reader.ingame = () => true;
        reader.sceneState = () => 2;
        reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
        reader.statsReady = () => statsReady;
        Execution.delayUntil = cond => {
            pending.waitedFor = cond;
            return new Promise(resolve => {
                pending.release = resolve;
            });
        };

        ScriptRunner.start({
            name: 'XP baseline probe',
            description: 'runner readiness regression fixture',
            create: () => instance
        });
        await settle();

        expect(instance.starts).toBe(0);
        expect(ScriptRunner.paintBot).toBeNull();
        expect(pending.waitedFor?.()).toBe(false);

        statsReady = true;
        expect(pending.waitedFor?.()).toBe(true);
        pending.release?.(true);
        await settle();
        expect(instance.starts).toBe(1);
        expect(ScriptRunner.paintBot).toBe(instance);
    } finally {
        Execution.delayUntil = originalDelayUntil;
        reader.attached = originalReader.attached;
        reader.ingame = originalReader.ingame;
        reader.sceneState = originalReader.sceneState;
        reader.worldTile = originalReader.worldTile;
        reader.statsReady = originalReader.statsReady;
    }
});

// Why: harnesses call `rs2b0t.runner.stop()` with no argument, and throwing there aborts before the state transition, leaving the run `running` forever.
test('stop() without a reason still stops the run', () => {
    expect(stopReasonOf(undefined as never)).toContain('no reason given');
    expect(stopReasonOf('  ')).toContain('no reason given');
    expect(stopReasonOf('out of food')).toBe('out of food');
});
