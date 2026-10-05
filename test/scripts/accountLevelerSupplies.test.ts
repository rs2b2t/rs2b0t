import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { expect, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { gameSupplyPort, provision, stockCounts, type SupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import type { ActivityPlan } from '#/bot/scripts/AccountLeveler/types.js';

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
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platelegs', count: 1 }] };
    await provision(armor, f.port, update => {
        progress.push(`${update.id}:${update.state}`);
        if (update.id === 'shop:Horvik' && update.state === 'done') {
            expect(f.bank['Iron chainbody']).toBe(1);
            expect(f.bank['Iron platelegs']).toBe(1);
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


test('sold out gear reports only the unavailable item for replanning', async () => {
    const f = fixture();
    f.port.shopStock = name => name === 'Iron platelegs' ? 0 : 3;
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platelegs', count: 1 }] };
    await expect(provision(armor, f.port)).rejects.toMatchObject({ name: 'SupplyUnavailableError', items: ['iron platelegs'] });
    expect(f.purchases()).toBe(1);
});

test('a purchase with no usable inventory delta reports the unavailable tier', async () => {
    const f = fixture();
    f.port.buy = async () => 1;
    await expect(provision(plan, f.port)).rejects.toMatchObject({ name: 'SupplyUnavailableError', items: ['iron scimitar'] });
});

test.each(['walk', 'shop'] as const)('an unavailable vendor during %s reports every item at that stop', async operation => {
    const f = fixture();
    f.port[operation] = async () => false;
    const armor: ActivityPlan = { ...plan, needs: [{ item: 'Iron chainbody', count: 1 }, { item: 'Iron platelegs', count: 1 }] };
    await expect(provision(armor, f.port)).rejects.toMatchObject({ name: 'SupplyUnavailableError', items: ['iron chainbody', 'iron platelegs'] });
    expect(f.purchases()).toBe(0);
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
