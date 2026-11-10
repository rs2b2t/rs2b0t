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


test('configured Cake is stolen to the exact whole cake stock target', () => {
    const s = snapshot(); s.stock.cake = 3; s.stock.bread = 30;
    s.stock['2/3 cake'] = 10;
    const result = plan(s, { food: { item: 'Cake', count: 16 } });
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('QuestCakeSupply');
    expect(result.plan.output).toEqual({ item: 'Cake', count: 16 });
    expect(result.plan.settings.count).toBe(16);
    expect(result.plan.needs).toEqual([]);
});

test('cake stealing first trains its required thieving level', () => {
    const s = snapshot(); s.levels.thieving = 1;
    const result = plan(s, { food: { item: 'Cake', count: 8 } });
    expect(result.kind === 'activity' && result.plan.prerequisiteLevels).toEqual({ thieving: 5 });
});

test('Watchtower bat bones are looted from Giant bats without burying the output', () => {
    const result = plan(snapshot(), { items: [{ item: 'Bat bones', count: 1 }] });
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('AutoFighter');
    expect(result.plan.settings.target).toBe('Giant bat');
    expect(result.plan.settings.loot).toEqual(['Bat bones']);
    expect(result.plan.settings.buryBones).toBe(false);
    expect(result.plan.settings.buryBigBones).toBe(false);
    expect(result.plan.output).toEqual({ item: 'Bat bones', count: 1 });
    expect(result.plan.travel).toMatchObject({ x: 2589, z: 3478, level: 0 });
});

test('Tai Bwo Wannai Trio seaweed is picked from the known coast spawn', () => {
    const result = plan(snapshot(), { items: [{ item: 'Seaweed', count: 1 }] });
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.plan.script).toBe('QuestGroundSupply');
    expect(result.plan.output).toEqual({ item: 'Seaweed', count: 1 });
    expect(result.plan.travel).toMatchObject({ x: 2708, z: 3728, level: 0 });
});

test('agility potions earn six Brimhaven tickets, trade for toadflax, then brew', () => {
    const s = snapshot();
    const request = { items: [{ item: 'Agility potion(3)', count: 2 }] };
    const result = plan(s, request);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.queue.map(step => step.script)).toEqual(['QuestArenaTickets', 'QuestToadflax', 'PotionMaker', '']);
    expect(result.plan.output).toEqual({ item: 'Agility arena ticket', count: 6 });
    expect(result.plan.settings).toMatchObject({ count: 6, food: 'Lobster', stealRestock: false });
    s.stock['agility arena ticket'] = 6;
    const trade = plan(s, request);
    expect(trade.kind === 'activity' && trade.plan.script).toBe('QuestToadflax');
    expect(trade.kind === 'activity' && trade.plan.needs).toContainEqual({ item: 'Agility arena ticket', count: 6, carry: 6 });
    s.stock.toadflax = 2;
    const legs = plan(s, request);
    expect(legs.kind === 'activity' && legs.plan.script).toBe('HerbloreSecondaries');
    s.stock["toad's legs"] = 2;
    const brew = plan(s, request);
    expect(brew.kind === 'activity' && brew.plan.script).toBe('PotionMaker');
    expect(brew.kind === 'activity' && brew.plan.settings).toMatchObject({ herb: 'Toadflax', secondary: "Toad's legs" });
});

test('agility potion preparation reuses unfinished potions by exact ID and gathers only the remaining herbs', () => {
    const s = snapshot();
    s.stock['#3002'] = 1;
    s.stock['unfinished potion'] = 20;
    s.stock['agility potion(3)'] = 1;
    const result = plan(s, { items: [{ item: 'Agility potion(3)', count: 3 }] });
    expect(result.kind === 'activity' && result.plan.output).toEqual({ item: 'Agility arena ticket', count: 3 });
    s.stock['#3002'] = 2;
    s.stock["toad's legs"] = 2;
    const brew = plan(s, { items: [{ item: 'Agility potion(3)', count: 3 }] });
    expect(brew.kind === 'activity' && brew.plan.script).toBe('PotionMaker');
    expect(brew.kind === 'activity' && brew.plan.needs.some(need => ['Toadflax', 'Vial of water'].includes(need.item))).toBe(false);
});

test('agility potion preparation trains Herblore to 34 only when brewing is needed', () => {
    const s = snapshot(); s.levels.herblore = 3; s.quests['Druidic Ritual'] = true;
    const request = { items: [{ item: 'Agility potion(3)', count: 2 }] };
    const result = plan(s, request);
    expect(result.kind === 'activity' && result.queue.some(step => step.prerequisiteLevels?.herblore === 5)).toBe(true);
    s.levels.herblore = 33;
    const final = plan(s, request);
    expect(final.kind === 'activity' && final.queue.some(step => step.prerequisiteLevels?.herblore === 34)).toBe(true);
    s.stock['agility potion(3)'] = 2;
    expect(plan(s, request).kind).toBe('complete');
});
