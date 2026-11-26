import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import * as supplies from '#/bot/scripts/AccountLeveler/economySupplies.js';
import { SEERS_MARKET_STAND } from '#/bot/scripts/AccountLeveler/market.js';
import { MarketSeller } from '#/bot/scripts/AccountLeveler/marketSeller.js';

const initialLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
afterEach(() => {
    mock.restore();
    resetLiveCatalog();
    if (initialLocation) Object.defineProperty(globalThis, 'location', initialLocation);
    else Reflect.deleteProperty(globalThis, 'location');
});

function catalog() {
    const row = (id: number, name: string, stackable = false, certlink = -1) => ({
        id, name, cost: 100, stackable, members: false, equippable: false, certlink, certtemplate: certlink < 0 ? -1 : 799
    });
    spyOn(reader, 'objCatalog').mockReturnValue([
        row(1749, 'Dragonhide'), row(1750, 'Dragonhide', true, 1749),
        row(1751, 'Dragonhide'), row(1752, 'Dragonhide', true, 1751),
        row(1753, 'Dragonhide'), row(1754, 'Dragonhide', true, 1753),
        row(536, 'Dragon bones'), row(537, 'Dragon bones', true, 536),
        row(556, 'Air rune', true), row(886, 'Steel arrow', true), row(995, 'Coins', true), row(1526, 'Snake weed'), row(526, 'Bones')
    ]);
}

async function seller(item?: string) {
    catalog();
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { host: 'localhost', search: '?world=1' } });
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(SEERS_MARKET_STAND);
    spyOn(Inventory, 'used').mockReturnValue(0);
    spyOn(Execution, 'delayUntil').mockImplementation(async check => Boolean(await check()));
    const bot = new MarketSeller(true, item);
    bot.bindLog(() => {});
    await bot.onStart();
    return bot;
}

test('dedicated sales reserve runes and finished arrows per type', () => {
    for (const item of ['Dragonhide', 'Blue dragonhide', 'Dragon bones', 'Big bones', 'Ranarr weed', 'Herb', 'Vial',
        'Vial of water', 'Super attack(3)', 'Coal', 'Diamond', 'Iron ore', 'Maple logs', 'Rune essence', 'Headless arrow', 'Rune platebody',
        'Rune scimitar']) expect(supplies.economyReserve(item, true)).toBe(0);
    for (const item of ['Law rune', 'Chaos rune', 'Steel arrow', 'Rune arrow']) expect(supplies.economyReserve(item, true)).toBe(1000);
    for (const item of ['Coins', 'Clue scroll', 'Snake weed', 'Rune arrow(p)']) expect(supplies.economyReserve(item, true)).toBeUndefined();
});

test('a sale requires 1000 banked units of the same tradeable item in a stackable or noted form', () => {
    catalog();
    const bank = { dragonhide: 1200, '#1751': 600, '#1753': 600, 'air rune': 3000, '#556': 3000,
        coins: 5000, '#995': 5000, bones: 3000, '#526': 3000, 'snake weed': 1000, '#1526': 1000 };
    expect(supplies.supplierSaleItems(bank)).toEqual(['air rune']);
    bank['#1751'] = 1000;
    bank.dragonhide = 1600;
    expect(supplies.supplierSaleItems(bank).sort()).toEqual(['#1751', 'air rune']);
});

test.each(['#1749', '#1753'])('sells hide %s and dragon bones independently in whole thousands', hide => {
    catalog();
    const bank = { [hide]: 2012, dragonhide: 2012, '#536': 1004, 'dragon bones': 1004 };
    expect(supplies.supplierSaleItems(bank).sort()).toEqual([hide, 'dragon bones']);
    expect(supplies.saleQuantity('Dragonhide', bank[hide], true)).toBe(2000);
    expect(supplies.saleQuantity('Dragon bones', bank['#536'], true)).toBe(1000);
});

test.each([{ id: 556, name: 'air rune' }, { id: 886, name: 'steel arrow' }])('reserves the banked stack before planning and withdrawing %o', async ({ id, name }) => {
    const bot = await seller(name);
    for (const [count, offer] of [[1000, 0], [1999, 0], [2000, 0], [2001, 1000], [2999, 1000], [3000, 2000], [6350, 5000]]) {
        const expected = offer ? [name] : [];
        expect(supplies.supplierSaleItems({ [name]: count })).toEqual(expected);
        expect(supplies.supplierSaleItems({ [name]: count, ['#' + id]: count })).toEqual(expected);
        expect(bot.dumpable([{ id, count }], true).map(row => row.count)).toEqual(offer ? [offer] : []);
    }
});

test('all whole thousands of the selected bank row enter the same trade', async () => {
    const bot = await seller('#1751');
    const rows = [{ id: 1751, count: 3250 }, { id: 1753, count: 1200 }, { id: 556, count: 5000 }];
    expect(bot.dumpable(rows, true).map(row => [row.id, row.count])).toEqual([[1751, 3000]]);
    expect(bot.dumpable([{ id: 1754, count: 3000 }])).toEqual([]);
    expect(bot.dumpable([{ id: 1752, count: 999 }])).toEqual([]);
    expect(bot.dumpable([{ id: 1752, count: 2000 }])).toEqual([]);
    expect(bot.dumpable([{ id: 1752, count: 3000 }])).toMatchObject([{ id: 1751, count: 3000 }]);
});

test.each(['paid', 'paid notes', 'short', 'wrong', 'extra', 'replaced before bid'])('supplier checks the confirmed lot and finishes a single paid sale: %s', async outcome => {
    const noted = outcome === 'paid notes';
    const paid = outcome.startsWith('paid');
    const bot = await seller(noted ? '#1751' : 'air rune');
    const finish = mock(() => {});
    bot.bindFinish(finish);
    const names: Record<number, string> = { 556: 'Air rune', 995: 'Coins', 1752: 'Dragonhide' };
    const item = (id: number, count: number): InvItemSnapshot => ({ id, count, slot: 0, comId: 3322, ops: [], name: names[id] });
    const lot = item(noted ? 1752 : 556, 3000);
    const bid = [item(995, 500)];
    let screen = 'offer';
    bot.dumpable([{ id: noted ? 1751 : 556, count: noted ? 3999 : 4999 }], true);
    spyOn(reader, 'tradePartner').mockReturnValue('Seers Market');
    spyOn(reader, 'tradeOfferOpen').mockImplementation(() => screen === 'offer');
    spyOn(reader, 'tradeConfirmOpen').mockImplementation(() => screen === 'confirm');
    spyOn(reader, 'tradeSidePack').mockReturnValue([]);
    let offerReads = 0;
    const replacement = item(1752, 3000);
    spyOn(reader, 'tradeMyOffer').mockImplementation(() => outcome === 'replaced before bid' && ++offerReads > 3 ? [replacement] : [lot]);
    spyOn(reader, 'tradeTheirOffer').mockReturnValue(bid);
    spyOn(reader, 'ifText').mockReturnValue('Other player has accepted.');
    spyOn(reader, 'tradeConfirmReady').mockReturnValue(true);
    const mine = outcome === 'short' ? [item(556, 2000)] : ['wrong', 'replaced before bid'].includes(outcome) ? [replacement] : outcome === 'extra' ? [lot, item(1752, 1)] : [lot];
    spyOn(reader, 'tradeConfirmOffers').mockReturnValue({ mine, theirs: bid });
    spyOn(Inventory, 'countById').mockImplementation(() => screen === 'paid' ? 500 : 0);
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Trade, 'decline').mockImplementation(async () => { screen = 'declined'; });
    spyOn(Trade, 'accept').mockImplementation(async () => { screen = screen === 'offer' ? 'confirm' : 'paid'; return true; });
    await bot['tasks'].find(task => task.constructor.name === 'Sell')!.execute();
    expect(screen).toBe(paid ? 'paid' : 'declined');
    expect(bot.gp).toBe(paid ? 500 : 0);
    expect(finish).toHaveBeenCalledTimes(paid ? 1 : 0);
});
