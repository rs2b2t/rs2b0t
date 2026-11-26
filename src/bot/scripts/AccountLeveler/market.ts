import { resolveWorldNumber } from '../../../client/config/worlds.js';
import { actions, reader, type ChatLine } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { displayName, liveCatalog, resolveByName } from '../../api/market/catalog.js';
import { Players } from '../../api/players/Players.js';
import { namesMatch } from '../../api/trade/PartnerTrade.js';
import { Trade, type TradeItem } from '../../api/trade/Trade.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { levelerTravelZones } from './travel.js';
import { marketLotSize, marketOrderQuantity } from './marketLots.js';
import { SHOPPING_RESERVE } from './shopping.js';
import Tile from '../../geometry/Tile.js';

export const MAKER = 'seers market';
export const SEERS_MARKET_STAND = new Tile(2725, 3491, 0);
export const RUNE_AXE_ID = 1359;
const COINS = 995;
export const MARKET_PREFIX = 'seers-market:';
export const MARKET_COOLDOWN = 60 * 60_000;

export function marketItemId(need: { item: string; id?: number }, cooldowns: Record<string, number>, now: number): number | undefined {
    if (need.item.toLowerCase() === 'coins') return;
    const hits = resolveByName(liveCatalog(), need.id === undefined ? need.item : '#' + need.id, { exactOnly: true });
    if (hits.length !== 1) return;
    const { id, name } = hits[0];
    if (need.id === undefined && need.item !== '#' + id && need.item.toLowerCase() !== name.toLowerCase()) return;
    if (id !== COINS && !(cooldowns[MARKET_PREFIX + id] > now)) return id;
}

interface MarketRequest {
    world: number;
    reserve?: number;
    maxUnitPrice?: number;
    log?: (message: string) => void;
}

function safe(): boolean {
    return Game.sceneReady() && !Game.inCombat() && !EventSignal.pending();
}

function signature(line: ChatLine): string {
    return `${line.type}|${line.username}|${line.text}`;
}

function exact(items: readonly TradeItem[], ids: readonly number[], count: number): boolean {
    return items.length > 0 && items.every(item => ids.includes(item.id) && item.count > 0)
        && items.reduce((total, item) => total + item.count, 0) === count;
}

type MarketMiss = 'unavailable' | 'retry';
type MarketQuote = { quantity: number; unit: number };
const POLL_MS = 500;

function readQuote(reply: string, item: string): (MarketQuote & { ready: boolean }) | undefined {
    const match = /^([\d,]+) x (.+?) = ([\d,]+)gp \(([\d,]+)ea\)\. (trade me\.|give me a moment\.)$/.exec(reply);
    if (!match || match[2] !== item) return;
    const quantity = Number(match[1].replaceAll(',', ''));
    const price = Number(match[3].replaceAll(',', ''));
    const unit = Number(match[4].replaceAll(',', ''));
    if (!Number.isSafeInteger(price) || quantity <= 0 || unit <= 0 || price !== quantity * unit) return;
    return { quantity, unit, ready: match[5] === 'trade me.' };
}

export function marketWorld() {
    if (typeof location !== 'undefined' && (location.host || location.search)) {
        return resolveWorldNumber(location.host || 'localhost', new URLSearchParams(location.search));
    }
}

export function atMarket(here = Game.tile()): boolean {
    return here !== null && SEERS_MARKET_STAND.distanceTo(here) <= 5;
}

async function fundQuote(price: number, reserve: number, log?: MarketRequest['log']): Promise<MarketMiss | undefined> {
    if (!safe() || !atMarket() || Trade.active()) return 'retry';
    const held = Inventory.countById(COINS);
    if (held === price) return;
    if (!(await Bank.openNearest('Bank booth', 'Use-quickly', log))) return 'retry';
    try {
        if (!safe() || !atMarket()) return 'retry';
        if (Bank.count('Coins') + held - reserve < price) return 'unavailable';
        if (held < price) {
            log?.(`Withdrawing ${price - held} coins at Seers bank for the quoted total of ${price}`);
            if (!(await Bank.withdrawX('Coins', price - held))) return 'retry';
        } else if (!(await Bank.depositXById(COINS, held - price))) return 'retry';
    } finally {
        await Bank.close();
    }
    if (!safe() || !atMarket() || Bank.isOpen() || Inventory.countById(COINS) !== price) return 'retry';
}

async function openMarketOrder(item: string, wanted: number, lotSize: number, reserve: number, maxUnitPrice: number, log?: MarketRequest['log']): Promise<MarketQuote | MarketMiss> {
    const ask = () => actions.sayPublic(`buying ${wanted} ${item}`);
    let previous = reader.chat(100).map(signature);
    if (!ask()) return 'retry';
    const customer = Game.myName()?.trim().toLowerCase();
    const label = item.toLowerCase();
    let quote: MarketQuote | undefined;
    let ready = false;
    let requested = false;
    let queuedBehind = '';
    let askAt = 20_000;
    let requestAt = 0;
    for (let elapsed = 0; elapsed < 240_000 && safe(); elapsed += POLL_MS) {
        if (Trade.onOfferScreen()) {
            const partner = Trade.partner();
            if (partner !== null) return requested && quote && namesMatch(partner, MAKER) ? quote : 'retry';
        } else if (Trade.active()) {
            return 'retry';
        } else {
            const lines = reader.chat(100);
            const current = lines.map(signature);
            const overlap = current.findIndex((_, i) => current.slice(i).every((value, j) => value === previous[j]));
            previous = current;
            for (const line of lines.slice(0, overlap < 0 ? lines.length : overlap).reverse()) {
                if (![1, 2].includes(line.type) || !namesMatch((line.username ?? '').replace(/^@cr\d@/, ''), MAKER)) continue;
                const reply = line.text.trim().toLowerCase();
                if (!quote) {
                    if (reply === `i have no ${label} right now.` || reply === `i don't sell '${label}'.`) return 'unavailable';
                    const offer = readQuote(reply, label);
                    if (!offer || offer.quantity > wanted) continue;
                    if (offer.quantity < lotSize || offer.unit > maxUnitPrice) return 'unavailable';
                    quote = offer;
                    ready = offer.ready;
                    askAt = elapsed + 95_000;
                    log?.(ready ? `Seers Market invited a trade for ${item}` : `Waiting for Seers Market to fetch ${item}`);
                    continue;
                }
                const partial = /^i could only get ([\d,]+) x (.+?)\. trade me, (.+)\.$/.exec(reply);
                if (customer && (reply === `got your ${label}. trade me, ${customer}.` || (partial && partial[2] === label && partial[3] === customer))) {
                    if (partial) {
                        const amount = Number(partial[1].replaceAll(',', ''));
                        if (amount < 1 || amount > quote.quantity) return 'retry';
                        if (amount < lotSize) return 'unavailable';
                        quote = { quantity: amount, unit: quote.unit };
                    }
                    ready = true;
                    queuedBehind = '';
                    requestAt = elapsed;
                    askAt = elapsed + 95_000;
                    log?.(`Seers Market has ${quote.quantity} ${item} ready for ${customer}`);
                } else if (customer && reply.startsWith(customer + ', serving ') && reply.endsWith(' first. one moment.')) {
                    queuedBehind = reply.slice(customer.length + ', serving '.length, -' first. one moment.'.length);
                    log?.(`Waiting for Seers Market to finish serving ${queuedBehind}`);
                } else if (queuedBehind && reply === `thanks ${queuedBehind}. pleasure doing business.`) {
                    queuedBehind = '';
                    requestAt = elapsed;
                } else if (customer && reply === `${customer}, i could not get your ${label}. ask me again.`) {
                    return 'unavailable';
                } else if (requested && reply === `fetching your ${label}, one moment.`) {
                    ready = false;
                    log?.(`Waiting for Seers Market to fetch ${item}`);
                } else if (requested && reply === 'that did not open. trade me again.') {
                    requestAt = elapsed;
                }
            }
            if (quote && quote.quantity % lotSize !== 0) {
                wanted = quote.quantity - quote.quantity % lotSize;
                quote = undefined;
                queuedBehind = '';
                askAt = elapsed;
            }
            if (!queuedBehind && elapsed >= askAt) {
                if (!ask()) return 'retry';
                quote = undefined;
                ready = false;
                requested = false;
                queuedBehind = '';
                askAt = elapsed + 20_000;
            } else if (quote && ready && !queuedBehind && elapsed >= requestAt) {
                const miss = await fundQuote(quote.quantity * quote.unit, reserve, log);
                if (miss) return miss;
                if (await Trade.request(MAKER)) requested = true;
                requestAt = elapsed + 15_000;
            }
        }
        await Execution.delay(POLL_MS);
    }
    log?.(`Seers Market trade for ${item} did not open`);
    return 'retry';
}

async function bankRemainingCoins(log: MarketRequest['log']): Promise<void> {
    const remaining = Inventory.countById(COINS);
    if (remaining && safe() && atMarket() && !Trade.active()) {
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', log)) || !(await Bank.depositXById(COINS, remaining))) {
            throw new Error('Could not return unspent market coins to Seers bank');
        }
    }
}

export async function buyMarketItem(request: MarketRequest & { id: number; quantity: number }): Promise<'bought' | MarketMiss> {
    const { id } = request;
    if (request.world !== 1 || !Number.isSafeInteger(request.quantity) || request.quantity < 1
        || !safe() || Trade.active() || Inventory.free() < 1) return 'retry';
    const catalog = liveCatalog();
    const row = catalog.items.find(entry => entry.id === id);
    if (!row) return 'retry';
    const item = displayName(catalog, id);
    const noted = catalog.notedOf.get(id);
    const lotSize = marketLotSize(row.name, request.quantity);
    const wanted = marketOrderQuantity(row.name, request.quantity);
    const quantity = noted === undefined && !row.stackable ? Math.min(wanted, Inventory.free()) : wanted;
    if (quantity < lotSize) return 'unavailable';
    const ids = noted === undefined ? [id] : [id, noted];
    const held = () => ids.reduce((count, itemId) => count + Inventory.countById(itemId), 0);
    const before = held();
    if (Inventory.countById(COINS) !== 0) return 'retry';
    request.log?.(`Checking the price of ${quantity} ${item} at Seers bank`);
    if (!(await Traversal.walkResilient(SEERS_MARKET_STAND, { radius: 3, attempts: 2, timeoutMs: 120_000, avoidZones: levelerTravelZones(), log: request.log })) || !safe()) return 'retry';
    if (!atMarket()) return 'retry';
    if (!Players.query().name(MAKER).within(5).first()) return 'unavailable';
    try {
        const order = await openMarketOrder(item, quantity, lotSize, request.reserve ?? SHOPPING_RESERVE, request.maxUnitPrice ?? Infinity, request.log);
        if (typeof order === 'string') return order;
        const amount = order.quantity;
        const price = amount * order.unit;
        if (!safe() || !Trade.onOfferScreen() || !namesMatch(Trade.partner() ?? '', MAKER) || Trade.myOffer().length > 0) return 'retry';
        const coinsBeforeTrade = Inventory.countById(COINS);
        if (coinsBeforeTrade !== price || !(await Trade.offer('Coins', price, item => item.id === COINS))) return 'retry';
        let accepted = false;
        let confirmed = false;
        for (let poll = 0; poll < 60 && safe(); poll++) {
            if (Trade.onOfferScreen()) {
                if (confirmed || !namesMatch(Trade.partner() ?? '', MAKER) || !exact(Trade.myOffer(), [COINS], price)) return 'retry';
                const theirs = Trade.theirOffer();
                if (theirs.length > 0 && !exact(theirs, ids, amount)) return 'retry';
                if (exact(theirs, ids, amount)) accepted = await Trade.accept();
            } else if (Trade.onConfirmScreen()) {
                if (!accepted || !namesMatch(Trade.partner() ?? '', MAKER)) return 'retry';
                if (reader.tradeConfirmReady()) {
                    const offers = reader.tradeConfirmOffers();
                    if (!exact(offers.mine, [COINS], price) || !exact(offers.theirs, ids, amount)) return 'retry';
                    if (!confirmed) confirmed = await Trade.accept();
                }
            } else if (confirmed && held() === before + amount && Inventory.countById(COINS) === coinsBeforeTrade - price) {
                request.log?.(`Bought ${amount} ${item} for ${price} coins`);
                return 'bought';
            }
            await Execution.delay(500);
        }
        return 'retry';
    } finally {
        if (Trade.active()) await Trade.decline();
        await bankRemainingCoins(request.log);
    }
}
