import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Bank } from '../../api/bank/Bank.js';
import { withdrawOp } from '../../api/bank/bankOps.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { Trade } from '../../api/trade/Trade.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Locs } from '../../api/locs/Locs.js';
import { Players } from '../../api/players/Players.js';
import type { Player } from '../../api/model/Player.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { SettingsStore, type SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';

const ESSENCE = 'Rune essence';
const ESSENCE_ID = 1436; // blankrune (unnoted essence); the bank-note variant has a different id
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const TEMPLE_Z = 4000; // altar temples sit at z ~4800; the overworld is < 4000
const MAX_BANK_FAILS = 6;
const MAX_ENTER_FAILS = 3;
// the Mule Recipient stands at the altar holding a talisman + one stacking rune slot, so 26 slots take essence
const TRADE_LOAD = 26;
const TRADEREQ_CHAT = 4; // Client.addChat(4, 'wishes to trade with you.', player)
const TRADE_REQ_TEXT = /wishes to trade with you/i;
const EMPTY_TRADE_MS = 20_000; // a trade nobody puts essence into gets declined after this
const ADJACENT = 2; // OPPLAYER4 walks you to the target — only answer a runner that already came to us
const TEMPLE_RANGE = 30; // the runner lands at the temple entrance, a walk away from the altar
const ALTAR_PARK = 2; // the recipient camps this close to the altar so every runner finds it there

interface RuneType {
    talisman: string;
    rune: string;
    level: number;
    ruins: Tile; // the Mysterious ruins loc — walk here + use the talisman
    bank: Tile;
}

// Adding a rune = one row (talisman/rune/level from runecraft.dbrow) + its
// Mysterious-ruins tile (exit_coord) + nearest bank.
const RUNES: Record<string, RuneType> = {
    'Air runes': { talisman: 'Air talisman', rune: 'Air rune', level: 1, ruins: new Tile(2988, 3294, 0), bank: new Tile(3013, 3355, 0) },
    'Earth runes': { talisman: 'Earth talisman', rune: 'Earth rune', level: 9, ruins: new Tile(3303, 3477, 0), bank: new Tile(3253, 3420, 0) }
};
const RUNE_OPTIONS = Object.keys(RUNES);
const MODES = ['Solo', 'Runner', 'Mule Recipient'];

export const SETTINGS: SettingsSchema = {
    rune: { type: 'string', default: 'Air runes', options: RUNE_OPTIONS, label: 'Rune', help: 'which rune to craft — Air is the ruins south of Falador (Falador East bank), Earth is north-east of Varrock (Varrock East bank)' },
    mode: { type: 'string', default: 'Solo', options: MODES, label: 'Mode', help: 'Solo banks its own essence. A Runner needs its own talisman: it banks essence, enters the altar and hands the load over inside. The Mule Recipient camps next to the altar and never leaves — it takes every essence trade and crafts between them' },
    partner: { type: 'string', default: '', label: 'Trade essence to (IGN)', help: 'the Mule Recipient this runner delivers essence to', showIf: { key: 'mode', anyOf: ['Runner'] } }
};

function inTemple(): boolean {
    const t = Game.tile();
    return t !== null && t.z > TEMPLE_Z;
}
// unnoted only: a noted stack can't be crafted or traded onward, counting it wedges every loop
function essCount(): number {
    return Inventory.items().filter(i => i.id === ESSENCE_ID).reduce((s, i) => s + i.count, 0);
}
// everything the pack is allowed to hold; anything else eats a slot essence needs.
// Nameless items count as junk — a cache miss must not smuggle an item past the deposit.
function packJunk(keep: string[]): InvItem[] {
    const kept = new Set(keep.map(s => s.toLowerCase()));
    return Inventory.items().filter(i => !kept.has((i.name ?? '').toLowerCase()));
}
// chat usernames can carry nbsp/underscores where the entity list has spaces
function sameName(a: string, b: string): boolean {
    const clean = (s: string) => s.toLowerCase().replace(/[\u00A0_]/g, ' ').trim();
    return clean(a) === clean(b);
}
function playerNamed(name: string, range: number): Player | null {
    return Players.query().where(p => p.name !== null && sameName(p.name, name)).within(range).nearest();
}
// Why: a short or over load makes a runner deliver 1 essence and waste a trade slot the recipient could have spent on a full delivery.

/** True when the pack holds the altar talisman plus one recipient load. */
function runnerLoaded(bot: RuneCrafter): boolean {
    return Inventory.contains(bot.talismanName()) && essCount() === TRADE_LOAD
        && packJunk([bot.talismanName(), ESSENCE]).length === 0;
}
function altarLoc(): { tile(): Tile; distance(): number; interact(op: string): boolean | Promise<boolean> } | null {
    return Locs.query().name(ALTAR.name).action(ALTAR.op).nearest();
}

async function openBank(bot: RuneCrafter): Promise<boolean> {
    const log = (m: string): void => bot.log(`  ${m}`);
    await bot.walkTo(bot.bankTile(), 3);
    if ((await Bank.openBooth(bot.bankTile(), BOOTH.name, BOOTH.op, log)) || (await Bank.openNearest(BOOTH.name, BOOTH.op, log))) {
        bot.resetBankFail();
        return true;
    }
    if (bot.countBankFail() >= MAX_BANK_FAILS) {
        ScriptRunner.stop('RuneCrafter: couldn\'t reach the bank — start nearer it');
        return false;
    }
    bot.log('could not open the bank — will retry');
    return false;
}

// Deposit everything off the keep list, then prove it worked: a stack that refuses to
// deposit silently shrinks every load from here on, so it stops the script instead.
async function cleanPack(bot: RuneCrafter, keep: string[]): Promise<boolean> {
    const kept = new Set(keep.map(s => s.toLowerCase()));
    const deposit = (): Promise<void> => Bank.depositAllMatching(name => !kept.has(name.toLowerCase()), m => bot.log(`  ${m}`));
    await Bank.setNoteMode(false);
    await deposit();
    await Execution.delayTicks(1);
    if (packJunk(keep).length > 0) {
        // one more pass before calling it stuck: a click that landed late still shows in the side pack
        await deposit();
        await Execution.delayUntil(() => packJunk(keep).length === 0, 2500);
    }
    const left = packJunk(keep);
    if (left.length > 0) {
        ScriptRunner.stop(`RuneCrafter: ${left.length} item(s) would not deposit (${left.map(i => `${i.name ?? 'unnamed'}#${i.id}`).join(', ')}) — the pack must hold only ${keep.join(' + ')}`);
        return false;
    }
    return true;
}

async function ensureTalisman(bot: RuneCrafter): Promise<boolean> {
    const talisman = bot.talismanName();
    if (Inventory.contains(talisman)) {
        return true;
    }
    // blank is not empty: the bank list reads [] for a beat after opening
    await Execution.delayUntil(() => Bank.loaded(), 3000);
    const tal = Bank.items().find(i => i.name?.toLowerCase() === talisman.toLowerCase());
    if (!tal) {
        ScriptRunner.stop(`RuneCrafter: no ${talisman} in the bank or pack`);
        return false;
    }
    const op = withdrawOp(tal.ops, '1') ?? withdrawOp(tal.ops, 'any') ?? 'Withdraw-1';
    await Bank.withdraw(talisman, op);
    if (!(await Execution.delayUntil(() => Inventory.contains(talisman), 3000))) {
        ScriptRunner.stop(`RuneCrafter: the ${talisman} withdraw never landed`);
        return false;
    }
    bot.log(`withdrew a ${talisman}`);
    return true;
}

export default class RuneCrafter extends TaskBot {
    override loopDelay = 600;

    private cfg: RuneType = RUNES['Air runes'];
    private choice = 'Air runes';
    private mode = 'Solo';
    private partner = '';
    private lastRequester: string | null = null;
    private trips = 0;
    private crafted = 0;
    private trades = 0;
    private moved = 0;
    private bankFails = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.choice = this.settings.str('rune', 'Air runes');
        this.cfg = RUNES[this.choice] ?? RUNES['Air runes'];
        this.mode = this.settings.str('mode', 'Solo');
        this.partner = this.settings.str('partner', '').trim();
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('runecraft');

        if (this.mode === 'Runner') {
            if (!this.partner) {
                this.log('RuneCrafter: Runner mode needs the Mule Recipient\'s name in settings. Stopping.');
                throw new Error('RuneCrafter: no trade partner configured');
            }
            this.log(`RuneCrafter runner starting — ferrying essence from ${this.cfg.bank} into the ${this.choice} altar for '${this.partner}' (needs an ${this.cfg.talisman})`);
            this.add(new ContinueDialog(), new RunnerTrade(this), new RunnerDeliver(this), new Exit(this), new RunnerRestock(this), new Enter(this, () => essCount() > 0));
            return;
        }

        if (Skills.level('runecraft') < this.cfg.level) {
            this.log(`RuneCrafter: Runecrafting ${this.cfg.level} required for ${this.choice} (have ${Skills.level('runecraft')}) — stopping.`);
            throw new Error('RuneCrafter: runecrafting level too low');
        }

        if (this.mode === 'Mule Recipient') {
            this.on('chat.message', e => {
                if (e.type === TRADEREQ_CHAT && e.username && TRADE_REQ_TEXT.test(e.text)) {
                    this.lastRequester = e.username; // most recent wins — that runner is still waiting
                }
            });
            this.log(`RuneCrafter mule recipient starting — camping inside the ${this.choice} altar, crafting whatever essence gets traded in`);
            this.add(new ContinueDialog(), new MuleTakeTrade(this), new Craft(this, false), new MuleDropJunk(this), new MuleAnswerRequest(this), new MuleWait(this), new MulePrepare(this), new Enter(this, () => true));
            return;
        }

        this.log(`RuneCrafter starting — ${this.choice}, ruins ${this.cfg.ruins}, bank ${this.cfg.bank}`);
        this.add(new ContinueDialog(), new Craft(this, true), new Exit(this), new BankTrip(this), new Enter(this, () => essCount() > 0));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        p.title(`RuneCrafter — ${this.mode.toLowerCase()} — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        if (this.mode === 'Runner') {
            p.row(`Runtime: ${fmtDuration(mins)}`, `To: ${this.partner}`, `Bank runs: ${this.trips}`);
            p.row(`Delivered: ${this.moved}`, `Trades: ${this.trades}`, `Pack ess: ${essCount()}`);
        } else {
            const xph = mins > 0.5 ? `${(((Skills.xp('runecraft') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `RC lvl: ${Skills.level('runecraft')}`, `XP/hr: ${xph}`);
            p.row(`${this.choice}: ${this.crafted}`, this.mode === 'Solo' ? `Trips: ${this.trips}` : `Ess in: ${this.moved}`, `Pack ess: ${essCount()}`);
        }
        p.gap();
        const picked = p.select('rune', 'rune', RUNE_OPTIONS, this.choice);
        if (picked && picked !== this.choice) {
            this.switchRune(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchRune(rune: string): void {
        if (!RUNES[rune]) {
            return;
        }
        this.choice = rune;
        this.cfg = RUNES[rune];
        SettingsStore.save('RuneCrafter', 'rune', rune);
        this.log(`rune switched to ${rune} (from the paint)`);
    }

    setStatus(s: string): void { this.status = s; }
    countCraft(n: number): void { this.crafted += n; }
    countTrip(): void { this.trips++; }
    tripsTotal(): number { return this.trips; }
    countTrade(essence: number): void { this.trades++; this.moved += essence; }
    countBankFail(): number { return ++this.bankFails; }
    resetBankFail(): void { this.bankFails = 0; }
    talismanName(): string { return this.cfg.talisman; }
    runeName(): string { return this.cfg.rune; }
    ruinsTile(): Tile { return this.cfg.ruins; }
    bankTile(): Tile { return this.cfg.bank; }
    partnerName(): string { return this.partner; }
    pendingRequester(): string | null { return this.lastRequester; }
    takeRequester(): string | null {
        const name = this.lastRequester;
        this.lastRequester = null;
        return name;
    }
    // the recipient keeps the runes it crafts (one stack); everyone else banks them
    muleKeep(): string[] { return [this.cfg.talisman, this.cfg.rune]; }

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return;
        }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
    }
}

class Craft implements Task {
    constructor(private bot: RuneCrafter, private thenExit: boolean) {}
    validate(): boolean { return inTemple() && essCount() > 0; }
    async execute(): Promise<void> {
        const altar = altarLoc();
        if (!altar) { await Execution.delayTicks(2); return; } // scene still syncing after the telejump
        this.bot.setStatus('crafting runes');
        const before = essCount();
        this.bot.log(`crafting ${before} essence at the altar`);
        if (!(await altar.interact(ALTAR.op))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => essCount() === 0, 8000);
        const made = before - essCount();
        this.bot.countCraft(made);
        this.bot.log(`crafted ${made} ${this.bot.runeName()}s`);
        if (!this.thenExit) { return; } // the recipient lives here — it stays parked at the altar
        // Why: the craft locks the player (p_delay 3) and pops a level-up.
        // Why: a tight loop closes any dialog and re-clicks the portal every tick, so the Use fires the instant the lock clears.
        this.bot.setStatus('taking the portal out');
        this.bot.log('taking the portal back to the ruins');
        for (let i = 0; i < 15 && inTemple(); i++) {
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); continue; }
            const portal = Locs.query().name(PORTAL.name).action(PORTAL.op).nearest();
            if (portal) { await portal.interact(PORTAL.op); }
            await Execution.delayTicks(1);
        }
        if (!inTemple()) { this.bot.log('back at the mysterious ruins'); }
    }

}

class Exit implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        const portal = Locs.query().name(PORTAL.name).action(PORTAL.op).nearest();
        if (!portal) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('taking the portal out');
        this.bot.log('taking the portal back to the ruins');
        if (!(await portal.interact(PORTAL.op))) { await Execution.delayTicks(2); return; }
        if (await Execution.delayUntil(() => !inTemple(), 15_000)) {
            this.bot.log('back at the mysterious ruins');
        }
    }
}

class BankTrip implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return !inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        this.bot.log('heading to the bank');
        if (!(await openBank(this.bot))) { return; }

        const madeRunes = Inventory.count(this.bot.runeName());
        if (!(await cleanPack(this.bot, [this.bot.talismanName()]))) { return; }
        this.bot.countTrip();
        if (madeRunes > 0) {
            this.bot.log(`deposited ${madeRunes} ${this.bot.runeName()}s`);
        }
        if (!(await ensureTalisman(this.bot))) { return; }

        if (Bank.count(ESSENCE) === 0) {
            ScriptRunner.stop('RuneCrafter: out of Rune essence in the bank');
            return;
        }
        const ess = Bank.items().find(i => i.name?.toLowerCase() === ESSENCE.toLowerCase());
        const op = (ess && withdrawOp(ess.ops, 'all')) ?? 'Withdraw-All';
        await Bank.withdraw(ESSENCE, op);
        await Execution.delayUntil(() => essCount() > 0 || Bank.count(ESSENCE) === 0, 4000);
        this.bot.log(`withdrew ${essCount()} rune essence (trip ${this.bot.tripsTotal()})`);
    }
}

// Solo and Runner enter with a load of essence; the recipient enters once and stays.
class Enter implements Task {
    private fails = 0;
    constructor(private bot: RuneCrafter, private ready: () => boolean) {}
    validate(): boolean { return !inTemple() && this.ready(); }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the ruins');
        this.bot.log('heading to the mysterious ruins');
        await this.bot.walkTo(this.bot.ruinsTile(), 1);
        const ruins = Locs.query().name(RUINS).nearest();
        const talisman = Inventory.first(this.bot.talismanName());
        if (!talisman) {
            ScriptRunner.stop(`RuneCrafter: no ${this.bot.talismanName()} in the pack — the altar can't be entered without one`);
            return;
        }
        if (!ruins) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('entering the altar');
        this.bot.log(`using the ${this.bot.talismanName()} on the mysterious ruins`);
        if (!(await talisman.useOn(ruins))) { await Execution.delayTicks(2); return; }
        if (await Execution.delayUntil(() => inTemple(), 10_000)) {
            this.bot.log('entered the altar');
            this.fails = 0;
            return;
        }
        if (++this.fails >= MAX_ENTER_FAILS) {
            ScriptRunner.stop('RuneCrafter: the talisman didn\'t teleport into the altar');
        }
    }
}

// runner: owns the loop while a trade modal is open — never moves (movement closes it)
class RunnerTrade implements Task {
    private before = 0;
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return Trade.active(); }
    async execute(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the delivery');
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 3000)) {
                const delivered = this.before - essCount();
                if (delivered > 0) {
                    this.bot.countTrade(delivered);
                    this.bot.log(`delivered ${delivered} essence to ${this.bot.partnerName()}`);
                }
                this.before = 0;
            }
            return;
        }
        if (Trade.myOffer().length === 0) {
            const held = essCount();
            if (held <= 0) { await Execution.delayTicks(1); return; }
            this.before = held;
            this.bot.setStatus('offering essence');
            if (held <= TRADE_LOAD) {
                await Trade.offerAll(ESSENCE, i => i.id === ESSENCE_ID);
            } else {
                // over-stocked pack: the recipient only has TRADE_LOAD free slots, more blocks the trade
                await Trade.offer(ESSENCE, TRADE_LOAD, i => i.id === ESSENCE_ID);
            }
        } else {
            this.bot.setStatus('accepting the delivery');
            await Trade.accept();
        }
    }
}

// runner: inside the altar with a load — the recipient is parked at the altar, so walk to it
class RunnerDeliver implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return inTemple() && essCount() > 0 && !Trade.active(); }
    async execute(): Promise<void> {
        const partner = this.bot.partnerName();
        const master = playerNamed(partner, TEMPLE_RANGE);
        if (!master) {
            this.bot.setStatus(`looking for ${partner} at the altar`);
            const altar = altarLoc();
            if (altar) { await DirectNavigator.walkTo(altar.tile(), ALTAR_PARK + 1, 10_000); }
            await Execution.delayTicks(2);
            return;
        }
        // spam on purpose: a busy recipient drops the request server-side, and answering our
        // most recent request is how the recipient opens the trade — so keep asking
        this.bot.setStatus(`delivering to ${partner}`);
        this.bot.log(`requesting a trade with ${master.name}`);
        await Trade.request(master.name ?? partner);
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

class RunnerRestock implements Task {
    private emptyReads = 0;
    private stocked = false; // one withdraw per run — a drained bank must not shuttle the same short load forever
    constructor(private bot: RuneCrafter) {}
    validate(): boolean {
        if (essCount() === 0) { this.stocked = false; }
        return !inTemple() && !Trade.active() && !this.stocked && !runnerLoaded(this.bot);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking essence');
        if (!(await openBank(this.bot))) { return; }
        // Why: the talisman is the only thing that stays — junk, the noted essence the bank hands back, and leftovers from the last delivery all go.
        // Why: the run then starts on one full load instead of dribbling 1-2 essence into a trade the recipient waited for.
        if (!(await cleanPack(this.bot, [this.bot.talismanName()]))) { return; }
        if (!(await ensureTalisman(this.bot))) { return; }

        // blank is not empty: the list reads [] for a beat after opening — believe it on the third read
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        const banked = Bank.count(ESSENCE);
        if (banked === 0) {
            if (++this.emptyReads >= 3) {
                ScriptRunner.stop('RuneCrafter: out of Rune essence in the bank (three reads)');
            }
            return;
        }
        this.emptyReads = 0;
        await Bank.withdrawX(ESSENCE, Math.min(TRADE_LOAD, banked, Inventory.free()));
        this.stocked = await Execution.delayUntil(() => essCount() > 0, 3000); // a withdraw that never landed must retry
        this.bot.countTrip();
        this.bot.log(`withdrew ${essCount()} essence (bank run ${this.bot.tripsTotal()})`);
    }
}

// mule recipient: take whatever essence an open trade offers, giving nothing away
class MuleTakeTrade implements Task {
    private openedAt = 0;
    constructor(private bot: RuneCrafter) {}
    validate(): boolean {
        if (!Trade.active()) {
            this.openedAt = 0;
            return false;
        }
        if (this.openedAt === 0) { this.openedAt = Date.now(); }
        return true;
    }
    async execute(): Promise<void> {
        this.bot.takeRequester(); // anything recorded before this trade opened is stale now
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the essence trade');
            const before = essCount();
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 3000) && essCount() > before) {
                this.bot.countTrade(essCount() - before);
                this.bot.log(`received ${essCount() - before} essence`);
            }
            return;
        }
        if (Trade.myOffer().length > 0) {
            this.bot.log('safety: something is in MY trade offer — declining so nothing is given away');
            await Trade.decline();
            return;
        }
        const theirEssence = Trade.theirOffer().filter(o => (o.name ?? '').toLowerCase() === ESSENCE.toLowerCase()).reduce((s, o) => s + Math.max(1, o.count), 0);
        if (theirEssence <= 0) {
            if (Date.now() - this.openedAt > EMPTY_TRADE_MS) {
                this.bot.log('trade partner never offered essence — declining so waiting runners get served');
                await Trade.decline();
                return;
            }
            this.bot.setStatus('waiting for the essence offer');
            await Execution.delayTicks(1);
            return;
        }
        if (theirEssence > Inventory.free()) {
            // junk in the pack (random event) — the window has to close before MuleDropJunk can drop it
            this.bot.log(`can't fit ${theirEssence} essence (${Inventory.free()} slots free) — declining so the pack can be cleared first`);
            await Trade.decline();
            return;
        }
        this.bot.setStatus(`accepting ${theirEssence} essence`);
        await Trade.accept();
    }
}

class MuleAnswerRequest implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return inTemple() && !Trade.active() && this.bot.pendingRequester() !== null; }
    async execute(): Promise<void> {
        const name = this.bot.takeRequester();
        if (!name) {
            return;
        }
        // never chase: OPPLAYER4 walks us to the target, and a recipient that wanders
        // off the altar is one every other runner then has to hunt for
        const runner = await Execution.delayUntil(() => playerNamed(name, ADJACENT) !== null, 1800)
            ? playerNamed(name, ADJACENT)
            : null;
        if (!runner) {
            this.bot.log(`'${name}' asked to trade but never reached the altar — waiting for the next request`);
            return;
        }
        // trading the requester back is what opens the window (both sides must Trade-with each other)
        this.bot.setStatus(`answering ${runner.name}'s trade request`);
        this.bot.log(`answering ${runner.name}'s trade request`);
        await Trade.request(runner.name ?? name);
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

// Why: a random event hands the recipient an item, and that one slot decides whether a 26-essence delivery fits or every trade is declined.
// Why: the junk goes on the floor, since leaving for a bank strands every runner queued at the altar.

/** Drops recipient-side junk that would block a full delivery. */
class MuleDropJunk implements Task {
    constructor(private bot: RuneCrafter) {}
    // essence is the payload, never junk — a delivery can land between two loops
    private junk(): InvItem[] { return packJunk([...this.bot.muleKeep(), ESSENCE]); }
    validate(): boolean { return inTemple() && !Trade.active() && this.junk().length > 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('dropping random-event junk');
        for (let guard = 0; guard < 28; guard++) {
            const item = this.junk()[0];
            if (!item) { break; }
            this.bot.log(`dropping ${item.name ?? `item#${item.id}`} — it blocks a full essence delivery`);
            const before = Inventory.used();
            if (!(await item.interact('Drop'))) { await Execution.delayTicks(1); return; }
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
        }
        const left = this.junk();
        if (left.length > 0) {
            // undroppable junk would loop here forever while runners pile up outside
            ScriptRunner.stop(`RuneCrafter: could not drop ${left.map(i => `${i.name ?? 'unnamed'}#${i.id}`).join(', ')} — it keeps blocking essence deliveries`);
        }
    }
}

// anything besides the talisman/runes blocks a full 26-essence trade — bank it off
class MulePrepare implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean {
        return !inTemple() && !Trade.active() && essCount() === 0
            && (packJunk(this.bot.muleKeep()).length > 0 || !Inventory.contains(this.bot.talismanName()));
    }
    async execute(): Promise<void> {
        this.bot.setStatus('cleaning the pack at the bank');
        this.bot.log('bank trip — the pack needs just the talisman (+ the rune stack) to take trades');
        if (!(await openBank(this.bot))) { return; }
        if (!(await cleanPack(this.bot, this.bot.muleKeep()))) { return; }
        if (!(await ensureTalisman(this.bot))) { return; }
        this.bot.log('pack is clean — heading back to the altar');
    }
}

// the recipient never walks off the altar: runners come to it
class MuleWait implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        const altar = altarLoc();
        if (altar && altar.distance() > ALTAR_PARK) {
            this.bot.setStatus('parking at the altar');
            this.bot.log('taking up station next to the altar');
            await DirectNavigator.walkTo(altar.tile(), ALTAR_PARK, 15_000);
            return;
        }
        this.bot.setStatus('waiting for a trade request');
        await Execution.delayTicks(2);
    }
}
