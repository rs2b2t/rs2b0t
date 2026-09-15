import assert from 'node:assert/strict';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { LoopingBot, TaskBot, type Task } from '../../src/bot/api/bot/Bot.js';
import * as traceModule from '../../e2e/jive-private-trace.js';
import { scenario, restoreScenario } from '../scripts/JiveDragons/scheduler.fixture.js';

class SetupBot extends LoopingBot { loop() { return 1000; } }
class ClueTask implements Task {
    validate() { return true; }
    clueStatus() { return 'prepared'; }
    execute(): void | Promise<void> {}
}
class HostBot extends TaskBot {
    status = '';
    constructor(task?: Task) { super(); if (task) this.add(task); }
    addTask(task: Task) { this.add(task); }
    setStatus(value: string) { this.status = value; }
}

const restores: (() => void)[] = [];
afterEach(() => { restores.splice(0).reverse().forEach(restore => restore()); globalThis.__jiveHostTraceFactory = undefined; });

function harness(bot: unknown = null) {
    traceModule.installPrivateHostTraceFactory();
    const create = globalThis.__jiveHostTraceFactory;
    assert(create);
    const changes = new Set<() => void>(), ticks = new Set<() => void>(), events: string[] = [];
    const runner = { bot, onChange(fn: () => void) { changes.add(fn); return () => { changes.delete(fn); }; } };
    const host = { addTickListener(fn: () => void) { ticks.add(fn); return () => { ticks.delete(fn); }; } };
    const trace = create({ runner, host }, kind => events.push(kind));
    restores.push(trace.restore);
    return { runner, events, changes, ticks, trace, change() { changes.forEach(fn => fn()); }, tick() { ticks.forEach(fn => fn()); } };
}

test.each([null, new SetupBot(), { tasks: [{}], setStatus() {} }])('ignores absent, setup or malformed task hosts %#', bot => {
    const h = harness(bot);
    h.tick();
    expect(h.trace.status()).toBe('');
    expect(h.events).toEqual(['tick']);
});

test('binds a replacement TaskBot exactly once after a stopped setup bot', async () => {
    const h = harness(new SetupBot()), clue = new ClueTask(), bot = new HostBot(clue);
    h.runner.bot = bot;
    h.change(); h.tick(); h.change();
    await clue.execute();
    bot.setStatus('clue solved');
    expect(h.trace.status()).toBe('prepared');
    expect(h.events.filter(kind => kind !== 'tick')).toEqual(['solver-start', 'solver-end', 'solved']);
    expect(bot.status).toBe('clue solved');
});

test('restores old host methods when replacing or removing the host', async () => {
    const firstTask = new ClueTask(), first = new HostBot(firstTask);
    const secondTask = new ClueTask(), second = new HostBot(secondTask);
    const originalStatus = first.setStatus, originalExecute = firstTask.execute;
    const h = harness(first);
    h.runner.bot = second; h.change();
    expect(first.setStatus).toBe(originalStatus);
    expect(firstTask.execute).toBe(originalExecute);
    first.setStatus('clue solved');
    await secondTask.execute(); second.setStatus('clue solved');
    expect(h.events).toEqual(['solver-start', 'solver-end', 'solved']);
    h.runner.bot = null; h.change();
    expect(Object.hasOwn(second, 'setStatus')).toBe(false);
    expect(Object.hasOwn(secondTask, 'execute')).toBe(false);
    expect(h.trace.status()).toBe('');
});

test('binds tasks added during startup on the next tick', async () => {
    const bot = new HostBot(), h = harness(bot), clue = new ClueTask();
    bot.addTask(clue);
    h.tick();
    await clue.execute();
    expect(h.events).toEqual(['tick', 'solver-start', 'solver-end']);
});

test('binds tasks at startup completion before the first solver executes', async () => {
    const bot = new HostBot(), clue = new ClueTask();
    bot.onStart = async () => { bot.addTask(clue); };
    const start = bot.onStart, h = harness(bot);
    await bot.onStart();
    await clue.execute();
    expect(h.events).toEqual(['solver-start', 'solver-end']);
    h.trace.restore();
    expect(bot.onStart).toBe(start);
});

test('preserves upkeep and resume ordering without leaking solved state to another host', async () => {
    const before: Task = { validate: () => true, execute() {} };
    const after: Task = { validate: () => true, execute() {} };
    const clue = new ClueTask(), bot = new HostBot(before);
    bot.addTask(clue); bot.addTask(after);
    const h = harness(bot);
    await clue.execute(); await before.execute(); await after.execute();
    bot.setStatus('clue solved');
    const next = new HostBot(new ClueTask()), nextAfter: Task = { validate: () => true, execute() {} };
    next.addTask(nextAfter); h.runner.bot = next; h.change();
    await nextAfter.execute();
    expect(h.events).toEqual(['solver-start', 'solver-end', 'host-upkeep', 'host-resume', 'solved']);
});

test('restores original methods and both listeners idempotently', async () => {
    const task = new ClueTask(), bot = new HostBot(task);
    const status = bot.setStatus, execute = task.execute;
    const h = harness(bot);
    h.trace.restore(); h.trace.restore();
    await task.execute(); bot.setStatus('clue solved');
    expect(h.events).toEqual([]);
    expect([h.ticks.size, h.changes.size]).toEqual([0, 0]);
    expect(bot.setStatus).toBe(status);
    expect(task.execute).toBe(execute);
    expect(Object.hasOwn(bot, 'setStatus')).toBe(false);
    expect(Object.hasOwn(task, 'execute')).toBe(false);
});

test('does not attribute an old in-flight task completion to its replacement', async () => {
    const done = Promise.withResolvers<void>();
    const firstTask = new ClueTask();
    firstTask.execute = () => done.promise;
    const h = harness(new HostBot(firstTask));
    const execution = firstTask.execute();
    h.runner.bot = new HostBot(new ClueTask()); h.change();
    done.resolve(); await execution;
    expect(h.events).toEqual(['solver-start']);
});

test('captures the actual JiveDragons SolveClue task and status method on the right instance', async () => {
    const real = await scenario('taverley-blue', 'range', { solveClues: true });
    const task = real.task('SolveClue');
    spyOn(task, 'execute').mockImplementation(async () => { real.bot.setStatus('clue solved'); });
    const original = task.execute, status = real.bot.setStatus;
    const h = harness(new SetupBot());
    try {
        h.runner.bot = real.bot; h.change(); h.tick(); h.change();
        await task.execute();
        expect(h.events.filter(kind => kind !== 'tick')).toEqual(['solver-start', 'solved', 'solver-end']);
        expect(real.bot.status).toBe('clue solved');
        h.trace.restore();
        expect(task.execute).toBe(original);
        expect(real.bot.setStatus).toBe(status);
    } finally { h.trace.restore(); await restoreScenario(); }
});
