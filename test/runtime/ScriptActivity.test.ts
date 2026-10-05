import { afterEach, expect, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { ScriptActivity } from '#/bot/runtime/ScriptActivity.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { ScriptContext, ScriptAborted } from '#/bot/runtime/ScriptContext.js';
import { Execution } from '#/bot/api/execution/Execution.js';

const host = () => new ScriptActivity(() => {});
afterEach(() => { ScriptRunner.stop('test cleanup'); Scheduler.active = null; });

test('child finish unwinds its operation, keeps parent running, and cleans up once', async () => {
    const ctx = new ScriptContext();
    Scheduler.active = ctx;
    let stops = 0;
    let afterFinish = false;
    const activity = host();
    await activity.start({ name: 'child', description: '', create: () => new class extends LoopingBot {
        loop() { this.requestFinish('out of logs'); afterFinish = true; }
        override onStop() { stops++; }
    }() }, {});
    await activity.loop();
    expect(activity.outcome).toEqual({ kind: 'finished', reason: 'out of logs' });
    expect(ctx.state).toBe('running');
    expect(afterFinish).toBe(false);
    activity.stop();
    expect(stops).toBe(1);
});

test('completion during startup never runs the child loop', async () => {
    let loops = 0;
    const activity = host();
    await activity.start({ name: 'child', description: '', create: () => new class extends LoopingBot {
        override onStart() { this.requestFinish('already done'); }
        loop() { loops++; }
    }() }, {});
    await activity.loop();
    expect(loops).toBe(0);
    expect(activity.outcome?.reason).toBe('already done');
});

test('defaults are resolved with explicit overrides independently of standalone settings', async () => {
    let settings: Record<string, unknown> = {};
    const activity = host();
    await activity.start({ name: 'child', description: '', settingsSchema: {
        amount: { type: 'number', default: 12 }, mode: { type: 'string', default: 'bank' }
    }, create: () => new class extends LoopingBot {
        override onStart() { settings = this.settings.raw(); }
        loop() {}
    }() }, { amount: 5 });
    expect(settings).toEqual({ amount: 5, mode: 'bank' });
    activity.stop();
});

test('unexpected child exceptions are reported as failures and torn down', async () => {
    let stopped = false;
    const activity = host();
    await activity.start({ name: 'broken', description: '', create: () => new class extends LoopingBot {
        loop() { throw new Error('broken operation'); }
        override onStop() { stopped = true; }
    }() }, {});
    await activity.loop();
    expect(activity.outcome).toEqual({ kind: 'failed', reason: 'broken operation' });
    expect(stopped).toBe(true);
});

test('root cancellation of awaited child work remains a root cancellation', async () => {
    const ctx = new ScriptContext();
    Scheduler.active = ctx;
    const activity = host();
    await activity.start({ name: 'waiting', description: '', create: () => new class extends LoopingBot {
        async loop() { await Execution.delayTicks(100); }
    }() }, {});
    const running = activity.loop();
    ctx.state = 'stopping';
    ctx.abortWaiters();
    await expect(running).rejects.toBeInstanceOf(ScriptAborted);
    activity.stop();
});

test('death interruption unwinds pending child work without aborting the parent', async () => {
    const ctx=new ScriptContext();Scheduler.active=ctx;
    const activity=host();let continued=false;let stops=0;
    await activity.start({name:'waiting',description:'',create:()=>new class extends LoopingBot {
        async loop() { await Execution.delayTicks(100); continued=true; }
        override onStop() { stops++; }
    }()},{});
    const running=activity.loop();activity.interrupt('death');await running;
    expect(ctx.state).toBe('running');expect(continued).toBe(false);expect(stops).toBe(1);
    expect(activity.outcome).toEqual({kind:'interrupted',reason:'death'});
});

test('standalone owned completion still stops the script runner', async () => {
    ScriptRunner.start({name:'finishing',description:'',create:()=>new class extends LoopingBot {
        override onStart() { this.requestFinish('complete'); }
        loop() { throw new Error('must not loop'); }
    }()});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(ScriptRunner.state).toBe('stopped');
    expect(ScriptRunner.ctx?.stopReason).toBe('complete');
});
