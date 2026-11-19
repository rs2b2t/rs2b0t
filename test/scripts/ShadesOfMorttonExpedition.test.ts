import { afterEach, expect, spyOn, test } from 'bun:test';
import { Bank } from '../../src/bot/api/bank/Bank.js';
import { Execution } from '../../src/bot/api/execution/Execution.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { reader } from '../../src/bot/adapter/ClientAdapter.js';
import { resetLiveCatalog } from '../../src/bot/api/market/catalog.js';
import { Shop } from '../../src/bot/api/shop/Shop.js';
import { Inventory, InvItem } from '../../src/bot/api/inventory/Inventory.js';
import { EventSignal } from '../../src/bot/api/execution/EventSignal.js';
import { Expedition } from '../../src/bot/scripts/ShadesOfMortton/expedition.js';
import { noteId } from '../../src/bot/scripts/ShadesOfMortton/shop.js';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const restore of cleanup.splice(0)) restore(); resetLiveCatalog(); });
function rig() {
    const catalog = spyOn(reader, 'objCatalog').mockReturnValue([3448, 1513, 379].flatMap(id => [
        { id, name: '', cost: 1, stackable: false, members: true, equippable: false, certlink: -1, certtemplate: -1 },
        { id: id + 1, name: '', cost: 1, stackable: true, members: true, equippable: false, certlink: id, certtemplate: 799 }
    ]));
    resetLiveCatalog();
    const close = spyOn(Shop, 'close').mockResolvedValue(undefined);
    cleanup.push(() => catalog.mockRestore(), () => close.mockRestore());
    const items = new Map([[379, 4], [590, 1], [995, 30000], [3465, 1], [noteId(3448)!, 40], [noteId(379)!, 300]]);
    let event = false;
    let pending = false;
    let baseline: ReadonlyMap<number, number> | null = null;
    const count = spyOn(Inventory, 'countById').mockImplementation(id => items.get(id) ?? 0);
    const free = spyOn(Inventory, 'free').mockImplementation(() => 28 - [...items].reduce((n, [id, qty]) => n + (id === 995 || id === noteId(3448) || id === noteId(1513) || id === noteId(379) ? 1 : qty), 0));
    const listing = spyOn(Inventory, 'items').mockImplementation(() => [...items].filter(([,count]) => count > 0).map(([id, count], slot) => new InvItem({ id, count, slot, comId: 3214, ops: [], name: '' })));
    const events = spyOn(EventSignal, 'pending').mockImplementation(() => event);
    cleanup.push(() => count.mockRestore(), () => free.mockRestore(), () => listing.mockRestore(), () => events.mockRestore());
    let hunts = 0;
    let opened = 0;
    const shop = {
        budget: (_id: number) => 100,
        open: async () => true,
        pending: () => false,
        resume: async () => true,
        refill: async (id: number, target: number) => {
            const notes = noteId(id)!;
            const amount = Math.max(0, target - (items.get(id) ?? 0));
            if ((items.get(notes) ?? 0) < amount) return false;
            items.set(notes, items.get(notes)! - amount);
            items.set(id, (items.get(id) ?? 0) + amount);
            return true;
        }
    };
    const game = {
        pending: () => pending,
        resume: async () => { pending = false; return true; },
        hunt: async (_tier: number, amount: number) => { hunts++; items.set(3404, (items.get(3404) ?? 0) + amount); return true; },
        cremate: async (_tier: number) => { items.set(3404, items.get(3404)! - 1); items.set(3448, items.get(3448)! - 1); items.set(3466, (items.get(3466) ?? 0) + 1); return true; },
        openChests: async () => { opened++; items.delete(3466); items.set(3470, (items.get(3470) ?? 0) + 1); return true; },
        exit: async () => true
    };
    const supply = {
        clearWaste: async () => { items.delete(229); items.delete(2959); return true; },
        stock: new Map<number, number>(), take: async (_id: number, _count: number) => true,
        douse: async (qty: number) => {
            if ((items.get(1513) ?? 0) < qty || (items.get(3430) ?? 0) < qty) return false;
            items.set(1513, items.get(1513)! - qty);
            items.set(3430, items.get(3430)! - qty);
            items.set(3448, (items.get(3448) ?? 0) + qty);
            return true;
        }
    };
    const temple = { localOil: async (doses: number) => { items.set(3430, Math.ceil(doses / 4)); return true; } };
    const combat = { maintain: async () => true, standDown: async () => {}, protected: () => false };
    const expedition = new Expedition(supply, game, shop, combat,
        { process: async before => { baseline = before; return true; } },
        { prayer: false, alch: false }, temple);
    return { expedition, items, shop, game, combat, supply, temple, hunts: () => hunts, opened: () => opened, baseline: () => baseline, interrupt: () => { event = true; pending = true; }, clear: () => { event = false; } };
}

test('continues a second local hunt after small pyre batches and chests', async () => {
    const r = rig();
    for (let i = 0; i < 80 && r.hunts() < 2; i++) expect({ result: await r.expedition.step(), reason: r.expedition.reason }).toEqual({ result: 'continue', reason: '' });
    expect(r.hunts()).toBe(2);
    expect(r.opened()).toBe(1);
    expect(r.expedition.cycles).toBe(1);
    expect(r.items.get(3465)).toBe(1);
});

test('keeps the chest loot baseline through an interrupted chest', async () => {
    const r = rig();
    r.items.set(3470, 3);
    r.items.set(3466, 1);
    r.expedition.phase = 'chests';
    r.game.openChests = async () => { r.items.set(3470, 4); r.interrupt(); return false; };
    expect(await r.expedition.step()).toBe('continue');
    r.clear();
    r.game.openChests = async () => true;
    expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('continue');
    expect(r.baseline()?.get(3470)).toBe(3);
});

test('banks when protected loot leaves no safe transition slots', async () => {
    const r = rig();
    r.items.set(3470, 21);
    expect(await r.expedition.step()).toBe('bank');
});

test('retries unavailable shop access in town without banking or hunting', async () => {
    const r = rig();
    r.shop.open = async () => false;
    expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('failure');
    expect(r.expedition.reason).toContain('Preparing supplies');
    expect(r.hunts()).toBe(0);
});

test('reconciles an interrupted shop buyback before returning to bank', async () => {
    const r = rig();
    let unfinished = true;
    let resumes = 0;
    r.shop.pending = () => unfinished;
    r.shop.resume = async () => { resumes++; unfinished = false; return true; };
    r.items.set(3470, 21);
    expect(await r.expedition.step()).toBe('continue');
    expect(resumes).toBe(1);
    expect(await r.expedition.step()).toBe('bank');
});

test('uses a partial verified pyre buyback before banking', async () => {
    const r = rig();
    await r.expedition.step();
    await r.expedition.step();
    r.shop.refill = async id => { r.items.set(id, 1); return false; };
    expect(await r.expedition.step()).toBe('continue');
    expect(r.items.get(3404)).toBe(13);
});


test('a full optional load can burn and open chests before a second local hunt', async () => {
    const r = rig();
    for (const id of [2347, 2434, 2435, 561, 554]) r.items.set(id, 1);
    await r.expedition.step();
    await r.expedition.step();
    expect(r.items.get(3404)).toBe(9);
    for (let i = 0; i < 50 && r.hunts() < 2; i++) expect(await r.expedition.step()).toBe('continue');
    expect(r.opened()).toBe(1);
    expect(r.hunts()).toBe(2);
});


test('refills noted food after upkeep requests retreat with one lobster left', async () => {
    const r = rig();
    r.items.set(379, 1);
    r.combat.maintain = async () => (r.items.get(379) ?? 0) >= 2;
    expect(await r.expedition.step()).toBe('continue');
    expect(r.items.get(379)).toBe(4);
    expect(r.expedition.phase).toBe('hunt');
});

test('loads exact loose food and noted reserves with capped coins and resets note mode', async () => {
    const r = rig();
    r.items.clear();
    const bank = new Map([[379, 500], [1513, 40], [3448, 40], [590, 1], [2347, 1], [995, 50000], [3465, 1]]);
    r.supply.stock = new Map(bank);
    r.supply.take = async (id, qty) => {
        if ((bank.get(id) ?? 0) < qty) return false;
        bank.set(id, bank.get(id)! - qty);
        r.items.set(id, (r.items.get(id) ?? 0) + qty);
        return true;
    };
    const modes: boolean[] = [];
    const mode = spyOn(Bank, 'setNoteMode').mockImplementation(async value => { modes.push(value); });
    const stock = spyOn(Bank, 'countById').mockImplementation(id => bank.get(id) ?? 0);
    const withdraw = spyOn(Bank, 'withdrawXById').mockImplementation(async (id, qty, noted = id) => {
        bank.set(id, bank.get(id)! - qty);
        r.items.set(noted, (r.items.get(noted) ?? 0) + qty);
        return true;
    });
    const close = spyOn(Bank, 'close').mockResolvedValue(true);
    const delay = spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    const skill = spyOn(Skills, 'level').mockReturnValue(70);
    cleanup.push(() => mode.mockRestore(), () => stock.mockRestore(), () => withdraw.mockRestore(), () => close.mockRestore(), () => delay.mockRestore(), () => skill.mockRestore());
    expect(await r.expedition.load()).toBe(true);
    expect(r.items.get(379)).toBe(4);
    expect(r.items.get(noteId(379)!)).toBe(300);
    expect(r.items.get(3448)).toBeUndefined();
    expect(r.items.get(noteId(1513)!)).toBe(39);
    expect(r.items.get(1513)).toBe(1);
    expect(r.items.get(noteId(3448)!)).toBeUndefined();
    expect(r.items.get(995)).toBe(50000);
    expect(r.items.get(3465)).toBe(1);
    expect(modes.at(-1)).toBe(false);
});

test('stops bounded reconciliation failures while preserving pending rewards', async () => {
    const r = rig();
    r.game.pending = () => true;
    r.game.resume = async () => false;
    for (let i = 0; i < 7; i++) expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('failure');
    expect(r.game.pending()).toBe(true);
});

test('finishes carried lower-tier remains after the first progression key appears', async () => {
    const r = rig();
    r.items.delete(3465);
    r.items.set(3396, 2);
    const tiers: number[] = [];
    r.game.cremate = async (tier: number) => {
        tiers.push(tier);
        r.items.set(3396, r.items.get(3396)! - 1);
        r.items.set(3448, r.items.get(3448)! - 1);
        r.items.set(3450, (r.items.get(3450) ?? 0) + 1);
        return true;
    };
    await r.expedition.step();
    await r.expedition.step();
    await r.expedition.step();
    expect(tiers).toEqual([0, 0]);
    expect(r.items.get(3396)).toBe(0);
});

test('a failed partial buyback burns recovered logs and banks before another sale', async () => {
    const r = rig();
    await r.expedition.step();
    await r.expedition.step();
    let sales = 0;
    r.shop.refill = async id => { sales++; r.items.set(id, 1); return false; };
    expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('bank');
    expect(sales).toBe(1);
});

test('exits catacombs before walking to the surface shop for pyre logs', async () => {
    const r = rig();
    await r.expedition.step();
    await r.expedition.step();
    const calls: string[] = [];
    r.game.exit = async () => { calls.push('exit'); return true; };
    const refill = r.shop.refill;
    r.shop.refill = async (id, target) => { calls.push('refill'); return refill(id, target); };
    expect(await r.expedition.step()).toBe('continue');
    expect(calls).toEqual(['exit', 'refill']);
});

test('prepares oil, hunts, then unnotes ordinary magic logs and douses locally', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    const calls: string[] = [];
    const oil = r.temple.localOil;
    const hunt = r.game.hunt;
    const refill = r.shop.refill;
    const douse = r.supply.douse;
    r.temple.localOil = async doses => { calls.push('oil'); return oil(doses); };
    r.game.hunt = async (tier, amount) => { calls.push('hunt'); return hunt(tier, amount); };
    r.shop.refill = async (id, count) => { calls.push(`refill:${id}`); return refill(id, count); };
    r.supply.douse = async count => { calls.push('douse'); return douse(count); };
    for (let i = 0; i < 80 && r.hunts() < 2; i++) expect({ result: await r.expedition.step(), reason: r.expedition.reason }).toEqual({ result: 'continue', reason: '' });
    expect(r.hunts()).toBe(2);
    expect(r.opened()).toBe(1);
    expect(calls.indexOf('oil')).toBeLessThan(calls.indexOf('hunt'));
    expect(calls.indexOf('hunt')).toBeLessThan(calls.indexOf('refill:1513'));
    expect(calls.indexOf('refill:1513')).toBeLessThan(calls.indexOf('douse'));
    expect(calls).not.toContain('refill:3448');
    expect(r.items.get(noteId(1513)!)).toBeLessThan(40);
});

test('does not hunt without enough locally sanctified oil', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    r.temple.localOil = async () => false;
    for (let i = 0; i < 5; i++) await r.expedition.step();
    expect(r.hunts()).toBe(0);
});

test('uses recovered ordinary logs once after a partial buyback and then banks', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    await r.expedition.step();
    await r.expedition.step();
    await r.expedition.step();
    let sales = 0;
    r.shop.refill = async id => { sales++; r.items.set(id, 1); return false; };
    expect(await r.expedition.step()).toBe('continue');
    expect(r.items.get(1513)).toBe(0);
    expect(await r.expedition.step()).toBe('bank');
    expect(r.expedition.reason).toBe('log buyback unavailable');
    expect(sales).toBe(1);
});

test('sizes local oil batches to the room left by carried remains', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    r.items.set(3404, 10);
    const doses: number[] = [];
    const oil = r.temple.localOil;
    r.temple.localOil = async target => { doses.push(target); return oil(target); };
    await r.expedition.step();
    await r.expedition.step();
    expect(doses).toEqual([8]);
    expect(r.expedition.phase).toBe('burn');
    expect(await r.expedition.step()).toBe('continue');
    expect(r.items.get(3404)).toBe(9);
});

test('closes a resumed shop before dousing logs already in the inventory', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    r.items.set(1513, 1);
    r.items.set(3430, 1);
    r.items.set(3404, 1);
    await r.expedition.step();
    r.expedition.phase = 'burn';
    let closed = false;
    const close = spyOn(Shop, 'close').mockImplementation(async () => { closed = true; });
    cleanup.push(() => close.mockRestore());
    const douse = r.supply.douse;
    r.supply.douse = async qty => { expect(closed).toBe(true); return douse(qty); };
    expect(await r.expedition.step()).toBe('continue');
});

test('finishes the oil-matched hunting batch across partial hunting returns', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    const requests: number[] = [];
    r.game.hunt = async (_tier, qty) => {
        requests.push(qty);
        r.items.set(3404, (r.items.get(3404) ?? 0) + Math.min(2, qty));
        return true;
    };
    await r.expedition.step();
    await r.expedition.step();
    const logs = r.items.get(3430)!;
    expect(logs).toBeGreaterThan(2);
    while (r.expedition.phase === 'hunt') expect(await r.expedition.step()).toBe('continue');
    expect(r.items.get(3404)).toBe(logs);
    expect(r.expedition.phase).toBe('burn');
    expect(requests.length).toBeGreaterThan(1);
});

test('opens only silver chests while retaining the access key', async () => {
    const r = rig();
    r.items.set(3450, 3);
    r.items.set(3466, 2);
    const tiers: number[] = [];
    r.game.openChests = async (...args: number[]) => { tiers.push(args[0]); r.items.delete(3466); return true; };
    await r.expedition.step();
    await r.expedition.step();
    expect(tiers).toEqual([3]);
    expect(r.items.get(3465)).toBe(1);
    expect(r.items.get(3450)).toBe(3);
});

test('buys an affordable log batch without treating it as a failed buyback', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    await r.expedition.step();
    await r.expedition.step();
    await r.expedition.step();
    r.shop.budget = () => 1;
    const refill = r.shop.refill;
    const requests: number[] = [];
    r.shop.refill = async (id, qty) => { requests.push(qty); return refill(id, qty); };
    expect(await r.expedition.step()).toBe('continue');
    expect(await r.expedition.step()).toBe('continue');
    expect(requests).toEqual([1, 1]);
    expect(r.expedition.reason).toBe('');
});

test('requests resupply when temple money runs out instead of stopping on a generic error', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    r.temple.localOil = async () => false;
    Object.assign(r.temple, { resupplyReason: 'coins for temple supplies exhausted' });
    await r.expedition.step();
    expect(await r.expedition.step()).toBe('bank');
    expect(r.expedition.reason).toBe('coins for temple supplies exhausted');
});

test('requests missing serum ingredients only after actual shop access fails', async () => {
    const r = rig();
    r.shop.open = async () => false;
    Object.assign(r.temple, { resupplyReason: 'serum ingredients exhausted' });
    expect(await r.expedition.step()).toBe('bank');
    expect(r.expedition.reason).toBe('serum ingredients exhausted');
});

test('hunts one remain per oil bottle with three slots available for the first raw-log buyback', async () => {
    const r = rig();
    r.items.delete(noteId(3448)!);
    r.items.set(noteId(1513)!, 40);
    await r.expedition.step();
    await r.expedition.step();
    const logs = r.items.get(3430)!;
    const free = spyOn(Inventory, 'free').mockReturnValue(logs + 3);
    cleanup.push(() => free.mockRestore());
    expect(await r.expedition.step()).toBe('continue');
    expect(r.items.get(3404)).toBe(logs);
    expect(r.expedition.phase).toBe('burn');
});
