import { expect, spyOn, test } from 'bun:test';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { Game } from '#/bot/api/game/Game.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import * as zanaris from '#/bot/scripts/AccountLeveler/zanaris.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import { meleeEquipment } from '#/bot/scripts/AccountLeveler/equipment.js';
import { dragonPrayer } from '#/bot/scripts/AccountLeveler/dragons.js';
import { provision, type SupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 50])), target: 60, now: 1000,
    bankReady: true, wilderness: false, quests: { 'Dragon Slayer': true },
    stock: { coins: 1000000, lobster: 100, diamond: 1, 'dragonfire shield': 1, 'mithril scimitar': 1 }
});

test('an eligible account schedules Lost City before ordinary training', () => {
    const decision = planNext(snapshot(), emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind !== 'activity') return;
    expect(decision.plan.script).toBe('AIOQuester');
    expect(decision.plan.settings.quests).toEqual(['zanaris']);
    expect(decision.plan.quest).toBe('Lost City');
    expect(decision.plan.needs.some(need => need.equip)).toBe(false);
});

test.each([['crafting', 30], ['woodcutting', 35]])('Lost City waits for %s readiness', (skill, level) => {
    const s = snapshot();
    s.levels[skill] = level;
    const decision = planNext(s, emptyMemory(), () => 0);
    expect(decision.kind === 'activity' && decision.plan.quest).not.toBe('Lost City');
});

test('Lost City does not impose Dragon Slayer melee requirements on its spell-based fights', () => {
    const s = snapshot();
    Object.assign(s.levels, { attack: 20, strength: 20, defence: 20, hitpoints: 25, magic: 13 });
    expect(planNext(s, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { quest: 'Lost City' } });
});

test('Lost City reserves a way home, accepting teleport runes without a Diamond', () => {
    const s = snapshot();
    delete s.stock.diamond;
    expect(planNext(s, emptyMemory(), () => 0)).not.toMatchObject({ kind: 'activity', plan: { quest: 'Lost City' } });
    s.stock['law rune'] = 1;
    const decision = planNext(s, emptyMemory(), () => 0);
    expect(decision).toMatchObject({ kind: 'activity', plan: { quest: 'Lost City' } });
    if (decision.kind === 'activity') expect(decision.plan.needs).toContainEqual({ item: 'Law rune', count: 1 });
    if (decision.kind === 'activity') {
        expect(decision.plan.needs).toContainEqual({ item: 'Air rune', count: 303 });
        expect(decision.plan.needs).toContainEqual({ item: 'Fire rune', count: 451 });
        expect(decision.plan.needs).toContainEqual({ item: 'Mind rune', count: 150 });
    }
});

test('completed and cooling-down Lost City attempts leave training available', () => {
    const s = snapshot();
    const memory = emptyMemory();
    memory.cooldowns['quest-zanaris'] = s.now + 1000;
    expect(planNext(s, memory, () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'AutoFighter' } });
    s.quests['Lost City'] = true;
    expect(planNext(s, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'AutoFighter' } });
});

test('owned dragon weapons replace scimitars only at Attack 60 with Lost City complete', () => {
    const s = snapshot();
    s.levels.attack = 60;
    s.quests['Lost City'] = true;
    s.stock['dragon dagger'] = 1;
    expect(meleeEquipment(s)[0].item).toBe('Dragon dagger');
    s.stock['dragon longsword'] = 1;
    expect(meleeEquipment(s)[0].item).toBe('Dragon longsword');
    expect(dragonPrayer(s, emptyMemory(), () => 0)?.settings.weapon).toBe('Dragon longsword');
    s.levels.attack = 59;
    expect(meleeEquipment(s)[0].item).not.toStartWith('Dragon');
    s.levels.attack = 60;
    s.quests['Lost City'] = false;
    expect(meleeEquipment(s)[0].item).not.toStartWith('Dragon');
});

function fixture() {
    const bank: Record<string, number> = { Coins: 1000000, 'Dramen staff': 1, Diamond: 1 };
    const held: Record<string, number> = {};
    const worn: Record<string, number> = {};
    const purchases: string[] = [];
    const trips: string[] = [];
    let unlocked = true;
    const port: SupplyPort & { dragonShop: { ready(): boolean; enter(): Promise<boolean>; leave(): Promise<boolean> } } = {
        bank: async () => true,
        deposit: async () => { for (const [name, count] of Object.entries(held)) { bank[name] = (bank[name] ?? 0) + count; delete held[name]; } },
        stock: () => Object.fromEntries(Object.entries(bank).map(([name, count]) => [name.toLowerCase(), count])),
        held: name => held[name] ?? 0,
        worn: name => worn[name] ?? 0,
        equipment: () => Object.keys(worn),
        unequip: async name => { held[name] = worn[name]; delete worn[name]; return true; },
        withdraw: async (name, count) => { if ((bank[name] ?? 0) < count) return false; bank[name] -= count; held[name] = (held[name] ?? 0) + count; return true; },
        closeBank: async () => true,
        walk: async () => { trips.push('walk'); return true; },
        shop: async keeper => { trips.push(keeper); return true; },
        shopStock: () => 2,
        buy: async (name, count) => { purchases.push(name); held.Coins -= name === 'Dragon longsword' ? 100000 : 30000; held[name] = (held[name] ?? 0) + count; return count; },
        closeShop: async () => {},
        equip: async name => { worn[name] = held[name]; delete held[name]; return true; },
        log: () => {},
        dragonShop: {
            ready: () => unlocked,
            enter: async () => { expect(worn['Dramen staff']).toBe(1); expect(held.Diamond).toBe(1); held.Diamond--; trips.push('enter'); return true; },
            leave: async () => { trips.push('leave'); return true; }
        }
    };
    return { bank, held, worn, port, purchases, trips, lock: () => unlocked = false };
}

const upgrade: ActivityPlan = {
    id: 'quest-zanaris-weapons', label: 'Dragon weapons', objective: 'attack', script: '', settings: {},
    needs: [{ item: 'Dragon longsword', count: 1 }, { item: 'Dragon dagger', count: 1 }]
};

test('one shop trip banks both dragon weapons, consumes one diamond and preserves travel funds', async () => {
    const f = fixture();
    await provision(upgrade, f.port);
    expect(f.purchases).toEqual(['Dragon longsword', 'Dragon dagger']);
    expect(f.trips).toEqual(['enter', 'Jakut', 'leave']);
    expect(f.bank['Dragon longsword']).toBe(1);
    expect(f.bank['Dragon dagger']).toBe(1);
    expect(f.bank.Coins).toBe(870000);
});

test('locked dragon shop never starts a purchase trip', async () => {
    const f = fixture();
    f.lock();
    await expect(provision(upgrade, f.port)).rejects.toThrow('Lost City');
    expect(f.purchases).toEqual([]);
    expect(f.trips).toEqual([]);
});

test('a partial dragon purchase leaves the market and banks the weapon and change before rejecting', async () => {
    const f = fixture();
    f.port.shopStock = name => name === 'Dragon dagger' ? 0 : 2;
    f.port.bank = async () => !f.trips.includes('enter') || f.trips.includes('leave');
    await expect(provision(upgrade, f.port)).rejects.toThrow('stock');
    expect(f.bank['Dragon longsword']).toBe(1);
    expect(f.bank.Coins).toBe(900000);
    expect(f.held.Coins ?? 0).toBe(0);
    expect(f.trips).toContain('leave');
});

test('owned bank, inventory and worn dragon weapons avoid duplicate purchases', async () => {
    const f = fixture();
    f.held['Dragon dagger'] = 1;
    f.worn['Dragon longsword'] = 1;
    await provision(upgrade, f.port);
    expect(f.purchases).toEqual([]);
    expect(f.trips).toEqual([]);
    expect(f.bank['Dragon longsword']).toBe(1);
    expect(f.bank['Dragon dagger']).toBe(1);
});

test('an already-running leveler audits newly unlocked dragon weapons and cools down failed purchases', async () => {
    const f = fixture();
    Object.assign(f.bank, { Lobster: 100, 'Rune scimitar': 1, 'Rune platebody': 1, 'Rune platelegs': 1, 'Rune full helm': 1 });
    f.port.shopStock = () => 0;
    const s = snapshot();
    s.levels.attack = 60;
    s.quests['Lost City'] = true;
    const bot = new AccountLeveler();
    bot.bindLog(() => {});
    bot['shoppingChecked'] = true;
    bot['snapshot'] = () => ({ ...s, now: Date.now(), stock: { ...f.port.stock(), ...Object.fromEntries(Object.entries(f.worn).map(([name, count]) => [name.toLowerCase(), count])) } });
    Object.assign(bot['supplies'], f.port);
    class Idle extends LoopingBot { override loop(): void {} }
    const patches = [
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3200, z: 3200, level: 0 }),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Inventory, 'count').mockImplementation(name => f.held[name] ?? 0),
        spyOn(Bank, 'close').mockResolvedValue(true),
        spyOn(Traversal, 'walkResilient').mockResolvedValue(true),
        spyOn(ScriptRegistry, 'get').mockReturnValue({ name: 'AutoFighter', description: '', create: () => new Idle() }),
        spyOn(bot['activity'], 'start').mockResolvedValue(undefined)
    ];
    try {
        await bot['selectAndStart']();
        expect(f.trips.filter(event => event === 'enter')).toHaveLength(1);
        expect(f.trips).toContain('leave');
        expect(bot['session'].memory.cooldowns['quest-zanaris-weapons']).toBeGreaterThan(Date.now());
        await bot['selectAndStart']();
        expect(f.trips.filter(event => event === 'enter')).toHaveLength(1);
    } finally {
        bot.onStop();
        for (const patch of patches) patch.mockRestore();
    }
});

test('the leveler leaves Zanaris before provisioning a full inventory training activity', async () => {
    const f = fixture();
    Object.assign(f.bank, { Logs: 28, Tinderbox: 1 });
    const s = snapshot();
    s.quests['Lost City'] = true;
    for (const skill of enabledSkills) s.levels[skill] = 60;
    s.levels.woodcutting = 1;
    s.levels.firemaking = 1;
    let tile = { x: 3153, z: 9576, level: 0 };
    const events: string[] = [];
    const bot = new AccountLeveler();
    bot.bindLog(() => {});
    bot['shoppingChecked'] = true;
    bot['session'].memory.cooldowns['quest-zanaris-weapons'] = Date.now() + 60000;
    bot['session'].memory.objective = 'firemaking';
    bot['snapshot'] = () => ({ ...s, stock: f.port.stock() });
    Object.assign(bot['supplies'], f.port);
    const deposit = f.port.deposit;
    bot['supplies'].deposit = async () => { events.push('provision'); expect(tile.z).toBeLessThan(9000); await deposit(); };
    class Idle extends LoopingBot { override loop(): void {} }
    const patches = [
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockImplementation(() => tile),
        spyOn(Inventory, 'count').mockImplementation(name => f.held[name] ?? 0),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Bank, 'close').mockResolvedValue(true),
        spyOn(zanaris, 'leaveZanaris').mockImplementation(async () => { events.push('exit'); tile = { x: 3260, z: 3171, level: 0 }; return true; }),
        spyOn(ScriptRegistry, 'get').mockReturnValue({ name: 'AutoFighter', description: '', create: () => new Idle() }),
        spyOn(bot['activity'], 'start').mockResolvedValue(undefined)
    ];
    try {
        await bot['selectAndStart']();
        expect(events[0]).toBe('exit');
        expect(events).toContain('provision');
        expect(bot['session'].plan?.script).toBe('Firemaker');
    } finally {
        bot.onStop();
        for (const patch of patches) patch.mockRestore();
    }
});
