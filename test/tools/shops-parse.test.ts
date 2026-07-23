import { describe, expect, test } from 'bun:test';
import { joinShopDb, parseInvShops, parseNpcKeepers, parseObjDefs } from '../../tools/shops/parse.js';

const INV_FIXTURE = `
[runeshop]
scope=shared
size=40
restock=yes
stackall=yes
allstock=no
stock1=firerune,2000,10
stock2=mindrune,1000,10
stock7=chaosrune,1000,100
stock8=deathrune,1000,150

[skill_guide]
size=10
stock1=firerune,1

[adventurershop]
scope=shared
size=40
restock=yes
stackall=yes
allstock=yes
stock7=bronze_arrow,500,10
`;

const NPC_FIXTURE = `
[aubury]
name=Aubury
vislevel=hide
category=shop_keeper
op3=Trade
param=owned_shop,runeshop
param=shop_sell_multiplier,1000
param=shop_buy_multiplier,550
param=shop_delta,10
param=shop_title,Aubury's Rune Shop.

[aemad]
name=Aemad
category=shop_keeper
param=owned_shop,adventurershop
param=shop_sell_multiplier,1300
param=shop_buy_multiplier,400
param=shop_delta,20
param=shop_title,Aemad's Adventuring Supplies.

[kortan]
name=Kortan
category=shop_keeper
param=owned_shop,adventurershop
param=shop_sell_multiplier,1300
param=shop_buy_multiplier,400
param=shop_delta,20
param=shop_title,Aemad's Adventuring Supplies.

[guard]
name=Guard
op1=Attack
`;

const OBJ_FIXTURE = `
[deathrune]
cost=30
name=Death rune
stackable=yes
category=category_1289

[bronze_arrowheads]
name=Bronze arrowtips
members=yes
cost=1
stackable=yes

[bronze_pickaxe]
name=Bronze pickaxe
cost=1
`;

describe('parseInvShops', () => {
    test('parses 3-field stock lines with flags; skips 2-field non-shop invs', () => {
        const shops = parseInvShops(INV_FIXTURE);
        expect(shops.map(s => s.inv)).toEqual(['runeshop', 'adventurershop']);
        const rune = shops[0];
        expect(rune.scope).toBe('shared');
        expect(rune.allstock).toBe(false);
        expect(rune.stock).toEqual([
            { obj: 'firerune', baseline: 2000, restockTicks: 10 },
            { obj: 'mindrune', baseline: 1000, restockTicks: 10 },
            { obj: 'chaosrune', baseline: 1000, restockTicks: 100 },
            { obj: 'deathrune', baseline: 1000, restockTicks: 150 }
        ]);
        expect(shops[1].allstock).toBe(true);
    });
});

describe('parseNpcKeepers', () => {
    test('extracts owned_shop npcs with params and title; skips non-keepers', () => {
        const keepers = parseNpcKeepers(NPC_FIXTURE);
        expect(keepers.map(k => k.npc)).toEqual(['aubury', 'aemad', 'kortan']);
        expect(keepers[0]).toEqual({
            npc: 'aubury', name: 'Aubury', ownedShops: ['runeshop'],
            sell: 1000, buy: 550, delta: 10, title: "Aubury's Rune Shop."
        });
    });
});

describe('parseObjDefs', () => {
    test('reads name/cost/stackable/members in any field order', () => {
        const objs = parseObjDefs(OBJ_FIXTURE);
        expect(objs['deathrune']).toEqual({ name: 'Death rune', cost: 30, stackable: true, members: false });
        expect(objs['bronze_arrowheads']).toEqual({ name: 'Bronze arrowtips', cost: 1, stackable: true, members: true });
        expect(objs['bronze_pickaxe'].stackable).toBe(false);
    });
});

describe('joinShopDb', () => {
    test('joins invs to keepers (shared inv gets both) and objs to items', () => {
        const db = joinShopDb(parseInvShops(INV_FIXTURE), parseNpcKeepers(NPC_FIXTURE), parseObjDefs(OBJ_FIXTURE));
        expect(db['runeshop'].keepers).toEqual(['Aubury']);
        expect(db['runeshop'].sell).toBe(1000);
        expect(db['runeshop'].delta).toBe(10);
        const death = db['runeshop'].items.find(i => i.obj === 'deathrune');
        expect(death).toEqual({ obj: 'deathrune', name: 'Death rune', baseline: 1000, restockTicks: 150, cost: 30, stackable: true, members: false });
        expect(db['adventurershop'].keepers).toEqual(['Aemad', 'Kortan']);
        const fire = db['runeshop'].items.find(i => i.obj === 'firerune');
        expect(fire?.name).toBe('firerune');
        expect(fire?.cost).toBe(1);
    });
});
