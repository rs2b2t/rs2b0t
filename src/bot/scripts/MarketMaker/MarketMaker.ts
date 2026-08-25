import { actions, reader } from '../../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Trade } from '../../api/trade/Trade.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { PriceBooks } from '../../api/market/bookStore.js';
import { liveCatalog, notedId, resolveByName, unnotedId, type Catalog } from '../../api/market/catalog.js';
import {
    CHAT_LIMIT,
    formatAmbiguous,
    formatBuyQuote,
    formatGp,
    formatPriceList,
    formatSellQuote,
    parseCommand,
    truncateChat
} from '../../api/market/chatProtocol.js';
import { Ledger, roomUnderCap } from '../../api/market/ledger.js';
import { rowOf, type PriceBook } from '../../api/market/priceBook.js';
import { resolvePrices, rowValid } from '../../api/market/prices.js';
import {
    driveMarketTradeBeat,
    normaliseOffer,
    offersMatch,
    type MarketTradeHooks,
    type TradeExpectation
} from '../../api/market/driveMarketTrade.js';
import { formatValuation, valueOffer, type OfferItem } from '../../api/market/quote.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    advertiseDue,
    Desk,
    freshChatLines,
    RateLimiter,
    shouldRestock,
    shouldSettle,
    type Engagement,
    type EngagementKind
} from './marketMakerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const COIN_NAME = 'Coins';
// Why: obj 617 is `fake_coins`, also named "Coins" and also stackable, so resolving the currency by name picks the Pirate's Treasure prop and every quote asks for the wrong item. Nothing on the client's ObjType separates them, so the id is pinned and checked at startup.
const COIN_ID = 995;
/** Chat types the client uses for player speech (Client.ts addChat). */
const PUBLIC_CHAT_TYPES = new Set([1, 2]);
/** Chat type 4 is "<name> wishes to trade with you." */
const TRADE_REQUEST_TYPE = 4;
const CHAT_LINES_PER_READ = 20;
/** One line per this many ms, so a busy shop does not read as spam. */
const CHAT_GAP_MS = 2_000;
const CHAT_REPEAT_MS = 15_000;
/** How far the stand tile may sit from the bank it is meant to use. */
const BANK_REACH = 12;
const SPOT_LEASH = 3;
const ADVERTISE_ITEMS = 4;
/** Live quotes held at once. Bounds the memory one player with throwaway names can cost. */
const QUOTE_CAP = 24;
/** Outbound lines held at once; the oldest is dropped so a flood cannot build a backlog. */
const CHAT_BACKLOG_CAP = 6;
const COMMANDS_PER_WINDOW = 3;
const COMMAND_WINDOW_MS = 10_000;
const COMMAND_PENALTY_MS = 30_000;
/** Why: the engine shuts the offer screen a tick before it opens the confirm screen, so a bare "not open" read drops a trade that is completing normally. */
const TRADE_GONE_MS = 3_000;

export const MARKET_MAKER_SETTINGS: SettingsSchema = {
    priceBook: {
        type: 'string',
        default: '',
        options: [],
        optionsFrom: 'priceBooks',
        label: 'Price book',
        help: 'edit the prices with the button beside this field'
    },
    spot: {
        type: 'tile',
        default: new Tile(2725, 3491, 0),
        label: 'Stand tile (x,z)',
        help: 'must be within a few tiles of a bank booth; defaults to Seers bank'
    },
    advertiseSeconds: {
        type: 'number',
        default: 60,
        min: 0,
        max: 600,
        label: 'Advertise every (s)',
        help: '0 turns advertising off; under 30 reads as spam'
    },
    engagementTimeoutSeconds: {
        type: 'number',
        default: 90,
        min: 15,
        max: 600,
        label: 'Transaction window (s)',
        help: 'the whole transaction, bank trip included; a customer who runs past it is dropped and cooled off'
    },
    quoteSeconds: {
        type: 'number',
        default: 60,
        min: 15,
        max: 600,
        label: 'Quote lifetime (s)',
        help: 'how long a quote stays redeemable; short, so nobody banks a quote against a mispriced row and cashes it after you fix the row'
    },
    cooldownSeconds: {
        type: 'number',
        default: 60,
        min: 0,
        max: 3600,
        label: 'Cooldown after a failed trade (s)',
        help: 'a customer who opens a trade and does not finish it is ignored for this long, so stalling costs the staller rather than everyone behind them'
    },
    coinFloat: {
        type: 'number',
        default: 50_000,
        min: 0,
        max: 100_000_000,
        label: 'Coins to carry (float)',
        help: 'kept in the pack to pay for buys; the surplus is banked'
    },
    blacklist: {
        type: 'string[]',
        default: [],
        label: 'Refuse these names'
    }
};

interface PendingLine {
    text: string;
    atMs: number;
}

export default class MarketMaker extends TaskBot {
    override loopDelay = 600;

    private book: PriceBook | null = null;
    private cat: Catalog = { byId: new Map(), notedOf: new Map(), unnotedOf: new Map(), items: [] };
    private coinId = -1;
    private spot = new Tile(2725, 3491, 0);
    private engagementTimeoutMs = 90_000;
    private advertiseSeconds = 60;
    private coinFloat = 50_000;
    private blacklist: string[] = [];

    private readonly ledger = new Ledger();
    private readonly desk = new Desk(QUOTE_CAP);
    private readonly limiter = new RateLimiter(COMMANDS_PER_WINDOW, COMMAND_WINDOW_MS, COMMAND_PENALTY_MS);
    private readonly tradeState = { waitedTicks: 0 };
    private quoteTtlMs = 60_000;
    private cooldownMs = 60_000;

    private pending: PendingLine[] = [];
    private lastSaidAt = 0;
    private readonly saidRecently = new Map<string, number>();
    private lastChat: string[] = [];
    private readonly tradeRequests = new Set<string>();

    private tradeClosedAt: number | null = null;
    private lastAdvertiseAt = 0;
    private advertiseCursor = 0;

    private status = 'starting';
    private startedAt = Date.now();
    private bought = 0;
    private sold = 0;
    private refused = 0;
    private gpIn = 0;
    private gpOut = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.cat = liveCatalog();
        const coin = this.cat.byId.get(COIN_ID);
        if (coin?.name !== COIN_NAME || !coin.stackable) {
            this.log(`obj ${COIN_ID} is '${coin?.name ?? 'missing'}', not stackable ${COIN_NAME} — the cache does not match this build, stopping`);
            ScriptRunner.stop('coin id does not match the cache');
            return;
        }
        this.coinId = COIN_ID;

        this.spot = this.settings.tile('spot', this.spot);
        this.engagementTimeoutMs = this.settings.num('engagementTimeoutSeconds', 90) * 1000;
        this.advertiseSeconds = this.settings.num('advertiseSeconds', 60);
        this.coinFloat = this.settings.num('coinFloat', 50_000);
        this.blacklist = this.settings.list('blacklist').map(n => n.trim().toLowerCase()).filter(Boolean);
        this.quoteTtlMs = this.settings.num('quoteSeconds', 60) * 1000;
        this.cooldownMs = this.settings.num('cooldownSeconds', 60) * 1000;

        const bookName = this.settings.str('priceBook');
        this.book = PriceBooks.byName(bookName);
        if (!this.book || this.book.rows.length === 0) {
            this.log(`price book '${bookName}' is missing or empty — stopping`);
            ScriptRunner.stop('no price book');
            return;
        }

        const bank = nearestBank(this.spot);
        const reach = bank ? this.spot.distanceTo(Tile.from(bank.tile)) : Infinity;
        if (!bank || reach > BANK_REACH) {
            this.log(`stand tile (${this.spot.x},${this.spot.z}) is ${Number.isFinite(reach) ? `${reach} tiles` : 'nowhere'} from a bank (nearest: ${bank?.name ?? 'none'}) — stopping`);
            ScriptRunner.stop('stand tile is not at a bank');
            return;
        }

        this.startedAt = Date.now();
        this.lastAdvertiseAt = Date.now();
        this.log(`MarketMaker — book '${this.book.name}', ${this.book.rows.length} items, ${this.book.margin}% spread, at ${bank.name}`);

        if (!(await this.refreshLedger())) {
            this.log('could not read the bank at startup — stopping rather than quote stock I cannot prove');
            ScriptRunner.stop('bank unreadable');
            return;
        }

        this.add(
            new Recover(this),
            new ServeTrade(this),
            new AcceptCustomer(this),
            new Restock(this),
            new OpenTrade(this),
            new Settle(this),
            new Advertise(this),
            new Listen(this)
        );
    }

    // ---- state the tasks read -------------------------------------------

    activeBook(): PriceBook {
        return this.book!;
    }

    catalog(): Catalog {
        return this.cat;
    }

    coins(): number {
        return this.coinId;
    }

    standTile(): Tile {
        return this.spot;
    }

    counter(): Desk {
        return this.desk;
    }

    quoteTtl(): number {
        return this.quoteTtlMs;
    }

    stock(): Ledger {
        return this.ledger;
    }

    setStatus(s: string): void {
        this.status = s;
    }

    timeoutMs(): number {
        return this.engagementTimeoutMs;
    }

    advertiseEvery(): number {
        return this.advertiseSeconds;
    }

    float(): number {
        return this.coinFloat;
    }

    requests(): Set<string> {
        return this.tradeRequests;
    }

    beatState(): { waitedTicks: number } {
        return this.tradeState;
    }

    // ---- chat ------------------------------------------------------------

    /** One command's worth of budget for this player. False means ignore them. */
    spend(name: string, nowMs: number): boolean {
        return this.limiter.allow(name, nowMs);
    }

    /** Queue a line. Draining is rate limited so a busy shop does not read as spam. */
    // Why: the backlog is capped and drops oldest, so no flood can push the bot minutes behind answering questions nobody remembers asking.
    say(text: string): void {
        const line = truncateChat(text);
        if (line.length === 0 || this.pending.some(p => p.text === line)) {
            return;
        }
        this.pending.push({ text: line, atMs: Date.now() });
        while (this.pending.length > CHAT_BACKLOG_CAP) {
            this.pending.shift();
        }
    }

    drainChat(): void {
        const now = Date.now();
        if (this.pending.length === 0 || now - this.lastSaidAt < CHAT_GAP_MS) {
            return;
        }
        const next = this.pending.shift()!;
        const saidAt = this.saidRecently.get(next.text);
        if (saidAt !== undefined && now - saidAt < CHAT_REPEAT_MS) {
            return;
        }
        if (actions.sayPublic(next.text)) {
            this.lastSaidAt = now;
            this.saidRecently.set(next.text, now);
        }
    }

    /** Chat since the last read, oldest-first. */
    freshChat(): { type: number; username: string | null; text: string }[] {
        const lines = reader.chat(CHAT_LINES_PER_READ);
        const sig = (l: { type: number; username: string | null; text: string }) =>
            `${l.type}|${l.username ?? ''}|${l.text}`;
        const now = lines.map(sig);
        const fresh = freshChatLines(this.lastChat, now);
        this.lastChat = now;

        const byText = new Map(lines.map(l => [sig(l), l]));
        return fresh.flatMap(s => {
            const line = byText.get(s);
            return line ? [line] : [];
        });
    }

    blocked(name: string): boolean {
        return this.blacklist.includes(name.trim().toLowerCase());
    }

    // ---- pack and bank ---------------------------------------------------

    /** Units of one row held in the pack, noted and unnoted together. */
    packCount(id: number): number {
        const noted = notedId(this.cat, id);
        return Inventory.countById(id) + (noted === null ? 0 : Inventory.countById(noted));
    }

    packCoins(): number {
        return Inventory.countById(this.coinId);
    }

    /** Read the open bank into the ledger, collapsing notes onto their row. */
    async refreshLedger(): Promise<boolean> {
        if (!Bank.isOpen() && !(await Banking.open({ stand: this.spot, boothName: BOOTH.name, boothOp: BOOTH.op, log: m => this.log(m) }))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => Bank.snapshotReady(), 6000))) {
            return false;
        }

        const units = new Map<number, number>();
        for (const item of Bank.items()) {
            const id = unnotedId(this.cat, item.id);
            units.set(id, (units.get(id) ?? 0) + item.count);
        }
        const bankCoins = units.get(this.coinId) ?? 0;
        this.ledger.setStock([...units].map(([id, count]) => ({ id, count })), bankCoins);
        return true;
    }

    // ---- quoting ---------------------------------------------------------

    handleCommand(from: string, text: string): void {
        const cmd = parseCommand(text);
        switch (cmd.kind) {
            case 'prices':
                this.listPrices('both');
                return;
            case 'buying':
                this.listPrices('buy');
                return;
            case 'selling':
                this.listPrices('sell');
                return;
            case 'quoteSell':
                this.quoteFor(from, 'sell', cmd.qty, cmd.query);
                return;
            case 'quoteBuy':
                this.quoteFor(from, 'buy', cmd.qty, cmd.query);
                return;
            case 'none':
                return;
        }
    }

    private listPrices(side: 'both' | 'buy' | 'sell'): void {
        const book = this.activeBook();
        const entries = book.rows
            .filter(r => rowValid(book, r) && (side === 'buy' ? r.buying : side === 'sell' ? r.selling : r.buying || r.selling))
            .map(r => {
                const { buy, sell } = resolvePrices(book, r);
                return { name: this.cat.byId.get(r.id)?.name ?? `item ${r.id}`, buy, sell };
            });
        if (entries.length === 0) {
            this.say('Nothing listed right now.');
            return;
        }
        for (const line of formatPriceList(entries, side)) {
            this.say(line);
        }
    }

    /** One row, or a reply explaining why not. */
    private resolveRow(query: string, side: 'buying' | 'selling'): { id: number; name: string } | null {
        const book = this.activeBook();
        const candidates = resolveByName(this.cat, query).filter(r => {
            const row = rowOf(book, r.id);
            return row !== null && row[side] && rowValid(book, row);
        });
        if (candidates.length === 0) {
            this.say(`I don't ${side === 'selling' ? 'sell' : 'buy'} '${query}'.`);
            return null;
        }
        if (candidates.length > 1) {
            this.say(formatAmbiguous(candidates.map(c => ({ name: c.name, id: c.id }))));
            return null;
        }
        return { id: candidates[0].id, name: candidates[0].name };
    }

    /** How many units this side can honour right now, and at what unit price. */
    // Why: called when quoting and again when the customer turns up, so a stale quote cannot be redeemed after the row is corrected.
    priceNow(
        itemId: number,
        kind: EngagementKind,
        want: number | 'all'
    ): { qty: number; unit: number; refusal: string | null } {
        const book = this.activeBook();
        const row = rowOf(book, itemId);
        const name = this.cat.byId.get(itemId)?.name ?? `item ${itemId}`;
        if (!row || !rowValid(book, row) || !(kind === 'sell' ? row.selling : row.buying)) {
            return { qty: 0, unit: 0, refusal: `I don't ${kind === 'sell' ? 'sell' : 'buy'} ${name} any more.` };
        }

        const { buy, sell } = resolvePrices(book, row);
        const unit = kind === 'sell' ? sell : buy;

        let ceiling: number;
        let refusal: string;
        if (kind === 'sell') {
            ceiling = this.ledger.available(itemId, this.packCount(itemId));
            refusal = `Out of ${name}.`;
        } else {
            const room = roomUnderCap(row.cap, this.ledger.held(itemId) + this.packCount(itemId), 0);
            const affordable = Math.floor(this.ledger.available(this.coinId, this.packCoins()) / unit);
            ceiling = Math.min(room, affordable);
            refusal = room <= 0 ? `I'm full on ${name}.` : `I can't afford that many ${name}.`;
        }

        const asked = want === 'all' ? ceiling : Math.min(want, ceiling);
        const qty = Math.min(asked, Math.floor(book.maxTradeValue / unit));
        if (qty <= 0) {
            return {
                qty: 0,
                unit,
                refusal: ceiling > 0 ? `${name} is over my ${formatGp(book.maxTradeValue)}gp trade cap.` : refusal
            };
        }
        return { qty, unit, refusal: null };
    }

    // Why: quoting reserves nothing. Stock is committed only when someone opens a trade, so chat alone cannot lock the shop's inventory and several bots at one bank stop starving each other.
    private quoteFor(from: string, kind: EngagementKind, want: number | 'all', query: string): void {
        const hit = this.resolveRow(query, kind === 'sell' ? 'selling' : 'buying');
        if (!hit) {
            return;
        }

        const { qty, unit, refusal } = this.priceNow(hit.id, kind, want);
        if (refusal !== null) {
            this.say(refusal);
            return;
        }

        this.desk.quote({ customer: from, kind, itemId: hit.id, qty, unitPrice: unit, quotedAtMs: Date.now() });
        this.say(kind === 'sell' ? formatSellQuote(hit.name, qty, unit) : formatBuyQuote(hit.name, qty, unit));
    }

    /** Turn a live quote into the one transaction in flight, re-pricing it first. Null when it can no longer be honoured. */
    acceptCustomer(customer: string): Engagement | null {
        const q = this.desk.liveQuote(customer, Date.now(), this.quoteTtlMs);
        if (!q) {
            return null;
        }
        this.desk.dropQuote(customer);

        const name = this.cat.byId.get(q.itemId)?.name ?? `item ${q.itemId}`;
        const now = this.priceNow(q.itemId, q.kind, q.qty);
        if (now.refusal !== null) {
            this.say(now.refusal);
            return null;
        }
        if (now.unit !== q.unitPrice) {
            this.say(`${name} moved to ${formatGp(now.unit)}ea. Ask again.`);
            return null;
        }
        if (now.qty < q.qty) {
            this.say(`Only ${formatGp(now.qty)} ${name} left. Ask again.`);
            return null;
        }

        const gp = q.qty * q.unitPrice;
        const engagement: Engagement = {
            customer,
            kind: q.kind,
            give: q.kind === 'sell' ? new Map([[q.itemId, q.qty]]) : new Map([[this.coinId, gp]]),
            get: q.kind === 'sell' ? new Map([[this.coinId, gp]]) : new Map([[q.itemId, q.qty]]),
            startedAtMs: Date.now(),
            opened: false
        };

        const holdId = q.kind === 'sell' ? q.itemId : this.coinId;
        const holdQty = q.kind === 'sell' ? q.qty : gp;
        if (!this.ledger.reserve(customer, holdId, holdQty, Date.now())) {
            this.say(`Someone beat you to that ${name}.`);
            return null;
        }

        this.desk.startServing(engagement);
        return engagement;
    }

    // ---- trade -----------------------------------------------------------

    expectationOf(e: Engagement): TradeExpectation {
        return { customer: e.customer, give: e.give, get: e.get };
    }

    tradeHooks(): MarketTradeHooks {
        return {
            screen: () => (Trade.onConfirmScreen() ? 'confirm' : Trade.onOfferScreen() ? 'offer' : 'none'),
            partnerHeader: () => Trade.partner(),
            myOffer: () => Trade.myOffer() as OfferItem[],
            theirOffer: () => Trade.theirOffer() as OfferItem[],
            confirmMatches: expect => this.confirmMatches(expect),
            offerGive: give => this.offerGive(give),
            accept: () => Trade.accept(),
            decline: async () => Trade.decline(),
            log: m => this.log(m)
        };
    }

    /** null until the confirm screen has filled, so the driver waits rather than guessing. */
    private confirmMatches(expect: TradeExpectation): boolean | null {
        if (!reader.tradeConfirmReady()) {
            return null;
        }
        const shown = reader.tradeConfirmOffers();
        return offersMatch(normaliseOffer(this.cat, shown.mine as OfferItem[]), expect.give)
            && offersMatch(normaliseOffer(this.cat, shown.theirs as OfferItem[]), expect.get);
    }

    /** Fill the quoted side, notes first so a mixed holding still completes. */
    private async offerGive(give: ReadonlyMap<number, number>): Promise<boolean> {
        const already = normaliseOffer(this.cat, Trade.myOffer() as OfferItem[]);
        for (const [id, want] of give) {
            const name = this.cat.byId.get(id)?.name;
            if (name === undefined) {
                return false;
            }
            let left = want - (already.get(id) ?? 0);
            const noted = notedId(this.cat, id);
            for (const candidate of noted === null ? [id] : [noted, id]) {
                if (left <= 0) {
                    break;
                }
                const have = Inventory.countById(candidate);
                if (have <= 0) {
                    continue;
                }
                const take = Math.min(left, have);
                if (!(await Trade.offer(name, take, i => i.id === candidate))) {
                    return false;
                }
                left -= take;
            }
            if (left > 0) {
                return false;
            }
        }
        return true;
    }

    /** Post the itemised valuation of what a customer put up, before anything is accepted. */
    announceValuation(items: readonly OfferItem[]): void {
        const v = valueOffer(this.activeBook(), this.cat, this.ledger, items, this.coinId);
        this.say(formatValuation(v));
    }

    completeTrade(e: Engagement): void {
        for (const [id, qty] of e.give) {
            if (id === this.coinId) {
                this.gpOut += qty;
            } else {
                this.ledger.applySold(id, qty, 0);
            }
        }
        for (const [id, qty] of e.get) {
            if (id === this.coinId) {
                this.gpIn += qty;
                this.ledger.applySold(id, 0, qty);
            } else {
                this.ledger.applyBought(id, qty);
            }
        }
        if (e.kind === 'sell') {
            this.sold++;
        } else {
            this.bought++;
        }
        this.ledger.release(e.customer);
        this.desk.finishServing();
        this.tradeClosedAt = null;
        this.log(`trade complete with ${e.customer} (${e.kind})`);
        this.say(`Thanks ${e.customer}. Pleasure doing business.`);
    }

    /** One line, since the live harness surfaces a bounded number of log lines per poll. */
    describeMismatch(e: Engagement): string {
        const show = (m: ReadonlyMap<number, number>): string =>
            [...m].map(([id, n]) => `${this.cat.byId.get(id)?.name ?? id}(${id})x${n}`).join('+') || 'nothing';
        const mine = normaliseOffer(this.cat, Trade.myOffer() as OfferItem[]);
        const theirs = normaliseOffer(this.cat, Trade.theirOffer() as OfferItem[]);
        const confirm = Trade.onConfirmScreen() ? reader.tradeConfirmOffers() : null;
        const confirmPart = confirm === null
            ? ''
            : ` confirm[ready=${reader.tradeConfirmReady()} mine=${show(normaliseOffer(this.cat, confirm.mine as OfferItem[]))} theirs=${show(normaliseOffer(this.cat, confirm.theirs as OfferItem[]))}]`;
        return `mismatch: want give=${show(e.give)} get=${show(e.get)}; saw mine=${show(mine)} theirs=${show(theirs)}${confirmPart}`;
    }

    /** Drop the customer in flight and ignore them for a while. */
    // Why: a stall and a probe of the refusal rules look identical from here, so the cost lands on whoever failed the trade rather than on everyone behind them.
    abandon(e: Engagement, reason: string): void {
        this.refused++;
        this.ledger.release(e.customer);
        this.desk.dropQuote(e.customer);
        this.desk.finishServing();
        this.tradeClosedAt = null;
        if (this.cooldownMs > 0) {
            this.desk.cool(e.customer, Date.now() + this.cooldownMs);
        }
        this.log(`dropped ${e.customer}: ${reason}`);
    }

    /** Age out the transaction window, an abandoned window, stale quotes and stale holds. */
    dropExpired(): void {
        const now = Date.now();

        const stale = this.desk.staleServing(now, this.engagementTimeoutMs);
        if (stale) {
            this.say('Trade declined. Ask again in a minute.');
            this.abandon(stale, 'ran past the transaction window');
        } else {
            this.releaseIfWalkedAway(now);
        }

        this.desk.prune(now, this.quoteTtlMs);
        this.ledger.expire(now, this.engagementTimeoutMs);
    }

    /** Free the counter when the customer closes the window instead of trading. */
    // Why: without this one decline holds the shop for the rest of the transaction window, so a griefer costs everyone 90s per click.
    private releaseIfWalkedAway(nowMs: number): void {
        const served = this.desk.current();
        if (!served?.opened || Trade.active()) {
            this.tradeClosedAt = null;
            return;
        }
        if (this.tradeClosedAt === null) {
            this.tradeClosedAt = nowMs;
            return;
        }
        if (nowMs - this.tradeClosedAt >= TRADE_GONE_MS) {
            this.tradeClosedAt = null;
            this.say('Trade closed. Ask again in a minute.');
            this.abandon(served, 'customer closed the window');
        }
    }

    // ---- advertising -----------------------------------------------------

    advertiseNow(): void {
        const book = this.activeBook();
        const rows = book.rows.filter(r => rowValid(book, r) && (r.buying || r.selling));
        if (rows.length === 0) {
            return;
        }
        const slice: typeof rows = [];
        for (let i = 0; i < Math.min(ADVERTISE_ITEMS, rows.length); i++) {
            slice.push(rows[(this.advertiseCursor + i) % rows.length]);
        }
        this.advertiseCursor = (this.advertiseCursor + slice.length) % rows.length;

        const entries = slice.map(r => {
            const { buy, sell } = resolvePrices(book, r);
            return { name: this.cat.byId.get(r.id)?.name ?? `item ${r.id}`, buy, sell };
        });
        const [first] = formatPriceList(entries, 'both');
        if (first !== undefined) {
            this.say(truncateChat(`Trading: ${first}`.slice(0, CHAT_LIMIT)));
        }
        this.lastAdvertiseAt = Date.now();
    }

    advertiseIsDue(): boolean {
        return advertiseDue(this.lastAdvertiseAt, Date.now(), this.advertiseSeconds);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fb3ff' });
        p.title(`MarketMaker — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const e = this.desk.current();
        p.row(`Runtime: ${fmtDuration(mins)}`, `Book: ${this.book?.name ?? '-'}`, `Spread: ${this.book?.margin ?? 0}%`);
        p.row(`Sold: ${this.sold}`, `Bought: ${this.bought}`, `Refused: ${this.refused}`);
        p.row(`GP in: ${formatGp(this.gpIn)}`, `GP out: ${formatGp(this.gpOut)}`, `Pack coins: ${formatGp(this.packCoins())}`);
        p.row(`Serving: ${e?.customer ?? 'nobody'}`, `Quotes: ${this.desk.quoteCount()}`, `Pack: ${Inventory.used()}/28`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Client.ts prefixes a moderator's chat username with @cr1@ / @cr2@ for the crown icon. */
function bareName(username: string | null): string {
    const raw = (username ?? '').trim();
    return /^@cr\d@/.test(raw) ? raw.slice(5) : raw;
}

/** Close stray modals and return to the stand tile. */
class Recover implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        if (Trade.active()) {
            return false;
        }
        const modals = reader.modals();
        const here = Game.tile();
        return modals.main !== -1 || (here !== null && Tile.from(here).distanceTo(this.bot.standTile()) > SPOT_LEASH);
    }

    async execute(): Promise<void> {
        if (reader.modals().main !== -1) {
            this.bot.setStatus('closing a stray window');
            actions.closeModal();
            await Execution.delayTicks(1);
            return;
        }
        this.bot.setStatus('walking back to the stand');
        await Traversal.walkResilient(this.bot.standTile(), { radius: 1, timeoutMs: 60_000, log: m => this.bot.log(m) });
    }
}

/** Owns the loop while a trade is open, since movement cancels the modal. */
class ServeTrade implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return Trade.active();
    }

    async execute(): Promise<void> {
        const e = this.bot.counter().current();
        if (!e) {
            this.bot.setStatus('declining an unquoted trade');
            this.bot.say('Quote first, e.g. "buy 100 iron ore".');
            await Trade.decline();
            return;
        }

        const partner = Trade.partner();
        const stranger = partner !== null && !sameName(partner, e.customer);
        const onConfirm = Trade.onConfirmScreen();
        this.bot.setStatus(`trading with ${e.customer}${onConfirm ? ' (confirm)' : ''}`);

        // Why: the customer sees what their offer is worth before the bot accepts anything.
        if (e.kind === 'buy' && !onConfirm && !stranger) {
            this.bot.announceValuation(Trade.theirOffer() as OfferItem[]);
        }

        const decision = await driveMarketTradeBeat(
            this.bot.expectationOf(e),
            this.bot.catalog(),
            this.bot.tradeHooks(),
            this.bot.beatState()
        );

        if (decision.action === 'accept' && onConfirm) {
            await Execution.delayUntil(() => !Trade.active(), 8_000);
            if (!Trade.active()) {
                this.bot.completeTrade(e);
            }
            return;
        }

        // Why: a stranger opening a trade must not cost the queued customer their engagement.
        if (decision.action === 'decline' && !stranger) {
            this.bot.log(this.bot.describeMismatch(e));
            this.bot.say(`Trade declined: ${decision.reason}.`);
            this.bot.abandon(e, decision.reason);
        }
    }
}

/** Take the first live-quote holder who asks, and commit stock to them. */
// Why: no list of who is next means nothing to camp or fill with throwaway names; whoever clicks first wins.
class AcceptCustomer implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return !Trade.active()
            && this.bot.counter().current() === null
            && this.bot.requests().size > 0;
    }

    async execute(): Promise<void> {
        const asked = [...this.bot.requests()];
        this.bot.requests().clear();

        for (const name of asked) {
            if (this.bot.blocked(name) || this.bot.counter().onCooldown(name, Date.now())) {
                continue;
            }
            const taken = this.bot.acceptCustomer(name);
            if (taken) {
                this.bot.setStatus(`serving ${taken.customer}`);
                this.bot.log(`serving ${taken.customer} (${taken.kind})`);
                return;
            }
        }
        await Execution.delayTicks(1);
    }
}

/** Open the screen once the served customer's goods are in the pack. */
class OpenTrade implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        const e = this.bot.counter().current();
        return e !== null && !e.opened && !Trade.active();
    }

    async execute(): Promise<void> {
        const e = this.bot.counter().current()!;
        this.bot.setStatus(`opening a trade with ${e.customer}`);
        this.bot.counter().markOpened();
        if (!(await Trade.request(e.customer))) {
            this.bot.log(`${e.customer} is not in range to trade`);
            this.bot.say(`${e.customer}, stand next to me.`);
        }
    }
}

/** Withdraw what the current engagement promised, as notes. */
class Restock implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        if (Trade.active()) {
            return false;
        }
        const e = this.bot.counter().current();
        if (!e || e.opened) {
            return false;
        }
        return shouldRestock(e.give, id => (id === this.bot.coins() ? this.bot.packCoins() : this.bot.packCount(id)));
    }

    async execute(): Promise<void> {
        const e = this.bot.counter().current()!;
        this.bot.setStatus(`fetching ${e.customer}'s order`);

        if (!(await Banking.open({ stand: this.bot.standTile(), boothName: BOOTH.name, boothOp: BOOTH.op, log: m => this.bot.log(m) }))) {
            this.bot.log('could not open the bank to restock');
            return;
        }
        await Bank.setNoteMode(true);

        for (const [id, want] of e.give) {
            const inPack = () => (id === this.bot.coins() ? this.bot.packCoins() : this.bot.packCount(id));
            const short = want - inPack();
            if (short <= 0) {
                continue;
            }
            await Bank.withdrawXById(id, short);
            // Why: note mode delivers the cert id, so Bank.withdrawXById waits on an id that never arrives and reports false on a withdrawal that worked. Count both forms instead.
            if (!(await Execution.delayUntil(() => inPack() >= want, 5_000))) {
                this.bot.log(`bank came up short on ${this.bot.catalog().byId.get(id)?.name ?? id}: ${inPack()}/${want}`);
            }
        }

        await this.bot.refreshLedger();
        await Bank.close();
    }
}

/** Bank the takings when slots run low or coins pile up. */
class Settle implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        if (Trade.active() || this.bot.counter().current() !== null) {
            return false;
        }
        return shouldSettle(Inventory.free(), this.bot.packCoins(), this.bot.float());
    }

    async execute(): Promise<void> {
        this.bot.setStatus('banking the takings');
        if (!(await Banking.open({ stand: this.bot.standTile(), boothName: BOOTH.name, boothOp: BOOTH.op, log: m => this.bot.log(m) }))) {
            return;
        }

        // Why: deposit everything and take the float back, so a new item never squats a slot forever.
        await Bank.depositAllMatching(() => true, m => this.bot.log(m));
        await this.bot.refreshLedger();

        const float = Math.min(this.bot.float(), this.bot.stock().coins());
        if (float > 0) {
            await Bank.setNoteMode(false);
            await Bank.withdrawXById(this.bot.coins(), float);
        }
        await this.bot.refreshLedger();
        await Bank.close();
    }
}

class Advertise implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return !Trade.active() && this.bot.advertiseEvery() > 0 && this.bot.advertiseIsDue();
    }

    async execute(): Promise<void> {
        this.bot.advertiseNow();
        await Execution.delayTicks(1);
    }
}

/** Always last: reads chat, answers quotes, ages out stalled customers. */
class Listen implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return true;
    }

    async execute(): Promise<void> {
        const e = this.bot.counter().current();
        this.bot.setStatus(e ? `waiting on ${e.customer}` : 'open for business');
        this.bot.dropExpired();

        const me = reader.localPlayerName() ?? '';
        const now = Date.now();
        for (const line of this.bot.freshChat()) {
            const from = bareName(line.username);
            if (from.length === 0 || sameName(from, me) || this.bot.blocked(from)) {
                continue;
            }
            if (line.type === TRADE_REQUEST_TYPE) {
                this.bot.requests().add(from);
                continue;
            }
            if (!PUBLIC_CHAT_TYPES.has(line.type)) {
                continue;
            }
            // Why: the cooldown and the budget are checked before the parse, so a flood costs the
            // Why: flooder nothing to send and the bot nothing to answer.
            if (this.bot.counter().onCooldown(from, now) || !this.bot.spend(from, now)) {
                continue;
            }
            this.bot.handleCommand(from, line.text);
        }

        this.bot.drainChat();
        await Execution.delayTicks(1);
    }
}
