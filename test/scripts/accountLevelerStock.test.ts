import { expect, test } from 'bun:test';
import { LevelerStock } from '#/bot/scripts/AccountLeveler/stock.js';

test('closing the bank retains its last observed stock instead of reporting empty supplies', () => {
    const view=new LevelerStock();
    view.observe([{id:1511,name:'Logs',count:50}],true);
    view.observe([],false);
    expect(view.total([]).logs).toBe(50);
    expect(view.ready).toBe(true);
});

test('withdrawal updates bank stock before adding the carried items', () => {
    const view=new LevelerStock();
    view.observe([{id:1511,name:'Logs',count:50}],true);
    view.observe([{id:1511,name:'Logs',count:24}],true);
    expect(view.total([{id:1511,name:'Logs',count:26}]).logs).toBe(50);
});

test('restart invalidation requires a fresh bank read and a confirmed empty bank is valid', () => {
    const view=new LevelerStock();view.observe([{id:995,name:'Coins',count:10000}],true);
    view.invalidate();view.observe([],false);
    expect(view.ready).toBe(false);
    view.observe([],true);
    expect(view.ready).toBe(true);expect(view.total([])).toEqual({});
});
