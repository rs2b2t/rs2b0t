import { expect, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { gameSupplyPort, provision, stockCounts, type SupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';
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
