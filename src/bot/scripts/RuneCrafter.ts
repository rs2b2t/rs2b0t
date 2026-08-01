import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { depositAllExcept } from '../api/Banking.js';
import { Bank } from '../api/hud/Bank.js';
import { withdrawOp } from '../api/hud/bankOps.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { Trade } from '../api/hud/Trade.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Players } from '../api/queries/Players.js';
import type { Player } from '../api/entities/index.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore, type SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const ESSENCE = 'Rune essence';
const ESSENCE_ID = 1436; // blankrune (unnoted essence); the bank-note variant has a different id
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const TEMPLE_Z = 4000; // altar temples sit at z ~4800; the overworld is < 4000
const MAX_BANK_FAILS = 6;
const MAX_ENTER_FAILS = 3;
// the Mule Recipient holds a talisman + one stacking rune slot, so 26 slots take essence
const TRADE_LOAD = 26;
const TRADEREQ_CHAT = 4; // Client.addChat(4, 'wishes to trade with you.', player)
const TRADE_REQ_TEXT = /wishes to trade with you/i;
const EMPTY_TRADE_MS = 20_000; // a trade nobody puts essence into gets declined after this
const REQUEST_RANGE = 12; // only answer a request whose runner is still near the ruins

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
    mode: { type: 'string', default: 'Solo', options: MODES, label: 'Mode', help: 'Solo banks its own essence. A Runner ferries bank essence to a Mule Recipient at the ruins. The Mule Recipient camps the ruins with just the talisman, takes every essence trade and crafts between trades' },
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
// chat usernames can carry nbsp/underscores where the entity list has spaces
function sameName(a: string, b: string): boolean {
    const clean = (s: string) => s.toLowerCase().replace(/[\u00A0_]/g, ' ').trim();
    return clean(a) === clean(b);
}
function playerNamed(name: string, range: number): Player | null {
    return Players.query().where(p => p.name !== null && sameName(p.name, name)).within(range).nearest();
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
            this.log(`RuneCrafter runner starting — ferrying essence from ${this.cfg.bank} to '${this.partner}' at the ${this.choice} ruins ${this.cfg.ruins}`);
            this.add(new ContinueDialog(), new RunnerTrade(this), new RunnerDeliver(this), new RunnerRestock(this));
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
            this.log(`RuneCrafter mule recipient starting — camping the ${this.choice} ruins ${this.cfg.ruins}, crafting whatever essence gets traded in`);
            this.add(new ContinueDialog(), new MuleTakeTrade(this), new Craft(this), new Exit(this), new Enter(this), new MulePrepare(this), new MuleAnswerRequest(this), new MuleWait(this));
            return;
        }

        this.log(`RuneCrafter starting — ${this.choice}, ruins ${this.cfg.ruins}, bank ${this.cfg.bank}`);
        this.add(new ContinueDialog(), new Craft(this), new Exit(this), new BankTrip(this), new Enter(this));
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

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return;
        }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
    }
}

class Craft implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return inTemple() && essCount() > 0; }
    async execute(): Promise<void> {
        const altar = Locs.query().name(ALTAR.name).action(ALTAR.op).nearest();
        if (!altar) { await Execution.delayTicks(2); return; } // scene still syncing after the telejump
        this.bot.setStatus('crafting runes');
        const before = essCount();
        this.bot.log(`crafting ${before} essence at the altar`);
        if (!(await altar.interact(ALTAR.op))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => essCount() === 0, 8000);
        const made = before - essCount();
        this.bot.countCraft(made);
        this.bot.log(`crafted ${made} ${this.bot.runeName()}s`);
        // The craft locks the player (p_delay 3) and pops a level-up. Leave straight
        // away: in a tight loop, close any dialog and re-click the portal every tick
        // so the Use fires the instant the lock clears, instead of standing there.
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
        await this.bot.walkTo(this.bot.bankTile(), 3);
        const opened = (await Bank.openBooth(this.bot.bankTile(), BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            if (this.bot.countBankFail() >= MAX_BANK_FAILS) {
                this.bot.log('RuneCrafter: couldn\'t reach the bank — start nearer it. Stopping.');
                ScriptRunner.stop();
                return;
            }
            this.bot.log('could not open the bank — will retry');
            return;
        }
        this.bot.resetBankFail();

        const talisman = this.bot.talismanName();
        const rune = this.bot.runeName();
        const madeRunes = Inventory.count(rune);
        await Bank.setNoteMode(false);
        await Bank.depositAllMatching(depositAllExcept([talisman]), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        this.bot.countTrip();
        if (madeRunes > 0) {
            this.bot.log(`deposited ${madeRunes} ${rune}s`);
        }

        if (!Inventory.contains(talisman)) {
            const tal = Bank.items().find(i => i.name?.toLowerCase() === talisman.toLowerCase());
            if (!tal || tal.name === null) {
                this.bot.log(`RuneCrafter: no ${talisman} in the bank or pack. Stopping.`);
                ScriptRunner.stop();
                return;
            }
            const op = withdrawOp(tal.ops, '1') ?? withdrawOp(tal.ops, 'any') ?? 'Withdraw-1';
            await Bank.withdraw(talisman, op);
            await Execution.delayUntil(() => Inventory.contains(talisman), 3000);
            this.bot.log(`withdrew an ${talisman}`);
        }

        if (Bank.count(ESSENCE) === 0) {
            this.bot.log('RuneCrafter: out of Rune essence in the bank. Stopping.');
            ScriptRunner.stop();
            return;
        }
        const ess = Bank.items().find(i => i.name?.toLowerCase() === ESSENCE.toLowerCase());
        const op = (ess && withdrawOp(ess.ops, 'all')) ?? 'Withdraw-All';
        await Bank.withdraw(ESSENCE, op);
        await Execution.delayUntil(() => essCount() > 0 || Bank.count(ESSENCE) === 0, 4000);
        this.bot.log(`withdrew ${essCount()} rune essence (trip ${this.bot.tripsTotal()})`);
    }
}

class Enter implements Task {
    private fails = 0;
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return !inTemple() && essCount() > 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the ruins');
        this.bot.log('heading to the mysterious ruins with a pack of essence');
        await this.bot.walkTo(this.bot.ruinsTile(), 1);
        const ruins = Locs.query().name(RUINS).nearest();
        const talisman = Inventory.first(this.bot.talismanName());
        if (!ruins || !talisman) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('entering the altar');
        this.bot.log(`using the ${this.bot.talismanName()} on the mysterious ruins`);
        if (!(await talisman.useOn(ruins))) { await Execution.delayTicks(2); return; }
        if (await Execution.delayUntil(() => inTemple(), 10_000)) {
            this.bot.log('entered the altar');
            this.fails = 0;
            return;
        }
        if (++this.fails >= MAX_ENTER_FAILS) {
            this.bot.log('RuneCrafter: the talisman didn\'t teleport into the altar. Stopping.');
            ScriptRunner.stop();
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

class RunnerDeliver implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return essCount() > 0 && !Trade.active(); }
    async execute(): Promise<void> {
        const partner = this.bot.partnerName();
        this.bot.setStatus(`delivering to ${partner}`);
        await this.bot.walkTo(this.bot.ruinsTile(), 2);
        const master = playerNamed(partner, REQUEST_RANGE);
        if (!master) {
            this.bot.setStatus(`waiting for ${partner} at the ruins`);
            await Execution.delayTicks(2);
            return;
        }
        // spam on purpose: a busy recipient drops the request server-side, and answering our
        // most recent request is exactly how the recipient opens the trade — so keep asking
        this.bot.log(`requesting a trade with ${master.name}`);
        await Trade.request(master.name ?? partner);
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

class RunnerRestock implements Task {
    private emptyReads = 0;
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return essCount() === 0 && !Trade.active(); }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking essence');
        await this.bot.walkTo(this.bot.bankTile(), 3);
        const opened = (await Bank.openBooth(this.bot.bankTile(), BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            if (this.bot.countBankFail() >= MAX_BANK_FAILS) {
                this.bot.log('RuneCrafter: couldn\'t reach the bank — start nearer it. Stopping.');
                ScriptRunner.stop();
                return;
            }
            this.bot.log('could not open the bank — will retry');
            return;
        }
        this.bot.resetBankFail();

        await Bank.setNoteMode(false);
        // random events hand out junk that eats the slots essence needs; noted essence can't be traded
        await Bank.depositAllMatching((name, id) => name.length > 0 && id !== ESSENCE_ID, m => this.bot.log(`  ${m}`));

        // blank is not empty: the list reads [] for a beat after opening — believe it on the third read
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        const banked = Bank.count(ESSENCE);
        if (banked === 0) {
            if (++this.emptyReads >= 3) {
                this.bot.log('RuneCrafter: out of Rune essence in the bank (three reads). Stopping.');
                ScriptRunner.stop();
            }
            return;
        }
        this.emptyReads = 0;
        await Bank.withdrawX(ESSENCE, Math.min(TRADE_LOAD, banked, Inventory.free()));
        await Execution.delayUntil(() => essCount() > 0, 3000);
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
            // junk in the pack (random event) — declining lets MulePrepare bank it before the retry
            this.bot.log(`can't fit ${theirEssence} essence (${Inventory.free()} slots free) — declining to clean the pack first`);
            await Trade.decline();
            return;
        }
        this.bot.setStatus(`accepting ${theirEssence} essence`);
        await Trade.accept();
    }
}

// anything besides the talisman/runes/essence blocks a full 26-essence trade — bank it off
class MulePrepare implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean {
        if (inTemple() || Trade.active() || essCount() > 0) {
            return false;
        }
        const junk = Inventory.items().some(i => i.name !== null && i.id !== ESSENCE_ID
            && i.name.toLowerCase() !== this.bot.talismanName().toLowerCase()
            && i.name.toLowerCase() !== this.bot.runeName().toLowerCase());
        return junk || !Inventory.contains(this.bot.talismanName());
    }
    async execute(): Promise<void> {
        this.bot.setStatus('cleaning the pack at the bank');
        this.bot.log('bank trip — the pack needs just the talisman (+ the rune stack) to take trades');
        await this.bot.walkTo(this.bot.bankTile(), 3);
        const opened = (await Bank.openBooth(this.bot.bankTile(), BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            if (this.bot.countBankFail() >= MAX_BANK_FAILS) {
                this.bot.log('RuneCrafter: couldn\'t reach the bank — start nearer it. Stopping.');
                ScriptRunner.stop();
                return;
            }
            this.bot.log('could not open the bank — will retry');
            return;
        }
        this.bot.resetBankFail();

        const talisman = this.bot.talismanName();
        await Bank.depositAllMatching(depositAllExcept([talisman, this.bot.runeName()]), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);

        if (!Inventory.contains(talisman)) {
            // blank is not empty: the list reads [] for a beat after opening
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            const tal = Bank.items().find(i => i.name?.toLowerCase() === talisman.toLowerCase());
            if (!tal || tal.name === null) {
                this.bot.log(`RuneCrafter: no ${talisman} in the bank or pack. Stopping.`);
                ScriptRunner.stop();
                return;
            }
            const op = withdrawOp(tal.ops, '1') ?? withdrawOp(tal.ops, 'any') ?? 'Withdraw-1';
            await Bank.withdraw(talisman, op);
            await Execution.delayUntil(() => Inventory.contains(talisman), 3000);
            this.bot.log(`withdrew an ${talisman}`);
        }
        this.bot.log('pack is clean — heading back to the ruins');
    }
}

class MuleAnswerRequest implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return !inTemple() && essCount() === 0 && !Trade.active() && this.bot.pendingRequester() !== null; }
    async execute(): Promise<void> {
        const name = this.bot.takeRequester();
        if (!name) {
            return;
        }
        const runner = playerNamed(name, REQUEST_RANGE);
        if (!runner) {
            this.bot.log(`'${name}' asked to trade but isn't near the ruins any more — waiting for the next request`);
            return;
        }
        // trading the requester back is what opens the window (both sides must Trade-with each other)
        this.bot.setStatus(`answering ${runner.name}'s trade request`);
        this.bot.log(`answering ${runner.name}'s trade request`);
        await Trade.request(runner.name ?? name);
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

class MuleWait implements Task {
    constructor(private bot: RuneCrafter) {}
    validate(): boolean { return !inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('waiting for a trade request');
        await this.bot.walkTo(this.bot.ruinsTile(), 1);
        await Execution.delayTicks(2);
    }
}
