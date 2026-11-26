import { expect, test } from 'bun:test';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(stock: Record<string, number> = {}): LevelerSnapshot {
    return { levels: Object.fromEntries(enabledSkills.map(skill => [skill, 1])), stock, bankStock: stock, now: 1000,
        bankReady: true, target: 70, wilderness: false, supplierOnly: true, seersWorld: true, quests: {} };
}

test('refreshes the bank before selecting a supplier job, and blocks on other worlds', () => {
    const s = snapshot({ coal: 1000 });
    s.seersWorld = false;
    s.bankReady = false;
    expect(planNext(s, emptyMemory())).toEqual({ kind: 'refresh' });
    s.bankReady = true;
    expect(planNext(s, emptyMemory())).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('World 1') });
});

test('sells a full banked lot even at level one in hard clue mode', () => {
    const s = snapshot({ coal: 999, 'air rune': 2899 });
    s.stock = { ...s.stock, coal: 1000 };
    s.mode = 'Hard clue farming';
    expect(planNext(s, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: {
        label: 'Sell 1,000 air rune to Seers Market', script: 'MarketSeller', objective: 'economy', settings: { supplierOnly: true, item: 'air rune', quantity: 1000 }
    } });
});

test('a rejected item cools down independently of other eligible lots', () => {
    const s = snapshot({ coal: 3000, 'air rune': 2001 });
    const memory = emptyMemory();
    const next = () => planNext(s, memory, () => 0);
    const first = next();
    expect(first).toMatchObject({ kind: 'activity', plan: { script: 'MarketSeller' } });
    if (first.kind !== 'activity') throw new Error('Expected a sale');
    memory.cooldowns[first.plan.id] = s.now + 60000;
    const second = next();
    expect(second).toMatchObject({ kind: 'activity', plan: { script: 'MarketSeller' } });
    if (second.kind !== 'activity') throw new Error('Expected the other sale');
    expect(new Set([first.plan.settings.item, second.plan.settings.item])).toEqual(new Set(['coal', 'air rune']));
});

test('finishes the closest feasible banked lot and rotates off a failed method', () => {
    const s = snapshot({ 'bronze pickaxe': 1, 'copper ore': 999, 'tin ore': 999, 'iron ore': 800, coal: 998, coins: 50000 });
    s.levels.mining = 30;
    s.marketItem = () => 42;
    const memory = emptyMemory();
    const next = () => planNext(s, memory, () => 0.5);
    const first = next();
    expect(first).toMatchObject({ plan: { objective: 'economy', script: 'Miner', output: { item: 'Coal', count: 1000 } } });
    if (first.kind !== 'activity') throw new Error('Expected mining');
    memory.cooldowns[first.plan.id] = s.now + 60000;
    const second = next();
    expect(second).toMatchObject({ plan: { script: 'Miner', output: { item: 'Iron ore' } } });
    expect(second).not.toMatchObject({ plan: { id: first.plan.id } });
});

test('rotates to a fresh product after a sale leaves a partial stack', () => {
    const s = snapshot({ 'bronze pickaxe': 1, coal: 1009, 'iron ore': 7 });
    s.levels.mining = 30;
    const memory = emptyMemory();
    const sale = planNext(s, memory, () => 0);
    expect(sale).toMatchObject({ plan: { script: 'MarketSeller', settings: { item: 'coal' } } });
    if (sale.kind !== 'activity') throw new Error('Expected a sale');
    memory.recent.push(sale.plan.id);
    s.stock.coal = 9;
    expect(planNext(s, memory, () => 0)).toMatchObject({ plan: { script: 'Miner', output: { item: 'Iron ore' } } });
});

test('a banked sale can start while the supplier is waiting for skill levels', () => {
    const s = snapshot({ coal: 1000 });
    s.levels = {};
    expect(planNext(s, emptyMemory())).toMatchObject({ plan: { script: 'MarketSeller', settings: { item: 'coal' } } });
    s.stock.coal--;
    expect(planNext(s, emptyMemory())).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('Skill levels') });
});

test('an experienced woodcutter gathers yews ahead of a nearly complete lot of ordinary logs or feathers', () => {
    const s = snapshot({ 'bronze axe': 1, logs: 999, feather: 999 });
    s.levels.woodcutting = 80;
    expect(planNext(s, emptyMemory(), () => 0)).toMatchObject({ plan: { script: 'Woodcutter', output: { item: 'Yew logs' } } });
});

test('equipped high-combat suppliers hunt dragons ahead of nearly finished starter lots', () => {
    const s = snapshot({ coins: 200, lobster: 70, feather: 999, 'cow hide': 999, 'big bones': 999,
        'rune scimitar': 1, 'iron chainbody': 1, 'iron platelegs': 1, 'dragonfire shield': 1 });
    s.accountName = 'Supplier3';
    Object.assign(s.levels, { hitpoints: 70, attack: 70, strength: 70, defence: 70, prayer: 60 });
    expect(planNext(s, emptyMemory(), () => 0)).toMatchObject({ plan: { script: 'JiveDragons', output: { item: 'Dragon bones' } } });
});

test('a Wilderness supplier prioritizes green dragon hides and bones until a lot is ready', () => {
    const s = snapshot({ coins: 200, lobster: 70, '#1753': 80, 'dragon bones': 40, 'bronze axe': 1, 'yew logs': 999,
        'rune scimitar': 1, 'iron chainbody': 1, 'iron platelegs': 1, 'dragonfire shield': 1 });
    s.wilderness = true;
    s.accountName = 'Supplier3';
    Object.assign(s.levels, { hitpoints: 70, attack: 70, strength: 70, defence: 70, woodcutting: 80 });
    const memory = emptyMemory();
    memory.recent.push('prayer-green-dragons');
    memory.cooldowns['crowd:3096,3814,0'] = s.now + 30 * 60000;
    const next = () => planNext(s, memory, () => 0.99);
    expect(next()).toMatchObject({ plan: { script: 'GreenDragon', output: { item: 'Dragonhide', id: 1753, count: 1000 },
        settings: { loot: expect.arrayContaining(['Dragon bones', 'Dragonhide', 'Uncut ruby']), buryBones: false } } });
    s.stock['dragon bones'] = 999;
    expect(next()).toMatchObject({ plan: { script: 'GreenDragon', output: { item: 'Dragon bones', count: 1000 } } });
    memory.cooldowns['prayer-green-dragons'] = s.now + 60000;
    expect(next()).toMatchObject({ plan: { id: 'prayer-red-dragons' } });
});

test('a red dragon supplier banks the red hide lot and falls back when the camp is unavailable', () => {
    const s = snapshot({ coins: 200, lobster: 70, '#1749': 80, '#1753': 900, 'dragon bones': 40,
        'rune scimitar': 1, 'iron chainbody': 1, 'iron platelegs': 1, 'dragonfire shield': 1 });
    s.accountName = 'Supplier19';
    s.wilderness = true;
    Object.assign(s.levels, { hitpoints: 70, attack: 70, strength: 70, defence: 70 });
    const memory = emptyMemory();
    const next = () => planNext(s, memory, () => 0);
    expect(next()).toMatchObject({ plan: { id: 'prayer-red-dragons', wilderness: true,
        output: { item: 'Dragonhide', id: 1749, count: 1000 }, settings: { target: 'Red dragon',
            loot: expect.arrayContaining(['Dragon bones', 'Dragonhide', 'Adamant platebody']), buryBones: false } } });
    s.levels.defence = 69;
    expect(next()).toMatchObject({ plan: { id: 'prayer-green-dragons' } });
    s.levels.defence = 70;
    memory.cooldowns['prayer-red-dragons'] = s.now + 60000;
    expect(next()).toMatchObject({ plan: { id: 'prayer-green-dragons' } });
    s.wilderness = false;
    expect(next()).toMatchObject({ plan: { id: 'prayer-blue-dragons' } });
});

test('twenty eligible suppliers keep a stable split between green dragons and other work across replans', () => {
    const s = snapshot({ coins: 200, lobster: 70, 'bronze axe': 1, 'yew logs': 999,
        'rune scimitar': 1, 'iron chainbody': 1, 'iron platelegs': 1, 'dragonfire shield': 1 });
    s.wilderness = true;
    Object.assign(s.levels, { hitpoints: 70, attack: 70, strength: 70, defence: 70, woodcutting: 80 });
    const choose = (accountName: string, roll: number) => {
        const next = planNext({ ...s, accountName }, emptyMemory(), () => roll);
        if (next.kind !== 'activity') throw new Error('Expected supplier work');
        return next.plan.script;
    };
    const names = Array.from({ length: 20 }, (_, i) => 'Supplier' + i);
    const jobs = names.map(name => choose(name, 0));
    expect(jobs.filter(script => script === 'GreenDragon')).toHaveLength(4);
    expect(jobs.filter(script => script === 'Woodcutter')).toHaveLength(16);
    expect(names.map(name => choose(name.toUpperCase(), 0.99))).toEqual(jobs);
    s.wilderness = false;
    expect(choose(names[jobs.indexOf('Woodcutter')], 0)).toBe('Woodcutter');
});
