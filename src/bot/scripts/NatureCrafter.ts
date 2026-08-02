import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { depositAllExcept } from '../api/Banking.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { Shop } from '../api/hud/Shop.js';
import { Trade } from '../api/hud/Trade.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { GroundItems, type GroundItem } from '../api/queries/GroundItems.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Players } from '../api/queries/Players.js';
import type { Player } from '../api/entities/index.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { type SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { planStoreStep, offerCount, coinTargetFor, shortRouteWithdraw, RUNES, RUNE_OPTIONS, DEFAULT_RUNE, type RuneType, LOW_COINS, STORE_PASSES, TRADE_CAP, PICKUP_RANGE } from './NatureRunnerLogic.js';

const ESSENCE = 'Rune essence';
const ESSENCE_ID = 1436; // blankrune (unnoted essence); the bank-note variant has a different id
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const TEMPLE_Z = 4000; // altar temples sit at z ~4800; the overworld is < 4000
const RUNNER_RANGE = 2; // tiles; only trade an adjacent runner (OPPLAYER4 walks you to them)
const COINS = 'Coins';
const LADDER = 'Ladder';
const CLIMB_UP = 'Climb-up';
const CLIMB_DOWN = 'Climb-down';
const AGGRO_SHAKE_TICKS = 5; // ~3s upstairs, long enough for the spiders to drop us
const SHAKE_COOLDOWN_MS = 60_000;

export const SETTINGS: SettingsSchema = {
    rune: { type: 'string', default: DEFAULT_RUNE, options: RUNE_OPTIONS, label: 'Rune', help: 'which rune the pair crafts. Nature = Ardougne bank + ship + Jiminua un-noting; Air = Falador East bank, straight there and back' },
    mode: { type: 'string', default: 'Master', options: ['Master', 'Runner'], label: 'Mode', help: 'Master crafts at the altar and takes essence from runners; Runner ferries essence to the master' },
    partner: { type: 'string', default: '', label: 'Partner name(s)', help: 'Master: runner name(s) to accept essence from, comma-separated. Runner: the master to deliver to.' },
    bankEvery: { type: 'number', default: 60, min: 0, label: 'Bank everything every N minutes (0 = never)', help: 'Master: walks to the bank on this timer and deposits everything except the talisman — banks the runes and clears out whatever random events have left in the pack. Air banks at Falador East; the nature master\'s nearest bank is the quest-gated Shilo Village one, so it may not be reachable' },
    withdrawEss: { type: 'number', default: 0, min: 0, label: 'Essence per restock (0 = default)', help: 'Runner: essence withdrawn per bank restock. 0 = the whole bank stack when noting (nature), or one trade-load (air)' },
    withdrawCoins: { type: 'number', default: 10000, min: 0, label: 'Coins target at restock', help: 'Runner: top coins up to this at each restock (boat fares + shop buy-backs). Unused by air.' }
};

function inTemple(): boolean {
    const t = Game.tile();
    return t !== null && t.z > TEMPLE_Z;
}
function essCount(): number {
    return Inventory.count(ESSENCE);
}
function runeCount(bot: NatureCrafter): number {
    return Inventory.count(bot.cfg().rune);
}
function notedEssence(): number {
    return Inventory.items().filter(i => i.name?.toLowerCase() === ESSENCE.toLowerCase() && i.id !== ESSENCE_ID).reduce((s, i) => s + i.count, 0);
}
function unnotedEssence(): number {
    return Inventory.items().filter(i => i.id === ESSENCE_ID).reduce((s, i) => s + i.count, 0);
}

export default class NatureCrafter extends TaskBot {
    override loopDelay = 600;

    private mode = 'Master';
    private rune = DEFAULT_RUNE;
    private conf: RuneType = RUNES[DEFAULT_RUNE];
    private partners: string[] = [];
    private bankMs = 60 * 60_000;
    private essPer = 0;
    private coinsTarget = 10000;
    private goBank = false;
    private crafted = 0;
    private received = 0;
    private trades = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.mode = this.settings.str('mode', 'Master');
        this.rune = this.settings.str('rune', DEFAULT_RUNE);
        this.conf = RUNES[this.rune] ?? RUNES[DEFAULT_RUNE];
        this.partners = this.settings.str('partner', '').split(',').map(s => s.trim()).filter(Boolean);
        this.bankMs = Math.max(0, this.settings.num('bankEvery', 60)) * 60_000; // 0 = never bank
        this.essPer = Math.max(0, this.settings.num('withdrawEss', 0));
        this.coinsTarget = coinTargetFor(this.settings.num('withdrawCoins', 10000));
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('runecraft');

        if (this.partners.length === 0) {
            this.log(`NatureCrafter: no partner names set — ${this.mode === 'Runner' ? 'the runner needs the master name' : 'the master only trades with configured runners'}. Stopping.`);
            throw new Error('NatureCrafter: no partner configured');
        }

        if (this.mode === 'Runner') {
            const route = this.conf.unnote ? `via the bank + ship + ${this.conf.unnote.npc}` : 'straight from the bank (unnoted)';
            this.log(`NatureCrafter runner starting — ferrying essence for ${this.rune} to [${this.partners.join(', ')}] ${route}`);
            this.add(
                new ContinueDialog(),
                new DriveTrade(this),
                new GoBankPark(this),
                // the note legs only exist on the long route; the short one carries unnoted essence
                ...(this.conf.unnote ? [new PickupNotedEssence(this)] : []),
                new DeliverEssence(this),
                ...(this.conf.unnote ? [new UnNoteEssence(this)] : []),
                new BankRestock(this)
            );
            return;
        }

        if (Skills.level('runecraft') < this.conf.level) {
            this.log(`NatureCrafter: Runecrafting ${this.conf.level} required for ${this.rune} (have ${Skills.level('runecraft')}) — stopping.`);
            throw new Error('NatureCrafter: runecrafting level too low');
        }
        this.log(`NatureCrafter master starting — ${this.rune} at ${this.conf.ruins}, accepting essence from [${this.partners.join(', ')}], ${this.bankMs > 0 ? `banking everything every ${Math.round(this.bankMs / 60_000)}min` : 'never banking'}`);
        this.add(
            new ContinueDialog(),
            new HandleOpenTrade(this),
            new CraftNatures(this),
            new ExitTemple(this),
            new EnterAltar(this),
            new BankEverything(this),
            new AcceptRunner(this),
            new WaitForRunner(this)
        );
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        p.title(`NatureCrafter — ${this.rune} — ${this.mode.toLowerCase()} — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = Skills.xp('runecraft') - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Mode: ${this.mode}`, this.mode === 'Master' ? `RC lvl: ${Skills.level('runecraft')}` : `To: ${this.partners[0] ?? '?'}`);
        if (this.mode === 'Master') {
            p.row(`Crafted: ${this.crafted}`, `Trades: ${this.trades}`, `Ess in: ${this.received}`);
            p.row(`RC xp: ${xpGained}`, `RC xp/h: ${xph}`, `Runners: ${this.partners.length}`);
            p.row(`Pack ess: ${essCount()}`, `Pack runes: ${runeCount(this)}`, '');
        } else {
            p.row(`Deliveries: ${this.trades}`, `Ess sent: ${this.received}`, `Coins: ${Inventory.count(COINS)}`);
            p.row(`Pack ess: ${essCount()}`, `noted: ${notedEssence()}`, `unnoted: ${unnotedEssence()}`);
            p.gap();
            const clicked = p.buttons([{ id: 'gobank', label: this.goBank ? 'Resume' : 'Go bank' }]);
            if (clicked === 'gobank') {
                this.goBank = !this.goBank;
                this.log(this.goBank ? 'Go bank pressed — heading to the bank to park' : 'Resume pressed — back to the loop');
            }
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    cfg(): RuneType { return this.conf; }
    // the client is never told whether an obj is tradeable or bankable (ObjType has no such
    // field — it is server-side only), so the only way to know is to try and watch it refuse
    setStatus(s: string): void { this.status = s; }
    countCraft(n: number): void { this.crafted += n; }
    countTrade(essence: number): void { this.trades++; this.received += essence; }
    bankIntervalMs(): number { return this.bankMs; }
    essPerRestock(): number { return this.essPer; }
    coinTarget(): number { return this.coinsTarget; }
    goBankActive(): boolean { return this.goBank; }
    isPartner(name: string | null): boolean {
        return name !== null && this.partners.some(p => p.toLowerCase() === name.toLowerCase());
    }
    partnerNames(): string[] { return this.partners; }
    countDelivery(essence: number): void { this.trades++; this.received += essence; }
    nearestRunner(): Player | null {
        return Players.query().name(...this.partners).within(RUNNER_RANGE).nearest();
    }

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return;
        }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
    }
}

// master: the talisman, the runes it crafts and the essence it works on are the only things it
// should ever hold. Anything else is random-event litter (banked on the timer trip).
class HandleOpenTrade implements Task {
    private partnerWait = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return Trade.active(); }
    async execute(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the essence trade');
            const before = essCount();
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 3000) && essCount() > before) {
                this.bot.countTrade(essCount() - before);
                this.bot.log(`received ${essCount() - before} essence`);
            }
            this.partnerWait = 0;
            return;
        }

        // Header can lag several ticks after the modal opens — do not treat blank as stranger.
        const who = Trade.partner();
        if (who === null) {
            this.partnerWait++;
            this.bot.setStatus('reading trade partner');
            if (this.partnerWait > 8) {
                this.bot.log('trade partner name never appeared — declining stuck modal');
                await Trade.decline();
                this.partnerWait = 0;
            } else {
                await Execution.delayTicks(1);
            }
            return;
        }
        this.partnerWait = 0;
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            this.bot.log(`declining a trade from '${who}' — not a configured runner`);
            await Trade.decline();
            return;
        }
        // Real safety (regressed in bankEvery commit a660439): only refuse if precious
        // items are on OUR offer. Declining any non-empty myOffer killed legitimate
        // air/nature receives when the offer UI still held leftover slots / litter.
        const offered = Trade.myOffer();
        const precious = [this.bot.cfg().talisman, this.bot.cfg().rune, ESSENCE].map(n => n.toLowerCase());
        if (offered.some(o => precious.includes((o.name ?? '').toLowerCase()))) {
            this.bot.log(
                `safety: ${offered.map(o => o.name).join(', ')} in MY offer includes talisman/runes/essence — declining`
            );
            await Trade.decline();
            return;
        }

        const theirEssence = Trade.theirOffer()
            .filter(o => (o.name ?? '').toLowerCase() === ESSENCE.toLowerCase())
            .reduce((s, o) => s + Math.max(1, o.count), 0);
        if (theirEssence <= 0) {
            this.bot.setStatus(`waiting for ${who} to offer essence`);
            await Execution.delayTicks(1);
            return;
        }
        this.bot.setStatus(`accepting ${theirEssence} essence from ${who}`);
        await Trade.accept();
    }
}

class CraftNatures implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return inTemple() && essCount() > 0; }
    async execute(): Promise<void> {
        const altar = Locs.query().name(ALTAR.name).action(ALTAR.op).nearest();
        if (!altar) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('crafting runes');
        const before = essCount();
        this.bot.log(`crafting ${before} essence at the altar`);
        if (!(await altar.interact(ALTAR.op))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => essCount() === 0, 8000);
        const made = before - essCount();
        this.bot.countCraft(made);
        this.bot.log(`crafted ${made} ${this.bot.cfg().rune}s`);
        await portalOut(this.bot);
    }
}

class ExitTemple implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        await portalOut(this.bot);
    }
}

class EnterAltar implements Task {
    private fails = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return !inTemple() && essCount() > 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('entering the altar to craft');
        await this.bot.walkTo(this.bot.cfg().ruins, 1);
        const ruins = Locs.query().name(RUINS).nearest();
        const talisman = Inventory.first(this.bot.cfg().talisman);
        if (!ruins || !talisman) { await Execution.delayTicks(2); return; }
        this.bot.log(`using the ${this.bot.cfg().talisman} on the mysterious ruins`);
        if (!(await talisman.useOn(ruins))) { await Execution.delayTicks(2); return; }
        if (await Execution.delayUntil(() => inTemple(), 10_000)) {
            this.bot.log('entered the altar');
            this.fails = 0;
            return;
        }
        if (++this.fails >= 3) {
            this.bot.log('NatureCrafter: the talisman didn\'t teleport into the altar. Stopping.');
            ScriptRunner.stop();
        }
    }
}

// Everything-goes bank trip on a timer: banks the runes and, with them, whatever random events
// have dropped in the pack. Cheaper than reasoning about which litter can be traded or dropped.
class BankEverything implements Task {
    private backoffUntil = 0;
    private nextBankAt: number;
    constructor(private bot: NatureCrafter) {
        this.nextBankAt = Date.now() + bot.bankIntervalMs(); // first trip is a full interval away
    }
    validate(): boolean {
        return this.bot.bankIntervalMs() > 0 && Date.now() >= this.nextBankAt
            && !inTemple() && essCount() === 0 && !Trade.active() && Date.now() >= this.backoffUntil;
    }
    async execute(): Promise<void> {
        const cfg = this.bot.cfg();
        this.nextBankAt = Date.now() + this.bot.bankIntervalMs();
        this.bot.setStatus('banking everything');
        this.bot.log(`${Math.round(this.bot.bankIntervalMs() / 60_000)}min bank trip — ${runeCount(this.bot)} ${cfg.rune}s and anything else in the pack`);
        // short timeout so an unreachable quest-gated bank fails fast, not after the default 240s
        const reached = await Traversal.walkResilient(cfg.masterBank, { radius: 3, attempts: 2, timeoutMs: 30_000, log: m => this.bot.log(`  ${m}`) });
        const opened = reached && ((await Bank.openBooth(cfg.masterBank, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`))));
        if (!opened) {
            this.bot.log('NatureCrafter: bank unreachable (Shilo Village quest?) — holding runes (they stack) and continuing to serve runners');
            this.backoffUntil = Date.now() + 300_000;
            await this.bot.walkTo(cfg.ruins, 1);
            return;
        }
        const made = runeCount(this.bot);
        const before = Inventory.used();
        await Bank.depositAllMatching(depositAllExcept([cfg.talisman]), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        this.bot.log(`banked ${made} ${cfg.rune}s, cleared ${before - Inventory.used()} slot(s); back to the altar`);
        await this.bot.walkTo(cfg.ruins, 1);
    }
}

class AcceptRunner implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean {
        // no rune-count guard — task order lets the bank trip preempt when its timer is due
        return !inTemple() && essCount() === 0 && !Trade.active() && this.bot.nearestRunner() !== null;
    }
    async execute(): Promise<void> {
        const runner = this.bot.nearestRunner();
        if (!runner) { return; }
        this.bot.setStatus(`accepting ${runner.name}'s trade`);
        this.bot.log(`runner '${runner.name}' is here — accepting the trade`);
        await Trade.request(runner.name ?? '');
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

class WaitForRunner implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return !inTemple() && essCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('waiting for a runner at the ruins');
        await this.bot.walkTo(this.bot.cfg().ruins, 1);
        await Execution.delayTicks(2);
    }
}

// jungle spiders chase the runner all the way to the store; a trip up the ladder next to
// Jiminua (2766,3121) and straight back down drops their aggro
async function shakeAggroOnLadder(bot: NatureCrafter): Promise<void> {
    const level = (): number => Game.tile()?.level ?? 0;
    const ground = level();
    const up = Locs.query().name(LADDER).action(CLIMB_UP).nearest();
    if (!up) {
        return;
    }
    bot.setStatus('shaking the jungle spiders off on the ladder');
    if (!(await up.interact(CLIMB_UP)) || !(await Execution.delayUntil(() => level() !== ground, 10_000))) {
        bot.log('could not climb the store ladder — carrying on');
        return;
    }
    await Execution.delayTicks(AGGRO_SHAKE_TICKS);
    for (let i = 0; i < 3; i++) {
        // locs read empty for a tick after a level change, so this may need a retry
        const down = Locs.query().name(LADDER).action(CLIMB_DOWN).nearest();
        if (down && (await down.interact(CLIMB_DOWN)) && (await Execution.delayUntil(() => level() === ground, 10_000))) {
            bot.log('waited out the spiders upstairs and came back down');
            await Execution.delayTicks(1);
            return;
        }
        await Execution.delayTicks(2);
    }
    bot.log('stuck up the store ladder — the walker will bring us back down');
}

// opens via Talk-to + the first ("yes/buy") dialogue option, not a bare Trade op
async function openUnnoteShop(name: string): Promise<boolean> {
    if (Shop.isOpen()) {
        return true;
    }
    // the scene reads empty for a tick or two after the ladder trip — blank isn't absent
    await Execution.delayUntil(() => Npcs.query().name(name).nearest() !== null, 5000);
    const npc = Npcs.query().name(name).nearest();
    if (!npc) {
        return false;
    }
    await npc.interact('Talk-to');
    for (let i = 0; i < 10 && !Shop.isOpen(); i++) {
        if (ChatDialog.options().length > 0) {
            await ChatDialog.chooseOption();
        } else if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        }
        await Execution.delayTicks(1);
    }
    return Shop.isOpen();
}

// owns the loop while a trade modal is open — never moves (movement/combat closes it)
class DriveTrade implements Task {
    private pending = 0;
    private beforeUnnoted = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return Trade.active(); }
    async execute(): Promise<void> {
        if (Trade.onOfferScreen()) {
            if (Trade.myOffer().length === 0) {
                const held = unnotedEssence();
                const n = offerCount(held);
                if (n <= 0) {
                    // nothing to give — but the master may be handing random-event litter back
                    if (Trade.theirOffer().length > 0) {
                        this.bot.setStatus('taking items back from the master');
                        await Trade.accept();
                    } else {
                        await Execution.delayTicks(1);
                    }
                    return;
                }
                this.pending = n;
                this.beforeUnnoted = held;
                this.bot.setStatus('offering essence');
                if (held <= TRADE_CAP) {
                    this.bot.log(`trade open — offering ${n} essence`);
                    await Trade.offerAll(ESSENCE, i => i.id === ESSENCE_ID);
                } else {
                    this.bot.log(`holding ${held} unnoted — offering the ${n} cap`);
                    await Trade.offer(ESSENCE, n, i => i.id === ESSENCE_ID);
                }
            } else {
                this.bot.setStatus('accepting the offer');
                await Trade.accept();
            }
            return;
        }
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the trade');
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 2500) && this.pending > 0) {
                const delivered = this.beforeUnnoted - unnotedEssence();
                if (delivered > 0) {
                    this.bot.countDelivery(delivered);
                    this.bot.log(`delivered ${delivered} essence to the master`);
                }
                this.pending = 0;
            }
        }
    }
}

class GoBankPark implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return this.bot.goBankActive() && !Trade.active(); }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (!here || this.bot.cfg().runnerBank.distanceTo(here) > 4) {
            this.bot.setStatus('Go bank: walking to the bank');
            await this.bot.walkTo(this.bot.cfg().runnerBank, 3);
            return;
        }
        this.bot.setStatus('parked at the bank — press Resume');
        await Execution.delayTicks(2);
    }
}

function groundNotedEss(): GroundItem | null {
    return GroundItems.query()
        .where(g => (g.name ?? '').toLowerCase() === ESSENCE.toLowerCase() && g.id !== ESSENCE_ID)
        .within(PICKUP_RANGE)
        .nearest();
}

class PickupNotedEssence implements Task {
    private fails = 0;
    private blockedUntil = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return !Trade.active() && Date.now() >= this.blockedUntil && groundNotedEss() !== null; }
    async execute(): Promise<void> {
        const drop = groundNotedEss();
        if (!drop) {
            return;
        }
        this.bot.setStatus('picking up dropped noted essence');
        this.bot.log(`noted essence on the ground (${drop.count}) — another runner died? picking it up`);
        const before = notedEssence();
        const clicked = await drop.interact('Take');
        if (clicked) {
            await Execution.delayUntil(() => notedEssence() > before, 8000);
        }
        if (notedEssence() > before) {
            this.bot.log(`picked up ${notedEssence() - before} noted essence`);
            this.fails = 0;
            return;
        }
        // an unreachable/unpickable stack must not starve deliveries forever
        if (++this.fails >= 3) {
            this.bot.log('could not pick the noted stack up (full pack? out of reach) — ignoring it for a while');
            this.fails = 0;
            this.blockedUntil = Date.now() + 120_000;
        }
        await Execution.delayTicks(2);
    }
}

class DeliverEssence implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return unnotedEssence() > 0 && !Trade.active(); }
    async execute(): Promise<void> {
        const masterName = this.bot.partnerNames()[0];
        this.bot.setStatus(`walking to ${masterName}`);
        await this.bot.walkTo(this.bot.cfg().ruins, 2);
        const master = Players.query().name(...this.bot.partnerNames()).nearest();
        if (!master) {
            this.bot.log(`at the ruins — waiting for the master '${masterName}' to be here`);
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus(`requesting a trade with ${master.name}`);
        this.bot.log(`requesting a trade to hand ${unnotedEssence()} essence to ${master.name}`);
        await Trade.request(master.name ?? '');
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

function shopEssStock(): number {
    return Shop.stock().find(s => s.name.toLowerCase() === ESSENCE.toLowerCase())?.count ?? 0;
}

class UnNoteEssence implements Task {
    private lastShakeAt = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return this.bot.cfg().unnote !== null && notedEssence() > 0 && unnotedEssence() === 0 && Inventory.count(COINS) >= LOW_COINS; }
    async execute(): Promise<void> {
        const store = this.bot.cfg().unnote;
        if (!store) {
            return;
        }
        this.bot.setStatus('topping up unnoted essence at the store');
        await this.bot.walkTo(store.tile, 3);
        // one trip per arrival — a retried store visit must not climb all over again
        if (Date.now() - this.lastShakeAt > SHAKE_COOLDOWN_MS) {
            await shakeAggroOnLadder(this.bot);
            this.lastShakeAt = Date.now();
        }
        if (!(await openUnnoteShop(store.npc))) {
            this.bot.log(`couldn't open ${store.npc}'s store — retrying`);
            return;
        }
        for (let pass = 0; pass < STORE_PASSES; pass++) {
            const stock = shopEssStock();
            const step = planStoreStep(stock, notedEssence(), unnotedEssence());
            if (step.op === 'done') {
                break;
            }
            const before = { noted: notedEssence(), unnoted: unnotedEssence() };
            if (step.op === 'sell') {
                this.bot.log(`selling ${step.n} noted essence to ${store.npc} (stock ${stock})`);
                await Shop.sell(ESSENCE, step.n, i => i.id !== ESSENCE_ID);
            } else {
                this.bot.log(`buying ${step.n} essence from stock (${stock} in the shop)`);
                await Shop.buy(ESSENCE, step.n);
            }
            if (notedEssence() === before.noted && unnotedEssence() === before.unnoted) {
                this.bot.log('store pass made no progress (out of coins or raced) — leaving with what we have');
                break;
            }
        }
        await Shop.close();
        this.bot.log(`store visit done: ${unnotedEssence()} unnoted held (noted left: ${notedEssence()})`);
    }
}

class BankRestock implements Task {
    private emptyReads = 0;
    constructor(private bot: NatureCrafter) {}
    // coins only matter on the noting route (fares + buy-backs); the short route never spends any
    validate(): boolean { return essCount() === 0 || (this.bot.cfg().unnote !== null && Inventory.count(COINS) < LOW_COINS); }
    async execute(): Promise<void> {
        const cfg = this.bot.cfg();
        this.bot.setStatus('restocking at the bank');
        await this.bot.walkTo(cfg.runnerBank, 3);
        const opened = (await Bank.openBooth(cfg.runnerBank, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        await Bank.setNoteMode(false);
        // random events hand out items that eat the slots essence needs — dump anything unrelated
        const keep = cfg.unnote ? [ESSENCE, COINS] : [ESSENCE];
        const before = Inventory.used();
        await Bank.depositAllMatching(depositAllExcept(keep), m => this.bot.log(`  ${m}`));
        if (Inventory.used() < before) {
            this.bot.log(`banked ${before - Inventory.used()} slot(s) of random-event litter`);
        }

        // blank is not empty: the item list reads [] for a beat after opening and after a deposit,
        // and one stale read here used to stop a runner that had thousands of essence banked
        await Execution.delayUntil(() => Bank.loaded(), 3000);

        if (cfg.unnote) {
            const needCoins = this.bot.coinTarget() - Inventory.count(COINS);
            if (needCoins > 0 && Bank.count(COINS) > 0) {
                await Bank.withdrawX(COINS, Math.min(needCoins, Bank.count(COINS)));
            }
            if (Inventory.count(COINS) < LOW_COINS && Bank.loaded()) {
                this.bot.log('NatureCrafter runner: out of coins (bank + pack) for fares and buy-backs. Stopping.');
                ScriptRunner.stop();
                return;
            }
        }

        const banked = Bank.count(ESSENCE);
        if (banked === 0) {
            // only believe an empty bank after it reads empty on three separate restocks
            if (essCount() === 0 && ++this.emptyReads >= 3) {
                this.bot.log('NatureCrafter runner: out of Rune essence in the bank (three reads). Stopping.');
                ScriptRunner.stop();
            }
            return;
        }
        this.emptyReads = 0;
        const per = this.bot.essPerRestock();
        if (!cfg.unnote) {
            const want = shortRouteWithdraw(per, banked, Inventory.free());
            await Bank.withdrawX(ESSENCE, want);
            await Execution.delayUntil(() => essCount() > 0, 3000);
            this.bot.log(`withdrew ${essCount()} unnoted essence for the run`);
            return;
        }
        const want = per > 0 ? Math.min(per, banked) : banked;
        await Bank.setNoteMode(true);
        await Bank.withdrawX(ESSENCE, want);
        await Execution.delayUntil(() => essCount() > 0, 3000);
        await Bank.setNoteMode(false);
        this.bot.log(`withdrew ${essCount()} essence (${notedEssence() > 0 ? 'noted' : 'unnoted'}) + coins topped to ${Inventory.count(COINS)}`);
    }
}

// craft locks the player (p_delay 3); tight-loop the portal so Use fires the instant it clears
async function portalOut(bot: NatureCrafter): Promise<void> {
    bot.setStatus('taking the portal out');
    bot.log('taking the portal back to the ruins');
    for (let i = 0; i < 15 && inTemple(); i++) {
        if (ChatDialog.canContinue()) { await ChatDialog.continue(); continue; }
        const portal = Locs.query().name(PORTAL.name).action(PORTAL.op).nearest();
        if (portal) { await portal.interact(PORTAL.op); }
        await Execution.delayTicks(1);
    }
    if (!inTemple()) { bot.log('back at the mysterious ruins'); }
}
