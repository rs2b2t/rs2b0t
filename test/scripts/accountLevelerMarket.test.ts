import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type ChatLine } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { Trade, type TradeItem } from '#/bot/api/trade/Trade.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { SeersAxeBuyer } from '#/bot/scripts/AccountLeveler/market.js';

afterEach(() => { mock.restore(); resetLiveCatalog(); });

function scenario() {
    const state = { stage: 'none', coins: 30000, axes: 0, chats: [] as ChatLine[], price: 18000,
        partner: 'seers market', seller: 'seers market', response: '1 x Rune axe = 18,000gp (18,000ea). Trade me.',
        theirs: [{ id: 1360, name: 'Rune axe', count: 1 }] as TradeItem[], mine: [] as TradeItem[],
        confirmTheirs: null as TradeItem[] | null, confirmMine: null as TradeItem[] | null,
        available: true, open: true, complete: true, accepts: 0, offers: [] as number[], walks: 0, messages: 0, delays: 0 };
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2725, 3491, 0));
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Inventory, 'free').mockReturnValue(4);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? state.coins : id === 1360 ? state.axes : 0);
    spyOn(reader, 'players').mockImplementation(() => state.available ? [{ index: 5, name: 'Seers market', tile: { x: 2725, z: 3491, level: 0 }, distance: 1, inCombat: false, combatLevel: 3, faceEntity: -1 }] : []);
    spyOn(reader, 'objCatalog').mockReturnValue([
        { id: 1359, name: 'Rune axe', cost: 12800, stackable: false, members: false, equippable: true, certlink: -1, certtemplate: -1 },
        { id: 1360, name: 'Rune axe', cost: 12800, stackable: true, members: false, equippable: false, certlink: 1359, certtemplate: 799 }
    ]);
    spyOn(reader, 'chat').mockImplementation(() => state.chats);
    spyOn(actions, 'sayPublic').mockImplementation(() => {
        state.messages++;
        if (state.response) state.chats.unshift({ type: 2, username: state.seller, text: state.response });
        return true;
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { state.walks++; return true; });
    spyOn(Execution, 'delay').mockImplementation(async () => { state.delays++; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Trade, 'active').mockImplementation(() => state.stage !== 'none');
    spyOn(Trade, 'onOfferScreen').mockImplementation(() => state.stage === 'offer');
    spyOn(Trade, 'onConfirmScreen').mockImplementation(() => state.stage === 'confirm');
    spyOn(Trade, 'partner').mockImplementation(() => state.partner);
    spyOn(Trade, 'myOffer').mockImplementation(() => state.mine);
    spyOn(Trade, 'theirOffer').mockImplementation(() => state.theirs);
    spyOn(reader, 'tradeConfirmReady').mockReturnValue(true);
    spyOn(reader, 'tradeConfirmOffers').mockImplementation(() => ({ mine: state.confirmMine ?? state.mine, theirs: state.confirmTheirs ?? state.theirs }) as ReturnType<typeof reader.tradeConfirmOffers>);
    spyOn(Trade, 'request').mockImplementation(async () => { if (state.open) state.stage = 'offer'; return true; });
    spyOn(Trade, 'offer').mockImplementation(async (_item, count) => {
        state.offers.push(count);
        state.mine = [{ id: 995, name: 'Coins', count }];
        return true;
    });
    spyOn(Trade, 'accept').mockImplementation(async () => {
        state.accepts++;
        if (state.stage === 'offer') state.stage = 'confirm';
        else if (state.complete) { state.stage = 'none'; state.coins -= state.price; state.axes++; }
        return true;
    });
    spyOn(Trade, 'decline').mockImplementation(async () => { state.stage = 'none'; });
    return { state, buyer: new SeersAxeBuyer(), buy: { item: 'Rune axe', maxPrice: 20000, world: 1 } };
}

test('buys one authenticated noted axe at the quoted price and checks the receipt', async () => {
    const { state, buyer, buy } = scenario();
    expect(await buyer.buy(buy)).toBe(true);
    expect(state.offers).toEqual([18000]);
    expect(state.accepts).toBe(2);
    expect(state.axes).toBe(1);
    expect(state.coins).toBe(12000);
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.messages).toBe(1);
});

test.each(['absent', 'sold out', 'silent', 'busy', 'world', 'budget', 'reserve', 'foreign quote', 'stale quote'])('optional market miss continues without spending: %s', async reason => {
    const { state, buyer, buy } = scenario();
    if (reason === 'absent') state.available = false;
    if (reason === 'sold out') state.response = 'I have no Rune axe right now.';
    if (reason === 'silent') state.response = '';
    if (reason === 'busy') state.open = false;
    if (reason === 'world') buy.world = 2;
    if (reason === 'budget') buy.maxPrice = 17000;
    if (reason === 'reserve') state.coins = 18100;
    if (reason === 'foreign quote') state.seller = 'another seller';
    if (reason === 'stale quote') {
        state.chats.push({ type: 2, username: state.seller, text: state.response });
        state.response = '';
    }
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.offers).toEqual([]);
    expect(state.accepts).toBe(0);
    expect(state.delays).toBeLessThanOrEqual(100);
    expect(state.walks).toBeLessThanOrEqual(1);
    if (reason === 'world') expect(state.messages).toBe(0);
});

test.each(['partner', 'wrong item', 'extra item', 'extra quantity', 'confirm item', 'confirm coins', 'empty confirm'])('rejects a changed or incorrect trade: %s', async change => {
    const { state, buyer, buy } = scenario();
    if (change === 'partner') state.partner = 'another seller';
    if (change === 'wrong item') state.theirs = [{ id: 1351, name: 'Rune axe', count: 1 }];
    if (change === 'extra item') state.theirs.push({ id: 1351, name: 'Bronze axe', count: 1 });
    if (change === 'extra quantity') state.theirs[0].count = 2;
    if (change === 'confirm item') state.confirmTheirs = [{ id: 1351, name: 'Rune axe', count: 1 }];
    if (change === 'confirm coins') state.confirmMine = [{ id: 995, name: 'Coins', count: 20000 }];
    if (change === 'empty confirm') state.confirmTheirs = [];
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.accepts).toBeLessThan(2);
    expect(state.coins).toBe(30000);
    expect(state.stage).toBe('none');
});

test('a seller that never confirms times out and is not retried', async () => {
    const { state, buyer, buy } = scenario();
    state.complete = false;
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.delays).toBeLessThanOrEqual(100);
    expect(state.stage).toBe('none');
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.messages).toBe(1);
});

test('travel costs do not invalidate the verified trade receipt', async () => {
    const { state, buyer, buy } = scenario();
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { state.coins -= 100; return true; });
    expect(await buyer.buy(buy)).toBe(true);
    expect(state.coins).toBe(11900);
});

test('a closed trade without an item receipt is not reported as a purchase', async () => {
    const { state, buyer, buy } = scenario();
    spyOn(Trade, 'accept').mockImplementation(async () => { state.stage = 'none'; return true; });
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.axes).toBe(0);
    expect(state.coins).toBe(30000);
});

test('an event during the trade returns the coins without accepting', async () => {
    const { state, buyer, buy } = scenario();
    spyOn(EventSignal, 'pending').mockImplementation(() => state.mine.length > 0);
    expect(await buyer.buy(buy)).toBe(false);
    expect(state.accepts).toBe(0);
    expect(state.stage).toBe('none');
});


test('a new quote identical to an older chat line is still eligible', async () => {
    const { state, buyer, buy } = scenario();
    state.chats.push({ type: 2, username: state.seller, text: state.response });
    expect(await buyer.buy(buy)).toBe(true);
});
