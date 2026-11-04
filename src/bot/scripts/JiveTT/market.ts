import { actions, reader, type ChatLine } from '../../adapter/ClientAdapter.js';
import { TARGET } from '../../../client/config/target.js';
import { hostedWorld } from '../../../client/config/worlds.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { liveCatalog, resolveByName } from '../../api/market/catalog.js';
import { resolveSet } from '../../api/market/sets.js';
import { Players } from '../../api/players/Players.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { namesMatch } from '../../api/trade/PartnerTrade.js';
import { Trade } from '../../api/trade/Trade.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { levelerTravelZones } from '../AccountLeveler/travel.js';
import { withMarketTurn } from './marketQueue.js';
import { MARKET_MERCHANT, canonicalMarketItems, isMarketMerchant, marketReceiptSlots, parseMarketQuote, purchase, type MarketItem, type MarketPurchaseResult, type PurchaseIntent, type QuoteResult } from './marketTrade.js';

export type { MarketPurchaseResult, PurchaseIntent } from './marketTrade.js';
export const MARKET_STAND = new Tile(2725, 3491, 0);
export const MARKET_SUPPLIES = {
    Shark: 385, 'Prayer potion(3)': 139, 'Antifire potion(3)': 2454,
    'Superantipoison(3)': 181, 'Law rune': 563, 'Air rune': 556,
    'Water rune': 555, 'Earth rune': 557, 'Fire rune': 554
} as const;
export type MarketSupply = keyof typeof MARKET_SUPPLIES | 'Super set';
export const MARKET_BATCH_LIMITS: Record<MarketSupply, number> = {
    Shark: 1000, 'Prayer potion(3)': 100, 'Super set': 100, 'Antifire potion(3)': 100, 'Superantipoison(3)': 100,
    'Law rune': 10000, 'Air rune': 10000, 'Water rune': 10000, 'Earth rune': 10000, 'Fire rune': 10000
};
export interface MarketSupplyRequest {
    account: string;
    world: number;
    item: MarketSupply;
    quantity: number;
    maxUnitPrice: number;
    maxSpend: number;
    coinReserve: number;
    persist(intent: PurchaseIntent | null): void;
    signal?: AbortSignal;
    log?(message: string): void;
}
const signature = (line: ChatLine): string => `${line.type}|${line.username}|${line.text}`;

export async function buyMarketSupply(request: MarketSupplyRequest): Promise<MarketPurchaseResult> {
    const fail = (kind: Exclude<MarketPurchaseResult['kind'], 'bought'>, reason: string): MarketPurchaseResult => ({ kind, reason });
    const liveWorld = TARGET.world ?? (TARGET.wsHost ? hostedWorld(TARGET.wsHost)?.number : undefined);
    if (request.world !== 1 || (liveWorld !== undefined && liveWorld !== 1)) return fail('unavailable', 'Seers Market requires World 1');
    if (!Number.isSafeInteger(request.maxUnitPrice) || request.maxUnitPrice <= 0) return fail('missing-ceiling', `Set a price ceiling for ${request.item}`);
    if (!Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > MARKET_BATCH_LIMITS[request.item]) return fail('unavailable', `Invalid batch quantity for ${request.item}`);
    const safe = (): boolean => !request.signal?.aborted && Game.sceneReady() && !Game.inCombat() && !EventSignal.pending() && namesMatch(Game.myName() ?? '', request.account);
    const wait = async (): Promise<void> => { await Sustain.run(); await Execution.delay(500); };
    const cat = liveCatalog();
    const set = resolveSet(request.item);
    const expectedIds = set?.itemIds ?? (request.item === 'Super set' ? [] : [MARKET_SUPPLIES[request.item]]);
    const actualIds = set?.itemIds ?? resolveByName(cat, request.item, { exactOnly: true }).map(i => i.id);
    if (expectedIds.length === 0 || expectedIds.length !== actualIds.length || !expectedIds.every(id => actualIds.includes(id) && cat.byId.has(id))) return fail('unavailable', `Live catalog does not match ${request.item}`);
    const canonical = (items: readonly MarketItem[]): MarketItem[] => canonicalMarketItems(items, cat.unnotedOf);
    const snapshot = () => ({ coins: Inventory.countById(995), items: canonical(Inventory.items()) });
    if (!safe()) return fail('interrupted', 'Market trip cannot begin safely');
    if (!(await Traversal.walkResilient(MARKET_STAND, { radius: 3, attempts: 1, timeoutMs: 60000, avoidZones: levelerTravelZones(), log: request.log })) || !safe()) return fail('unavailable', 'Cannot reach Seers Market');
    const here = Game.tile();
    if (!here || MARKET_STAND.distanceTo(here) > 5 || !Players.query().name(MARKET_MERCHANT).within(5).first()) return fail('merchant-absent', 'Seers Market is absent');
    if (Inventory.free() < expectedIds.length) return fail('unavailable', 'Bank valuables to make receipt space');
    const result = await withMarketTurn(request.account, safe, wait, async () => {
        const quote = async (item: string, quantity: number): Promise<QuoteResult> => {
            let previous = reader.chat(100).map(signature);
            request.log?.(`Requesting ${quantity} ${item} from Seers Market`);
            if (!safe() || !actions.sayPublic(`buying ${quantity} ${item}`)) return { kind: 'interrupted' };
            for (let poll = 0; poll < 30 && safe(); poll++) {
                const lines = reader.chat(100);
                const current = lines.map(signature);
                const overlap = current.findIndex((_, i) => current.slice(i).every((value, j) => value === previous[j]));
                previous = current;
                for (const line of lines.slice(0, overlap < 0 ? lines.length : overlap)) {
                    if (![1, 2].includes(line.type) || !isMarketMerchant(line.username)) continue;
                    const parsed = parseMarketQuote(line.text, item, quantity);
                    if (parsed) {
                        if (parsed.kind === 'quote') request.log?.(`Seers Market quoted ${parsed.total} coins for ${quantity} ${item}`);
                        return parsed;
                    }
                }
                await wait();
            }
            return { kind: safe() ? 'merchant-absent' : 'interrupted' };
        };
        return await purchase({ ...request, expected: expectedIds.map(id => ({ id, count: request.quantity })) }, {
            ready: safe, snapshot, quote,
            request: () => Trade.request(MARKET_MERCHANT),
            screen: () => Trade.onOfferScreen() ? 'offer' : Trade.onConfirmScreen() ? 'confirm' : 'none',
            partner: () => Trade.partner(),
            offerCoins: count => Trade.offer('Coins', count, item => item.id === 995),
            offers: () => {
                const offers = Trade.onConfirmScreen() ? reader.tradeConfirmOffers() : { mine: Trade.myOffer(), theirs: Trade.theirOffer() };
                return { mine: canonical(offers.mine), theirs: canonical(offers.theirs) };
            },
            confirmReady: () => reader.tradeConfirmReady(),
            receiptFits: () => {
                const items = Trade.onConfirmScreen() ? reader.tradeConfirmOffers().theirs : Trade.theirOffer();
                return items.every(item => cat.byId.has(item.id)) && marketReceiptSlots(items, Inventory.items(), id => cat.byId.get(id)?.stackable === true || cat.unnotedOf.has(id)) <= Inventory.free();
            },
            accept: () => Trade.accept(), wait,
            decline: async () => { await Trade.decline(); },
            persist: request.persist
        });
    });
    return result ?? fail('interrupted', 'Market queue timed out or cancelled');
}
