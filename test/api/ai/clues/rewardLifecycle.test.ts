import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../lib/stubSingletons.js';
import { fixture, item, pile } from './rewardFixture.test.js';

let env: ReturnType<typeof fixture>;
let restores: (() => void)[];
let statuses: string[];
let deposits: number;
let banked: number;
let depositWorks: boolean;
let bankWorks: boolean;
let worn: string;
let equipWorks: boolean;
let walks: string[];
let task: SolveClue;
beforeEach(() => {
    env = fixture(); statuses = []; deposits = 0; banked = 0;
    depositWorks = true; bankWorks = true; equipWorks = true; worn = 'Dragon dagger(p)'; walks = [];
    let open = false;
    restores = [
        stubProps(ClueExecutor, { reward: null, rewardResult: null }),
        stubProps(Game, { tile: () => Tile.from(env.f.pos), inCombat: () => false }),
        stubProps(Skills, { level: () => 60, effective: () => 60 }),
        stubProps(ChatDialog, { canContinue: () => false, isOpen: () => false }),
        stubProps(Execution, { delayUntil: async p => p(), delayUntilTicks: async p => p() }),
        stubProps(Traversal, { walkResilient: async dest => {
            walks.push(`${dest.x},${dest.z}`); env.f.pos = { ...dest }; return true;
        } }),
        stubProps(Bank, {
            isOpen: () => open, ready: () => open, waitReady: async () => open,
            openNearest: async () => { open = bankWorks; return open; },
            close: async () => { open = false; return true; },
            withdraw: name => {
                if (env.f.inv.length >= 28) return false;
                env.f.inv.push({ ...item(861), name }); return true;
            },
            depositAllMatching: async predicate => {
                deposits++;
                if (!depositWorks) return;
                banked += env.f.inv.filter(i => i.id === 100 && predicate(i.name ?? '', i.id)).length;
                env.f.inv = env.f.inv.filter(i => !predicate(i.name ?? '', i.id));
            }
        }),
        stubProps(Equipment, {
            contains: name => name === worn,
            equip: async name => { if (equipWorks) worn = name; return equipWorks; }
        })
    ];
    task = new SolveClue({
        log: () => {}, setStatus: s => statuses.push(s),
        foodName: () => 'Shark', foodWithdraw: () => 20, isFood: n => n === 'Shark'
    });
    Sustain.set(null);
});
afterEach(() => { restores.reverse().forEach(r => r()); env.restore(); Sustain.set(null); });

function deliver(count: number): void {
    env.f.onOpen = () => {
        env.f.modal = 6960; env.f.manifest = [item(100, count)];
        const fit = Math.min(28 - env.f.inv.length, count);
        env.f.add(100, fit);
        env.f.ground = Array.from({ length: count - fit }, () => ({ ...pile(100), tile: { ...env.f.pos } }));
    };
}
async function run(): Promise<void> {
    for (let i = 0; i < 150 && task.validate(); i++) await task.execute();
}

test('keeps vanished casket rewards runnable across task yields before restoring the bow', async () => {
    task['strippedGear'] = ['Magic shortbow'];
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100)]; env.f.event = true; };
    await task.execute();
    expect(env.f.inv.some(i => i.id === 2724)).toBe(false);
    expect(task.validate()).toBe(true);
    expect(worn).toBe('Dragon dagger(p)');
    expect(statuses).not.toContain('clue solved');
    env.f.event = false;
    env.f.onTick = () => { if (env.f.tick === 4) env.f.ground = [{ ...pile(100), tile: { ...env.f.pos } }]; };
    await run();
    expect(env.f.takes).toEqual([100]);
    expect(worn).toBe('Magic shortbow');
    expect(statuses.filter(s => s === 'clue solved')).toHaveLength(1);
});

test('opens a hard casket at the bank without guardian preparation and banks overflow beyond capacity', async () => {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    deliver(40);
    await run();
    expect(env.f.opens).toBe(1);
    expect(walks[0]).toBe('3269,3167');
    expect(env.f.eats).toHaveLength(27);
    expect(banked + env.f.inv.filter(i => i.id === 100).length).toBe(40);
    expect(env.f.ground).toEqual([]);
    expect(statuses).toContain('clue solved');
});

test.each(['bank', 'deposit', 'pickup'])('blocks pending rewards without restoring or looping when %s fails', async failure => {
    task['strippedGear'] = ['Magic shortbow'];
    env.f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    deliver(40);
    const open = env.f.onOpen;
    env.f.onOpen = () => {
        open(); bankWorks = failure !== 'bank'; depositWorks = failure !== 'deposit';
        env.f.pickupWorks = failure !== 'pickup';
    };
    await run();
    expect(task.validate()).toBe(true);
    expect(task.clueStatus()).toContain('blocked');
    expect(statuses).not.toContain('clue solved');
    expect(worn).toBe('Dragon dagger(p)');
    expect(deposits).toBeLessThanOrEqual(2);
    expect(env.f.ground.length).toBeGreaterThan(0);
});

test('reports solved only after a later successful original-gear restoration', async () => {
    deliver(1);
    task['strippedGear'] = ['Magic shortbow'];
    equipWorks = false;
    env.f.inv.push({ ...item(861), name: 'Magic shortbow' });
    await run();
    expect(task.validate()).toBe(true);
    expect(statuses).not.toContain('clue solved');
    equipWorks = true;
    await run();
    expect(worn).toBe('Magic shortbow');
    expect(task.validate()).toBe(false);
    expect(statuses.filter(s => s === 'clue solved')).toHaveLength(1);
});

test('banks completed rewards to make room for the original bow before releasing the host', async () => {
    deliver(28);
    task['strippedGear'] = ['Magic shortbow'];
    await run();
    expect(banked + env.f.inv.filter(i => i.id === 100).length).toBe(28);
    expect(worn).toBe('Magic shortbow');
    expect(task.validate()).toBe(false);
    expect(statuses).toContain('clue solved');
});

test('keeps an itemless pending reward runnable even with the host disabled and no restoration', async () => {
    task = new SolveClue({ log: () => {}, setStatus: s => statuses.push(s), enabled: () => false,
        foodName: () => '', foodWithdraw: () => 0, isFood: () => false });
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100)]; env.f.event = true; };
    await task.execute();
    expect(env.f.inv).toEqual([]);
    expect(task.validate()).toBe(true);
    expect(statuses).not.toContain('clue solved');
});

test('does not open a hard casket when its pre-open bank is unavailable', async () => {
    bankWorks = false;
    deliver(1);
    await run();
    expect(env.f.opens).toBe(0);
    expect(task.validate()).toBe(true);
    expect(task.clueStatus()).toContain('blocked');
    expect(walks).toHaveLength(1);
});

test('leaves preexisting same-ID ground items uncredited and never reports solved for an unavailable reward', async () => {
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100)]; };
    env.f.ground = [{ ...pile(100), tile: { x: 3269, z: 3167, level: 0 } }];
    await run();
    expect(env.f.takes).toEqual([]);
    expect(task.validate()).toBe(true);
    expect(statuses).not.toContain('clue solved');
});

test('retains completion across an event fired by upkeep after the final reward is accounted', async () => {
    deliver(1);
    const restore = stubProps(Sustain, { run: async () => { if (env.f.opens > 0) env.f.event = true; } });
    try { await task.execute(); } finally { restore(); }
    expect(task.validate()).toBe(true);
    expect(statuses).not.toContain('clue solved');
    env.f.event = false;
    await run();
    expect(statuses.filter(s => s === 'clue solved')).toHaveLength(1);
});

test('collects a large roll without paying the host loop delay for each Shark and pickup', async () => {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    deliver(40);
    for (let n = 0; n < 100 && task.validate(); n++) {
        await task.execute();
        env.f.tick += 3;
    }
    expect(banked + env.f.inv.filter(i => i.id === 100).length).toBe(40);
    expect(statuses).toContain('clue solved');
});
