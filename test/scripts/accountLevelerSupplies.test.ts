import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { expect, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { gameSupplyPort, provision, stockCounts, SupplyStockError, type SupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import type { ActivityPlan } from '#/bot/scripts/AccountLeveler/types.js';
import { meleeEquipment } from '#/bot/scripts/AccountLeveler/equipment.js';
import { supplyOffer } from '#/bot/scripts/AccountLeveler/offers.js';

function fixture(coins = 10000) {
    const bank: Record<string, number> = { Coins: coins, Shrimps: 30 };
    const pack: Record<string, number> = {};
    const worn: Record<string, number> = { 'Bronze sword': 1 };
    let purchases = 0;
    let spent = 0;
    let price = 112;
    const port: SupplyPort = {
        bank: async () => true,
        deposit: async () => { for (const [name,count] of Object.entries(pack)) { bank[name]=(bank[name]??0)+count; delete pack[name]; } },
        stock: () => ({ ...Object.fromEntries(Object.entries(bank).map(([k,v]) => [k.toLowerCase(),v])), ...{} }),
        held: name => pack[name] ?? 0,
        worn: name => worn[name] ?? 0,
        equipment: () => Object.keys(worn),
        unequip: async name => { pack[name] = (pack[name]??0)+(worn[name]??0); delete worn[name]; return true; },
        withdraw: async (name,count) => { const n=Math.min(bank[name]??0,count); bank[name]=(bank[name]??0)-n; pack[name]=(pack[name]??0)+n; return n===count; },
        closeBank: async () => true,
        walk: async () => true,
        shop: async () => true,
        shopStock: () => 3,
        buy: async (name,count) => { const n=Math.min(count,Math.floor((pack.Coins??0)/price)); pack.Coins-=n*price; spent+=n*price; pack[name]=(pack[name]??0)+n; purchases++; return n; },
        closeShop: async () => {},
        equip: async name => { worn[name]=(worn[name]??0)+(pack[name]??0); delete pack[name]; return true; },
        log: () => {}
    };
    return { port, bank, pack, worn, purchases: () => purchases, spent: () => spent, setPrice: (p:number) => { price=p; } };
}
const plan: ActivityPlan = { id:'combat', label:'combat', objective:'attack', script:'AutoFighter', settings:{}, combat:true, food:'Shrimps', needs:[{item:'Iron scimitar',count:1,carry:1,equip:true},{item:'Shrimps',count:24,carry:12}] };

test('provisioning replaces equipped gear, buys a weapon, banks change and carries unnoted food', async () => {
    const f=fixture();
    await provision(plan,f.port);
    expect(f.worn).toEqual({'Iron scimitar':1});
    expect(f.pack).toEqual({Shrimps:12});
    expect(f.bank['Bronze sword']).toBe(1);
    expect(f.bank.Coins).toBe(10000-f.spent());
    expect(f.purchases()).toBe(1);
});

test('banked weapons prevent unnecessary purchases', async () => {
    const f=fixture(); f.bank['Iron scimitar']=1;
    await provision(plan,f.port);
    expect(f.purchases()).toBe(0);
    expect(f.worn['Iron scimitar']).toBe(1);
});

test('a purchase with no inventory delta is rejected even when shop reports success', async () => {
    const f=fixture(); f.port.buy=async()=>1;
    await expect(provision(plan,f.port)).rejects.toThrow('Iron scimitar');
});

test('missing shop stock fails without buying or carrying bank wealth', async () => {
    const f=fixture(); f.port.shopStock=()=>0;
    await expect(provision(plan,f.port)).rejects.toThrow('stock');
    expect(f.purchases()).toBe(0);
    expect(f.pack.Coins??0).toBeLessThan(1000);
});

test('noted food and herbs of another id do not satisfy a usable manifest', () => {
    const counts=stockCounts([
        {name:'Shrimps',id:316,count:50,noted:true},
        {name:'Shrimps',id:315,count:3,noted:false},
        {name:'Herb',id:199,count:2,noted:false},
        {name:'Herb',id:201,count:10,noted:false}
    ]);
    expect(counts.shrimps).toBe(3);
    expect(counts['#199']).toBe(2);
});

test('an unavailable bank snapshot cannot be treated as no weapon or no coins', async () => {
    const f=fixture(); f.port.bank=async()=>false;
    await expect(provision(plan,f.port)).rejects.toThrow('bank');
    expect(f.purchases()).toBe(0);
});

const bowPlan: ActivityPlan = { id: 'range', label: 'ranged combat', objective: 'ranged', script: 'AutoFighter', settings: {},
    needs: [{ item: 'Shortbow', id: 841, count: 1, carry: 1, equip: true }] };

function bowFixture(strung: number) {
    const f = fixture();
    f.bank['#50'] = 20;
    f.bank['#841'] = strung;
    const key = (name: string, items: Record<string, number>) => name === 'Shortbow' ? (items['#50'] ? '#50' : '#841') : name;
    f.port.stock = () => ({ ...Object.fromEntries(Object.entries(f.bank).map(([k, v]) => [k.toLowerCase(), v])), shortbow: f.bank['#50'] + f.bank['#841'] });
    f.port.held = name => f.pack[key(name, f.pack)] ?? 0;
    f.port.worn = name => f.worn[key(name, f.worn)] ?? 0;
    const withdraw = f.port.withdraw;
    f.port.withdraw = (name, count) => withdraw(key(name, f.bank), count);
    const buy = f.port.buy;
    f.port.buy = (name, count) => buy(name === 'Shortbow' ? '#841' : name, count);
    f.port.equip = async name => {
        const id = key(name, f.pack);
        if (id !== '#841' || !f.pack[id]) return false;
        f.worn[id] = f.pack[id];
        delete f.pack[id];
        return true;
    };
    return f;
}

test.each([0, 1])('equips a strung bow when the bank also holds unstrung bows (strung=%i)', async strung => {
    const f = bowFixture(strung);
    await provision(bowPlan, f.port);
    expect(f.worn['#841']).toBe(1);
    expect(f.bank['#50']).toBe(20);
    expect(f.purchases()).toBe(strung ? 0 : 1);
});

test('rejects a same-name purchase that supplies the wrong bow id', async () => {
    const f = bowFixture(0);
    f.port.buy = async () => { f.pack['#50'] = 1; return 1; };
    await expect(provision(bowPlan, f.port)).rejects.toThrow('Purchase of Shortbow');
});

test('rejects a same-name withdrawal that supplies the wrong bow id', async () => {
    const f = bowFixture(1);
    f.port.withdraw = async () => { f.pack['#50'] = 1; return true; };
    await expect(provision(bowPlan, f.port)).rejects.toThrow('Could not withdraw');
});

test('verifies the equipped bow id even when equip reports success', async () => {
    const f = bowFixture(1);
    f.port.equip = async () => { f.worn['#50'] = 1; return true; };
    await expect(provision(bowPlan, f.port)).rejects.toThrow('Failed to equip');
});

test('game adapter equips the strung bow even when an unstrung bow precedes it', async () => {
    const item = (id: number, slot: number, ops: string[]): InvItemSnapshot => ({ id, slot, ops, name: 'Shortbow', count: 1, comId: 3214 });
    const pack = [item(50, 0, ['Use']), item(841, 1, ['Wield'])];
    let worn: InvItemSnapshot[] = [];
    const patches = [
        spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition()),
        spyOn(reader, 'inventory').mockReturnValue(pack),
        spyOn(reader, 'equipment').mockImplementation(() => worn),
        spyOn(InvItem.prototype, 'interact').mockImplementation(async function(this: InvItem) {
            worn = [item(this.id, 3, ['Remove'])];
            return true;
        })
    ];
    try {
        expect(await gameSupplyPort(() => {}).equip('#841')).toBe(true);
        expect(worn.map(item => item.id)).toEqual([841]);
    } finally {
        for (const patch of patches) patch.mockRestore();
    }
});

test('shops for both armor pieces on one visit and marks the vendor done after banking both', async () => {
    const f = fixture();
    const visits: string[] = [];
    const progress: string[] = [];
    f.port.shop = async keeper => { visits.push(keeper); return true; };
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platebody', count: 1 }] };
    await provision(armor, f.port, update => {
        progress.push(`${update.id}:${update.state}`);
        if (update.id === 'shop:Horvik' && update.state === 'done') {
            expect(f.bank['Iron chainbody']).toBe(1);
            expect(f.bank['Iron platebody']).toBe(1);
        }
    });
    expect(visits).toEqual(['Horvik']);
    expect(progress).toContain('shop:Horvik:done');
    expect(f.bank.Coins).toBe(10000 - f.spent());
});

test('shopping withdraws fare money in addition to the full item budget', async () => {
    const f = fixture();
    f.setPrice(1);
    let departing = 0;
    f.port.walk = async () => { departing = f.pack.Coins; f.pack.Coins -= 60; return true; };
    await provision({ ...plan, needs: [{ item: 'Hammer', count: 1 }] }, f.port);
    expect(departing).toBe(207);
    expect(f.bank.Hammer).toBe(1);
    expect(f.bank.Coins).toBe(9939);
});

test('shopping refuses to use the last travel coins for an item', async () => {
    const f = fixture(700);
    await expect(provision(plan, f.port)).rejects.toThrow('Coins');
    expect(f.purchases()).toBe(0);
    expect(f.bank.Coins).toBe(700);
});

test('batches unstackable supplies without filling more than 28 inventory slots', async () => {
    const f = fixture();
    let visits = 0;
    let largestPack = 0;
    f.setPrice(2);
    f.port.shopStock = () => 500;
    f.port.shop = async () => { visits++; return true; };
    const buy = f.port.buy;
    f.port.buy = async (name, count) => {
        const bought = await buy(name, count);
        const used = Object.entries(f.pack).reduce((slots, [item, quantity]) => slots + (item === 'Coins' ? Number(quantity > 0) : quantity), 0);
        largestPack = Math.max(largestPack, used);
        if (used > 28) throw new Error('Inventory full');
        return bought;
    };
    await provision({ ...plan, food: undefined, needs: [{ item: 'Vial of water', count: 54 }] }, f.port);
    expect(f.bank['Vial of water']).toBe(54);
    expect(visits).toBe(2);
    expect(largestPack).toBe(28);
});

test('progress identifies travel and purchase counts before the external action starts', async () => {
    const f = fixture();
    let message = '';
    let destination: unknown;
    f.port.walk = async tile => { expect(message).toContain('Zeke'); expect(destination).toEqual(tile); return true; };
    const buy = f.port.buy;
    f.port.buy = async (name, count) => { expect(message).toContain('1 Iron scimitar'); return buy(name, count); };
    await provision(plan, f.port, update => { message = update.message; destination = update.destination; });
});

test('multiple unstackable needs share a vendor inventory limit including travel food', async () => {
    const f = fixture();
    let visits = 0;
    let largestPack = 0;
    f.setPrice(2);
    f.port.shopStock = () => 500;
    f.port.shop = async () => { visits++; return true; };
    const buy = f.port.buy;
    f.port.buy = async (name, count) => {
        const bought = await buy(name, count);
        const used = Object.entries(f.pack).reduce((slots, [item, quantity]) => slots + (item === 'Coins' ? Number(quantity > 0) : quantity), 0);
        largestPack = Math.max(largestPack, used);
        if (used > 28) throw new Error('Inventory full');
        return bought;
    };
    await provision({ ...plan, needs: [{ item: 'Vial of water', count: 27 }, { item: 'Rope', count: 2 }] }, f.port);
    expect(f.bank['Vial of water']).toBe(27);
    expect(f.bank.Rope).toBe(2);
    expect(visits).toBe(2);
    expect(largestPack).toBe(28);
    expect(f.bank.Shrimps).toBe(30);
});

test('partial purchases are banked and deficits retried before a vendor completes', async () => {
    const f = fixture();
    f.setPrice(2);
    let visits = 0;
    let done = 0;
    f.port.shop = async () => { visits++; return true; };
    const buy = f.port.buy;
    f.port.buy = (name, count) => buy(name, Math.min(count, 1));
    await provision({ ...plan, needs: [{ item: 'Small fishing net', count: 2 }, { item: 'Fly fishing rod', count: 2 }] }, f.port, event => {
        if (event.id === 'shop:Gerrant' && event.state === 'done') {
            done++;
            expect(f.bank['Small fishing net']).toBe(2);
            expect(f.bank['Fly fishing rod']).toBe(2);
        }
    });
    expect(visits).toBe(2);
    expect(done).toBe(1);
});


test('sold out gear banks earlier purchases and reports a temporary stock shortage', async () => {
    const f = fixture();
    f.port.shopStock = name => name === 'Iron platelegs' ? 0 : 3;
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platelegs', count: 1 }] };
    await expect(provision(armor, f.port)).rejects.toMatchObject({ name: 'SupplyStockError', items: ['iron platelegs'] });
    expect(f.purchases()).toBe(1);
    expect(f.bank['Iron chainbody']).toBe(1);
    expect(f.pack).toEqual({});
});

test('a purchase with no usable inventory delta reports a temporary stock shortage', async () => {
    const f = fixture();
    f.port.buy = async () => 1;
    await expect(provision(plan, f.port)).rejects.toMatchObject({ name: 'SupplyStockError', items: ['iron scimitar'] });
});

test('stock disappearing during purchase banks earlier items before a temporary retry', async () => {
    const f = fixture();
    let stock = 1;
    let attempts = 0;
    const buy = f.port.buy;
    f.port.shopStock = () => stock;
    f.port.buy = async (name, count) => {
        attempts++;
        if (name === 'Iron platelegs') {
            stock = 0;
            return 0;
        }
        return buy(name, count);
    };
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platelegs', count: 1 }] };
    await expect(provision(armor, f.port)).rejects.toMatchObject({ name: 'SupplyStockError', items: ['iron platelegs'] });
    expect(attempts).toBe(2);
    expect(f.port.shopStock('Iron platelegs')).toBe(0);
    expect(f.bank['Iron chainbody']).toBe(1);
    expect(f.pack).toEqual({});
});

test.each(['walk', 'shop'] as const)('an unavailable vendor during %s reports every item at that stop', async operation => {
    const f = fixture();
    f.port[operation] = async () => false;
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platebody', count: 1 }] };
    await expect(provision(armor, f.port)).rejects.toMatchObject({ name: 'SupplyUnavailableError', items: ['iron chainbody', 'iron platebody'] });
    expect(f.purchases()).toBe(0);
});

test('a planned melee kit buys and equips legs and a helmet from their actual vendors', async () => {
    const f = fixture(100000);
    const shelves: Record<string, string[]> = {
        Zeke: ['Mithril scimitar'], Horvik: ['Mithril platebody'], 'Louie legs': ['Mithril platelegs'], Peksa: ['Mithril full helm']
    };
    let keeper = '';
    const visits: string[] = [];
    f.port.shop = async name => { keeper = name; visits.push(name); return name in shelves; };
    f.port.shopStock = item => shelves[keeper]?.includes(item) ? 1 : 0;
    const needs = meleeEquipment({ levels: { attack: 20, defence: 20 }, stock: { coins: 100000 }, bankReady: true, quests: {}, target: 40, wilderness: false, now: 0 });
    await provision({ ...plan, needs }, f.port);
    expect(visits).toEqual(['Zeke', 'Horvik', 'Louie legs', 'Peksa']);
    expect(f.worn).toEqual({ 'Mithril scimitar': 1, 'Mithril platebody': 1, 'Mithril platelegs': 1, 'Mithril full helm': 1 });
    expect(f.bank.Coins).toBeGreaterThanOrEqual(200);
});

test.skipIf(!existsSync('out/collision.lcnav.gz')).each(['Mithril platelegs', 'Mithril full helm'])('the shopping route reaches %s without quest unlocks', item => {
    const offer = supplyOffer(item)!;
    expect(offer).not.toBeNull();
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const route = finder.findPath({ x: 3185, z: 3436, level: 0 }, offer.tile, {
        state: { ...emptyWorldStateData(), members: true, items: { Coins: 200 }, skills: { agility: 1 }, canSlashWeb: false }, useTeleportCatalog: false
    });
    expect(route.ok).toBe(true);
    if (route.ok) expect(route.waypoints.at(-1)).toMatchObject(offer.tile);
});

test.each(['bank', 'coins'] as const)('%s failure does not blacklist purchasable equipment', async failure => {
    const f = fixture(failure === 'coins' ? 1 : 10000);
    if (failure === 'bank') f.port.bank = async () => false;
    await expect(provision(plan, f.port)).rejects.toMatchObject({ name: 'Error' });
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('the navigation graph reaches Nurmof through the surface trapdoor', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const route = finder.findPath({ x: 3019, z: 3449, level: 0 }, { x: 2997, z: 9844, level: 0 }, {
        state: { ...emptyWorldStateData(), skills: { agility: 1 }, canSlashWeb: false }, useTeleportCatalog: false
    });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.hops.find(hop => hop.locId === 1568)).toMatchObject({
        kind: 'dungeon', action: 'Climb-down', to: { x: 3019, z: 9849, level: 0 }
    });
    expect(route.waypoints.at(-1)).toMatchObject({ x: 2997, z: 9844, level: 0 });
});

test('best effort takes the eight available arrows once instead of refilling a thousand-arrow target', async () => {
    const f = fixture();
    f.bank['Bronze arrow'] = 79;
    f.setPrice(1);
    const visits: string[] = [];
    const messages: string[] = [];
    f.port.shopStock = () => 8;
    f.port.shop = async keeper => { visits.push(keeper); return true; };
    await provision({ ...plan, needs: [{ item: 'Bronze arrow', count: 1000 }] }, f.port, event => messages.push(event.message), { bestEffort: true });
    expect(visits).toEqual(['Lowe']);
    expect(f.bank['Bronze arrow']).toBe(87);
    expect(messages.some(message => message.includes('913') && message.includes('Bronze arrow'))).toBe(true);
});

test('best effort skips sold out supplies and continues buying other items and vendors', async () => {
    const f = fixture();
    f.setPrice(1);
    f.port.shopStock = name => name === 'Bronze arrow' ? 0 : 3;
    await provision({ ...plan, needs: [
        { item: 'Bronze arrow', count: 1000 }, { item: 'Shortbow', count: 1 }, { item: 'Hammer', count: 1 }
    ] }, f.port, undefined, { bestEffort: true });
    expect(f.bank['Bronze arrow'] ?? 0).toBe(0);
    expect(f.bank.Shortbow).toBe(1);
    expect(f.bank.Hammer).toBe(1);
});

test('best effort does not revisit a vendor after a partially fulfilled purchase', async () => {
    const f = fixture();
    f.setPrice(1);
    f.port.shopStock = () => 1000;
    const buy = f.port.buy;
    f.port.buy = (name, count) => buy(name, Math.min(count, 8));
    await provision({ ...plan, needs: [{ item: 'Bronze arrow', count: 1000 }] }, f.port, undefined, { bestEffort: true });
    expect(f.purchases()).toBe(1);
    expect(f.bank['Bronze arrow']).toBe(8);
});

test('best effort permits capacity-limited batches without exceeding initially available stock', async () => {
    const f = fixture();
    f.setPrice(1);
    f.port.shopStock = () => 27;
    await provision({ ...plan, needs: [{ item: 'Vial of water', count: 54 }] }, f.port, undefined, { bestEffort: true });
    expect(f.bank['Vial of water']).toBe(27);
    expect(f.purchases()).toBe(2);
});

test.each(['walk', 'shop'] as const)('best effort recovers from a failed %s and continues to another supplier', async operation => {
    const f = fixture();
    f.setPrice(1);
    let calls = 0;
    f.port[operation] = async () => ++calls > 1;
    await provision({ ...plan, needs: [{ item: 'Shortbow', count: 1 }, { item: 'Hammer', count: 1 }] }, f.port, undefined, { bestEffort: true });
    expect(f.bank.Shortbow ?? 0).toBe(0);
    expect(f.bank.Hammer).toBe(1);
});

test('purchase progress retains bank counts while the shop has replaced the bank modal', async () => {
    const f = fixture();
    f.bank['Iron scimitar'] = 1;
    let open = true;
    const stock = f.port.stock;
    f.port.stock = () => open ? stock() : {};
    f.port.bank = async () => { open = true; return true; };
    f.port.closeBank = async () => { open = false; return true; };
    const messages: string[] = [];
    await provision({ ...plan, needs: [{ item: 'Iron scimitar', count: 2 }] }, f.port, event => messages.push(event.message));
    expect(messages.find(message => message.startsWith('Buying'))).toContain('(1/2 banked)');
});

test('mandatory ammunition uses a partial purchase and rebases the carried training batch', async () => {
    const f = fixture();
    f.bank['Bronze arrow'] = 79;
    f.setPrice(1);
    f.port.shopStock = () => 8;
    const activity: ActivityPlan = { ...plan, settings: { ammoWithdraw: 300 }, needs: [
        { item: 'Bronze arrow', count: 1000, carry: 300, equip: true, minimum: 1 }
    ] };
    await provision(activity, f.port);
    expect(f.purchases()).toBe(1);
    expect(f.worn['Bronze arrow']).toBe(87);
    expect(activity.needs[0]).toMatchObject({ count: 87, carry: 87 });
    expect(activity.settings.ammoWithdraw).toBe(87);
});

test('mandatory ammunition uses banked arrows when the shop has none', async () => {
    const f = fixture();
    f.bank['Bronze arrow'] = 79;
    f.port.shopStock = () => 0;
    const activity: ActivityPlan = { ...plan, settings: {}, needs: [
        { item: 'Bronze arrow', count: 300, carry: 300, equip: true, minimum: 1 }
    ] };
    await provision(activity, f.port);
    expect(f.worn['Bronze arrow']).toBe(79);
    expect(f.purchases()).toBe(0);
});

test('mandatory out of stock ammunition reports a retryable shortage after one visit', async () => {
    const f = fixture();
    let visits = 0;
    f.port.shop = async () => { visits++; return true; };
    f.port.shopStock = () => 0;
    await expect(provision({ ...plan, needs: [
        { item: 'Bronze arrow', count: 300, carry: 300, equip: true, minimum: 1 }
    ] }, f.port)).rejects.toMatchObject({ name: 'SupplyStockError', items: ['bronze arrow'] });
    expect(visits).toBe(1);
});

test('rune shortfalls rebase both runes and autocast restocking to the same complete cast batch', async () => {
    const f = fixture(1000000);
    f.bank['Chaos rune'] = 79;
    f.bank['Fire rune'] = 160;
    f.setPrice(1);
    f.port.shopStock = () => 8;
    const activity: ActivityPlan = { ...plan, settings: { combatStyle: 'mage', runesWithdraw: 150 }, needs: [
        { item: 'Chaos rune', count: 200, carry: 150, minimum: 1 },
        { item: 'Fire rune', count: 800, carry: 600, minimum: 4 }
    ] };
    await provision(activity, f.port);
    expect(f.purchases()).toBe(2);
    expect(f.pack).toEqual({ 'Chaos rune': 42, 'Fire rune': 168 });
    expect(activity.needs.map(need => [need.count, need.carry])).toEqual([[42, 42], [168, 168]]);
    expect(activity.settings.runesWithdraw).toBe(42);
});

test('an incomplete elemental rune set never launches autocasting', async () => {
    const f = fixture(1000000);
    f.bank['Chaos rune'] = 200;
    f.bank['Fire rune'] = 3;
    f.port.shopStock = () => 0;
    const activity: ActivityPlan = { ...plan, settings: { combatStyle: 'mage' }, needs: [
        { item: 'Chaos rune', count: 200, carry: 150, minimum: 1 },
        { item: 'Fire rune', count: 800, carry: 600, minimum: 4 }
    ] };
    await expect(provision(activity, f.port)).rejects.toMatchObject({ name: 'SupplyStockError', items: ['fire rune'] });
    expect(f.pack).toEqual({});
});

test('partial feathers update the child fishing restock amount', async () => {
    const f = fixture();
    f.setPrice(1);
    f.port.shopStock = () => 8;
    const activity: ActivityPlan = { ...plan, script: 'Fisher', settings: { baitQty: 200 }, needs: [
        { item: 'Feather', count: 200, carry: 200, minimum: 1 }
    ] };
    await provision(activity, f.port);
    expect(f.pack.Feather).toBe(8);
    expect(activity.settings.baitQty).toBe(8);
});

test('progress uses one logging channel when an action reporter is supplied', async () => {
    const f = fixture();
    let logs = 0;
    let updates = 0;
    f.port.log = () => { logs++; };
    await provision(plan, f.port, () => { updates++; });
    expect(updates).toBeGreaterThan(0);
    expect(logs).toBe(0);
});


test('a sold out mandatory tool reports a temporary stock shortage', async () => {
    const f = fixture();
    f.port.shopStock = () => 0;
    const result = provision({ ...plan, needs: [{ item: 'Small fishing net', count: 1, carry: 1 }] }, f.port);
    await expect(result).rejects.toBeInstanceOf(SupplyStockError);
    await expect(result).rejects.toMatchObject({ name: 'SupplyStockError', items: ['small fishing net'] });
    expect(f.purchases()).toBe(0);
    expect(f.pack).toEqual({});
});

test('partial thread updates the child crafting restock amount', async () => {
    const f = fixture();
    f.setPrice(1);
    f.port.shopStock = () => 8;
    const activity: ActivityPlan = { ...plan, script: 'LeatherCrafter', settings: { threadPerTrip: 100 }, needs: [{ item: 'Thread', count: 100, carry: 100, minimum: 1 }] };
    await provision(activity, f.port);
    expect(f.pack.Thread).toBe(8);
    expect(activity.settings.threadPerTrip).toBe(8);
});
