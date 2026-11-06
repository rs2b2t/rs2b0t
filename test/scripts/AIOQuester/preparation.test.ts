import { expect, test } from 'bun:test';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { planPreparation } from '#/bot/scripts/AIOQuester/preparation.js';

const snapshot = (): LevelerSnapshot => ({ levels: Object.fromEntries(enabledSkills.map(skill => [skill, 40])), stock: { coins: 100000, lobster: 100 }, bankReady: true, quests: {}, target: 60, wilderness: false, now: 1000 });
const plan = (s: LevelerSnapshot, request: Parameters<typeof planPreparation>[1]) => planPreparation(s, request, emptyMemory(), () => 0);

test('unread bank is refreshed before deciding whether food must be gathered', () => {
    expect(plan({ ...snapshot(), bankReady: false }, { food: { item: 'Shark', count: 20 } }).kind).toBe('refresh');
});

test('banked food satisfies exact quantities without training fishing', () => {
    const s = snapshot(); s.stock.shark = 20;
    expect(plan(s, { food: { item: 'Shark', count: 20 } }).kind).toBe('complete');
});

test('prayer 43 trains prayer without starting another quest', () => {
    const result = plan(snapshot(), { skills: [{ skill: 'prayer', level: 43 }] });
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('AutoFighter');
    expect(result.plan.prerequisiteLevels).toEqual({ prayer: 43 });
    expect(result.queue.some(step => step.script === 'AIOQuester')).toBe(false);
});

test('missing sharks train gathering and cooking prerequisites above level 60', () => {
    const s = snapshot();
    const fishing = plan(s, { food: { item: 'Shark', count: 20 } });
    expect(fishing.kind).toBe('activity');
    if (fishing.kind !== 'activity') return;
    expect(fishing.plan.script).toBe('Fisher');
    expect(fishing.plan.prerequisiteLevels).toEqual({ fishing: 76 });
    s.levels.fishing = 76;
    s.stock['raw lobster'] = 100;
    const cooking = plan(s, { food: { item: 'Shark', count: 20 } });
    expect(cooking.kind === 'activity' && cooking.plan.script).toBe('CookBot');
    expect(cooking.kind === 'activity' && cooking.plan.prerequisiteLevels).toEqual({ cooking: 80 });
});

test('ready shark skills produce raw sharks then cook exact requested food', () => {
    const s = snapshot(); s.levels.fishing = 76; s.levels.cooking = 80;
    const result = plan(s, { food: { item: 'Shark', count: 35 } });
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('Fisher');
    expect(result.plan.settings.fishMethod).toBe('Harpoon — sharks');
    expect(result.queue.map(step => step.script)).toEqual(['Fisher', 'CookBot', '']);
    expect(result.queue[1].output).toEqual({ item: 'Shark', count: 35 });
    s.stock['raw shark'] = 28;
    const banked = plan(s, { food: { item: 'Shark', count: 35 } });
    expect(banked.kind === 'activity' && banked.plan.script).toBe('CookBot');
});

test('all unmet skill targets remain independently actionable after each completes', () => {
    const s = snapshot();
    const request = { skills: [{ skill: 'prayer', level: 43 }, { skill: 'agility', level: 56 }] };
    s.levels.prayer = 43;
    const result = plan(s, request);
    expect(result.kind === 'activity' && result.plan.objective).toBe('agility');
    s.levels.agility = 56;
    expect(plan(s, request).kind).toBe('complete');
});

test('unsupported items and quest locked skills return actionable blockers', () => {
    const item = plan(snapshot(), { items: [{ item: 'Mystery quest token', count: 2 }] });
    expect(item.kind).toBe('blocked');
    expect(item.kind === 'blocked' && item.reason).toContain('Mystery quest token');
    const herb = plan(snapshot(), { skills: [{ skill: 'herblore', level: 45 }] });
    expect(herb.kind).toBe('blocked');
    expect(herb.kind === 'blocked' && herb.reason).toContain('Druidic Ritual');
});

test('empty food stocks gather travel food before attempting coastal lobster fishing', () => {
    const s = snapshot(); s.stock = { coins: 100000 };
    const result = plan(s, { food: { item: 'Lobster', count: 24 } });
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('Fisher');
    expect(result.plan.settings.fishMethod).toBe('Small net — shrimp/anchovy');
    expect(result.queue.some(step => step.output?.item === 'Shrimps')).toBe(true);
});

test('banked raw sharks bypass fishing prerequisites when cooking is already sufficient', () => {
    const s = snapshot(); s.levels.fishing = 1; s.levels.cooking = 80; s.stock['raw shark'] = 28;
    const result = plan(s, { food: { item: 'Shark', count: 20 } });
    expect(result.kind === 'activity' && result.plan.script).toBe('CookBot');
    expect(result.kind === 'activity' && result.plan.output).toEqual({ item: 'Shark', count: 20 });
});

test('a partial banked raw shark stack is cooked before training fishing for more', () => {
    const s = snapshot(); s.levels.fishing = 1; s.levels.cooking = 80; s.stock['raw shark'] = 10;
    for (const count of [8, 20]) {
        const result = plan(s, { food: { item: 'Shark', count } });
        expect(result.kind === 'activity' && result.plan.script).toBe('CookBot');
        expect(result.kind === 'activity' && result.plan.needs.find(need => need.item === 'Raw shark')?.count).toBe(Math.min(count, 10));
    }
});
