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
import { advertiseDue, Queue, shouldRestock, shouldSettle, type Engagement } from './marketMakerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const COIN_NAME = 'Coins';
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
        label: 'Engagement timeout (s)',
        help: 'a customer who quotes and never trades is dropped after this, freeing their reserved stock'
    },
    maxQueue: {
        type: 'number',
        default: 4,
        min: 1,
        max: 10,
        label: 'Customers in the queue'
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
    private queue = new Queue(4);
    private readonly tradeState = { waitedTicks: 0 };

    private pending: PendingLine[] = [];
    private lastSaidAt = 0;
    private readonly saidRecently = new Map<string, number>();
    private lastChatSig: string | null = null;
    private readonly tradeRequests = new Set<string>();

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
        this.coinId = this.cat.items.find(r => r.name === COIN_NAME)?.id ?? -1;
        if (this.coinId === -1) {
            this.log('the item catalog has no Coins entry, so nothing can be priced — stopping');
            ScriptRunner.stop('no Coins in the catalog');
            return;
        }

        this.spot = this.settings.tile('spot', this.spot);
        this.engagementTimeoutMs = this.settings.num('engagementTimeoutSeconds', 90) * 1000;
        this.advertiseSeconds = this.settings.num('advertiseSeconds', 60);
        this.coinFloat = this.settings.num('coinFloat', 50_000);
        this.blacklist = this.settings.list('blacklist').map(n => n.trim().toLowerCase()).filter(Boolean);
        this.queue = new Queue(this.settings.num('maxQueue', 4));

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
            new OpenTrade(this),
            new Restock(this),
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

    engagements(): Queue {
        return this.queue;
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

    /** Queue a line. Draining is rate limited so a busy shop does not read as spam. */
    say(text: string): void {
        const line = truncateChat(text);
        if (line.length === 0 || this.pending.some(p => p.text === line)) {
            return;
        }
        this.pending.push({ text: line, atMs: Date.now() });
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

    /** Newest-first chat since the last read, oldest-first on the way out. */
    freshChat(): { type: number; username: string | null; text: string }[] {
        const lines = reader.chat(CHAT_LINES_PER_READ);
        if (lines.length === 0) {
            return [];
        }
        const sig = (l: { type: number; username: string | null; text: string }) =>
            `${l.type}|${l.username ?? ''}|${l.text}`;

        if (this.lastChatSig === null) {
            this.lastChatSig = sig(lines[0]);
            return [];
        }

        const fresh: typeof lines = [];
        for (const line of lines) {
            if (sig(line) === this.lastChatSig) {
                break;
            }
            fresh.push(line);
        }
        this.lastChatSig = sig(lines[0]);
        return fresh.reverse();
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
                this.quoteSale(from, cmd.qty, cmd.query);
                return;
            case 'quoteBuy':
                this.quotePurchase(from, cmd.qty, cmd.query);
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
            this.say(formatAmbiguous(candidates.map(c => c.name)));
            return null;
        }
        return { id: candidates[0].id, name: candidates[0].name };
    }

    private quoteSale(from: string, want: number | 'all', query: string): void {
        const book = this.activeBook();
        const hit = this.resolveRow(query, 'selling');
        if (!hit) {
            return;
        }
        const row = rowOf(book, hit.id)!;
        const { sell } = resolvePrices(book, row);

        const available = this.ledger.available(hit.id, this.packCount(hit.id));
        let qty = want === 'all' ? available : Math.min(want, available);
        qty = Math.min(qty, Math.floor(book.maxTradeValue / sell));
        if (qty <= 0) {
            this.say(available <= 0 ? `Out of ${hit.name}.` : `${hit.name} is over my ${formatGp(book.maxTradeValue)}gp trade cap.`);
            return;
        }

        if (!this.ledger.reserve(from, hit.id, qty, Date.now())) {
            this.say(`Someone beat you to that ${hit.name}.`);
            return;
        }

        const engagement: Engagement = {
            customer: from,
            kind: 'sell',
            give: new Map([[hit.id, qty]]),
            get: new Map([[this.coinId, qty * sell]]),
            quotedAtMs: Date.now(),
            opened: false
        };
        this.offerQuote(from, engagement, formatSellQuote(hit.name, qty, sell));
    }

    private quotePurchase(from: string, want: number | 'all', query: string): void {
        const book = this.activeBook();
        const hit = this.resolveRow(query, 'buying');
        if (!hit) {
            return;
        }
        const row = rowOf(book, hit.id)!;
        const { buy } = resolvePrices(book, row);

        const room = roomUnderCap(row.cap, this.ledger.held(hit.id) + this.packCount(hit.id), 0);
        const purse = this.ledger.available(this.coinId, this.packCoins());
        const affordable = Math.floor(purse / buy);
        let qty = Math.min(want === 'all' ? room : want, room, affordable);
        qty = Math.min(qty, Math.floor(book.maxTradeValue / buy));
        if (qty <= 0) {
            this.say(room <= 0 ? `I'm full on ${hit.name}.` : `I can't afford that many ${hit.name}.`);
            return;
        }

        const total = qty * buy;
        if (!this.ledger.reserve(from, this.coinId, total, Date.now())) {
            this.say('My coins are spoken for, one moment.');
            return;
        }

        const engagement: Engagement = {
            customer: from,
            kind: 'buy',
            give: new Map([[this.coinId, total]]),
            get: new Map([[hit.id, qty]]),
            quotedAtMs: Date.now(),
            opened: false
        };
        this.offerQuote(from, engagement, formatBuyQuote(hit.name, qty, buy));
    }

    private offerQuote(from: string, engagement: Engagement, quote: string): void {
        const placed = this.queue.enqueue(from, engagement);
        if (placed === 'full') {
            this.ledger.release(from);
            this.say('Queue is full, ask again in a minute.');
            return;
        }
        this.say(quote);
        if (placed === 'queued') {
            this.say(`You're #${this.queue.size() - 1} in the queue.`);
        }
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
        this.queue.finish(e.customer);
        this.log(`trade complete with ${e.customer} (${e.kind})`);
        this.say(`Thanks ${e.customer}. Pleasure doing business.`);
    }

    abandon(e: Engagement, reason: string): void {
        this.refused++;
        this.ledger.release(e.customer);
        this.queue.finish(e.customer);
        this.log(`dropped ${e.customer}: ${reason}`);
    }

    dropExpired(): void {
        const now = Date.now();
        for (const name of this.queue.expire(now, this.engagementTimeoutMs)) {
            this.ledger.release(name);
            this.log(`${name} never traded, releasing their hold`);
        }
        this.ledger.expire(now, this.engagementTimeoutMs);
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
            this.say(truncateChat(`Buying/selling: ${first}`.slice(0, CHAT_LIMIT)));
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
        const e = this.queue.current();
        p.row(`Runtime: ${fmtDuration(mins)}`, `Book: ${this.book?.name ?? '-'}`, `Spread: ${this.book?.margin ?? 0}%`);
        p.row(`Sold: ${this.sold}`, `Bought: ${this.bought}`, `Refused: ${this.refused}`);
        p.row(`GP in: ${formatGp(this.gpIn)}`, `GP out: ${formatGp(this.gpOut)}`, `Pack coins: ${formatGp(this.packCoins())}`);
        p.row(`Serving: ${e?.customer ?? 'nobody'}`, `Queue: ${this.queue.size()}`, `Pack: ${Inventory.used()}/28`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
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
        const e = this.bot.engagements().current();
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
            this.bot.say(`Trade declined: ${decision.reason}.`);
            this.bot.abandon(e, decision.reason);
        }
    }
}

/** Open the screen once the engaged customer has sent a trade request. */
class OpenTrade implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        const e = this.bot.engagements().current();
        if (!e || e.opened || Trade.active()) {
            return false;
        }
        return [...this.bot.requests()].some(name => sameName(name, e.customer));
    }

    async execute(): Promise<void> {
        const e = this.bot.engagements().current()!;
        this.bot.setStatus(`opening a trade with ${e.customer}`);
        this.bot.requests().clear();
        this.bot.engagements().markOpened(e.customer);
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
        const e = this.bot.engagements().current();
        if (!e || e.opened) {
            return false;
        }
        return shouldRestock(e.give, id => (id === this.bot.coins() ? this.bot.packCoins() : this.bot.packCount(id)));
    }

    async execute(): Promise<void> {
        const e = this.bot.engagements().current()!;
        this.bot.setStatus(`fetching ${e.customer}'s order`);

        if (!(await Banking.open({ stand: this.bot.standTile(), boothName: BOOTH.name, boothOp: BOOTH.op, log: m => this.bot.log(m) }))) {
            this.bot.log('could not open the bank to restock');
            return;
        }
        await Bank.setNoteMode(true);

        for (const [id, want] of e.give) {
            const held = id === this.bot.coins() ? this.bot.packCoins() : this.bot.packCount(id);
            const short = want - held;
            if (short <= 0) {
                continue;
            }
            if (!(await Bank.withdrawXById(id, short))) {
                this.bot.log(`bank has no ${this.bot.catalog().byId.get(id)?.name ?? id} to withdraw`);
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
        if (Trade.active() || this.bot.engagements().current() !== null) {
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
        const e = this.bot.engagements().current();
        this.bot.setStatus(e ? `waiting on ${e.customer}` : 'open for business');
        this.bot.dropExpired();

        const me = reader.localPlayerName() ?? '';
        for (const line of this.bot.freshChat()) {
            const from = (line.username ?? '').trim();
            if (from.length === 0 || sameName(from, me) || this.bot.blocked(from)) {
                continue;
            }
            if (line.type === TRADE_REQUEST_TYPE) {
                this.bot.requests().add(from);
                continue;
            }
            if (PUBLIC_CHAT_TYPES.has(line.type)) {
                this.bot.handleCommand(from, line.text);
            }
        }

        this.bot.drainChat();
        await Execution.delayTicks(1);
    }
}
