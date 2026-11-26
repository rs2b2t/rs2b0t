import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type ChatLine } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { Trade, type TradeItem } from '#/bot/api/trade/Trade.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { marketOrderQuantity } from '#/bot/scripts/AccountLeveler/marketLots.js';
import { gatheringTool, rangedArmour, rangedBow } from '#/bot/scripts/AccountLeveler/equipment.js';
import { rangingGuildPlan } from '#/bot/scripts/AccountLeveler/rangingGuild.js';
import { emptyMemory, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { buyMarketItem, marketItemId, MARKET_COOLDOWN, MARKET_PREFIX, SEERS_MARKET_STAND } from '#/bot/scripts/AccountLeveler/market.js';

afterEach(() => { mock.restore(); resetLiveCatalog(); });

function scenario() {
    const state = { stage: 'none', coins: 30000, purse: 0, bankOpen: false, axes: 0, chats: [] as ChatLine[], price: 18000,
        partner: 'seers market', seller: 'seers market', response: '1 x Rune axe = 18,000gp (18,000ea). Trade me.',
        theirs: [{ id: 1360, name: 'Rune axe', count: 1 }] as TradeItem[], mine: [] as TradeItem[],
        confirmTheirs: null as TradeItem[] | null, confirmMine: null as TradeItem[] | null,
        available: true, open: true, complete: true, accepts: 0, offers: [] as number[], walks: 0, messages: 0, delays: 0 };
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'myName').mockReturnValue('Buyer');
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2725, 3491, 0));
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Inventory, 'free').mockReturnValue(4);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? state.purse : id === 1360 ? state.axes : 0);
    spyOn(Bank, 'openNearest').mockImplementation(async () => { state.bankOpen = true; return true; });
    spyOn(Bank, 'isOpen').mockImplementation(() => state.bankOpen);
    spyOn(Bank, 'count').mockImplementation(() => state.coins - state.purse);
    spyOn(Bank, 'withdrawX').mockImplementation(async (_name, count) => {
        if (!state.bankOpen || count > state.coins - state.purse) return false;
        state.purse += count;
        return true;
    });
    spyOn(Bank, 'depositXById').mockImplementation(async (_id, count) => { state.purse -= count; return true; });
    spyOn(Bank, 'close').mockImplementation(async () => { state.bankOpen = false; return true; });
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
        else if (state.complete) { state.stage = 'none'; state.coins -= state.price; state.purse -= state.price; state.axes++; }
        return true;
    });
    spyOn(Trade, 'decline').mockImplementation(async () => { state.stage = 'none'; });
    return { state, buy: { id: 1359, quantity: 1, world: 1 } };
}

test('buys one authenticated noted axe at the quoted price and checks the receipt', async () => {
    const { state, buy } = scenario();
    expect(await buyMarketItem(buy)).toBe('bought');
    expect(state.offers).toEqual([18000]);
    expect(state.accepts).toBe(2);
    expect(state.axes).toBe(1);
    expect(state.coins).toBe(12000);
    expect(state.messages).toBe(1);
});

test.each(['absent', 'sold out', 'silent', 'busy', 'world', 'insufficient coins', 'reserve', 'foreign quote', 'stale quote'])('optional market miss continues without spending: %s', async reason => {
    const { state, buy } = scenario();
    if (reason === 'absent') state.available = false;
    if (reason === 'sold out') state.response = 'I have no Rune axe right now.';
    if (reason === 'silent') state.response = '';
    if (reason === 'busy') state.open = false;
    if (reason === 'world') buy.world = 2;
    if (reason === 'insufficient coins') state.coins = 17000;
    if (reason === 'reserve') state.coins = 18100;
    if (reason === 'foreign quote') state.seller = 'another seller';
    if (reason === 'stale quote') {
        state.chats.push({ type: 2, username: state.seller, text: state.response });
        state.response = '';
    }
    expect(await buyMarketItem(buy)).toBe(['absent', 'sold out', 'insufficient coins', 'reserve'].includes(reason) ? 'unavailable' : 'retry');
    expect(state.offers).toEqual([]);
    expect(state.accepts).toBe(0);
    expect(state.delays).toBeLessThanOrEqual(480);
    expect(state.walks).toBeLessThanOrEqual(1);
    if (reason === 'world') expect(state.messages).toBe(0);
});

test.each(['partner', 'wrong item', 'extra item', 'extra quantity', 'confirm item', 'confirm coins', 'empty confirm'])('rejects a changed or incorrect trade: %s', async change => {
    const { state, buy } = scenario();
    if (change === 'partner') state.partner = 'another seller';
    if (change === 'wrong item') state.theirs = [{ id: 1351, name: 'Rune axe', count: 1 }];
    if (change === 'extra item') state.theirs.push({ id: 1351, name: 'Bronze axe', count: 1 });
    if (change === 'extra quantity') state.theirs[0].count = 2;
    if (change === 'confirm item') state.confirmTheirs = [{ id: 1351, name: 'Rune axe', count: 1 }];
    if (change === 'confirm coins') state.confirmMine = [{ id: 995, name: 'Coins', count: 20000 }];
    if (change === 'empty confirm') state.confirmTheirs = [];
    expect(await buyMarketItem(buy)).toBe('retry');
    expect(state.accepts).toBeLessThan(2);
    expect(state.coins).toBe(30000);
    expect(state.purse).toBe(0);
    expect(state.stage).toBe('none');
});

test('a seller that never confirms times out and the trade closes', async () => {
    const { state, buy } = scenario();
    state.complete = false;
    expect(await buyMarketItem(buy)).toBe('retry');
    expect(state.delays).toBeLessThanOrEqual(100);
    expect(state.stage).toBe('none');
    expect(state.messages).toBe(1);
});

test('the buyer reaches Seers empty-handed and withdraws the quoted price only after arrival', async () => {
    const { state, buy } = scenario();
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        expect(state.purse).toBe(0);
        expect(Bank.withdrawX).not.toHaveBeenCalled();
        return true;
    });
    state.coins = 45150903;
    expect(await buyMarketItem(buy)).toBe('bought');
    expect(spyOn(Bank, 'withdrawX').mock.calls).toEqual([['Coins', 18000]]);
    expect(state.coins).toBe(45150903 - 18000);
    expect(state.purse).toBe(0);
});

test('a closed trade without an item receipt is not reported as a purchase', async () => {
    const { state, buy } = scenario();
    spyOn(Trade, 'accept').mockImplementation(async () => { state.stage = 'none'; return true; });
    expect(await buyMarketItem(buy)).toBe('retry');
    expect(state.axes).toBe(0);
    expect(state.coins).toBe(30000);
});

test('an event during the trade returns the coins without accepting', async () => {
    const { state, buy } = scenario();
    spyOn(EventSignal, 'pending').mockImplementation(() => state.mine.length > 0);
    expect(await buyMarketItem(buy)).toBe('retry');
    expect(state.accepts).toBe(0);
    expect(state.stage).toBe('none');
});


test('a new quote identical to an older chat line is still eligible', async () => {
    const { state, buy } = scenario();
    state.chats.push({ type: 2, username: state.seller, text: state.response });
    expect(await buyMarketItem(buy)).toBe('bought');
});

function gearMarket() {
    const { state } = scenario();
    const bow = { id: 861, name: 'Magic shortbow', cost: 1536, stackable: false, members: true, equippable: true, certlink: -1, certtemplate: -1 };
    spyOn(reader, 'objCatalog').mockReturnValue([bow, { ...bow, id: 72, equippable: false },
        { ...bow, id: 2499, name: 'Dragonhide body' }, { ...bow, id: 2501, name: 'Dragonhide body' },
        { ...bow, id: 2487, name: 'Dragon vambraces' }, { ...bow, id: 2493, name: 'Dragonhide chaps' }]);
    const cooldowns: Record<string, number> = {};
    const snapshot: LevelerSnapshot = { levels: { ranged: 50, defence: 40 }, stock: { coins: 80000, '#72': 1, '#853': 1 },
        bankReady: true, quests: {}, target: 70, wilderness: false, now: 1000,
        marketItem: need => marketItemId(need, cooldowns, snapshot.now) };
    return { state, snapshot, cooldowns };
}

test('Seers can supply the strung bow and each wearable dragonhide slot independently', () => {
    const { snapshot, cooldowns } = gearMarket();
    expect(rangedBow(snapshot).id).toBe(861);
    expect(rangedArmour(snapshot).map(need => need.id)).toEqual([2499, 2493, 2487]);
    const guild = rangingGuildPlan(snapshot, emptyMemory())!;
    expect(guild.needs.filter(need => need.equip).map(need => need.id)).toEqual([861, 2499, 2493, 2487]);
    expect(resolveActivity(snapshot, guild, emptyMemory(), () => 0)).toMatchObject({ plan: { script: 'SeersMarket', output: { id: 861 } } });
    snapshot.levels.defence = 39;
    expect(rangedArmour(snapshot).map(need => need.id)).toEqual([2493, 2487]);
    cooldowns[MARKET_PREFIX + 861] = snapshot.now + MARKET_COOLDOWN;
    expect(rangedBow(snapshot).id).toBe(853);
    expect(rangedArmour(snapshot).map(need => need.id)).toEqual([2493, 2487]);
    snapshot.now += MARKET_COOLDOWN;
    expect(rangedBow(snapshot).id).toBe(861);
});

test('market asks for the exact colour and refuses a same-named substitute', async () => {
    const { state } = gearMarket();
    state.response = '1 x Blue dragonhide body = 18,000gp (18,000ea). Trade me.';
    state.theirs = [{ id: 2501, name: 'Dragonhide body', count: 1 }];
    expect(await buyMarketItem({ id: 2499, quantity: 1, world: 1 })).toBe('retry');
    expect(actions.sayPublic).toHaveBeenCalledWith('buying 1 Blue dragonhide body');
    expect(state.accepts).toBe(0);
});

test('a partial quote buys only the offered quantity at the quoted total', async () => {
    const { state, buy } = scenario();
    state.response = '2 x Rune axe = 18,000gp (9,000ea). Trade me.';
    state.theirs[0].count = 2;
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? state.purse : id === 1360 ? 2 * state.axes : 0);
    expect(await buyMarketItem({ ...buy, id: 1359, quantity: 3 })).toBe('bought');
    expect(state.offers).toEqual([18000]);
});

test('NPC stock takes priority, and a missing market supply is banked before the queued activity', () => {
    const { snapshot } = gearMarket();
    const plan: ActivityPlan = { id: 'train', script: 'AutoFighter', label: 'Train', objective: 'ranged', settings: {},
        needs: [{ item: 'Bronze arrow', count: 10 }, { item: 'Magic shortbow', id: 861, count: 2 }] };
    snapshot.marketItem = need => need.item === 'Bronze arrow' ? 882 : 861;
    snapshot.stock['#861'] = 1;
    const decision = resolveActivity(snapshot, plan, emptyMemory(), () => 0);
    expect(decision).toMatchObject({ kind: 'activity', plan: { script: 'SeersMarket', output: { id: 861, count: 1 } } });
    if (decision.kind === 'activity') expect(decision.queue[1]).toBe(plan);
    snapshot.stock['#861']++;
    expect(resolveActivity(snapshot, plan, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'AutoFighter' } });
    snapshot.unavailableItems = ['bronze arrow'];
    expect(resolveActivity(snapshot, plan, emptyMemory(), () => 0)).toMatchObject({ plan: { script: 'SeersMarket', output: { id: 882, count: 1000 } } });
});

test('market shopping leaves the queued activity funds available even above the old cap', async () => {
    const { state } = scenario();
    const bot = new AccountLeveler();
    const snapshot: LevelerSnapshot = { levels: {}, stock: { coins: 510000 }, bankReady: true, quests: {}, target: 70, wilderness: false, now: 1000 };
    state.coins = 510000;
    state.price = 500000;
    state.response = '1 x Rune axe = 500,000gp (500,000ea). Trade me.';
    spyOn(bot['supplies'], 'bank').mockResolvedValue(true);
    const departure = spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true);
    spyOn(bot['supplies'], 'deposit').mockResolvedValue();
    const withdraw = spyOn(bot['supplies'], 'withdraw').mockImplementation(async (_name, count) => { state.coins = count; return true; });
    const next: ActivityPlan = { id: 'craft-laws', label: 'Craft law runes', objective: 'runecrafting', script: 'JiveRC', settings: {}, needs: [{ item: 'Air rune', count: 5 }] };
    expect(await bot['buyMarketSupply'](snapshot, { item: 'Rune axe', id: 1359, count: 1 }, 10000, undefined, [next])).toBe(true);
    expect(departure).toHaveBeenCalledWith(SEERS_MARKET_STAND, next.needs);
    expect(withdraw).not.toHaveBeenCalled();
    expect(spyOn(Bank, 'withdrawX').mock.calls).toEqual([['Coins', 500000]]);
    expect(state.offers).toEqual([500000]);
});

test.each(['sold out', 'busy'])('a market %s deadline survives a leveler restart', async reason => {
    const { state, snapshot } = gearMarket();
    state.response = reason === 'sold out' ? 'I have no Magic shortbow right now.' : '1 x Magic shortbow = 5,000gp (5,000ea). Give me a moment.';
    const now = spyOn(Date, 'now').mockReturnValue(snapshot.now);
    const bot = new AccountLeveler();
    bot['shoppingChecked'] = true;
    bot['retry'] = { id: 'range', script: 'AutoFighter', objective: 'ranged', label: 'Train', settings: {}, needs: [rangedBow(snapshot)] };
    bot['snapshot'] = () => snapshot;
    spyOn(bot['supplies'], 'bank').mockResolvedValue(true);
    spyOn(bot['supplies'], 'deposit').mockResolvedValue();
    spyOn(bot['supplies'], 'withdraw').mockResolvedValue(true);
    spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true);
    spyOn(Game, 'myName').mockReturnValue('Shopper');
    const store = new Map<string, string>();
    bot['storage'] = () => ({ getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } });
    snapshot.levels = { ...snapshot.levels, attack: 70, strength: 70, defence: 70, hitpoints: 70, magic: 70, prayer: 70 };
    await bot['selectAndStart']();
    const restarted = new AccountLeveler();
    restarted['storage'] = bot['storage'];
    restarted['load']();
    const until = snapshot.now + (reason === 'sold out' ? 60 : 1) * 60000;
    expect(restarted['session'].memory.cooldowns[MARKET_PREFIX + 861]).toBe(until);
    expect(marketItemId(rangedBow(snapshot), restarted['session'].memory.cooldowns, until - 1)).toBeUndefined();
    expect(marketItemId(rangedBow(snapshot), restarted['session'].memory.cooldowns, until)).toBe(861);
    now.mockReturnValue(until);
    restarted['load']();
    expect(restarted['session'].memory.cooldowns[MARKET_PREFIX + 861]).toBeUndefined();
});

test.each(['bought', 'sold out', 'legacy cap', 'legacy zero', 'other world', 'already owned'])('startup axe shopping from Lumbridge: %s', async outcome => {
    const { state } = scenario();
    const bot = new AccountLeveler();
    let now = 1000;
    spyOn(Date, 'now').mockImplementation(() => now);
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const world = outcome === 'other world' ? 2 : 1;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { host: 'localhost', search: '?world=' + world } });
    let bankedAxe = outcome === 'already owned';
    spyOn(Game, 'tile').mockImplementation(() => state.walks ? new Tile(2725, 3491, 0) : new Tile(3208, 3220, 0));
    spyOn(Game, 'myName').mockReturnValue(null);
    spyOn(Skills, 'level').mockImplementation(skill => skill === 'woodcutting' ? 15 : 70);
    spyOn(Bank, 'ready').mockReturnValue(true);
    spyOn(Bank, 'items').mockImplementation(() => [
        { id: 995, name: 'Coins', count: 300000, slot: 0, comId: 5382, ops: [] },
        ...(bankedAxe ? [{ id: 1359, name: 'Rune axe', count: 1, slot: 1, comId: 5382, ops: [] }] : [])
    ]);
    spyOn(Inventory, 'items').mockReturnValue([]);
    spyOn(Equipment, 'items').mockReturnValue([]);
    const withdraw = spyOn(bot['supplies'], 'withdraw').mockImplementation(async (_item, count) => { state.coins = count; return true; });
    spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true);
    spyOn(bot['supplies'], 'deposit').mockImplementation(async () => { if (state.axes) bankedAxe = true; });
    state.coins = 300000;
    state.price = 275000;
    state.response = '1 x Rune axe = 275,000gp (275,000ea). Trade me.';
    if (outcome === 'bought') bot.settings = new SettingsBag({ marketAxes: false, marketAxeBudget: 50000 });
    if (outcome === 'legacy cap') bot.settings = new SettingsBag({ marketBudget: 50000 });
    if (outcome === 'legacy zero') bot.settings = new SettingsBag({ marketBudget: 0 });
    const checked = ['bought', 'sold out', 'legacy cap', 'legacy zero'].includes(outcome);
    const visits = checked ? 2 : 1;
    let banks = 0;
    spyOn(bot['supplies'], 'bank').mockImplementation(async () => {
        if (++banks > visits) throw new Error('next provisioning visit');
        return true;
    });
    spyOn(ScriptRegistry, 'get').mockReturnValue({ name: 'Woodcutter', description: '', create: () => bot });
    if (outcome === 'sold out') state.response = 'I have no Rune axe right now.';
    try {
        await expect(bot['selectAndStart']()).rejects.toThrow('next provisioning visit');
        expect(state.messages).toBe(checked ? 1 : 0);
        expect(withdraw).not.toHaveBeenCalled();
        if (checked && outcome !== 'sold out') expect(spyOn(Bank, 'withdrawX').mock.calls).toEqual([['Coins', 275000]]);
        else expect(Bank.withdrawX).not.toHaveBeenCalled();
        expect(bankedAxe).toBe(['bought', 'already owned', 'legacy cap', 'legacy zero'].includes(outcome));
        const plan = bot['displayPlan']!;
        expect(plan.needs.map(need => need.item)).toContain(bankedAxe ? 'Rune axe' : 'Steel axe');
        expect(plan.id === 'stock-up').toBe(!bankedAxe);
        if (outcome === 'sold out') {
            const woodcutting = { id: 'wood', script: 'Woodcutter', label: 'Woodcutting', objective: 'woodcutting', settings: {} };
            const next = () => {
                const s = bot['snapshot']();
                return resolveActivity(s, { ...woodcutting, needs: [gatheringTool(s, 'axe')] }, bot['session'].memory, () => 0);
            };
            now += MARKET_COOLDOWN - 1;
            expect(next()).toMatchObject({ plan: { script: 'Woodcutter', needs: [{ item: 'Steel axe' }] } });
            now++;
            expect(next()).toMatchObject({ plan: { script: 'SeersMarket', output: { id: 1359, count: 1 } } });
        }
    } finally {
        if (previous) Object.defineProperty(globalThis, 'location', previous);
        else Reflect.deleteProperty(globalThis, 'location');
    }
});

test('a bank fetch waits for the invitation naming this buyer and item', async () => {
    const { state, buy } = scenario();
    state.response = state.response.replace('Trade me.', 'Give me a moment.');
    const cues = new Map([
        [3, 'Got your Rune axe. Trade me, Another Buyer.'],
        [4, 'Got your Magic shortbow. Trade me, Buyer.'],
        [55, 'Got your Rune axe. Trade me, Buyer.']
    ]);
    spyOn(Execution, 'delay').mockImplementation(async () => {
        const cue = cues.get(++state.delays);
        if (cue) state.chats.unshift({ type: 2, username: state.seller, text: cue });
        if (state.delays <= 55) expect(Trade.request).not.toHaveBeenCalled();
    });
    expect(await buyMarketItem(buy)).toBe('bought');
    expect(Trade.request).toHaveBeenCalledTimes(1);
    expect(state.messages).toBe(1);
});

test('a queued buyer lets the first customer finish before refreshing the trade request', async () => {
    const { state, buy } = scenario();
    state.open = false;
    spyOn(Execution, 'delay').mockImplementation(async () => {
        state.delays++;
        if (state.delays === 3) state.chats.unshift({ type: 2, username: state.seller, text: 'Buyer, serving First first. One moment.' });
        if (state.delays > 3 && state.delays <= 70) expect(Trade.request).toHaveBeenCalledTimes(1);
        if (state.delays === 70) {
            state.open = true;
            state.chats.unshift({ type: 2, username: state.seller, text: 'Thanks First. Pleasure doing business.' });
        }
    });
    expect(await buyMarketItem(buy)).toBe('bought');
    expect(Trade.request).toHaveBeenCalledTimes(2);
    expect(state.messages).toBe(1);
});

test('a suppressed quote is asked for again after the maker repeat interval', async () => {
    const { state, buy } = scenario();
    spyOn(actions, 'sayPublic').mockImplementation(() => {
        if (++state.messages === 2) {
            expect(state.delays * 500).toBeGreaterThan(15000);
            state.chats.unshift({ type: 2, username: state.seller, text: state.response });
        }
        return true;
    });
    expect(await buyMarketItem(buy)).toBe('bought');
    expect(state.messages).toBe(2);
});

test('a named partial fetch pays only for the reduced quantity at the quoted unit price', async () => {
    const { state, buy } = scenario();
    state.response = '3 x Rune axe = 18,000gp (6,000ea). Give me a moment.';
    state.price = 6000;
    spyOn(Execution, 'delay').mockImplementation(async () => {
        if (++state.delays === 5) state.chats.unshift({ type: 2, username: state.seller, text: 'I could only get 1 x Rune axe. Trade me, Buyer.' });
    });
    expect(await buyMarketItem({ ...buy, quantity: 3 })).toBe('bought');
    expect(state.offers).toEqual([6000]);
    expect(spyOn(Bank, 'withdrawX').mock.calls).toEqual([['Coins', 6000]]);
});

test.each([
    { item: 'Lobster', id: 379, count: 1000 }, { item: 'Shark', id: 385, count: 1000 },
    { item: 'Raw shark', id: 383, count: 1000 }, { item: 'Raw lobster', id: 377, count: 1000 },
    { item: 'Raw trout', id: 335, count: 1000 }, { item: 'Raw beef', id: 2132, count: 1000 }, { item: 'Manta ray', id: 391, count: 1000 }, { item: 'Law rune', id: 563, count: 1000 },
    { item: 'Rune essence', id: 1436, count: 1000 }, { item: 'Iron ore', id: 440, count: 1000 },
    { item: 'Coal', id: 453, count: 1000 }, { item: 'Steel bar', id: 2353, count: 1000 }, { item: 'Yew logs', id: 1515, count: 1000 },
    { item: 'Green dragon leather', id: 1745, count: 1000 }, { item: 'Dragon bones', id: 536, count: 1000 },
    { item: 'Kwuarm', id: 213, count: 1000 }, { item: '#199', id: 199, count: 1000 },
    { item: 'Prayer potion(4)', id: 2434, count: 1000 }, { item: 'Ruby', id: 1603, count: 1000 }
])('Seers order size for $item leaves the activity loadout intact', ({ item, id, count }) => {
    const { snapshot } = gearMarket();
    snapshot.marketItem = () => id;
    snapshot.stock[item.toLowerCase()] = 23;
    const plan: ActivityPlan = { id: 'train', label: 'Training', objective: 'defence', script: 'AutoFighter',
        settings: {}, needs: [{ item, count: 24, carry: 12 }] };
    const result = resolveActivity(snapshot, plan, emptyMemory(), () => 0);
    expect(result).toMatchObject({ plan: { script: 'SeersMarket', output: { id, count } }, queue: [{}, { needs: [{ item, count: 24, carry: 12 }] }] });
    plan.needs[0].count = 1523;
    expect(resolveActivity(snapshot, plan, emptyMemory(), () => 0)).toMatchObject({ plan: { output: { id, count: 2000 } } });
    plan.needs[0].count = 24;
    snapshot.stock[item.toLowerCase()]++;
    expect(resolveActivity(snapshot, plan, emptyMemory(), () => 0)).toMatchObject({ plan: { script: 'AutoFighter' } });
});

test.each([{ unit: 1300, outcome: 'bought' as const }, { unit: 1301, outcome: 'unavailable' as const }])('a 1000-lobster order at $unit gp each uses the coins available after travel', async ({ unit, outcome }) => {
    const { state } = scenario();
    const lobster = { id: 379, name: 'Lobster', cost: 70, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1 };
    spyOn(reader, 'objCatalog').mockReturnValue([lobster, { ...lobster, id: 380, stackable: true, certlink: 379, certtemplate: 799 }]);
    state.coins = 1300200;
    state.price = unit * 1000;
    state.response = `1,000 x Lobster = ${state.price.toLocaleString('en-US')}gp (${unit}ea). Trade me.`;
    state.theirs = [{ id: 380, name: 'Lobster', count: 1000 }];
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? state.purse : id === 380 ? state.axes * 1000 : 0);
    expect(await buyMarketItem({ id: 379, quantity: 1000, world: 1 })).toBe(outcome);
    expect(actions.sayPublic).toHaveBeenCalledWith('buying 1000 Lobster');
    expect(state.offers).toEqual(outcome === 'bought' ? [1300000] : []);
});

test.each(['initial quote', 'bank fetch'])('a food fill below 1,000 in the %s leaves the coins alone', async phase => {
    const { state } = scenario();
    const fish = { id: 377, name: 'Raw lobster', cost: 70, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1 };
    spyOn(reader, 'objCatalog').mockReturnValue([fish, { ...fish, id: 378, stackable: true, certlink: 377, certtemplate: 799 }]);
    state.response = phase === 'initial quote' ? '600 x Raw lobster = 600gp (1ea). Trade me.' : '1,000 x Raw lobster = 1,000gp (1ea). Give me a moment.';
    state.theirs = [{ id: 378, name: 'Raw lobster', count: 600 }];
    spyOn(Execution, 'delay').mockImplementation(async () => {
        if (++state.delays === 3 && phase === 'bank fetch') state.chats.unshift({ type: 2, username: state.seller, text: 'I could only get 600 x Raw lobster. Trade me, Buyer.' });
    });
    expect(await buyMarketItem({ id: 377, quantity: 1000, world: 1 })).toBe('unavailable');
    expect(state.offers).toEqual([]);
});

test.each(['initial quote', 'bank fetch'])('a 1,500-essence %s gets a new quote for one complete lot', async phase => {
    const { state } = scenario();
    const essence = { id: 1436, name: 'Rune essence', cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1 };
    spyOn(reader, 'objCatalog').mockReturnValue([essence, { ...essence, id: 1437, stackable: true, certlink: 1436, certtemplate: 799 }]);
    spyOn(actions, 'sayPublic').mockImplementation(message => {
        const reply = message === 'buying 1000 Rune essence' ? '1,000 x Rune essence = 5,000gp (5ea). Trade me.'
            : phase === 'initial quote' ? '1,500 x Rune essence = 7,500gp (5ea). Trade me.' : '2,000 x Rune essence = 10,000gp (5ea). Give me a moment.';
        state.chats.unshift({ type: 2, username: state.seller, text: reply });
        return true;
    });
    spyOn(Execution, 'delay').mockImplementation(async () => {
        if (++state.delays === 3 && phase === 'bank fetch') state.chats.unshift({ type: 2, username: state.seller, text: 'I could only get 1,500 x Rune essence. Trade me, Buyer.' });
    });
    state.price = 5000;
    state.theirs = [{ id: 1437, name: 'Rune essence', count: 1000 }];
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? state.purse : id === 1437 ? state.axes * 1000 : 0);
    expect(await buyMarketItem({ id: 1436, quantity: 1001, world: 1 })).toBe('bought');
    expect(spyOn(actions, 'sayPublic').mock.calls.map(([message]) => message)).toEqual(['buying 2000 Rune essence', 'buying 1000 Rune essence']);
    expect(state.offers).toEqual([5000]);
});

test('Seers keeps exact resource lots and buys individual access items and equipment', () => {
    for (const count of [1000, 2000]) expect(marketOrderQuantity('Rune essence', count)).toBe(count);
    for (const item of ['Nature talisman', 'Rune pickaxe', 'Amulet of glory(4)', 'Dragonhide body', 'Diamond', 'Uncut diamond']) {
        expect(marketOrderQuantity(item, 1)).toBe(1);
    }
});

test('rejects an alchable quote exceeding its cap before withdrawing coins', async () => {
    const { buy, state } = scenario();
    expect(await buyMarketItem({ ...buy, maxUnitPrice: 17999 })).toBe('unavailable');
    expect(Bank.withdrawX).not.toHaveBeenCalled();
    expect(state.offers).toEqual([]);
    expect(await buyMarketItem({ ...buy, maxUnitPrice: 18000 })).toBe('bought');
});
