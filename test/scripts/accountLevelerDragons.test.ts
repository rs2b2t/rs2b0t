import { expect, test } from 'bun:test';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { QUESTS } from '#/bot/api/ai/quests/data/quests.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 50])), target: 60, now: 1000,
    bankReady: true, wilderness: true, quests: { 'Dragon Slayer': true },
    stock: { coins: 100000, lobster: 100, 'dragonfire shield': 1, 'mithril scimitar': 1 }
});
const method = (s: LevelerSnapshot, skill = 'prayer', roll = 0, memory = emptyMemory()) => methodFor(s, skill, memory, () => roll)!;

test('prayer chooses green and blue dragons with burial, supplied gear and no clue detours', () => {
    const s = snapshot();
    const plans = [method(s), method(s, 'prayer', 0.999)];
    expect(plans.map(p => p.script).sort()).toEqual(['GreenDragon', 'JiveDragons']);
    for (const plan of plans) {
        expect(plan.settings).toMatchObject({ buryBones: true, solveClues: false, usePotions: false, combatStyle: 'melee', weapon: 'Mithril scimitar' });
        expect(plan.needs).toContainEqual({ item: 'Dragonfire shield', count: 1, carry: 1, equip: true });
        expect(plan.food).toBe('Lobster');
        expect(plan.combat).toBe(true);
    }
});

test('Wilderness preference, cooldowns and missing protection keep unsuitable dragon plans out', () => {
    const s = snapshot(); s.wilderness = false;
    expect(method(s).script).toBe('JiveDragons');
    s.wilderness = true;
    const memory = emptyMemory();
    for (const roll of [0, 0.999]) memory.cooldowns[method(s, 'prayer', roll).id] = s.now + 60000;
    expect(method(s, 'prayer', 0, memory).script).toBe('AutoFighter');
    delete s.stock['dragonfire shield'];
    expect(method(s).script).toBe('AutoFighter');
    s.stock['dragonfire shield'] = 1; s.levels.hitpoints = 20;
    expect(method(s).script).toBe('AutoFighter');
});

test('Dragon Slayer progression earns 32 quest points without repeating quests', () => {
    const s = snapshot(); s.quests = {};
    let points = 0;
    for (let i = 0; i < 20; i++) {
        const plan = method(s);
        expect(plan.script).toBe('AIOQuester');
        const quest = QUESTS.find(q => q.name === plan.quest)!;
        expect(quest).toBeDefined();
        expect(s.quests[quest.name]).not.toBe(true);
        if (quest.id === 'dragon') { expect(points).toBeGreaterThanOrEqual(32); return; }
        s.quests[quest.name] = true; points += quest.questPoints;
    }
    throw new Error('Dragon Slayer was never selected');
});

test('Dragon Slayer uses actual quest points, equips melee gear and prepares supply skills', () => {
    const s = snapshot(); s.quests = {}; s.questPoints = 32;
    expect(method(s).settings.quests).toEqual(['dragon']);
    expect(method(s).needs.some(n => n.equip && n.item.endsWith('scimitar'))).toBe(true);
    s.levels.smithing = 20;
    expect(method(s).prerequisiteLevels).toEqual({ smithing: 34 });
    expect(method(s).objective).toBe('prayer');
    s.levels.smithing = 50; s.levels.mining = 20;
    expect(method(s).prerequisiteLevels).toEqual({ mining: 30 });
    s.levels.mining = 50; s.wilderness = false;
    expect(method(s).script).not.toBe('AIOQuester');
    s.stock.plank = 3;
    expect(method(s).settings.quests).toEqual(['dragon']);
    s.quests['Dragon Slayer'] = true;
    expect(method(s).script).toBe('JiveDragons');
});

test('eligible magic accounts gather chaos runes in Ardougne before returning to casting', () => {
    const s = snapshot(); s.levels.thieving = 70; s.unavailableItems = ['chaos rune'];
    s.stock['staff of air'] = 1; s.stock['fire rune'] = 1000; s.stock['chaos rune'] = 2;
    const plan = method(s, 'magic');
    expect(plan.settings.spell).toBe('Fire Bolt');
    const decision = resolveActivity(s, plan, emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind !== 'activity') return;
    expect(decision.plan.script).toBe('Thiever');
    expect(decision.plan.settings).toMatchObject({ target: 'Paladin', banking: 'Auto', suicide: false });
    expect(decision.plan.travel).toMatchObject({ x: 2655, z: 3311 });
    expect(decision.plan.output).toEqual({ item: 'Chaos rune', count: 200 });
    expect(decision.plan.objective).toBe('magic');
    expect(decision.plan.prerequisiteLevels).toBeUndefined();
    expect(decision.queue.at(-1)?.script).toBe('AutoFighter');
    s.stock['chaos rune'] = 200;
    const stocked = resolveActivity(s, method(s, 'magic'), emptyMemory(), () => 0);
    expect(stocked.kind === 'activity' && stocked.plan.script).toBe('AutoFighter');
});

test('accounts below 70 Thieving keep casting without training Thieving for runes', () => {
    const s = snapshot(); s.levels.thieving = 69; s.unavailableItems = ['chaos rune'];
    const plan = method(s, 'magic');
    expect(plan.settings.spell).toContain('Strike');
    const decision = resolveActivity(s, plan, emptyMemory(), () => 0);
    expect(decision.kind === 'activity' && decision.plan.script).toBe('AutoFighter');
});

test('resuming Dragon Slayer after ship repair does not require consumed planks, nails or the original cash', () => {
    const s = snapshot(); s.quests = {}; s.questPoints = 32; s.dragonStage = 7;
    s.wilderness = false; s.stock.coins = 500; s.levels.smithing = 1; s.levels.mining = 1;
    const plan = method(s);
    expect(plan.settings.quests).toEqual(['dragon']);
    expect(plan.needs.find(n => n.item === 'Coins')?.count).toBe(200);
    expect(plan.needs.some(n => n.item === 'Plank')).toBe(false);
    expect(plan.prerequisiteLevels).toBeUndefined();
});

test('paladin supply trips can prepare food before travelling instead of treating low food as ineligible', () => {
    const s = snapshot(); s.levels.thieving = 70; delete s.stock.lobster;
    s.unavailableItems = ['chaos rune']; s.stock['staff of air'] = 1; s.stock['fire rune'] = 1000;
    const paladin = producer(s, 'magic', { item: 'Chaos rune', count: 200 }, emptyMemory(), () => 0);
    expect(paladin).not.toBeNull();
    const decision = resolveActivity(s, paladin!, emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind !== 'activity') return;
    expect(['Fisher', 'CookBot']).toContain(decision.plan.script);
    expect(decision.queue.some(p => p.settings.target === 'Paladin')).toBe(true);
});

test('Dragon Slayer point quests carry combat gear and proper food for their fights', () => {
    const s = snapshot(); s.quests = {}; s.stock.shrimps = 50;
    const plan = method(s);
    expect(plan.food).toBe('Lobster');
    expect(plan.needs.some(n => n.equip && n.item.endsWith('scimitar'))).toBe(true);
});

test('quest and Prayer preparation train food skills before combat priority can starve them out', () => {
    const s = snapshot(); s.questPoints = 32; s.quests = {}; delete s.stock.lobster;
    s.stock.trout = 1000; s.levels.fishing = 1; s.levels.cooking = 1;
    expect(method(s).prerequisiteLevels).toEqual({ fishing: 40 });
    s.levels.fishing = 40;
    expect(method(s).prerequisiteLevels).toEqual({ cooking: 40 });
    s.quests['Dragon Slayer'] = true;
    expect(method(s).prerequisiteLevels).toEqual({ cooking: 40 });
});

test('partial hull repairs resume with remaining planks and nails', () => {
    const s = snapshot(); s.questPoints = 32; s.quests = {}; s.dragonStage = 3; s.wilderness = false;
    s.stock.plank = 2; s.stock.nails = 8; s.levels.smithing = 1; s.levels.mining = 1;
    const plan = method(s);
    expect(plan.settings.quests).toEqual(['dragon']);
    expect(plan.needs.find(n => n.item === 'Plank')).toMatchObject({ count: 2, carry: 2 });
    expect(plan.prerequisiteLevels).toBeUndefined();
});

test('quest provisioning reserves payments before purchasing equipment', () => {
    const s = snapshot(); s.quests = {}; s.questPoints = 32;
    s.stock = { coins: 15000, lobster: 100 };
    const decision = resolveActivity(s, method(s), emptyMemory(), () => 0);
    expect(decision.kind).toBe('blocked');
    s.stock = { ...s.stock, 'mithril scimitar': 1, 'mithril chainbody': 1, 'mithril platelegs': 1, 'mithril med helm': 1 };
    expect(resolveActivity(s, method(s), emptyMemory(), () => 0).kind).toBe('activity');
});


test('quest requirements cannot lower the food preparation threshold', () => {
    const s = snapshot(); s.quests = Object.fromEntries(QUESTS.map(q => [q.name, true]));
    s.quests['Dragon Slayer'] = false; s.quests["The Knight's Sword"] = false;
    s.questPoints = 31; s.levels.cooking = 20; delete s.stock.lobster;
    expect(method(s).prerequisiteLevels).toEqual({ cooking: 40 });
});
