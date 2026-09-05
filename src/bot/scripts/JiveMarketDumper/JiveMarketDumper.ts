import { reader } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { BANK_LOCATIONS, nearestBank, type BankLocation } from '../../api/bank/BankLocations.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { liveCatalog, type Catalog } from '../../api/market/catalog.js';
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
import { COINS, PACK, TRADE_SLOTS, acceptAction, decide, dumpables, heldWithOffer, planPile, type Dumpable, type Step } from './logic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const CATALOG_WAIT_MS = 15_000;
const WALK_MS = 120_000;
/** The engine refuses a request while the maker banks, so one request gets one long wait and only a refusal earns another. */
const WINDOW_WAIT_MS = 40_000;
const BUSY_PAUSE_MS = 3_000;
const OFFER_SETTLE_MS = 5_000;
/** Past the maker's own give-up on a pile it will not pay for. */
const OFFER_WAIT_MS = 20_000;
const STABLE_POLLS = 3;
const POLL_MS = 500;
/** Ticks with neither screen up that still count as the handover between them. */
const HANDOVER_TICKS = 3;
const ACCEPT_STEPS = 30;
const ACCEPT_STEP_MS = 900;
const COINS_LAND_MS = 5_000;
const MAKER_MISSES = 10;
const TOP_LINES = 3;

/** The option that leaves the bank to the walker. */
export const NEAREST_BANK = 'Nearest';

// Why: the maker stands at a bank of its own choosing and the nearest one to wherever the dumper started is not always that bank, so the operator names it and the run walks there.
/** The bank a setting names, or null for the nearest one. */
export function bankChoice(name: string): BankLocation | null {
    const want = name.trim().toLowerCase();
    if (want === '' || want === NEAREST_BANK.toLowerCase()) {
        return null;
    }
    return BANK_LOCATIONS.find(b => b.name.toLowerCase() === want) ?? null;
}

export const SETTINGS: SettingsSchema = {
    maker: { type: 'string', default: '', label: 'Maker name', help: 'the player running MarketMaker; start this script standing beside it, at its bank' },
    bank: {
        type: 'string',
        default: NEAREST_BANK,
        options: [NEAREST_BANK, ...BANK_LOCATIONS.map(b => b.name)],
        label: 'Bank',
        help: 'where the takings go between trips. Pick the maker\'s own bank, since the nearest one to where this starts is not always the one it stands at'
    }
};

export default class JiveMarketDumper extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private cat: Catalog | null = null;
    private bankAccess = BOOTH;
    private bankTile: Tile | null = null;
    private bankName = 'the bank';
    private soldByName = new Map<string, number>();
    private lastBank: Dumpable[] = [];

    maker = '';
    trades = 0;
    gp = 0;
    /** Rows the maker would not take at any price, so the next pile is a different one. */
    refused = new Set<number>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.maker = this.settings.str('maker', '').trim();
        if (this.maker === '') {
            ScriptRunner.stop('[dumper] no maker named in the settings');
            return;
        }
        this.startedAt = Date.now();
        if (!(await Execution.delayUntil(() => liveCatalog().items.length > 0, CATALOG_WAIT_MS))) {
            ScriptRunner.stop('[dumper] the item catalogue never loaded');
            return;
        }
        this.cat = liveCatalog();
        if (!(await this.resolveBank())) {
            return;
        }
        this.log(`[dumper] dumping the bank to ${this.maker}, whatever it pays, banking at ${this.bankName}`);
        this.add(new ContinueDialog(), new Sell(this), new Approach(this), new Restock(this));
    }

    private async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const named = this.settings.str('bank', NEAREST_BANK);
        const bank = bankChoice(named) ?? nearestBank(here);
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

    /** What a trade window could carry among these, less the rows the maker has already turned down. */
    dumpable(items: readonly { id: number; count: number }[]): Dumpable[] {
        return this.cat === null ? [] : dumpables(items, this.cat).filter(d => !this.refused.has(d.id));
    }

    // Why: an offered item leaves the pack view, so mid-window the pile has to count what is already staked or it reads as empty and a good trade gets declined for nothing.
    packPile(): Dumpable[] {
        const pack = Inventory.items().map(i => ({ id: i.id, count: i.count }));
        const mine = Trade.active() ? heldWithOffer(pack, Trade.myOffer().map(o => ({ id: o.id, count: o.count }))) : pack;
        return this.dumpable(mine);
    }

    step(): Step {
        return decide({ tradeActive: Trade.active(), pile: this.packPile().length });
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

    busyLines(): number {
        return reader.chat(20).filter(l => l.type === 0 && /busy at the moment/i.test(l.text)).length;
    }

    refuse(lines: readonly Dumpable[]): void {
        for (const line of lines) {
            this.refused.add(line.id);
        }
        this.log(`[dumper] ${this.maker} would not take ${lines.map(l => l.displayName).join(', ')}, leaving ${lines.length === 1 ? 'it' : 'them'} banked`);
    }

    noteBank(list: Dumpable[]): void {
        this.lastBank = list;
    }

    noteSale(lines: readonly Dumpable[], gp: number): void {
        this.trades++;
        this.gp += gp;
        for (const l of lines) {
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
                [{ text: `Maker: ${this.maker || 'unset'}` }, { text: `Bank: ${this.bankName}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Taken: ${this.gp.toLocaleString()}gp` }],
                [{ text: `Trades: ${this.trades}` }, { text: `Gp/hr: ${mins > 0.5 ? Math.round((this.gp / mins) * 60).toLocaleString() : 'n/a'}` }],
                [{ text: `Pile: ${this.packPile().length} kinds` }, { text: `Refused: ${this.refused.size}` }]
            ]);
            p.bar('Pack', Inventory.used() / PACK);
        } else {
            const rows = this.lastBank.slice(0, TOP_LINES).map(d => [{ text: `${d.count}x ${d.displayName}` }]);
            p.statGrid([
                ...rows,
                [{ text: `Banked kinds: ${this.lastBank.length}` }, { text: `Sold kinds: ${this.soldByName.size}` }]
            ]);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

// Why: everything goes in, coins included, so the payment lands in the bank and the withdrawal always starts from an empty pack; notes, since the maker keeps four slots free and its pack is also its coin float.
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
        bot.setStatus('banking the takings');
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Bank.loaded(), 5000))) {
            bot.log(Bank.isOpen() ? '[dumper] the bank list has not filled in, retrying' : '[dumper] the bank window closed, retrying');
            return;
        }
        await Bank.setNoteMode(true);

        const list = bot.dumpable(Bank.items().map(i => ({ id: i.id, count: i.count })));
        bot.noteBank(list);
        const pile = planPile(list, TRADE_SLOTS);
        if (pile.length === 0) {
            await Bank.close();
            bot.setStatus('stopped');
            ScriptRunner.stop(bot.refused.size === 0
                ? `[dumper] the bank holds nothing tradeable; ${bot.trades} trade(s) took ${bot.gp.toLocaleString()}gp`
                : `[dumper] all that is left is ${bot.refused.size} kind(s) ${bot.maker} would not take; ${bot.trades} trade(s) took ${bot.gp.toLocaleString()}gp`);
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
        bot.log(`[dumper] took ${describe(pile)}`);
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
        const answered = await Execution.delayUntil(() => Trade.onOfferScreen() || bot.busyLines() > busyBefore, WINDOW_WAIT_MS);
        if (!Trade.onOfferScreen()) {
            bot.log(answered ? `[dumper] ${bot.maker} is busy at the bank, asking again shortly` : `[dumper] ${bot.maker} did not open the window, asking again`);
            await Execution.delay(BUSY_PAUSE_MS);
        }
    }
}

function describe(lines: readonly Dumpable[]): string {
    return lines.map(l => `${l.count} ${l.displayName}`).join(' + ');
}

function coinsOn(offer: readonly { id: number; count: number }[]): number {
    return offer.filter(o => o.id === COINS).reduce((sum, o) => sum + Math.max(1, o.count), 0);
}

// Why: the maker prices what it sees and pays what it carries, so every line goes up and whatever it bids is taken; only a pile it will not pay for at all is pulled back, since it never completes a trade it owes nothing on.
class Sell implements Task {
    constructor(private bot: JiveMarketDumper) {}

    validate(): boolean {
        return this.bot.step().kind === 'trade';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const coinsBefore = Inventory.countById(COINS);
        const pile = bot.packPile();
        if (pile.length === 0) {
            bot.log('[dumper] nothing left to offer, closing the window');
            await Trade.decline();
            return;
        }
        if (!(await this.putUp(pile))) {
            return;
        }
        bot.setStatus(`waiting on ${bot.maker}`);
        const offered = await this.awaitOffer();
        if (!Trade.active()) {
            bot.log(`[dumper] ${bot.maker} closed the window without paying`);
            bot.refuse(pile);
            return;
        }
        if (offered <= 0) {
            bot.log(`[dumper] ${bot.maker} put up nothing for ${describe(pile)}`);
            bot.refuse(pile);
            await Trade.decline();
            return;
        }
        await this.accept(pile, coinsBefore, offered);
    }

    private async putUp(pile: readonly Dumpable[]): Promise<boolean> {
        this.bot.setStatus(`offering ${describe(pile)}`);
        for (const line of pile) {
            const id = line.notedId ?? line.id;
            const n = Math.min(line.count, Inventory.countById(id));
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

    /** The coins the maker settles on, or zero when it puts up nothing for the pile. */
    private async awaitOffer(): Promise<number> {
        const deadline = Date.now() + OFFER_WAIT_MS;
        let coins = 0;
        let stable = 0;
        while (Trade.active() && Date.now() < deadline) {
            const now = coinsOn(Trade.theirOffer());
            stable = now > 0 && now === coins ? stable + 1 : 0;
            coins = now;
            if (stable >= STABLE_POLLS) {
                return coins;
            }
            await Execution.delay(POLL_MS);
        }
        return coins;
    }

    private async accept(pile: Dumpable[], coinsBefore: number, offered: number): Promise<void> {
        const bot = this.bot;
        bot.setStatus(`accepting ${offered.toLocaleString()}gp`);
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
        bot.noteSale(pile, gp);
        bot.log(`[dumper] dumped ${describe(pile)} for ${gp.toLocaleString()}gp`);
    }
}
