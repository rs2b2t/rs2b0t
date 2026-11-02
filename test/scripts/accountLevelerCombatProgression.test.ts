import { expect, test } from 'bun:test';
import { COMBAT_CAMPS, combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (hitpoints: number): LevelerSnapshot => ({
    levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 1])), attack: 12, strength: 12, defence: 12, hitpoints },
    stock: { coins: 100000 }, bankReady: true, quests: {}, target: 40, wilderness: true, now: 1000
});

test('combat 14 trains without food and combat 15 queues fishing and cooking before fighting', () => {
    const early = planNext(snapshot(16), emptyMemory(), () => 0);
    expect(early.kind === 'activity' && early.plan.deathWalk).toBe(true);
    const supplied = planNext(snapshot(17), emptyMemory(), () => 0);
    expect(supplied.kind).toBe('activity');
    if (supplied.kind !== 'activity') return;
    expect(supplied.queue.map(plan => plan.script)).toEqual(['Fisher', 'CookBot', 'AutoFighter']);
    expect(supplied.queue.at(-1)?.deathWalk).toBe(false);
    expect(supplied.queue.at(-1)?.settings.foodWithdraw).toBe(12);
});

test('combat 15 cooks owned raw shrimp and uses cooked food without fishing again', () => {
    const s = snapshot(17);
    s.stock['raw shrimps'] = 100;
    const raw = planNext(s, emptyMemory(), () => 0);
    expect(raw.kind === 'activity' && raw.plan.script).toBe('CookBot');
    s.stock.shrimps = 24;
    const ready = planNext(s, emptyMemory(), () => 0);
    expect(ready.kind === 'activity' && ready.plan.script).toBe('AutoFighter');
    expect(ready.kind === 'activity' && ready.plan.food).toBe('Shrimps');
});

test('food-backed combat 15 prefers stronger targets across randomized choices', () => {
    const s = snapshot(18);
    s.stock.shrimps = 100;
    const memory = emptyMemory();
    const targets = new Set<string>();
    for (let i = 0; i < 100; i++) {
        const plan = combatPlan(s, 'attack', memory, () => i / 100)!;
        expect(['Chicken', 'Rat', 'Man', 'Woman', 'Goblin', 'Spider', 'Giant spider']).not.toContain(plan.settings.target);
        expect(plan.deathWalk).toBe(false);
        targets.add(String(plan.settings.target));
        memory.recent = [...memory.recent, plan.id].slice(-6);
    }
    expect(targets.size).toBeGreaterThanOrEqual(3);
});

test('higher ranged or magic combat levels also end melee death walking', () => {
    for (const skill of ['ranged', 'magic']) {
        const s = snapshot(10);
        Object.assign(s.levels, { attack: 1, strength: 1, defence: 1, [skill]: 30 });
        const plan = combatPlan(s, 'attack', emptyMemory(), () => 0)!;
        expect(plan.deathWalk).toBe(false);
        expect(plan.food).toBe('Shrimps');
        expect(plan.settings.target).not.toBe('Guard');
    }
});

test('resource gathering can still choose low-tier cows despite combat progression', () => {
    const s = snapshot(40);
    Object.assign(s.levels, { attack: 40, strength: 40, defence: 40 });
    const plan = combatPlan(s, 'crafting', emptyMemory(), () => 0, 'Cow hide');
    expect(plan?.settings.target).toBe('Cow');
});

test('cooling down stronger camps still leaves a usable fallback instead of blocking training', () => {
    const s = snapshot(18);
    const memory = emptyMemory();
    memory.cooldowns = Object.fromEntries(COMBAT_CAMPS.filter(c => c.target !== 'Cow').map(c => [c.id, 2000]));
    expect(combatPlan(s, 'attack', memory, () => 0)?.settings.target).toBe('Cow');
});

test('unavailable lower camps cannot force normal training into a later combat group', () => {
    const s = snapshot(25);
    Object.assign(s.levels, { attack: 20, strength: 20, defence: 15 });
    const memory = emptyMemory();
    memory.cooldowns = Object.fromEntries(COMBAT_CAMPS.filter(c => c.id !== 'taverley-druids').map(c => [c.id, 2000]));
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
});

test('giant training enables Big bones burial so prayer sessions gain XP', () => {
    const s = snapshot(40);
    Object.assign(s.levels, { attack: 40, strength: 40, defence: 40 });
    const memory = emptyMemory();
    memory.cooldowns = Object.fromEntries(COMBAT_CAMPS.filter(c => c.id !== 'edgeville-dungeon-giants').map(c => [c.id, 2000]));
    const plan = combatPlan(s, 'prayer', memory, () => 0);
    expect(plan?.settings.target).toBe('Giant');
    expect(plan?.settings.buryBones).toBe(true);
    expect(plan?.settings.buryBigBones).toBe(true);
});
