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
import { liveCatalog, notedId, unnotedId, type Catalog } from '../../api/market/catalog.js';
import {
    CHAT_LIMIT,
    formatAmbiguous,
    formatGp,
    formatPriceList,
    HELP_LINES,
    parseCommand,
    truncateChat
} from '../../api/market/chatProtocol.js';
import { Ledger } from '../../api/market/ledger.js';
import { rowOf, type PriceBook } from '../../api/market/priceBook.js';
import { resolvePrices, rowValid } from '../../api/market/prices.js';
import { normaliseOffer, offerCovers, offersMatch } from '../../api/market/driveMarketTrade.js';
import { appraise, describeAppraisal, type Appraisal, type DeskState } from '../../api/market/appraise.js';
import type { OfferItem } from '../../api/market/quote.js';
import Tile from '../../geometry/Tile.js';
import { Paint, type PaintFrame } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    advertiseDue,
    decideBeat,
    Desk,
    clockOf,
    dealLine,
    dealOf,
    dealTotals,
    floatShortfall,
    FREE_SLOT_FLOOR,
    freshChatLines,
    RateLimiter,
    resolveQuote,
    shouldSettle,
    sideSignature,
    type Deal
} from './marketMakerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const COIN_NAME = 'Coins';
// Why: obj 617 is `fake_coins`, also named "Coins" and also stackable, so resolving the currency by name picks the Pirate's Treasure prop. Nothing on the client's ObjType separates them, so the id is pinned and checked at startup.
const COIN_ID = 995;
/** Chat types the client uses for player speech (Client.ts addChat). */
const PUBLIC_CHAT_TYPES = new Set([1, 2]);
/** Chat type 4 is "<name> wishes to trade with you." */
const TRADE_REQUEST_TYPE = 4;
const CHAT_LINES_PER_READ = 20;
/** One line per this many ms, so a busy shop does not read as spam. */
const CHAT_GAP_MS = 2_000;
const CHAT_REPEAT_MS = 15_000;
/** Outbound lines held at once; the oldest is dropped so a flood cannot build a backlog. */
const CHAT_BACKLOG_CAP = 6;
/** Bank trips that come back empty before the shop gives up on an order and lets the queue move on. */
/** Deals kept for the paint. Newest first, and bounded so a long shift cannot grow without limit. */
const DEAL_LOG_CAP = 250;
/** Panel pixels held back for the control buttons under a filled list. */
const FOOTER_H = 26;
const STOCK_TRIES = 2;
const COMMANDS_PER_WINDOW = 3;
const COMMAND_WINDOW_MS = 10_000;
const COMMAND_PENALTY_MS = 30_000;
/** Ticks between resets, at the live game's 600ms tick. One customer stuck is worth ten minutes, spam is not. */
const RESET_EVERY_TICKS = 1000;
const RESET_EVERY_MS = RESET_EVERY_TICKS * 600;

/** Live chat requests held at once. */
const INTENT_CAP = 24;
/** How far the stand tile may sit from the bank it is meant to use. */
const BANK_REACH = 12;
const SPOT_LEASH = 3;
const ADVERTISE_ITEMS = 4;
/** Beats a customer's side must sit still before the bot touches its own. */
const STILL_BEATS = 3;
/** Times the bot will re-derive its side in one window before giving up. */
const REOFFER_CAP = 12;
/** Beats of waiting on a customer before the window goes back. At one beat a tick, this is about 15 seconds. */
const WAIT_BEATS = 25;
// Why: the engine shuts the offer screen a tick before it opens the confirm screen, so a bare "not open" read drops a trade that is completing normally.
const TRADE_GONE_MS = 3_000;
/** How long to wait for a window we asked for to appear on this client. */
const OPEN_WAIT_MS = 10_000;
/** Why: a bank task that can fail and immediately re-validate is a livelock, so a failed trip backs off. */
const BANK_BACKOFF_MS = 30_000;

export const MARKET_MAKER_SETTINGS: SettingsSchema = {
    priceBook: {
        type: 'string',
        default: '',
        options: [],
        optionsFrom: 'priceBooks',
        label: 'Order book',
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
        help: 'a trade that runs past this is declined and the customer is cooled off'
    },
    intentSeconds: {
        type: 'number',
        default: 90,
        min: 15,
        max: 600,
        label: 'Buy request lifetime (s)',
        help: 'how long "buy 100 iron ore" stays live before the bot forgets it'
    },
    cooldownSeconds: {
        type: 'number',
        default: 15,
        min: 0,
        max: 3600,
        label: 'Cooldown after a failed trade (s)',
        help: 'a customer who opens a trade and does not finish it is ignored for this long'
    },
    coinFloat: {
        type: 'number',
        default: 200_000,
        min: 0,
        max: 100_000_000,
        label: 'Coins to carry (float)',
        help: 'the most the shop can pay in one trade, since only coins in the pack can be offered'
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

type Accepted = { give: Map<number, number>; get: Map<number, number> };

export default class MarketMaker extends TaskBot {
    override loopDelay = 600;

    private book: PriceBook | null = null;
    private cat: Catalog = { byId: new Map(), notedOf: new Map(), unnotedOf: new Map(), items: [] };
    private readonly coinId = COIN_ID;
    private spot = new Tile(2725, 3491, 0);
    private windowMs = 90_000;
    private intentTtlMs = 90_000;
    private cooldownMs = 15_000;
    private advertiseSeconds = 60;
    private coinFloat = 200_000;
    private blacklist: string[] = [];

    private readonly ledger = new Ledger();
    private readonly desk = new Desk(INTENT_CAP);
    private readonly deals: Deal[] = [];
    private readonly limiter = new RateLimiter(COMMANDS_PER_WINDOW, COMMAND_WINDOW_MS, COMMAND_PENALTY_MS);

    private pending: PendingLine[] = [];
    private lastSaidAt = 0;
    private readonly saidRecently = new Map<string, number>();
    private lastChat: string[] = [];
    private readonly tradeRequests = new Set<string>();
    private tradeClosedAt: number | null = null;
    private lastTold = '';
    private bankBackoffUntil = 0;
    private lastStrayLog = 0;

    private lastAdvertiseAt = 0;
    private lastResetAt = 0;
    private advertiseCursor = 0;
    private advertCycle = 0;

    private status = 'starting';
    private startedAt = Date.now();
    private bought = 0;
    private sold = 0;
    private refused = 0;
    private gpIn = 0;
    private gpOut = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        // Why: the obj config unpacks after login, and reading the catalog before it lands reports the coin as missing, which is the same symptom as a genuine cache mismatch.
        await Execution.delayUntil(() => liveCatalog().items.length > 0, 15_000);
        this.cat = liveCatalog();
        const coin = this.cat.byId.get(COIN_ID);
        if (coin?.name !== COIN_NAME || !coin.stackable) {
            this.log(`obj ${COIN_ID} is '${coin?.name ?? 'missing'}', not stackable ${COIN_NAME} — the cache does not match this build, stopping`);
            ScriptRunner.stop('coin id does not match the cache');
            return;
        }

        this.spot = this.settings.tile('spot', this.spot);
        this.windowMs = this.settings.num('engagementTimeoutSeconds', 90) * 1000;
        this.intentTtlMs = this.settings.num('intentSeconds', 90) * 1000;
        this.cooldownMs = this.settings.num('cooldownSeconds', 15) * 1000;
        this.advertiseSeconds = this.settings.num('advertiseSeconds', 60);
        this.coinFloat = this.settings.num('coinFloat', 200_000);
        this.blacklist = this.settings.list('blacklist').map(n => n.trim().toLowerCase()).filter(Boolean);

        const bookName = this.settings.str('priceBook');
        this.book = PriceBooks.byName(bookName);
        if (!this.book || this.book.rows.length === 0) {
            this.log(`order book '${bookName}' is missing or empty, stopping`);
            ScriptRunner.stop('no order book');
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
            this.log('could not read the bank at startup — stopping rather than trade stock I cannot prove');
            ScriptRunner.stop('bank unreadable');
            return;
        }

        this.add(
            new Recover(this),
            new ServeWindow(this),
            new OpenWindow(this),
            new Restock(this),
            new Settle(this),
            new Advertise(this),
            new Listen(this)
        );
    }

    /** Listening and talking are not tasks. */
    // Why: doing either in the lowest-priority task means the shop goes deaf and mute for the length of any bank trip, and chat scrolls out of the client's 20-line buffer while it is away.
    override async loop(): Promise<number | void> {
        this.pumpChat();
        this.drainChat();
        return super.loop();
    }

    /** Read what has been said and act on it. */
    pumpChat(): void {
        const me = reader.localPlayerName() ?? '';
        const now = Date.now();
        for (const line of this.freshChat()) {
            const from = bareName(line.username);
            if (from.length === 0 || sameName(from, me) || this.blocked(from)) {
                continue;
            }
            if (line.type === TRADE_REQUEST_TYPE) {
                this.tradeRequests.add(from);
                continue;
            }
            if (!PUBLIC_CHAT_TYPES.has(line.type)) {
                continue;
            }
            // Why: the cooldown and the budget are checked before the parse, so a flood costs the flooder nothing to send and the bot nothing to answer.
            if (this.desk.onCooldown(from, now) || !this.spend(from, now)) {
                continue;
            }
            this.handleCommand(from, line.text);
        }
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

    setStatus(s: string): void {
        this.status = s;
    }

    windowLimitMs(): number {
        return this.windowMs;
    }

    intentTtl(): number {
        return this.intentTtlMs;
    }

    float(): number {
        return this.coinFloat;
    }

    /** Coins the shop is short of its float that the bank can actually supply. */
    // Why: the bank coin count only moves on a settle trip, and refreshLedger runs at the end of each one with the bank still open, so this is accurate exactly when Settle asks.
    floatShort(): number {
        return floatShortfall(this.packCoins(), this.ledger.held(this.coinId), this.coinFloat);
    }

    /** A modal the bot did not mean to have open is worth saying out loud, once in a while. */
    noteStray(comId: number): void {
        const now = Date.now();
        if (now - this.lastStrayLog > 5_000) {
            this.lastStrayLog = now;
            this.log(`stray modal ${comId} open, closing it`);
        }
    }

    /** How long a dropped customer waits, in words. */
    // Why: hardcoding "a minute" goes wrong the moment the setting is tuned, and the customer is the one who has to believe it.
    coolNote(): string {
        return this.cooldownMs <= 0 ? 'Try again.' : `Ask again in ${Math.round(this.cooldownMs / 1000)}s.`;
    }

    bankReady(nowMs: number): boolean {
        return nowMs >= this.bankBackoffUntil;
    }

    backOffBank(reason: string): void {
        this.bankBackoffUntil = Date.now() + BANK_BACKOFF_MS;
        this.log(`bank trip fell short (${reason}) — backing off ${BANK_BACKOFF_MS / 1000}s`);
    }

    requests(): Set<string> {
        return this.tradeRequests;
    }

    // ---- chat ------------------------------------------------------------

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

    /** Units of one row in the pack, noted and unnoted together. */
    packCount(id: number): number {
        const noted = notedId(this.cat, id);
        return Inventory.countById(id) + (noted === null ? 0 : Inventory.countById(noted));
    }

    packCoins(): number {
        return Inventory.countById(this.coinId);
    }

    /** What the bot can hand over and pay with now: the pack, plus whatever is already on our own side. */
    // Why: an item in the offer has left the pack view, so counting the pack alone makes the bot appraise itself as empty the moment it puts something up, owe nothing, and wait out the window.
    deskState(): DeskState {
        const mine = Trade.active()
            ? normaliseOffer(this.cat, Trade.myOffer() as OfferItem[])
            : new Map<number, number>();
        return {
            available: id => this.packCount(id) + (mine.get(id) ?? 0),
            held: id => this.ledger.held(id) + this.packCount(id) + (mine.get(id) ?? 0),
            purse: this.packCoins() + (mine.get(this.coinId) ?? 0)
        };
    }

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
        this.ledger.setStock([...units].map(([id, count]) => ({ id, count })));
        return true;
    }

    // ---- chat requests ---------------------------------------------------

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
            case 'help':
                this.explain();
                return;
            case 'reset':
                void this.resetState();
                return;
            case 'quoteSell':
                this.wantToBuy(from, cmd.qty, cmd.query, cmd.qtyImplied);
                return;
            case 'quoteBuy':
                // Why: selling to the bot needs no words at all, so the command is answered with the shorter path.
                if (resolveQuote({ cat: this.cat, book: this.activeBook(), query: cmd.query, side: 'buying', qtyImplied: cmd.qtyImplied }).kind !== 'miss' || !cmd.qtyImplied) {
                    this.say('Just trade me and put it up. I price what I see.');
                }
                return;
            case 'none':
        }
    }

    /** First thing a customer hears when their window opens. */
    // Why: the shop's interface is invisible, and the moment someone opens a trade is the one moment they are certain to be looking.
    greet(customer: string): void {
        const want = this.desk.intentFor(customer, Date.now(), this.intentTtlMs);
        if (want === null) {
            this.say('Put items in and I price them as you go. To buy, say what you want first.');
            return;
        }
        const name = this.cat.byId.get(want.itemId)?.name ?? 'that';
        const row = rowOf(this.activeBook(), want.itemId);
        const each = row ? resolvePrices(this.activeBook(), row).sell : 0;
        this.say(`${formatGp(want.maxQty)} x ${name} = ${formatGp(want.maxQty * each)}gp. Put that up.`);
    }

    /** Back to an empty desk: no window, nothing owed, nobody cooling off. Rate limited, it discards work. */
    // Why: the shop can tie itself up past talking to, and the alternative is an operator restarting the script.
    private async resetState(): Promise<void> {
        const now = Date.now();
        const since = now - this.lastResetAt;
        if (this.lastResetAt > 0 && since < RESET_EVERY_MS) {
            const mins = Math.ceil((RESET_EVERY_MS - since) / 60_000);
            this.say(`Already reset. Ask again in ${mins}m.`);
            return;
        }

        this.lastResetAt = now;
        this.log('reset asked for in chat, clearing the desk');
        this.say('Resetting. Trade me again in a moment.');

        if (Trade.active()) {
            await Trade.decline();
        }
        this.desk.clear();
        this.tradeRequests.clear();
        this.tradeClosedAt = null;
        this.lastTold = '';
        this.setStatus('reset, open for business');
    }

    /** Say how the shop works. */
    explain(): void {
        for (const line of HELP_LINES) {
            this.say(line);
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

    private wantToBuy(from: string, want: number | 'all', query: string, qtyImplied: boolean): void {
        const book = this.activeBook();
        const target = resolveQuote({ cat: this.cat, book, query, side: 'selling', qtyImplied });
        if (target.kind === 'miss') {
            if (target.answer) {
                this.say(`I don't sell '${query}'.`);
            }
            return;
        }
        if (target.kind === 'ambiguous') {
            this.say(formatAmbiguous(target.candidates));
            return;
        }

        const hit = target;
        const { sell } = resolvePrices(book, rowOf(book, hit.id)!);
        const asked = want === 'all' ? Math.floor(book.maxTradeValue / sell) : want;
        // Why: the bank is the shop's stock and the pack is only what it happens to be carrying, so the quote is sized against both and the difference is a bank trip, not a refusal.
        const maxQty = Math.min(asked, this.deskState().held(hit.id), Math.floor(book.maxTradeValue / sell));
        if (maxQty <= 0) {
            this.say(`I have no ${hit.name} right now.`);
            return;
        }

        this.desk.remember({ customer: from, itemId: hit.id, maxQty, askedAtMs: Date.now() });
        const carried = this.packCount(hit.id) >= maxQty;
        const price = `${formatGp(maxQty)} x ${hit.name} = ${formatGp(maxQty * sell)}gp (${formatGp(sell)}ea).`;
        this.say(`${price} ${carried ? 'Trade me.' : 'Give me a moment.'}`);
    }

    // ---- the window ------------------------------------------------------

    /** What the bot should have on its own side, given what the customer has on theirs. */
    appraiseNow(customer: string): Appraisal {
        const theirOffer = Trade.theirOffer() as OfferItem[];
        let intent = this.desk.intentFor(customer, Date.now(), this.intentTtlMs);
        if (intent !== null && theirOffer.some(o => o.id !== this.coinId)) {
            // Why: once the shop has staked the goods it asked to be paid for, it stays a sale and names the
            // Why: items it will not count. Flipping then would ignore the coins and leave its own side stranded.
            const mine = normaliseOffer(this.cat, Trade.myOffer() as OfferItem[]);
            if ((mine.get(intent.itemId) ?? 0) <= 0) {
                // Why: nothing staked means the request was never acted on, so the goods in front of the shop win.
                this.desk.forget(customer);
                intent = null;
            }
        }
        return appraise({
            book: this.activeBook(),
            cat: this.cat,
            desk: this.deskState(),
            coinId: this.coinId,
            theirOffer,
            intent
        });
    }

    /** Tell the customer what their side is worth, once per distinct valuation. */
    tellAppraisal(a: Appraisal): void {
        const line = describeAppraisal(a);
        if (line !== this.lastTold) {
            this.lastTold = line;
            this.say(line);
        }
    }

    /** Clear our side and rebuild it from what we owe. */
    // Why: two operations that cannot drift, where nudging item by item has to reason about what is already up.
    async putUp(owe: ReadonlyMap<number, number>): Promise<boolean> {
        await Trade.removeAll();
        for (const [id, want] of owe) {
            const name = this.cat.byId.get(id)?.name;
            if (name === undefined) {
                return false;
            }
            let left = want;
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

    /** null until the confirm screen has filled. */
    confirmMatches(accepted: Accepted): boolean | null {
        if (!reader.tradeConfirmReady()) {
            return null;
        }
        const shown = reader.tradeConfirmOffers();
        return offersMatch(normaliseOffer(this.cat, shown.mine as OfferItem[]), accepted.give)
            && offersMatch(normaliseOffer(this.cat, shown.theirs as OfferItem[]), accepted.get);
    }

    completed(accepted: Accepted, customer: string): void {
        for (const [id, qty] of accepted.give) {
            if (id === this.coinId) {
                this.gpOut += qty;
            } else {
                this.ledger.add(id, -qty);
            }
        }
        for (const [id, qty] of accepted.get) {
            if (id === this.coinId) {
                this.gpIn += qty;
            } else {
                this.ledger.add(id, qty);
            }
        }
        if (accepted.give.has(this.coinId)) {
            this.bought++;
        } else {
            this.sold++;
        }
        const deal = dealOf({ give: accepted.give, get: accepted.get, coinId: this.coinId, customer, atMs: Date.now() });
        if (deal !== null) {
            this.deals.unshift(deal);
            this.deals.length = Math.min(this.deals.length, DEAL_LOG_CAP);
        }
        this.desk.forget(customer);
        this.desk.close();
        this.tradeClosedAt = null;
        this.lastTold = '';
        this.log(`trade complete with ${customer}`);
        this.say(`Thanks ${customer}. Pleasure doing business.`);
    }

    /** Let a customer go without a cooldown, for a failure that was not theirs. */
    release(customer: string, reason: string): void {
        this.desk.close();
        this.tradeClosedAt = null;
        this.lastTold = '';
        this.log(`released ${customer}: ${reason}`);
    }

    /** Drop the window in flight and ignore the customer for a while. */
    // Why: a stall and a probe of the refusal rules look identical from here, so the cost lands on whoever failed the trade rather than on everyone behind them.
    abandon(customer: string, reason: string): void {
        this.refused++;
        this.desk.forget(customer);
        this.desk.close();
        this.tradeClosedAt = null;
        this.lastTold = '';
        if (this.cooldownMs > 0) {
            this.desk.cool(customer, Date.now() + this.cooldownMs);
        }
        this.log(`dropped ${customer}: ${reason}`);
    }

    /** One line, since the live harness surfaces a bounded number of log lines per poll. */
    describeWindow(a: Appraisal): string {
        const show = (m: ReadonlyMap<number, number>): string =>
            [...m].map(([id, n]) => `${this.cat.byId.get(id)?.name ?? id}(${id})x${n}`).join('+') || 'nothing';
        const mine = normaliseOffer(this.cat, Trade.myOffer() as OfferItem[]);
        const theirs = normaliseOffer(this.cat, Trade.theirOffer() as OfferItem[]);
        return `window: owe=${show(a.owe)}; mine=${show(mine)} theirs=${show(theirs)}`;
    }

    /** Age out the window deadline and an abandoned window. */
    dropExpired(): void {
        const now = Date.now();
        const open = this.desk.current();

        if (open && this.desk.expired(now, this.windowMs)) {
            this.say(`Trade declined. ${this.coolNote()}`);
            this.abandon(open.customer, 'ran past the transaction window');
            return;
        }

        // Why: a request sent as a modal closes can open the window on their client alone, leaving the bot holding one it cannot see until the deadline.
        if (open && !open.sawOpen && now - open.openedAtMs > OPEN_WAIT_MS) {
            this.say('That did not open. Trade me again.');
            this.release(open.customer, 'the window never opened on my side');
            return;
        }

        if (open && open.sawOpen && !Trade.active()) {
            if (this.tradeClosedAt === null) {
                this.tradeClosedAt = now;
            } else if (now - this.tradeClosedAt >= TRADE_GONE_MS) {
                this.say(`Trade closed. ${this.coolNote()}`);
                this.abandon(open.customer, 'customer closed the window');
            }
        } else {
            this.tradeClosedAt = null;
        }

        this.desk.pruneIntents(now, this.intentTtlMs);
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
        // Why: a price list alone never tells a passer-by how to trade at all, so every other line is the how-to.
        this.advertCycle++;
        if (this.advertCycle % 2 === 0) {
            this.say(HELP_LINES[0]);
            this.say(HELP_LINES[1]);
        } else {
            const [first] = formatPriceList(entries, 'both');
            if (first !== undefined) {
                this.say(truncateChat(`Trading: ${first}`.slice(0, CHAT_LIMIT)));
            }
        }
        this.lastAdvertiseAt = Date.now();
    }

    advertiseIsDue(): boolean {
        return advertiseDue(this.lastAdvertiseAt, Date.now(), this.advertiseSeconds);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fb3ff' });
        p.title(`MarketMaker — ${this.status}`);
        switch (p.tabs('marketmaker', ['Deals', 'Summary', 'Stock', 'Book'])) {
            case 'Summary':
                this.paintSummary(p);
                break;
            case 'Stock':
                this.paintStock(p);
                break;
            case 'Book':
                this.paintBook(p);
                break;
            default:
                this.paintDeals(p);
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private paintDeals(p: PaintFrame): void {
        const lines = this.deals.map(d =>
            dealLine({
                clock: clockOf(d.atMs),
                customer: d.customer,
                kind: d.kind,
                count: d.count,
                item: this.cat.byId.get(d.itemId)?.name ?? `item ${d.itemId}`,
                gp: d.gp,
                mixed: d.mixed
            })
        );
        const t = dealTotals(this.deals);
        p.fill('mm-deals', lines, {
            reserve: FOOTER_H,
            footer: `net ${t.net >= 0 ? '+' : ''}${formatGp(t.net)} · float ${formatGp(this.packCoins())}`
        });
    }

    private paintSummary(p: PaintFrame): void {
        const mins = (Date.now() - this.startedAt) / 60_000;
        const t = dealTotals(this.deals);
        const w = this.desk.current();
        p.row(`Runtime: ${fmtDuration(mins)}`, `Book: ${this.book?.name ?? '-'}`, `Spread: ${this.book?.margin ?? 0}%`);
        p.row(`Sold: ${this.sold}`, `Bought: ${this.bought}`, `Refused: ${this.refused}`);
        p.row(`GP in: ${formatGp(this.gpIn)}`, `GP out: ${formatGp(this.gpOut)}`, `Net: ${t.net >= 0 ? '+' : ''}${formatGp(t.net)}`);
        p.row(
            `Per hour: ${mins > 1 ? `${formatGp(Math.round(t.net / (mins / 60)))}` : '-'}`,
            `Deals: ${t.count}`,
            `Serving: ${w?.customer ?? 'nobody'}`
        );
        p.gap(2);
        p.bar('Float', this.float() > 0 ? this.packCoins() / this.float() : 0);
        p.bar('Pack', Inventory.used() / 28);
        const rows = this.activeBook().rows.filter(r => rowValid(this.activeBook(), r));
        const stocked = rows.filter(r => this.ledger.held(r.id) + this.packCount(r.id) > 0).length;
        p.bar('Stock', rows.length > 0 ? stocked / rows.length : 0);
    }

    private paintStock(p: PaintFrame): void {
        const book = this.activeBook();
        const lines = book.rows
            .map(r => {
                const held = this.ledger.held(r.id) + this.packCount(r.id);
                const full = r.cap > 0 ? Math.min(1, held / r.cap) : 0;
                const filled = Math.round(full * 5);
                const name = this.cat.byId.get(r.id)?.name ?? `item ${r.id}`;
                return { held, text: `${name.padEnd(20).slice(0, 20)} ${'#'.repeat(filled)}${'.'.repeat(5 - filled)} ${formatGp(held)} / ${formatGp(r.cap)}` };
            })
            .sort((a, b) => a.held - b.held)
            .map(r => (r.held === 0 ? { text: r.text, color: '#e05b5b' } : r.text));
        p.fill('mm-stock', lines, { reserve: FOOTER_H, footer: 'empty rows first' });
    }

    private paintBook(p: PaintFrame): void {
        const book = this.activeBook();
        const lines = book.rows.map(r => {
            const { buy, sell } = resolvePrices(book, r);
            const name = this.cat.byId.get(r.id)?.name ?? `item ${r.id}`;
            const sides = `${r.buying ? 'B' : '-'}${r.selling ? 'S' : '-'}`;
            const text = `${name.padEnd(20).slice(0, 20)} ${formatGp(buy).padStart(8)} ${formatGp(sell).padStart(8)} ${formatGp(r.cap).padStart(7)}  ${sides}`;
            return rowValid(book, r) ? text : { text, color: '#e05b5b' };
        });
        p.fill('mm-book', lines, {
            reserve: FOOTER_H,
            footer: `${book.name} · spread ${book.margin}% · max ${formatGp(book.maxTradeValue)}`
        });
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
        const main = reader.modals().main;
        if (main !== -1) {
            this.bot.setStatus('closing a stray window');
            this.bot.noteStray(main);
            actions.closeModal();
            await Execution.delayTicks(1);
            return;
        }
        this.bot.setStatus('walking back to the stand');
        await Traversal.walkResilient(this.bot.standTile(), { radius: 1, timeoutMs: 60_000, log: m => this.bot.log(m) });
    }
}

/** The window is the transaction. Owns the loop while it is open, since movement cancels it. */
// Why: the bot's side is re-derived from the customer's every beat, so nothing here outlives the window.
class ServeWindow implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return Trade.active() && this.bot.counter().current() !== null;
    }

    async execute(): Promise<void> {
        const w = this.bot.counter().current()!;
        if (!w.sawOpen) {
            this.bot.log(`window with ${w.customer} is open on my side`);
            this.bot.greet(w.customer);
        }
        w.sawOpen = true;
        const partner = Trade.partner();
        if (partner !== null && !sameName(partner, w.customer)) {
            this.bot.log(`window opened with ${partner}, not ${w.customer} — declining`);
            await Trade.decline();
            this.bot.abandon(w.customer, 'someone else opened the window');
            return;
        }

        if (Trade.onConfirmScreen()) {
            await this.confirm(w.customer, w.accepted);
            return;
        }

        const a = this.bot.appraiseNow(w.customer);
        const cat = this.bot.catalog();
        const theirSig = sideSignature(normaliseOffer(cat, Trade.theirOffer() as OfferItem[]));
        const mine = normaliseOffer(cat, Trade.myOffer() as OfferItem[]);

        const theirs = normaliseOffer(cat, Trade.theirOffer() as OfferItem[]);
        const beat = decideBeat({
            theirSig,
            window: w,
            oweMatched: offersMatch(mine, a.owe),
            wantMatched: offerCovers(theirs, a.want),
            oweAnything: a.owe.size > 0,
            stillBeatsNeeded: STILL_BEATS,
            reOfferCap: REOFFER_CAP,
            waitCap: WAIT_BEATS
        });
        w.waited = beat.do === 'wait' ? w.waited + 1 : 0;

        if (theirSig === w.lastSig) {
            w.stillBeats++;
        } else {
            w.stillBeats = 0;
            w.lastSig = theirSig;
            this.bot.tellAppraisal(a);
        }

        this.bot.setStatus(`${w.customer}: ${beat.do}`);

        switch (beat.do) {
            case 'offer':
                w.reOffers++;
                if (!(await this.bot.putUp(a.owe))) {
                    this.bot.log(this.bot.describeWindow(a));
                    await Trade.decline();
                    this.bot.abandon(w.customer, 'could not put up what I owe');
                }
                return;
            case 'accept':
                w.accepted = { give: new Map(a.owe), get: normaliseOffer(cat, Trade.theirOffer() as OfferItem[]) };
                await Trade.accept();
                return;
            case 'give-up':
                this.bot.say(`Trade declined: ${beat.reason}. ${this.bot.coolNote()}`);
                await Trade.decline();
                this.bot.abandon(w.customer, beat.reason);
                return;
            case 'wait':
                await Execution.delayTicks(1);
        }
    }

    /** The screen the accept lands on, re-read from its own components. */
    private async confirm(customer: string, accepted: Accepted | null): Promise<void> {
        if (!accepted) {
            await Trade.decline();
            this.bot.abandon(customer, 'confirm screen with nothing agreed');
            return;
        }
        const ok = this.bot.confirmMatches(accepted);
        if (ok === null) {
            await Execution.delayTicks(1);
            return;
        }
        if (!ok) {
            this.bot.say(`Trade declined: the confirm screen changed. ${this.bot.coolNote()}`);
            await Trade.decline();
            this.bot.abandon(customer, 'confirm screen does not match what was accepted');
            return;
        }
        await Trade.accept();
        await Execution.delayUntil(() => !Trade.active(), 8_000);
        if (!Trade.active()) {
            this.bot.completed(accepted, customer);
        }
    }
}

/** Take whoever asked first. The engine turns the rest away while a window is open. */
class OpenWindow implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        // Why: requesting while the bank is still closing opens the window on their client and not on ours, and the bot then owns a window it cannot see.
        if (this.bot.counter().current() !== null || this.bot.requests().size === 0 || Trade.active() || reader.modals().main !== -1) {
            return false;
        }
        // Why: this task runs ahead of Restock, so claiming the tick when every request is waiting on a bank trip starves the fetch that would let any of them open.
        const now = Date.now();
        return [...this.bot.requests()].some(name => {
            if (this.bot.blocked(name) || this.bot.counter().onCooldown(name, now)) {
                return true;
            }
            const want = this.bot.counter().intentFor(name, now, this.bot.intentTtl());
            return want === null || this.bot.packCount(want.itemId) >= want.maxQty;
        });
    }

    async execute(): Promise<void> {
        const now = Date.now();
        for (const name of [...this.bot.requests()]) {
            if (this.bot.blocked(name) || this.bot.counter().onCooldown(name, now)) {
                this.bot.requests().delete(name);
                continue;
            }

            // Why: opening before the goods are in the pack strands the window, because Restock cannot run while one is open and the bot then owes nothing until the deadline.
            const want = this.bot.counter().intentFor(name, now, this.bot.intentTtl());
            if (want !== null && this.bot.packCount(want.itemId) < want.maxQty) {
                const what = this.bot.catalog().byId.get(want.itemId)?.name ?? 'that';
                this.bot.say(`Fetching your ${what}, one moment.`);
                continue;
            }

            this.bot.requests().delete(name);
            this.bot.setStatus(`opening a window with ${name}`);
            this.bot.log(`opening a window with ${name}`);
            this.bot.counter().open(name, now);
            if (!(await Trade.request(name))) {
                this.bot.log(`${name} is not in range to trade`);
                this.bot.say(`${name}, stand next to me.`);
            }
            return;
        }
        await Execution.delayTicks(1);
    }
}

/** Fetch the goods a chat request named, before its customer turns up. */
class Restock implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        if (Trade.active() || this.bot.counter().current() !== null) {
            return false;
        }
        if (!this.bot.bankReady(Date.now())) {
            return false;
        }
        const want = this.bot.counter().nextIntent(Date.now(), this.bot.intentTtl());
        return want !== null && this.bot.packCount(want.itemId) < want.maxQty;
    }

    async execute(): Promise<void> {
        const want = this.bot.counter().nextIntent(Date.now(), this.bot.intentTtl())!;
        const name = this.bot.catalog().byId.get(want.itemId)?.name ?? String(want.itemId);
        this.bot.setStatus(`fetching ${name} for ${want.customer}`);

        if (!(await Banking.open({ stand: this.bot.standTile(), boothName: BOOTH.name, boothOp: BOOTH.op, log: m => this.bot.log(m) }))) {
            this.bot.log('could not open the bank to restock');
            return;
        }
        await Bank.setNoteMode(true);

        const short = want.maxQty - this.bot.packCount(want.itemId);
        if (short > 0) {
            await Bank.withdrawXById(want.itemId, short);
            // Why: note mode delivers the cert id, so Bank.withdrawXById waits on an id that never arrives and reports false on a withdrawal that worked.
            if (!(await Execution.delayUntil(() => this.bot.packCount(want.itemId) >= want.maxQty, 5_000))) {
                this.bot.backOffBank(`${name} ${this.bot.packCount(want.itemId)}/${want.maxQty}`);
            }
        }

        await this.bot.refreshLedger();
        await Bank.close();
        // Why: the modal reads closed a tick before the engine has settled it, and a trade request sent in that gap opens the window on the customer's client alone. Every purchase runs into it, since fetching the goods puts a bank trip directly in front of opening the window.
        await Execution.delayTicks(2);

        const got = this.bot.packCount(want.itemId);
        if (got >= want.maxQty) {
            this.bot.counter().renew(want.customer, Date.now());
            this.bot.say(`Got your ${name} ${want.customer}. Trade me.`);
            return;
        }
        if (got > 0) {
            // Why: the order is cut to what arrived, or Restock keeps going back for the rest and never lets Settle run.
            this.bot.counter().limitTo(want.customer, got);
            this.bot.counter().renew(want.customer, Date.now());
            this.bot.say(`${want.customer}, I could only get ${formatGp(got)} x ${name}. Trade me.`);
            return;
        }
        if (this.bot.counter().missedStock(want.customer, STOCK_TRIES)) {
            this.bot.say(`${want.customer}, I could not get your ${name}. Ask me again.`);
            this.bot.counter().forget(want.customer);
        }
    }
}

/** Bank the takings and keep the coin float topped up. */
class Settle implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        if (Trade.active() || this.bot.counter().current() !== null || !this.bot.bankReady(Date.now())) {
            return false;
        }
        // Why: holding an order used to block banking outright, so a pack that filled up could never be emptied:
        // Why: Restock kept going back for goods with no room to put them, and the shop lived at the bank.
        const outOfRoom = Inventory.free() <= FREE_SLOT_FLOOR;
        if (!outOfRoom && this.bot.counter().nextIntent(Date.now(), this.bot.intentTtl()) !== null) {
            return false;
        }
        return shouldSettle(Inventory.free(), this.bot.packCoins(), this.bot.float())
            || this.bot.floatShort() > 0;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('banking the takings');
        if (!(await Banking.open({ stand: this.bot.standTile(), boothName: BOOTH.name, boothOp: BOOTH.op, log: m => this.bot.log(m) }))) {
            this.bot.backOffBank('could not open the bank');
            return;
        }

        // Why: an empty pack has nothing to deposit, and the deposit path bails on the side backpack view rather than no-opping.
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true, m => this.bot.log(m));
        }

        // Why: read the float off the live bank rather than the ledger, which goes stale when a trip has gone wrong.
        const short = this.bot.float() - this.bot.packCoins();
        const inBank = Bank.countById(this.bot.coins());
        if (short > 0 && inBank > 0) {
            await Bank.setNoteMode(false);
            await Bank.withdrawXById(this.bot.coins(), Math.min(short, inBank));
            await Execution.delayUntil(() => this.bot.packCoins() >= Math.min(this.bot.float(), inBank), 5_000);
        }

        if (!(await this.bot.refreshLedger()) || this.bot.packCoins() < Math.min(this.bot.float(), inBank)) {
            this.bot.backOffBank(`float ${this.bot.packCoins()}/${this.bot.float()}`);
        }
        await Bank.close();
        // Why: the modal reads closed a tick before the engine has settled it, and a trade request sent in that gap opens the window on the customer's client alone. Every purchase runs into it, since fetching the goods puts a bank trip directly in front of opening the window.
        await Execution.delayTicks(2);
    }
}

class Advertise implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return !Trade.active() && this.bot.advertiseIsDue();
    }

    async execute(): Promise<void> {
        this.bot.advertiseNow();
        await Execution.delayTicks(1);
    }
}

/** Always last: ages out the window. Chat is pumped from the loop, not from here. */
class Listen implements Task {
    constructor(private readonly bot: MarketMaker) {}

    validate(): boolean {
        return true;
    }

    async execute(): Promise<void> {
        const w = this.bot.counter().current();
        this.bot.setStatus(w ? `serving ${w.customer}` : 'open for business');
        this.bot.dropExpired();
        await Execution.delayTicks(1);
    }
}
