import { reader } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { PriceBooks } from '../../api/market/bookStore.js';
import { liveCatalog, type Catalog } from '../../api/market/catalog.js';
import type { PriceBook } from '../../api/market/priceBook.js';
import { Players } from '../../api/players/Players.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { namesMatch } from '../../api/trade/PartnerTrade.js';
import { Trade } from '../../api/trade/Trade.js';
import { Modals } from '../../api/ui/widgets/Modals.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { jiveFrame } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { COINS, PACK, acceptAction, adapt, decide, heldWithOffer, parseMakerLine, pileValue, planPile, sellables, type MakerNote, type PileLine, type Sellable, type Step } from './logic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const PUBLIC_CHAT_TYPES = new Set([1, 2]);
const CHAT_LINES = 20;
const CATALOG_WAIT_MS = 15_000;
const WALK_MS = 120_000;
/** The engine refuses a request while the maker banks; one request, one long wait, then a pause before the next. */
const WINDOW_WAIT_MS = 40_000;
const BUSY_PAUSE_MS = 3_000;
const OFFER_SETTLE_MS = 5_000;
const COINS_WAIT_MS = 45_000;
/** Ticks with neither screen up that still count as the handover between them. */
const HANDOVER_TICKS = 3;
const ACCEPT_STEPS = 30;
const ACCEPT_STEP_MS = 900;
const COINS_LAND_MS = 5_000;
/** Under the maker's 90 s engagement timeout, so the window is ours to close. */
const WINDOW_MS = 80_000;
const CORRECTIONS = 2;
const MAKER_MISSES = 10;
const TOP_LINES = 3;

export const SETTINGS: SettingsSchema = {
    maker: { type: 'string', default: '', label: 'Maker name', help: 'the player running MarketMaker; start this script standing beside it' },
    priceBook: { type: 'string', default: '', options: [], optionsFrom: 'priceBooks', label: 'Order book', help: "the maker's book, so only what it buys leaves the bank" },
    maxPerTrade: { type: 'number', default: 200_000, min: 1_000, max: 10_000_000, label: 'Max gp a trade', help: "the maker's coin float; it pays only what it carries and bids that ceiling for a dearer pile" }
};

interface Sale {
    lines: PileLine[];
    gp: number;
}

export default class JiveMarketDumper extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private cat: Catalog | null = null;
    private book: PriceBook | null = null;
    private bankAccess = BOOTH;
    private bankTile: Tile | null = null;
    private bankName = 'the bank';
    trades = 0;
    gp = 0;
    private soldByName = new Map<string, number>();
    private lastBank: Sellable[] = [];

    maker = '';
    cap = 0;
    /** Rows the maker would not count, by unnoted id, kept out of every later pile. */
    dropped = new Set<number>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.maker = this.settings.str('maker', '').trim();
        if (this.maker === '') {
            ScriptRunner.stop('[dumper] no maker named in the settings');
            return;
        }
        const book = PriceBooks.byName(this.settings.str('priceBook', ''));
        if (!book || book.rows.length === 0) {
            ScriptRunner.stop('[dumper] no order book chosen, or the book is empty');
            return;
        }
        this.book = book;
        this.cap = Math.min(this.settings.num('maxPerTrade', 200_000), book.maxTradeValue);
        this.startedAt = Date.now();

        if (!(await Execution.delayUntil(() => liveCatalog().items.length > 0, CATALOG_WAIT_MS))) {
            ScriptRunner.stop('[dumper] the item catalogue never loaded');
            return;
        }
        this.cat = liveCatalog();
        if (!(await this.resolveBank())) {
            return;
        }
        this.log(`[dumper] selling to ${this.maker} from the ${book.name} book, ${book.rows.filter(r => r.buying).length} rows bought, up to ${this.cap.toLocaleString()}gp a trade, banking at ${this.bankName}`);
        this.add(new ContinueDialog(), new Sell(this), new Approach(this), new Restock(this));
    }

    private async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const bank = nearestBank(here);
        if (!bank) {
            ScriptRunner.stop('[dumper] no reachable bank');
            return false;
        }
        this.bankAccess = bank.access ?? BOOTH;
        this.bankTile = bank.tile;
        this.bankName = bank.name;
        if (bank.tile.level === here.level && bank.tile.distanceTo(here) <= 6) {
            return true;
        }
        this.setStatus(`walking to ${bank.name}`);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: WALK_MS, log: m => this.log(`  ${m}`) }))) {
            ScriptRunner.stop(`[dumper] the walk to ${bank.name} failed`);
            return false;
        }
        return true;
    }

    override recoveryAnchor(): Tile | null {
        return this.bankTile;
    }

    setStatus(s: string): void {
        this.status = s;
    }

    async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        this.setStatus('opening the bank');
        if (await Bank.openNearest(this.bankAccess.name, this.bankAccess.op, m => this.log(`  ${m}`))) {
            return true;
        }
        this.log('[dumper] could not open the bank, will retry');
        return false;
    }

    /** What the maker's book buys among these, less the rows it refused. */
    priced(items: readonly { id: number; count: number }[]): Sellable[] {
        if (!this.book || !this.cat) {
            return [];
        }
        return sellables(items, this.book, this.cat).filter(s => !this.dropped.has(s.id));
    }

    // Why: an offered item leaves the pack view, so mid-window the pile has to count what is already staked or it reads as empty and a good trade gets declined for nothing.
    packPile(): PileLine[] {
        const pack = Inventory.items().map(i => ({ id: i.id, count: i.count }));
        const mine = Trade.active() ? heldWithOffer(pack, Trade.myOffer().map(o => ({ id: o.id, count: o.count }))) : pack;
        return this.priced(mine);
    }

    step(): Step {
        return decide({ tradeActive: Trade.active(), pileValue: pileValue(this.packPile()) });
    }

    makerNear(): { tile: Tile; distance: number } | null {
        const here = Game.tile();
        const player = Players.query().where(p => namesMatch(p.name ?? '', this.maker)).nearest();
        if (!here || !player) {
            return null;
        }
        const tile = player.tile();
        return { tile, distance: Math.max(Math.abs(tile.x - here.x), Math.abs(tile.z - here.z)) };
    }

    /** The maker's public lines in the buffer, newest first, with any crown prefix stripped from the name. */
    makerLines(): string[] {
        return reader
            .chat(CHAT_LINES)
            .filter(l => PUBLIC_CHAT_TYPES.has(l.type) && namesMatch((l.username ?? '').replace(/^@cr\d@/, ''), this.maker))
            .map(l => l.text);
    }

    busyLines(): number {
        return reader.chat(CHAT_LINES).filter(l => l.type === 0 && /busy at the moment/i.test(l.text)).length;
    }

    dropByName(names: readonly string[]): string[] {
        const hit: string[] = [];
        for (const line of this.packPile()) {
            if (names.some(n => namesMatch(n, line.displayName))) {
                this.dropped.add(line.id);
                hit.push(line.displayName);
            }
        }
        return hit;
    }

    noteBank(list: Sellable[]): void {
        this.lastBank = list;
    }

    noteSale(sale: Sale): void {
        this.trades++;
        this.gp += sale.gp;
        for (const l of sale.lines) {
            this.soldByName.set(l.displayName, (this.soldByName.get(l.displayName) ?? 0) + l.count);
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveMarketDumper',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Stock']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;

        if (page === 'Options') {
            p.statGrid([
                [{ text: `Maker: ${this.maker || 'unset'}` }, { text: `Book: ${this.book?.name ?? 'none'}` }],
                [{ text: `Cap: ${this.cap.toLocaleString()}gp` }, { text: `Bank: ${this.bankName}` }]
            ]);
        } else if (section === 'Overview') {
            const pile = this.packPile();
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Sold: ${this.gp.toLocaleString()}gp` }],
                [{ text: `Trades: ${this.trades}` }, { text: `Gp/hr: ${mins > 0.5 ? Math.round((this.gp / mins) * 60).toLocaleString() : 'n/a'}` }],
                [{ text: `Pile: ${pileValue(pile).toLocaleString()}gp` }, { text: `Kinds: ${pile.length}` }]
            ]);
            p.bar('Pack', Inventory.used() / PACK);
        } else {
            const rows = this.lastBank.slice(0, TOP_LINES).map(s => [{ text: `${s.count}x ${s.displayName}` }, { text: `${s.each.toLocaleString()}gp each` }]);
            p.statGrid([
                ...rows,
                [{ text: `Banked kinds: ${this.lastBank.length}` }, { text: `Refused: ${this.dropped.size}` }]
            ]);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

// Why: everything goes in, coins included, so the payment lands in the bank and the withdrawal always starts from an empty pack; notes, since the maker keeps four slots free and its pack is its float.
class Restock implements Task {
    constructor(private bot: JiveMarketDumper) {}

    validate(): boolean {
        return this.bot.step().kind === 'bank';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        if (!(await bot.openBank())) {
            return;
        }
        bot.setStatus('banking the coins');
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Bank.loaded(), 5000))) {
            bot.log(Bank.isOpen() ? '[dumper] the bank list has not filled in, retrying' : '[dumper] the bank window closed, retrying');
            return;
        }
        await Bank.setNoteMode(true);

        const list = bot.priced(Bank.items().map(i => ({ id: i.id, count: i.count })));
        bot.noteBank(list);
        const pile = planPile(list, bot.cap, PACK);
        if (pile.length === 0) {
            await Bank.close();
            bot.setStatus('stopped');
            ScriptRunner.stop(list.length === 0
                ? `[dumper] the bank holds nothing ${bot.maker} buys; ${bot.trades} trade(s) made ${bot.gp.toLocaleString()}gp`
                : `[dumper] ${list.length} kind(s) left, none fits under ${bot.cap.toLocaleString()}gp a trade`);
            return;
        }
        for (const line of pile) {
            if (!Bank.isOpen() || !Bank.loaded()) {
                bot.log('[dumper] the bank window closed mid-withdrawal, retrying');
                return;
            }
            bot.setStatus(`withdrawing ${line.count} ${line.displayName}`);
            if (!(await Bank.withdrawXById(line.id, line.count, line.notedId ?? line.id))) {
                bot.log(`[dumper] could not withdraw ${line.count} ${line.displayName}, retrying`);
                return;
            }
        }
        if (!(await Bank.close())) {
            bot.log('[dumper] the bank would not close, retrying');
            return;
        }
        bot.log(`[dumper] took ${describe(pile)}, worth ${pileValue(pile).toLocaleString()}gp`);
    }
}

// Why: a "Trade with" click clears the pending action and shuts a window that opened the same tick, so one request gets one long wait, and only a refusal from the engine earns another.
class Approach implements Task {
    private misses = 0;

    constructor(private bot: JiveMarketDumper) {}

    validate(): boolean {
        return this.bot.step().kind === 'approach';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const near = bot.makerNear();
        if (!near) {
            this.misses++;
            if (this.misses >= MAKER_MISSES) {
                bot.setStatus('stopped');
                ScriptRunner.stop(`[dumper] ${bot.maker} is not in sight; start this beside the maker`);
                return;
            }
            bot.setStatus(`looking for ${bot.maker}`);
            await Execution.delayTicks(2);
            return;
        }
        this.misses = 0;
        if (near.distance > 2) {
            bot.setStatus(`walking to ${bot.maker}`);
            await Traversal.walkResilient(near.tile, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`) });
            return;
        }
        const here = Game.tile();
        if (here && near.distance === 0) {
            await Traversal.walkResilient(new Tile(here.x + 1, here.z, here.level), { radius: 0, attempts: 2, timeoutMs: 20_000, log: m => bot.log(`  ${m}`) });
            return;
        }
        await Modals.closeIfOpen();

        const busyBefore = bot.busyLines();
        bot.setStatus(`asking ${bot.maker} to trade`);
        if (!(await Trade.request(bot.maker))) {
            bot.log(`[dumper] ${bot.maker} is not in the scene to click`);
            await Execution.delayTicks(2);
            return;
        }
        const opened = await Execution.delayUntil(() => Trade.onOfferScreen() || bot.busyLines() > busyBefore, WINDOW_WAIT_MS);
        if (!Trade.onOfferScreen()) {
            bot.log(opened ? `[dumper] ${bot.maker} is busy at the bank, asking again shortly` : `[dumper] ${bot.maker} did not open the window, asking again`);
            await Execution.delay(BUSY_PAUSE_MS);
        }
    }
}

function describe(lines: readonly PileLine[]): string {
    return lines.map(l => `${l.count} ${l.displayName}`).join(' + ');
}

function coinsOn(offer: readonly { id: number; count: number }[]): number {
    return offer.filter(o => o.id === COINS).reduce((sum, o) => sum + o.count, 0);
}

// Why: the maker takes whatever is on our side once we accept, priced or not, so the pile is accepted only when its coins cover what the book says; short, and the pile is shrunk in the window by what the maker said, since a decline or a walk-out earns a cooldown.
class Sell implements Task {
    constructor(private bot: JiveMarketDumper) {}

    validate(): boolean {
        return this.bot.step().kind === 'trade';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const deadline = Date.now() + WINDOW_MS;
        const seen = new Set(bot.makerLines());
        const coinsBefore = Inventory.countById(COINS);
        let pile = bot.packPile();
        let corrections = 0;

        while (Trade.active() && Date.now() < deadline) {
            if (pile.length === 0) {
                bot.log('[dumper] nothing priced left to offer, closing the window');
                await Trade.decline();
                return;
            }
            const expected = pileValue(pile);
            if (!(await this.putUp(pile))) {
                return;
            }
            bot.setStatus(`waiting for ${expected.toLocaleString()}gp from ${bot.maker}`);
            const notes: MakerNote[] = [];
            const offered = await this.awaitCoins(expected, seen, notes);
            if (!Trade.active()) {
                bot.log('[dumper] the window closed before any coins came');
                return;
            }
            if (offered >= expected) {
                await this.accept(pile, coinsBefore);
                return;
            }
            bot.log(`[dumper] ${bot.maker} offered ${offered.toLocaleString()}gp for a pile worth ${expected.toLocaleString()}gp${notes.length > 0 ? `, saying: ${notes.map(n => n.kind === 'ceiling' ? `ceiling ${n.gp}` : `${n.count} ${n.name} not counted`).join('; ')}` : ''}`);
            if (++corrections > CORRECTIONS) {
                bot.log('[dumper] too many corrections in one window, closing it');
                await Trade.decline();
                return;
            }
            const change = adapt({ cap: bot.cap, offered, notes });
            bot.cap = change.cap;
            if (change.dropAll) {
                bot.dropByName(pile.map(l => l.displayName));
            } else if (change.drop.length > 0) {
                bot.dropByName(change.drop);
            }
            await Trade.removeAll();
            await Execution.delayTicks(1);
            pile = planPile(bot.packPile(), bot.cap, PACK);
        }
        if (Trade.active()) {
            bot.log('[dumper] the window ran out of time, closing it');
            await Trade.decline();
        }
    }

    private async putUp(pile: readonly PileLine[]): Promise<boolean> {
        this.bot.setStatus(`offering ${describe(pile)}`);
        for (const line of pile) {
            const id = line.notedId ?? line.id;
            const held = Inventory.countById(id);
            const n = Math.min(line.count, held);
            if (n < 1) {
                continue;
            }
            if (!(await Trade.offer(line.name, n, i => i.id === id))) {
                this.bot.log(`[dumper] could not put up ${n} ${line.displayName}`);
                return false;
            }
        }
        const staked = (): boolean => pile.every(line => Trade.myOffer().filter(o => o.id === (line.notedId ?? line.id)).reduce((s, o) => s + Math.max(1, o.count), 0) >= line.count);
        if (!(await Execution.delayUntil(() => !Trade.active() || staked(), OFFER_SETTLE_MS))) {
            this.bot.log('[dumper] the offer never showed every line, retrying');
            return false;
        }
        return Trade.active();
    }

    /** The coins on the maker's side once it has settled, collecting what it said meanwhile. */
    private async awaitCoins(expected: number, seen: Set<string>, notes: MakerNote[]): Promise<number> {
        const bot = this.bot;
        const deadline = Date.now() + COINS_WAIT_MS;
        let coins = 0;
        let stable = 0;
        while (Trade.active() && Date.now() < deadline) {
            for (const text of bot.makerLines()) {
                if (seen.has(text)) {
                    continue;
                }
                seen.add(text);
                const note = parseMakerLine(text);
                if (note) {
                    notes.push(note);
                }
            }
            const now = coinsOn(Trade.theirOffer());
            if (now >= expected) {
                return now;
            }
            stable = now > 0 && now === coins ? stable + 1 : 0;
            coins = now;
            if (stable >= 3) {
                return coins;
            }
            await Execution.delay(500);
        }
        return coins;
    }

    private async accept(pile: PileLine[], coinsBefore: number): Promise<void> {
        const bot = this.bot;
        bot.setStatus('accepting');
        let dead = 0;
        let sawConfirm = false;
        for (let step = 0; step < ACCEPT_STEPS; step++) {
            const view = { onOffer: Trade.onOfferScreen(), onConfirm: Trade.onConfirmScreen(), deadTicks: dead };
            sawConfirm = sawConfirm || view.onConfirm;
            const action = acceptAction(view, HANDOVER_TICKS);
            if (action === 'done') {
                break;
            }
            if (action === 'wait') {
                dead++;
                await Execution.delayTicks(1);
                continue;
            }
            dead = 0;
            await Trade.accept();
            await Execution.delay(ACCEPT_STEP_MS);
        }
        if (Trade.active()) {
            bot.log('[dumper] the trade never closed, walking out of it');
            await Trade.decline();
            return;
        }
        // Why: the pack shows the payment only once the window is gone, so the coins are waited for rather than read on the next tick.
        await Execution.delayUntil(() => Inventory.countById(COINS) > coinsBefore, COINS_LAND_MS);
        const gp = Inventory.countById(COINS) - coinsBefore;
        if (gp <= 0) {
            bot.log(`[dumper] the window closed with no coins paid${sawConfirm ? '' : `, and ${bot.maker} never reached the confirm screen`}`);
            return;
        }
        bot.noteSale({ lines: pile, gp });
        bot.log(`[dumper] sold ${describe(pile)} for ${gp.toLocaleString()}gp`);
    }
}
