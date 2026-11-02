import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { BotHost } from '../../runtime/BotHost.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { XpTracker, jiveFrame, paintLevels } from '../../paint/jive.js';
import { Skills } from '../../api/skills/Skills.js';
import { Shop } from '../../api/shop/Shop.js';
import { Trade } from '../../api/trade/Trade.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { GroundItems, type GroundItem } from '../../api/grounditems/GroundItems.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Players } from '../../api/players/Players.js';
import type { Player } from '../../api/model/Player.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { type SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { inRuneTemple, inZanaris, planStoreStep, offerCount, coinTargetFor, shortRouteWithdraw, RUNES, RUNE_OPTIONS, DEFAULT_RUNE, type RuneType, LOW_COINS, STORE_PASSES, TRADE_CAP, TRADE_ADJACENT, PICKUP_RANGE, SPIDER_SAFE, spiderSafeVia, runnerShouldWalkToMeet, runnerMayLeaveAltar, masterPickTradeTarget, masterOfferDecision, tradeWindowIsFor, masterShouldExitTemple, masterShouldEnterAltar, keepNames, isDroppableLitter, MASTER_HANDSHAKE_MS, runnerShouldRequestTrade } from './logic.js';

const ESSENCE = 'Rune essence';
const ESSENCE_ID = 1436; // blankrune (unnoted essence); the bank-note variant has a different id
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const TRADEREQ_CHAT = 4; // Client.addChat(4, 'wishes to trade with you.', player)
const TRADE_REQ_TEXT = /wishes to trade with you/i;
const COINS = 'Coins';
const LADDER = 'Ladder';
const CLIMB_UP = 'Climb-up';
const CLIMB_DOWN = 'Climb-down';
const AGGRO_SHAKE_TICKS = 5; // ~3s upstairs, long enough for the spiders to drop us
const SHAKE_COOLDOWN_MS = 60_000;

export const SETTINGS: SettingsSchema = {
    rune: { type: 'string', default: DEFAULT_RUNE, options: RUNE_OPTIONS, label: 'Rune', help: 'Nature uses Ardougne bank and Jiminua unnoting. Air uses Falador East bank. Cosmic uses Zanaris bank; start in Zanaris or the cosmic altar.' },
    mode: { type: 'string', default: 'Master', options: ['Master', 'Runner'], label: 'Mode', help: 'Master crafts at the altar and takes essence from runners; Runner ferries essence to the master' },
    partner: { type: 'string', default: '', label: 'Partner name(s)', help: 'Master: runner name(s) to accept essence from, comma-separated. Runner: the master to deliver to.' },
    bankEvery: { type: 'number', default: 60, min: 0, label: 'Bank everything every N minutes (0 = never)', help: 'Master: bank runes and junk on this timer, keeping the talisman and travel gear. Air banks at Falador East, Cosmic in Zanaris, and Nature in Shilo Village (quest required).' },
    withdrawEss: { type: 'number', default: 0, min: 0, label: 'Essence per restock (0 = default)', help: 'Runner: 0 withdraws the full bank stack as notes for Nature, or one unnoted trade load for Air and Cosmic.' },
    withdrawCoins: { type: 'number', default: 10000, min: 0, label: 'Coins target at restock', help: 'Runner: coins for Nature boat fares and shop buybacks. Air and Cosmic do not spend coins.' },
    stayInAltar: { type: 'boolean', default: false, label: 'Stay in the altar', help: 'Master and runner trade inside the selected altar. Each runner needs the matching talisman.' }
};

function essCount(): number {
    return Inventory.count(ESSENCE);
}
function runeCount(bot: JiveRC): number {
    return Inventory.count(bot.cfg().rune);
}
function notedEssence(): number {
    return Inventory.items().filter(i => i.name?.toLowerCase() === ESSENCE.toLowerCase() && i.id !== ESSENCE_ID).reduce((s, i) => s + i.count, 0);
}
function unnotedEssence(): number {
    return Inventory.items().filter(i => i.id === ESSENCE_ID).reduce((s, i) => s + i.count, 0);
}

function offerEss(items: { name: string | null; count: number }[]): number {
    return items
        .filter(o => (o.name ?? '').toLowerCase() === ESSENCE.toLowerCase())
        .reduce((s, o) => s + Math.max(1, o.count), 0);
}

function tradeSnap(): string {
    const screen = Trade.onConfirmScreen() ? 'confirm' : Trade.onOfferScreen() ? 'offer' : Trade.active() ? 'open' : 'closed';
    return `${screen} with=${Trade.partner() ?? '-'} mine=${offerEss(Trade.myOffer())} theirs=${offerEss(Trade.theirOffer())} unnoted=${unnotedEssence()}`;
}

export default class JiveRC extends TaskBot {
    override loopDelay = 600;

    private mode = 'Master';
    private rune = DEFAULT_RUNE;
    private conf: RuneType = RUNES[DEFAULT_RUNE];
    private partners: string[] = [];
    private bankMs = 60 * 60_000;
    private essPer = 0;
    private coinsTarget = 10000;
    private stayInAltar = false;
    private nextBankAt = 0;
    private goBank = false;
    private crafted = 0;
    private received = 0;
    private trades = 0;
    private lastRequester: string | null = null;
    private lastAskAt = 0;
    private lastAcceptAt = 0;
    private handshakeHoldUntil = 0;
    private loadDelivered = false;
    private status = 'starting';
    private startedAt = Date.now();
    private xp = new XpTracker(['runecraft'], Skills);

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.mode = this.settings.str('mode', 'Master');
        this.rune = this.settings.str('rune', DEFAULT_RUNE);
        this.conf = RUNES[this.rune] ?? RUNES[DEFAULT_RUNE];
        this.partners = this.settings.str('partner', '').split(',').map(s => s.trim()).filter(Boolean);
        this.bankMs = Math.max(0, this.settings.num('bankEvery', 60)) * 60_000; // 0 = never bank
        this.essPer = Math.max(0, this.settings.num('withdrawEss', 0));
        this.coinsTarget = coinTargetFor(this.settings.num('withdrawCoins', 10000));
        this.stayInAltar = this.settings.bool('stayInAltar', false);
        this.nextBankAt = Date.now() + this.bankMs;
        this.startedAt = Date.now();
        this.xp.begin();

        if (this.partners.length === 0) {
            this.log(`JiveRC: no partner names set — ${this.mode === 'Runner' ? 'the runner needs the master name' : 'the master only trades with configured runners'}. Stopping.`);
            throw new Error('JiveRC: no partner configured');
        }

        if (this.conf.rune === 'Cosmic rune' && !inZanaris(Game.tile()) && !this.inTemple()) {
            throw new Error('JiveRC: start Cosmic crafting in Zanaris or the cosmic altar');
        }

        if (this.mode === 'Runner') {
            if (this.stayInAltar) {
                await Execution.delayUntil(() => Inventory.first(this.conf.talisman) !== null, 3000);
                if (Inventory.first(this.conf.talisman) === null) {
                    ScriptRunner.stop('JiveRC runner: stay-in-altar needs a talisman in the pack');
                    return;
                }
            }
            const route = this.conf.unnote ? `via the bank + ship + ${this.conf.unnote.npc}` : 'straight from the bank (unnoted)';
            this.log(`JiveRC runner starting — ferrying essence for ${this.rune} to [${this.partners.join(', ')}] ${route}${this.stayInAltar ? ', staying in the altar' : ''}`);
            this.add(
                new DriveTrade(this),
                new ContinueDialog(),
                new DropLitter(this, false),
                new GoBankPark(this),
                // the note legs only exist on the long route; the short one carries unnoted essence
                ...(this.conf.unnote ? [new PickupRunnerSupplies(this)] : []),
                new DeliverEssence(this),
                new ExitAltarForRestock(this),
                ...(this.conf.unnote ? [new UnNoteEssence(this)] : []),
                new BankRestock(this)
            );
            return;
        }

        if (Skills.level('runecraft') < this.conf.level) {
            this.log(`JiveRC: Runecrafting ${this.conf.level} required for ${this.rune} (have ${Skills.level('runecraft')}) — stopping.`);
            throw new Error('JiveRC: runecrafting level too low');
        }
        this.on('chat.message', e => {
            if (e.type === TRADEREQ_CHAT && e.username && TRADE_REQ_TEXT.test(e.text) && this.isPartner(e.username)) {
                const stale = this.lastAskAt <= this.lastAcceptAt;
                if (this.lastRequester?.toLowerCase() !== e.username.toLowerCase() || stale) {
                    this.say(`trade-ask from ${e.username}`);
                }
                this.lastRequester = e.username;
                this.lastAskAt = Date.now();
            }
        });
        this.log(`JiveRC master starting — ${this.rune} at ${this.conf.ruins}, accepting essence from [${this.partners.join(', ')}], ${this.bankMs > 0 ? `banking everything every ${Math.round(this.bankMs / 60_000)}min` : 'never banking'}${this.stayInAltar ? ', staying in the altar' : ''}`);
        this.add(
            new HandleOpenTrade(this),
            new ContinueDialog(),
            new DropLitter(this, true),
            new CraftRunes(this),
            new AcceptRunner(this),
            new ExitTemple(this),
            new BankEverything(this),
            new EnterAltar(this),
            new WaitForRunner(this)
        );
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveRC',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Supplies']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const runner = this.mode === 'Runner';

        if (page === 'Options') {
            p.statGrid([[{ text: `Rune: ${this.rune}` }, { text: `Mode: ${this.mode}` }]]);
            p.text(`Partners: ${this.partners.join(', ') || 'none'}`);
            p.statGrid([[{ text: `Trading: ${this.stayInAltar ? 'inside' : 'outside'}` }, { text: `Bank: ${this.bankMs > 0 ? `${this.bankMs / 60_000}m` : 'never'}` }]]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Mode: ${this.mode}` }],
                [{ text: `Rune: ${this.rune}` }, { text: runner ? `Deliveries: ${this.trades}` : `Crafted: ${this.crafted}` }],
                [{ text: `${runner ? 'Ess sent' : 'Ess in'}: ${this.received}` }, { text: runner ? `To: ${this.partners[0] ?? '?'}` : `Trades: ${this.trades}` }]
            ]);
            if (!runner) {
                paintLevels(p, this.xp.progress(), mins, 2);
            }
        } else {
            p.statGrid([
                [{ text: `Unnoted: ${unnotedEssence()}` }, { text: `Noted: ${notedEssence()}` }],
                [{ text: `Coins: ${Inventory.count(COINS)}` }, { text: `${this.conf.rune}: ${runeCount(this)}` }]
            ]);
            p.bar('Pack', Inventory.used() / 28);
        }

        p.gap();
        if (runner) {
            const clicked = p.buttons([{ id: 'gobank', label: this.goBank ? 'Resume' : 'Go bank' }]);
            if (clicked === 'gobank') {
                this.goBank = !this.goBank;
                this.log(this.goBank ? 'Go bank pressed, heading to the bank to park' : 'Resume pressed, back to the loop');
            }
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    say(msg: string): void {
        this.log(`${this.mode === 'Runner' ? 'runner' : 'master'}: ${msg}`);
    }
    setTradeHot(on: boolean): void {
        this.loopCadence = on ? { kind: 'frame' } : null;
    }
    cfg(): RuneType { return this.conf; }
    inTemple(): boolean { return inRuneTemple(Game.tile(), this.conf); }
    keepList(keepProductRune: boolean): string[] {
        return keepNames(this.conf.talisman, keepProductRune ? this.conf.rune : null, this.conf.keepItems);
    }

    async openBank(stand: Tile): Promise<boolean> {
        const log = (message: string) => this.log(`  ${message}`);
        if (this.conf.bankNpc) {
            return Bank.openNpcAccess(this.conf.bankNpc, log);
        }
        return await Bank.openBooth(stand, BOOTH.name, BOOTH.op, log)
            || await Bank.openNearest(BOOTH.name, BOOTH.op, log);
    }
    // the client is never told whether an obj is tradeable or bankable (ObjType has no such
    // field. It is server-side only), so the only way to know is to try and watch it refuse
    setStatus(s: string): void { this.status = s; }
    countCraft(n: number): void { this.crafted += n; }
    countTrade(essence: number): void { this.trades++; this.received += essence; }
    bankIntervalMs(): number { return this.bankMs; }
    essPerRestock(): number { return this.essPer; }
    coinTarget(): number { return this.coinsTarget; }
    goBankActive(): boolean { return this.goBank; }
    stayInsideAltar(): boolean { return this.stayInAltar; }
    bankTripDue(): boolean { return this.bankMs > 0 && Date.now() >= this.nextBankAt; }
    markBankDone(): void { this.nextBankAt = Date.now() + this.bankMs; }
    isPartner(name: string | null): boolean {
        return name !== null && this.partners.some(p => p.toLowerCase() === name.toLowerCase());
    }
    partnerNames(): string[] { return this.partners; }
    countDelivery(essence: number): void { this.trades++; this.received += essence; this.loadDelivered = true; }
    loadWasDelivered(): boolean { return this.loadDelivered; }
    clearLoadDelivered(): void { this.loadDelivered = false; }
    nearestPartner(): Player | null {
        return Players.query().name(...this.partners).nearest();
    }
    adjacentRunner(): Player | null {
        return Players.query().name(...this.partners).within(TRADE_ADJACENT).nearest();
    }
    runnerNamed(name: string, range: number): Player | null {
        return Players.query().name(name).within(range).nearest();
    }
    pendingRequester(): string | null { return this.lastRequester; }
    markHandshakeStarted(): void {
        this.lastAcceptAt = Date.now();
        this.handshakeHoldUntil = Date.now() + MASTER_HANDSHAKE_MS;
    }
    tradeTarget(): string | null {
        const asked = this.lastRequester;
        const askedHere = asked !== null && this.runnerNamed(asked, TRADE_ADJACENT) !== null;
        return masterPickTradeTarget({
            asked,
            askedAt: this.lastAskAt,
            lastAcceptAt: this.lastAcceptAt,
            askedInRange: askedHere,
            holdUntil: this.handshakeHoldUntil,
            now: Date.now()
        });
    }

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return;
        }
        const store = this.conf.unnote?.tile;
        if (store && spiderSafeVia(here, dest, store, this.conf.ruins)) {
            this.log(`via spider-safe tile ${SPIDER_SAFE.x},${SPIDER_SAFE.z}`);
            await Traversal.walkResilient(SPIDER_SAFE, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
        }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: m => this.log(`  ${m}`) });
    }
}

class DropLitter implements Task {
    constructor(private bot: JiveRC, private keepProductRune: boolean) {}
    private droppable() {
        const keep = this.bot.keepList(this.keepProductRune);
        return Inventory.items().filter(i => isDroppableLitter(i.name, keep, i.actions()));
    }
    validate(): boolean {
        return !Trade.active() && !Shop.isOpen() && !Bank.isOpen() && this.droppable().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('dropping random-event junk');
        for (let guard = 0; guard < 28; guard++) {
            const item = this.droppable()[0];
            if (!item) {
                break;
            }
            this.bot.say(`dropping ${item.name ?? `item#${item.id}`}`);
            const before = Inventory.used();
            if (!(await item.interact('Drop'))) {
                await Execution.delayTicks(1);
                return;
            }
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
        }
    }
}

// master: the talisman, the runes it crafts and the essence it works on are the only things it
// should ever hold. Anything else is random-event litter.
class HandleOpenTrade implements Task {
    private lastWait = '';
    private awaitingConfirm = false;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        const on = Trade.active() || this.awaitingConfirm;
        if (!on) {
            this.bot.setTradeHot(false);
        }
        return on;
    }
    async execute(): Promise<void> {
        this.bot.setTradeHot(true);
        if (Trade.onConfirmScreen()) {
            this.awaitingConfirm = true;
            this.bot.setStatus('confirming the essence trade');
            this.bot.say(`confirm-accept ${tradeSnap()}`);
            const before = essCount();
            await Trade.accept();
            if (!Trade.active() && essCount() > before) {
                this.bot.countTrade(essCount() - before);
                this.bot.say(`received ${essCount() - before} essence ${tradeSnap()}`);
                this.awaitingConfirm = false;
            }
            return;
        }
        if (Trade.onOfferScreen()) {
            await this.driveOfferScreen();
            return;
        }
        if (this.awaitingConfirm) {
            const got = essCount();
            if (got > 0) {
                this.bot.countTrade(got);
                this.bot.say(`received ${got} essence ${tradeSnap()}`);
            } else {
                this.bot.say(`handshake dropped ${tradeSnap()}`);
            }
            this.awaitingConfirm = false;
        }
    }

    private async driveOfferScreen(): Promise<boolean> {
        const who = Trade.partner();
        const theirEssence = offerEss(Trade.theirOffer());
        const decision = masterOfferDecision({
            who,
            isPartner: this.bot.isPartner(who),
            theirEssence,
            runnerWaiting: this.bot.pendingRequester() !== null || this.bot.adjacentRunner() !== null
        });
        if (decision === 'decline') {
            this.bot.setStatus(`declining trade from ${who}`);
            this.bot.say(`decline stranger ${tradeSnap()}`);
            await Trade.decline();
            this.awaitingConfirm = false;
            return false;
        }
        if (decision === 'wait') {
            this.bot.setStatus(who ? `waiting for ${who} to offer essence` : 'reading trade partner');
            const key = `${who}:${theirEssence}:${this.bot.pendingRequester() ?? ''}`;
            if (key !== this.lastWait) {
                this.lastWait = key;
                this.bot.say(`offer-wait ${tradeSnap()} asked=${this.bot.pendingRequester() ?? '-'}`);
            }
            await Execution.delayTicks(1);
            return false;
        }
        const offered = Trade.myOffer();
        const precious = [this.bot.cfg().talisman, this.bot.cfg().rune, ESSENCE].map(n => n.toLowerCase());
        if (offered.some(o => precious.includes((o.name ?? '').toLowerCase()))) {
            this.bot.say(`decline safety mine=[${offered.map(o => o.name).join(',')}] ${tradeSnap()}`);
            await Trade.decline();
            this.awaitingConfirm = false;
            return false;
        }
        this.lastWait = '';
        this.awaitingConfirm = true;
        this.bot.setStatus(`accepting ${theirEssence} essence from ${who ?? 'runner'}`);
        this.bot.say(`offer-accept ${theirEssence} ess ${tradeSnap()}`);
        await Trade.accept();
        return true;
    }
}

class CraftRunes implements Task {
    constructor(private bot: JiveRC) {}
    validate(): boolean { return this.bot.inTemple() && essCount() > 0; }
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
        if (!this.bot.stayInsideAltar()) {
            await portalOut(this.bot);
        }
    }
}

class ExitTemple implements Task {
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return masterShouldExitTemple(this.bot.inTemple(), essCount(), this.bot.stayInsideAltar(), this.bot.bankTripDue());
    }
    async execute(): Promise<void> {
        if (this.bot.bankTripDue()) {
            this.bot.log('taking the portal — bank trip due');
        }
        await portalOut(this.bot);
    }
}

class EnterAltar implements Task {
    private fails = 0;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return masterShouldEnterAltar(this.bot.inTemple(), essCount(), this.bot.stayInsideAltar(), this.bot.bankTripDue());
    }
    async execute(): Promise<void> {
        this.bot.setStatus(essCount() > 0 ? 'entering the altar to craft' : 'entering the altar to wait');
        if (await enterAltar(this.bot)) {
            this.fails = 0;
            return;
        }
        if (++this.fails >= 3) {
            ScriptRunner.stop('JiveRC: the talisman didn\'t teleport into the altar');
        }
    }
}

// Everything-goes bank trip on a timer: banks the runes and, with them, whatever random events
// have dropped in the pack. Cheaper than reasoning about which litter can be traded or dropped.
class BankEverything implements Task {
    private backoffUntil = 0;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return this.bot.bankTripDue()
            && !this.bot.inTemple() && essCount() === 0 && !Trade.active() && Date.now() >= this.backoffUntil;
    }
    async execute(): Promise<void> {
        const cfg = this.bot.cfg();
        this.bot.markBankDone();
        this.bot.setStatus('banking everything');
        this.bot.log(`${Math.round(this.bot.bankIntervalMs() / 60_000)}min bank trip — ${runeCount(this.bot)} ${cfg.rune}s and anything else in the pack`);
        // short timeout so an unreachable quest-gated bank fails fast, not after the default 240s
        const reached = await Traversal.walkResilient(cfg.masterBank, { radius: 3, attempts: 2, timeoutMs: 30_000, log: m => this.bot.log(`  ${m}`) });
        const opened = reached && await this.bot.openBank(cfg.masterBank);
        if (!opened) {
            this.bot.log('JiveRC: could not open the bank; holding runes and continuing to serve runners');
            this.backoffUntil = Date.now() + 300_000;
            await this.bot.walkTo(cfg.ruins, 1);
            return;
        }
        const made = runeCount(this.bot);
        const before = Inventory.used();
        await Bank.depositAllMatching(depositAllExcept([cfg.talisman, ...cfg.keepItems ?? []]), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        this.bot.log(`banked ${made} ${cfg.rune}s, cleared ${before - Inventory.used()} slot(s); back to the altar`);
        await this.bot.walkTo(cfg.ruins, 1);
    }
}

class AcceptRunner implements Task {
    private nextClickAt = 0;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return essCount() === 0 && !Trade.active()
            && Date.now() >= this.nextClickAt
            && this.bot.tradeTarget() !== null
            && (this.bot.stayInsideAltar() || !this.bot.inTemple());
    }
    async execute(): Promise<void> {
        const name = this.bot.tradeTarget();
        if (!name) { return; }
        const asked = this.bot.pendingRequester();
        const nearest = this.bot.adjacentRunner();
        this.bot.setStatus(`accepting ${name}'s trade`);
        this.bot.say(`Trade-with '${name}' asked=${asked ?? '-'} nearest=${nearest?.name ?? '-'} d=${this.bot.runnerNamed(name, 20)?.distance() ?? '-'} ${tradeSnap()}`);
        this.nextClickAt = Date.now() + MASTER_HANDSHAKE_MS;
        this.bot.markHandshakeStarted();
        await Trade.request(name);
        await Execution.delayTicks(1);
        if (Trade.active() && !tradeWindowIsFor(Trade.partner(), name)) {
            this.nextClickAt = Date.now() + 3000;
            this.bot.say(`window is with someone else wanted=${name} ${tradeSnap()}`);
            return;
        }
        const opened = await Execution.delayUntil(
            () => Trade.active() && tradeWindowIsFor(Trade.partner(), name),
            4000
        );
        if (opened) {
            this.bot.say(`window opened ${tradeSnap()}`);
        } else {
            this.bot.say(`window did not open ${tradeSnap()}`);
        }
    }
}

class WaitForRunner implements Task {
    constructor(private bot: JiveRC) {}
    validate(): boolean { return essCount() === 0 && (this.bot.stayInsideAltar() || !this.bot.inTemple()); }
    async execute(): Promise<void> {
        if (this.bot.nearestPartner() !== null) {
            this.bot.setStatus('runner in sight — standing for the trade');
            await Execution.delayTicks(1);
            return;
        }
        if (this.bot.stayInsideAltar() && this.bot.inTemple()) {
            const meet = this.bot.cfg().insideMeet;
            if (meet) {
                await this.bot.walkTo(meet, 1);
            }
            this.bot.setStatus('waiting for a runner in the altar');
            await Execution.delayTicks(1);
            return;
        }
        this.bot.setStatus('waiting for a runner at the ruins');
        const here = Game.tile();
        const ruins = this.bot.cfg().ruins;
        if (here && ruins.distanceTo(here) > 1) {
            await Traversal.walkResilient(ruins, { radius: 1, attempts: 1, timeoutMs: 8_000, log: m => this.bot.log(`  ${m}`) });
            return;
        }
        await Execution.delayTicks(1);
    }
}

// jungle spiders chase the runner all the way to the store; a trip up the ladder next to
// Jiminua (2766,3121) and straight back down drops their aggro
async function shakeAggroOnLadder(bot: JiveRC): Promise<void> {
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
    // the scene reads empty for a tick or two after the ladder trip, blank isn't absent
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

// owns the loop while a trade modal is open, and until the pack settles after it closes
class DriveTrade implements Task {
    private pending = 0;
    private beforeUnnoted = 0;
    private settling = false;
    private settleFromTick = -1;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        const on = Trade.active() || this.settling;
        if (!on) {
            this.bot.setTradeHot(false);
        }
        return on;
    }
    async execute(): Promise<void> {
        this.bot.setTradeHot(true);
        if (Trade.onConfirmScreen()) {
            this.settling = true;
            this.settleFromTick = -1;
            this.bot.setStatus('confirming the trade');
            this.bot.say(`confirm-accept ${tradeSnap()}`);
            await Trade.accept();
            return;
        }
        if (Trade.onOfferScreen()) {
            if (Trade.myOffer().length === 0) {
                const held = unnotedEssence();
                const n = offerCount(held);
                if (n <= 0) {
                    if (Trade.theirOffer().length > 0) {
                        this.bot.setStatus('taking items back from the master');
                        await Trade.accept();
                    }
                    return;
                }
                this.pending = n;
                this.beforeUnnoted = held;
                this.settling = true;
                this.settleFromTick = -1;
                this.bot.setStatus('offering essence');
                this.bot.say(`offering ${n} ess ${tradeSnap()}`);
                if (held <= TRADE_CAP) {
                    await Trade.offerAll(ESSENCE, i => i.id === ESSENCE_ID);
                } else {
                    await Trade.offer(ESSENCE, n, i => i.id === ESSENCE_ID);
                }
                return;
            }
            this.bot.setStatus('accepting the offer');
            this.bot.say(`offer-accept ${tradeSnap()}`);
            await Trade.accept();
            return;
        }
        if (this.settling) {
            this.finishSettle();
        }
    }

    private finishSettle(): void {
        const now = unnotedEssence();
        if (now > 0) {
            this.bot.say(`trade bounced ess back pending=${this.pending} before=${this.beforeUnnoted} ${tradeSnap()}`);
            this.pending = 0;
            this.settling = false;
            this.beforeUnnoted = 0;
            this.settleFromTick = -1;
            this.bot.setTradeHot(false);
            return;
        }
        if (this.settleFromTick < 0) {
            this.settleFromTick = BotHost.tickCount;
            return;
        }
        if (BotHost.tickCount - this.settleFromTick < 2) {
            return;
        }
        if (this.pending > 0) {
            this.bot.countDelivery(this.beforeUnnoted);
            this.bot.say(`delivered ${this.beforeUnnoted} ess ${tradeSnap()}`);
        }
        this.pending = 0;
        this.settling = false;
        this.beforeUnnoted = 0;
        this.settleFromTick = -1;
        this.bot.setTradeHot(false);
    }
}

class GoBankPark implements Task {
    constructor(private bot: JiveRC) {}
    validate(): boolean { return this.bot.goBankActive() && !Trade.active(); }
    async execute(): Promise<void> {
        if (this.bot.inTemple()) {
            await portalOut(this.bot);
            return;
        }
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

function groundRunnerSupplies(): GroundItem | null {
    return GroundItems.query()
        .where(g => g.id === 995 || ((g.name ?? '').toLowerCase() === ESSENCE.toLowerCase() && g.id !== ESSENCE_ID))
        .within(PICKUP_RANGE)
        .nearest();
}

class PickupRunnerSupplies implements Task {
    private fails = 0;
    private blockedUntil = 0;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return !this.bot.inTemple() && unnotedEssence() === 0 && !Trade.active() && Date.now() >= this.blockedUntil && groundRunnerSupplies() !== null;
    }
    async execute(): Promise<void> {
        const drop = groundRunnerSupplies();
        if (!drop) {
            return;
        }
        const label = drop.id === 995 ? 'coins' : 'noted essence';
        const count = () => Inventory.items().filter(item => item.id === drop.id).reduce((sum, item) => sum + item.count, 0);
        this.bot.setStatus(`picking up dropped ${label}`);
        this.bot.log(`${label} on the ground (${drop.count}), picking it up`);
        const before = count();
        const clicked = await drop.interact('Take');
        if (clicked) {
            await Execution.delayUntil(() => count() > before, 8000);
        }
        if (count() > before) {
            this.bot.log(`picked up ${count() - before} ${label}`);
            this.fails = 0;
            return;
        }
        // an unreachable/unpickable stack must not starve deliveries forever
        if (++this.fails >= 3) {
            this.bot.log('could not pick the stack up (full pack? out of reach), ignoring it for a while');
            this.fails = 0;
            this.blockedUntil = Date.now() + 120_000;
        }
        await Execution.delayTicks(2);
    }
}

class DeliverEssence implements Task {
    private meeting = false;
    private lastReqKey = '';
    private lastReqAt = 0;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        if (unnotedEssence() === 0) {
            this.meeting = false;
            return false;
        }
        return !Trade.active();
    }
    async execute(): Promise<void> {
        const masterName = this.bot.partnerNames()[0];
        if (!this.bot.stayInsideAltar() && this.bot.inTemple()) {
            await portalOut(this.bot);
            return;
        }
        if (this.bot.stayInsideAltar() && !this.bot.inTemple()) {
            this.bot.setStatus('entering the altar to deliver');
            if (!(await enterAltar(this.bot))) {
                this.bot.log('could not enter the altar — retrying');
            }
            return;
        }
        const master = this.bot.nearestPartner();
        if (master) {
            this.meeting = true;
        }
        if (runnerShouldWalkToMeet(master !== null, this.meeting, this.bot.inTemple(), this.bot.stayInsideAltar())) {
            this.bot.setStatus(`walking to ${masterName}`);
            await this.bot.walkTo(this.bot.cfg().ruins, 2);
            return;
        }
        if (!master) {
            const meet = this.bot.cfg().insideMeet;
            if (this.bot.inTemple() && meet) {
                await this.bot.walkTo(meet, 1);
            }
            this.bot.setStatus(`waiting for ${masterName} — holding the essence`);
            await Execution.delayTicks(1);
            return;
        }
        if (!runnerShouldRequestTrade(Trade.active(), this.lastReqAt, Date.now())) {
            await Execution.delayTicks(1);
            return;
        }
        this.bot.setStatus(`requesting a trade with ${master.name}`);
        const key = `${master.name}:${master.distance()}:${unnotedEssence()}`;
        if (key !== this.lastReqKey || Date.now() - this.lastReqAt > 8000) {
            this.lastReqKey = key;
            this.bot.say(`Trade-with '${master.name}' d=${master.distance()} ${tradeSnap()}`);
        }
        this.lastReqAt = Date.now();
        await Trade.request(master.name ?? '');
        if (Trade.active()) {
            this.bot.setTradeHot(true);
            return;
        }
        await Execution.delayTicks(1);
    }
}

class ExitAltarForRestock implements Task {
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return this.bot.inTemple()
            && runnerMayLeaveAltar(Trade.active(), unnotedEssence());
    }
    async execute(): Promise<void> {
        this.bot.say(`leaving altar after delivery ${tradeSnap()}`);
        await portalOut(this.bot);
        this.bot.clearLoadDelivered();
    }
}

function shopEssStock(): number {
    return Shop.stock().find(s => s.name.toLowerCase() === ESSENCE.toLowerCase())?.count ?? 0;
}

class UnNoteEssence implements Task {
    private lastShakeAt = 0;
    constructor(private bot: JiveRC) {}
    validate(): boolean {
        return this.bot.cfg().unnote !== null && !this.bot.inTemple() && !Trade.active()
            && notedEssence() > 0 && unnotedEssence() === 0 && Inventory.count(COINS) >= LOW_COINS;
    }
    async execute(): Promise<void> {
        const store = this.bot.cfg().unnote;
        if (!store) {
            return;
        }
        this.bot.setStatus('topping up unnoted essence at the store');
        await this.bot.walkTo(store.tile, 3);
        // one trip per arrival, a retried store visit must not climb all over again
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
    constructor(private bot: JiveRC) {}
    // coins only matter on the noting route (fares + buy-backs); the short route never spends any
    validate(): boolean { return essCount() === 0 || (this.bot.cfg().unnote !== null && Inventory.count(COINS) < LOW_COINS); }
    async execute(): Promise<void> {
        const cfg = this.bot.cfg();
        this.bot.setStatus('restocking at the bank');
        await this.bot.walkTo(cfg.runnerBank, 3);
        const opened = await this.bot.openBank(cfg.runnerBank);
        if (!opened) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        await Bank.setNoteMode(false);
        // random events hand out items that eat the slots essence needs, dump anything unrelated
        const keep = [
            ESSENCE,
            ...cfg.keepItems ?? [],
            ...(cfg.unnote ? [COINS] : []),
            ...(this.bot.stayInsideAltar() ? [cfg.talisman] : [])
        ];
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
                ScriptRunner.stop('JiveRC runner: out of coins (bank + pack) for fares and buy-backs');
                return;
            }
        }

        const banked = Bank.count(ESSENCE);
        if (banked === 0) {
            // only believe an empty bank after it reads empty on three separate restocks
            if (essCount() === 0 && ++this.emptyReads >= 3) {
                ScriptRunner.stop('JiveRC runner: out of Rune essence in the bank (three reads)');
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

async function enterAltar(bot: JiveRC): Promise<boolean> {
    await bot.walkTo(bot.cfg().ruins, 1);
    const ruins = Locs.query().name(RUINS).nearest();
    const talisman = Inventory.first(bot.cfg().talisman);
    if (!ruins || !talisman) {
        await Execution.delayTicks(2);
        return false;
    }
    bot.log(`using the ${bot.cfg().talisman} on the mysterious ruins`);
    if (!(await talisman.useOn(ruins))) {
        await Execution.delayTicks(2);
        return false;
    }
    if (await Execution.delayUntil(() => bot.inTemple(), 10_000)) {
        bot.log('entered the altar');
        return true;
    }
    return false;
}

// craft locks the player (p_delay 3); tight-loop the portal so Use fires the instant it clears
async function portalOut(bot: JiveRC): Promise<void> {
    bot.setStatus('taking the portal out');
    bot.log('taking the portal back to the ruins');
    for (let i = 0; i < 15 && bot.inTemple(); i++) {
        if (ChatDialog.canContinue()) { await ChatDialog.continue(); continue; }
        const portal = Locs.query().name(PORTAL.name).action(PORTAL.op).nearest();
        if (portal) { await portal.interact(PORTAL.op); }
        await Execution.delayTicks(1);
    }
    if (!bot.inTemple()) { bot.log('back at the mysterious ruins'); }
}
