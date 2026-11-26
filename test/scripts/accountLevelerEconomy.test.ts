import { expect, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import { economyReserve } from '#/bot/scripts/AccountLeveler/economySupplies.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(): LevelerSnapshot {
    return { levels: Object.fromEntries(enabledSkills.map(skill => [skill, 70])), stock: {}, now: 1000, bankReady: true,
        target: 70, wilderness: false, supplySeers: true, quests: {} };
}

test('sells surplus supplies after every target is reached, even with no coins to buy stock', () => {
    const s = snapshot();
    s.stock.coal = 1099;
    s.stock['law rune'] = 2000;
    const next = () => planNext(s, emptyMemory(), () => 0);
    expect(next()).not.toMatchObject({ plan: { script: 'MarketSeller' } });
    s.stock.coal++;
    expect(next()).toMatchObject({ kind: 'activity', plan: { script: 'MarketSeller', objective: 'economy' } });
    s.levels.mining = 69;
    expect(next()).not.toMatchObject({ plan: { objective: 'economy' } });
    s.levels.mining = 70;
    s.supplySeers = false;
    expect(next()).toEqual({ kind: 'complete' });
});

test('keeps personal reserves and excludes gear and coins', () => {
    expect(economyReserve('AIR RUNE')).toBe(10000);
    for (const rune of ['Fire', 'Water', 'Earth', 'Law', 'Nature']) expect(economyReserve(rune + ' rune')).toBe(1000);
    expect(economyReserve("Red spiders' eggs")).toBe(100);
    expect(economyReserve('Coal')).toBe(100);
    expect(economyReserve('Coins')).toBeUndefined();
    expect(economyReserve('Rune platebody')).toBeUndefined();
});

test('gathers fresh supplies when the maker is on cooldown or only reserves remain', () => {
    const s = snapshot();
    const memory = emptyMemory();
    Object.assign(s.stock, { 'bronze pickaxe': 1, 'air rune': 10000, 'law rune': 1000, 'coal': 100 });
    const next = () => planNext(s, memory, () => 0);
    expect(next()).toMatchObject({ kind: 'activity', plan: { script: 'Miner', objective: 'economy', output: { item: 'Coal', count: 1000 } } });
    s.stock.coal += 200;
    memory.cooldowns['sell-seers-surplus'] = s.now + 60000;
    expect(next()).toMatchObject({ kind: 'activity', plan: { script: 'Miner', output: { item: 'Coal', count: 1000 } } });
});

test('mines missing essence for an unlocked rune and crafts when a batch is available', () => {
    const s = snapshot();
    s.quests['Rune Mysteries Quest'] = true;
    Object.assign(s.stock, { 'air talisman': 1, 'bronze pickaxe': 1 });
    const next = () => planNext(s, emptyMemory(), () => 0.42);
    expect(next()).toMatchObject({ plan: { script: 'EssMiner', output: { item: 'Rune essence', count: 1000 } } });
    s.stock['rune essence'] = 50;
    expect(next()).toMatchObject({ plan: { script: 'RuneCrafter', output: { item: 'Air rune' } } });
});

test('secondary gathering uses stocked food and honors the Wilderness setting', () => {
    const s = snapshot();
    s.stock.trout = 6;
    const next = () => planNext(s, emptyMemory(), () => 0.99);
    expect(next()).toMatchObject({ plan: { script: 'HerbloreSecondaries', output: { item: 'Snape grass' } } });
    s.wilderness = true;
    expect(next()).toMatchObject({ plan: { script: 'HerbloreSecondaries', settings: { food: 'Trout', foodWithdraw: 6 }, output: { item: "Red spiders' eggs" } } });
});

test('the first bank check after reaching target discards pending training and starts a sale', async () => {
    const s = snapshot();
    s.stock.coal = 1100;
    const bot = new AccountLeveler();
    const queued: ActivityPlan = { id: 'old', objective: 'smithing', label: 'Smith', script: 'SmithingBot', settings: {}, needs: [] };
    bot['pendingPlans'] = [queued];
    bot['retry'] = queued;
    bot['snapshot'] = () => s;
    let started: ActivityPlan | undefined;
    bot['startPlannedActivity'] = async plan => { started = plan; };
    const patches = [spyOn(Bank, 'isOpen').mockReturnValue(true), spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(bot['supplies'], 'bank').mockResolvedValue(true)];
    try {
        await bot['selectAndStart']();
        expect(started).toMatchObject({ script: 'MarketSeller' });
        expect(bot['pendingPlans']).toEqual([]);
        expect(bot['retry']).toBeNull();
    } finally {
        for (const patch of patches) patch.mockRestore();
    }
});
