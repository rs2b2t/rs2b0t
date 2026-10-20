import { actions, reader, type ChatLine } from '../../adapter/ClientAdapter.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { liveCatalog } from '../../api/market/catalog.js';
import { Players } from '../../api/players/Players.js';
import { namesMatch } from '../../api/trade/PartnerTrade.js';
import { Trade, type TradeItem } from '../../api/trade/Trade.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';

const MAKER = 'seers market';
const STAND = new Tile(2725, 3491, 0);
const AXES: Record<string, number> = { 'Rune axe': 1359, 'Adamant axe': 1357, 'Mithril axe': 1355 };
const COINS = 995;
const RESERVE = 200;

export interface MarketAxeRequest {
    item: string;
    maxPrice: number;
    world: number;
    log?: (message: string) => void;
}

function safe(): boolean {
    return Game.sceneReady() && !Game.inCombat() && !EventSignal.pending();
}

function signature(line: ChatLine): string {
    return `${line.type}|${line.username}|${line.text}`;
}

function exact(items: readonly TradeItem[], ids: readonly number[], count: number): boolean {
    return items.length === 1 && ids.includes(items[0].id) && items[0].count === count;
}

async function quote(item: string, budget: number): Promise<number | null> {
    let previous = reader.chat(100).map(signature);
    if (!actions.sayPublic(`buying 1 ${item}`)) return null;
    const pattern = new RegExp(`^1 x ${item} = ([\\d,]+)gp \\(([\\d,]+)ea\\)\\.`, 'i');
    for (let poll = 0; poll < 20 && safe(); poll++) {
        const lines = reader.chat(100);
        const current = lines.map(signature);
        const overlap = current.findIndex((_, i) => current.slice(i).every((value, j) => value === previous[j]));
        previous = current;
        for (const line of lines.slice(0, overlap < 0 ? lines.length : overlap)) {
            if (![1, 2].includes(line.type) || !namesMatch(line.username ?? '', MAKER)) continue;
            if (line.text.toLowerCase() === `i have no ${item.toLowerCase()} right now.`) return null;
            const match = pattern.exec(line.text);
            if (!match) continue;
            const price = Number(match[1].replaceAll(',', ''));
            const unit = Number(match[2].replaceAll(',', ''));
            return Number.isSafeInteger(price) && price > 0 && price === unit && price <= budget ? price : null;
        }
        await Execution.delay(500);
    }
    return null;
}

export class SeersAxeBuyer {
    private attempted = false;

    async buy(request: MarketAxeRequest): Promise<boolean> {
        const id = AXES[request.item];
        if (this.attempted || request.world !== 1 || !id || !Number.isSafeInteger(request.maxPrice) || request.maxPrice <= 0
            || !safe() || Trade.active() || Inventory.free() < 1) return false;
        const catalog = liveCatalog();
        if (catalog.byId.get(id)?.name !== request.item) return false;
        const noted = catalog.notedOf.get(id);
        const ids = noted === undefined ? [id] : [id, noted];
        const held = () => ids.reduce((count, itemId) => count + Inventory.countById(itemId), 0);
        const before = held();
        const coins = Inventory.countById(COINS);
        const budget = Math.min(request.maxPrice, coins - RESERVE);
        if (before > 0 || budget < 1) return false;
        this.attempted = true;
        request.log?.(`Trying ${MAKER} for one ${request.item}, up to ${budget} coins`);
        if (!(await Traversal.walkResilient(STAND, { radius: 3, attempts: 1, timeoutMs: 60_000, log: request.log })) || !safe()) return false;
        const here = Game.tile();
        if (here === null || STAND.distanceTo(here) > 5 || !Players.query().name(MAKER).within(5).first()) return false;
        const price = await quote(request.item, budget);
        if (price === null || !safe() || Trade.active()) return false;
        try {
            if (!(await Trade.request(MAKER))) return false;
            for (let poll = 0; poll < 40 && safe() && (!Trade.onOfferScreen() || Trade.partner() === null); poll++) {
                if (Trade.onConfirmScreen()) return false;
                await Execution.delay(500);
            }
            if (!safe() || !Trade.onOfferScreen() || !namesMatch(Trade.partner() ?? '', MAKER) || Trade.myOffer().length > 0) return false;
            const coinsBeforeTrade = Inventory.countById(COINS);
            if (coinsBeforeTrade < price + RESERVE || !(await Trade.offer('Coins', price, item => item.id === COINS))) return false;
            let accepted = false;
            let confirmed = false;
            for (let poll = 0; poll < 60 && safe(); poll++) {
                if (Trade.onOfferScreen()) {
                    if (confirmed || !namesMatch(Trade.partner() ?? '', MAKER) || !exact(Trade.myOffer(), [COINS], price)) return false;
                    const theirs = Trade.theirOffer();
                    if (theirs.length > 0 && !exact(theirs, ids, 1)) return false;
                    if (exact(theirs, ids, 1)) accepted = await Trade.accept();
                } else if (Trade.onConfirmScreen()) {
                    if (!accepted || !namesMatch(Trade.partner() ?? '', MAKER)) return false;
                    if (reader.tradeConfirmReady()) {
                        const offers = reader.tradeConfirmOffers();
                        if (!exact(offers.mine, [COINS], price) || !exact(offers.theirs, ids, 1)) return false;
                        if (!confirmed) confirmed = await Trade.accept();
                    }
                } else if (confirmed && held() === before + 1 && Inventory.countById(COINS) === coinsBeforeTrade - price) {
                    request.log?.(`Bought one ${request.item} for ${price} coins`);
                    return true;
                }
                await Execution.delay(500);
            }
            return false;
        } finally {
            if (Trade.active()) await Trade.decline();
        }
    }
}
