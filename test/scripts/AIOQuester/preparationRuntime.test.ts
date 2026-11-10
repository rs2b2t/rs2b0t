import { afterEach, expect, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { QuestPreparation, PreparationError, type PreparationEnvironment } from '#/bot/scripts/AIOQuester/preparationRuntime.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { ScriptAborted, ScriptContext } from '#/bot/runtime/ScriptContext.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Execution } from '#/bot/api/execution/Execution.js';

const active: QuestPreparation[] = [];
afterEach(() => { active.forEach(runtime => runtime.stop()); active.length = 0; Scheduler.active = null; Sustain.set(null); });
function fixture(loop: (plan: ActivityPlan, s: LevelerSnapshot) => void | Promise<void> = () => {}) {
    const s: LevelerSnapshot = { levels: Object.fromEntries(enabledSkills.map(skill => [skill, 40])), stock: { coins: 100000, lobster: 50 }, bankReady: false, quests: {}, target: 60, wilderness: false, now: 0 };
    let current: ActivityPlan;
    let stops = 0;
    let banks = 0;
    let hooks = 0;
    const parentHook = async () => {};
    let now = 0;
    const environment: PreparationEnvironment = {
        snapshot: () => s,
        bank: async () => { banks++; s.bankReady = true; },
        prepare: async plan => { current = plan; },
        invalidate: () => { s.bankReady = false; },
        progress: plan => JSON.stringify([s.levels[plan.objective], plan.output ? s.stock[plan.output.item.toLowerCase()] ?? 0 : 0]),
        canStop: () => true,
        eat: async () => {},
        now: () => now,
        dispose: () => {},
        meta: name => ({ name, description: '', create: () => new class extends LoopingBot {
            override loopDelay = 0;
            async loop() { await loop(current, s); }
            override onStop() { stops++; }
        }() })
    };
    const runtime = new QuestPreparation(() => {}, { environment, restoreHooks: () => { hooks++; Sustain.set(parentHook); } });
    active.push(runtime);
    return { runtime, s, environment, parentHook, stops: () => stops, banks: () => banks, hooks: () => hooks, advance: (ms: number) => { now += ms; } };
}

test('preparation banks, trains a real child to the requested target, then stops it and restores hooks', async () => {
    const f = fixture((_, s) => { s.levels.prayer++; });
    const request = { skills: [{ skill: 'prayer', level: 43 }] };
    let result = await f.runtime.tick(request);
    for (let ticks = 0; ticks < 15 && result !== 'ready'; ticks++) result = await f.runtime.tick(request);
    expect(result).toBe('ready');
    expect(f.s.levels.prayer).toBe(43);
    expect(f.runtime.child).toBeNull();
    expect(f.stops()).toBe(1);
    expect(f.banks()).toBeGreaterThanOrEqual(2);
    expect(f.hooks()).toBeGreaterThan(0);
});

test('empty raw stock runs Fisher then CookBot and completes only at the requested food count', async () => {
    const scripts: string[] = [];
    const f = fixture((plan, s) => {
        scripts.push(plan.script);
        if (plan.output) s.stock[plan.output.item.toLowerCase()] = plan.output.count;
    });
    delete f.s.stock.lobster; f.s.stock.shrimps = 30;
    const request = { food: { item: 'Lobster', count: 35 } };
    let result = await f.runtime.tick(request);
    for (let ticks = 0; ticks < 15 && result !== 'ready'; ticks++) result = await f.runtime.tick(request);
    expect(result).toBe('ready');
    expect(scripts).toEqual(['Fisher', 'CookBot']);
    expect(f.s.stock.lobster).toBe(35);
});

test('stalled children terminate with a bounded failure across restarts', async () => {
    const f = fixture();
    const request = { skills: [{ skill: 'prayer', level: 43 }] };
    let failure: unknown;
    for (let ticks = 0; ticks < 20; ticks++) {
        try { await f.runtime.tick(request); } catch (error) { failure = error; break; }
        f.advance(181000);
    }
    expect(failure).toBeInstanceOf(PreparationError);
    expect(String(failure)).toContain('progress');
    expect(f.stops()).toBe(3);
    expect(f.runtime.child).toBeNull();
});

test('unsupported supplies do not launch children or retry indefinitely', async () => {
    const f = fixture();
    await expect(f.runtime.tick({ items: [{ item: 'Mystery token', count: 1 }] })).rejects.toBeInstanceOf(PreparationError);
    expect(f.runtime.child).toBeNull();
});

test('root cancellation propagates and cleans up the active child', async () => {
    const ctx = new ScriptContext(); Scheduler.active = ctx;
    const f = fixture(async () => { await Execution.delayTicks(100); });
    const request = { skills: [{ skill: 'prayer', level: 43 }] };
    await f.runtime.tick(request);
    const pending = f.runtime.tick(request);
    ctx.state = 'stopping'; ctx.abortWaiters();
    await expect(pending).rejects.toBeInstanceOf(ScriptAborted);
    expect(f.runtime.child).toBeNull();
    expect(f.stops()).toBe(1);
});

test('death interrupts in-flight child work and returns to a fresh bank check', async () => {
    Scheduler.active = new ScriptContext();
    const f = fixture(async () => { await Execution.delayTicks(100); });
    const request = { skills: [{ skill: 'prayer', level: 43 }] };
    await f.runtime.tick(request);
    const pending = f.runtime.tick(request);
    f.runtime.interrupt('Player died');
    await pending;
    expect(f.stops()).toBe(1);
    expect(f.runtime.child).toBeNull();
    expect(f.s.bankReady).toBe(false);
    await f.runtime.tick(request);
    expect(f.banks()).toBe(2);
});

test('shop preparation that returns without stocking the requested item fails after three attempts', async () => {
    const f = fixture();
    const request = { items: [{ item: 'Small fishing net', count: 1 }] };
    let failure: unknown;
    for (let tick = 0; tick < 10; tick++) {
        try { await f.runtime.tick(request); } catch (error) { failure = error; break; }
    }
    expect(failure).toBeInstanceOf(PreparationError);
    expect(String(failure)).toContain('Small fishing net');
    expect(f.runtime.child).toBeNull();
});

test('stopping during bank preparation prevents a late child launch', async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    f.environment.bank = () => new Promise<void>(resolve => { release = resolve; });
    const pending = f.runtime.tick({ skills: [{ skill: 'prayer', level: 43 }] });
    f.runtime.stop();
    release?.();
    await pending;
    expect(f.runtime.child).toBeNull();
    await expect(f.runtime.tick({})).rejects.toBeInstanceOf(PreparationError);
});

test('stopping in-flight child startup restores parent hooks after the child actually stops', async () => {
    Scheduler.active = new ScriptContext();
    const f = fixture();
    let started: (() => void) | undefined;
    const starting = new Promise<void>(resolve => { started = resolve; });
    f.environment.meta = name => ({ name, description: '', create: () => new class extends LoopingBot {
        override async onStart() { started?.(); await Execution.delayTicks(100); }
        loop() {}
    }() });
    const pending = f.runtime.tick({ skills: [{ skill: 'prayer', level: 43 }] });
    await starting;
    f.runtime.stop();
    await pending;
    expect(f.runtime.child).toBeNull();
    expect(Sustain.hook).toBe(f.parentHook);
});

test('quest potion preparation leaves the arena before banking and consumes the gathered ingredients', async () => {
    let inside = false;
    const scripts: string[] = [];
    const f = fixture((plan, s) => {
        if (scripts.at(-1) !== plan.script) scripts.push(plan.script);
        switch (plan.script) {
            case 'QuestArenaTickets':
                if ((s.stock['agility arena ticket'] ?? 0) >= 6) inside = false;
                else { inside = true; s.stock['agility arena ticket'] = (s.stock['agility arena ticket'] ?? 0) + 1; }
                break;
            case 'QuestToadflax':
                s.stock['agility arena ticket'] -= 3;
                s.stock.toadflax = (s.stock.toadflax ?? 0) + 1;
                break;
            case 'HerbloreSecondaries': s.stock["toad's legs"] = 2; break;
            case 'PotionMaker':
                s.stock.toadflax--;
                s.stock["toad's legs"]--;
                s.stock['vial of water']--;
                s.stock['agility potion(3)'] = (s.stock['agility potion(3)'] ?? 0) + 1;
                break;
        }
    });
    f.s.stock['vial of water'] = 2;
    f.environment.canStop = () => !inside;
    const bank = f.environment.bank;
    f.environment.bank = async () => { expect(inside).toBe(false); await bank(); };
    const request = { items: [{ item: 'Agility potion(3)', count: 2 }] };
    let result = await f.runtime.tick(request);
    for (let tick = 0; tick < 40 && result !== 'ready'; tick++) result = await f.runtime.tick(request);
    expect(result).toBe('ready');
    expect(scripts).toEqual(['QuestArenaTickets', 'QuestToadflax', 'HerbloreSecondaries', 'PotionMaker']);
    expect(f.s.stock['agility potion(3)']).toBe(2);
    expect(f.s.stock['agility arena ticket']).toBe(0);
    expect(f.s.stock.toadflax).toBe(0);
    expect(f.s.stock["toad's legs"]).toBe(0);
});
