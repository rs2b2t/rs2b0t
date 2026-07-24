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
import { withdrawOp } from '../api/hud/bankOps.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Players } from '../api/queries/Players.js';
import type { Player } from '../api/entities/index.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { type SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const ESSENCE = 'Rune essence';
const ESSENCE_ID = 1436; // blankrune (unnoted essence); the bank-note variant has a different id
const NATURE = 'Nature rune';
const TALISMAN = 'Nature talisman';
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const RUINS_TILE = new Tile(2865, 3022, 0); // nature Mysterious ruins = the trade spot
const BANK_TILE = new Tile(2852, 2954, 0); // Shilo Village bank (needs the Shilo Village quest)
const TEMPLE_Z = 4000; // altar temples sit at z ~4800; the overworld is < 4000
const RC_LEVEL = 44;
const RUNNER_RANGE = 2; // tiles; only trade an adjacent runner (OPPLAYER4 walks you to them)
const COINS = 'Coins';
const ARD_BANK = new Tile(2655, 3283, 0); // Ardougne East bank, by Captain Barnaby's pier
const STORE_TILE = new Tile(2767, 3122, 0); // Jiminua's Jungle Store, Karamja
const UNNOTE_NPC = 'Jiminua';
const BATCH = 26; // essence un-noted per store visit
const COINS_BUFFER = 10000; // fare + un-note margin buffer

export const SETTINGS: SettingsSchema = {
    mode: { type: 'string', default: 'Master', options: ['Master', 'Runner'], label: 'Mode', help: 'Master crafts natures at the altar and takes essence from runners; Runner ferries essence to the master (runner ships in a later phase)' },
    partner: { type: 'string', default: '', label: 'Partner name(s)', help: 'Master: runner name(s) to accept essence from, comma-separated. Runner: the master to deliver to.' },
    bankAt: { type: 'number', default: 0, label: 'Bank natures at (0 = never)', help: 'Master: 0 = never bank — natures stack into one slot so just hold them (recommended). Set > 0 to deposit profit once holding that many, but banking uses the quest-gated Shilo Village bank, so only useful for a master with the quest' }
};

function inTemple(): boolean {
    const t = Game.tile();
    return t !== null && t.z > TEMPLE_Z;
}
function essCount(): number {
    return Inventory.count(ESSENCE);
}
function natureCount(): number {
    return Inventory.count(NATURE);
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
    private partners: string[] = [];
    private bankAt = 0;
    private crafted = 0;
    private received = 0;
    private trades = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.mode = this.settings.str('mode', 'Master');
        this.partners = this.settings.str('partner', '').split(',').map(s => s.trim()).filter(Boolean);
        this.bankAt = Math.max(0, this.settings.num('bankAt', 0)); // 0 = never bank
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('runecraft');

        if (this.partners.length === 0) {
            this.log(`NatureCrafter: no partner names set — ${this.mode === 'Runner' ? 'the runner needs the master name' : 'the master only trades with configured runners'}. Stopping.`);
            throw new Error('NatureCrafter: no partner configured');
        }

        if (this.mode === 'Runner') {
            this.log(`NatureCrafter runner starting — ferrying essence to [${this.partners.join(', ')}] via the Ardougne bank + ship`);
            this.add(
                new ContinueDialog(),
                new DriveTrade(this),
                new DeliverEssence(this),
                new UnNoteEssence(this),
                new BankRestock(this)
            );
            return;
        }

        if (Skills.level('runecraft') < RC_LEVEL) {
            this.log(`NatureCrafter: Runecrafting ${RC_LEVEL} required for natures (have ${Skills.level('runecraft')}) — stopping.`);
            throw new Error('NatureCrafter: runecrafting level too low');
        }
        this.log(`NatureCrafter master starting — accepting essence from [${this.partners.join(', ')}], ${this.bankAt > 0 ? `banking natures at ${this.bankAt}` : 'holding natures (never banking)'}`);
        this.add(
            new ContinueDialog(),
            new HandleOpenTrade(this),
            new CraftNatures(this),
            new ExitTemple(this),
            new EnterAltar(this),
            new BankNatures(this),
            new AcceptRunner(this),
            new WaitForRunner(this)
        );
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        p.title(`NatureCrafter — ${this.mode.toLowerCase()} — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Mode: ${this.mode}`, this.mode === 'Master' ? `RC lvl: ${Skills.level('runecraft')}` : `To: ${this.partners[0] ?? '?'}`);
        if (this.mode === 'Master') {
            p.row(`Natures: ${this.crafted}`, `Trades: ${this.trades}`, `Ess in: ${this.received}`);
            p.row(`Pack ess: ${essCount()}`, `Pack nat: ${natureCount()}`, `Runners: ${this.partners.length}`);
        } else {
            p.row(`Deliveries: ${this.trades}`, `Ess sent: ${this.received}`, `Coins: ${Inventory.count(COINS)}`);
            p.row(`Pack ess: ${essCount()}`, `noted: ${notedEssence()}`, `unnoted: ${unnotedEssence()}`);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    countCraft(n: number): void { this.crafted += n; }
    countTrade(essence: number): void { this.trades++; this.received += essence; }
    bankThreshold(): number { return this.bankAt; }
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

class HandleOpenTrade implements Task {
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
            return;
        }

        // header can lag a tick — wait for it rather than declining a real runner
        const who = Trade.partner();
        if (who === null) {
            this.bot.setStatus('reading trade partner');
            await Execution.delayTicks(1);
            return;
        }
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            this.bot.log(`declining a trade from '${who}' — not a configured runner`);
            await Trade.decline();
            return;
        }
        if (Trade.myOffer().length > 0) {
            this.bot.log('safety: something is in MY trade offer — declining so nothing is given away');
            await Trade.decline();
            return;
        }

        const theirEssence = Trade.theirOffer().filter(o => (o.name ?? '').toLowerCase() === ESSENCE.toLowerCase()).reduce((s, o) => s + Math.max(1, o.count), 0);
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
        this.bot.setStatus('crafting natures');
        const before = essCount();
        this.bot.log(`crafting ${before} essence into natures at the altar`);
        if (!(await altar.interact(ALTAR.op))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => essCount() === 0, 8000);
        const made = before - essCount();
        this.bot.countCraft(made);
        this.bot.log(`crafted ${made} ${NATURE}s`);
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
        await this.bot.walkTo(RUINS_TILE, 1);
        const ruins = Locs.query().name(RUINS).nearest();
        const talisman = Inventory.first(TALISMAN);
        if (!ruins || !talisman) { await Execution.delayTicks(2); return; }
        this.bot.log(`using the ${TALISMAN} on the mysterious ruins`);
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

class BankNatures implements Task {
    private backoffUntil = 0;
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return this.bot.bankThreshold() > 0 && !inTemple() && essCount() === 0 && natureCount() >= this.bot.bankThreshold() && !Trade.active() && Date.now() >= this.backoffUntil; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking natures');
        this.bot.log(`heading to the bank with ${natureCount()} natures`);
        // short timeout so an unreachable quest-gated bank fails fast, not after the default 240s
        const reached = await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 2, timeoutMs: 30_000, log: m => this.bot.log(`  ${m}`) });
        const opened = reached && ((await Bank.openBooth(BANK_TILE, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`))));
        if (!opened) {
            this.bot.log('NatureCrafter: bank unreachable (Shilo Village quest?) — holding natures (they stack) and continuing to serve runners');
            this.backoffUntil = Date.now() + 300_000;
            await this.bot.walkTo(RUINS_TILE, 1);
            return;
        }
        const made = natureCount();
        await Bank.depositAllMatching(depositAllExcept([TALISMAN]), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        this.bot.log(`deposited ${made} ${NATURE}s`);
        await this.bot.walkTo(RUINS_TILE, 1);
    }
}

class AcceptRunner implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean {
        // no natureCount guard — task order lets BankNatures preempt; gating here breaks bankAt=0
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
        await this.bot.walkTo(RUINS_TILE, 1);
        await Execution.delayTicks(2);
    }
}

// opens via Talk-to + the first ("yes/buy") dialogue option, not a bare Trade op
async function openUnnoteShop(): Promise<boolean> {
    if (Shop.isOpen()) {
        return true;
    }
    const npc = Npcs.query().name(UNNOTE_NPC).nearest();
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
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return Trade.active(); }
    async execute(): Promise<void> {
        if (Trade.onOfferScreen()) {
            if (Trade.myOffer().length === 0) {
                this.pending = unnotedEssence();
                this.bot.setStatus('offering essence');
                this.bot.log(`trade open — offering ${this.pending} essence`);
                await Trade.offerAll(ESSENCE, i => i.id === ESSENCE_ID);
            } else {
                this.bot.setStatus('accepting the offer');
                await Trade.accept();
            }
            return;
        }
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming the trade');
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 2500) && this.pending > 0 && unnotedEssence() === 0) {
                this.bot.countDelivery(this.pending);
                this.bot.log(`delivered ${this.pending} essence to the master`);
                this.pending = 0;
            }
        }
    }
}

class DeliverEssence implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return unnotedEssence() > 0 && !Trade.active(); }
    async execute(): Promise<void> {
        const masterName = this.bot.partnerNames()[0];
        this.bot.setStatus(`walking to ${masterName}`);
        await this.bot.walkTo(RUINS_TILE, 2);
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

class UnNoteEssence implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return notedEssence() > 0 && unnotedEssence() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('un-noting a batch at the store');
        await this.bot.walkTo(STORE_TILE, 3);
        if (!(await openUnnoteShop())) {
            this.bot.log(`couldn't open ${UNNOTE_NPC}'s store — retrying`);
            return;
        }
        const batch = Math.min(BATCH, notedEssence());
        this.bot.log(`selling ${batch} noted essence to ${UNNOTE_NPC}, buying it back unnoted`);
        const notedBefore = notedEssence();
        await Shop.sell(ESSENCE, batch);
        await Execution.delayUntil(() => notedEssence() <= notedBefore - batch, 3000);
        await Shop.buy(ESSENCE, batch);
        await Execution.delayUntil(() => unnotedEssence() >= batch, 4000);
        await Shop.close();
        this.bot.log(`un-noted ${unnotedEssence()} essence (noted left: ${notedEssence()})`);
    }
}

class BankRestock implements Task {
    constructor(private bot: NatureCrafter) {}
    validate(): boolean { return essCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Ardougne bank');
        await this.bot.walkTo(ARD_BANK, 3);
        const opened = (await Bank.openBooth(ARD_BANK, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the Ardougne bank — retrying');
            return;
        }

        await Bank.setNoteMode(false);
        const needCoins = COINS_BUFFER - Inventory.count(COINS);
        if (needCoins > 0 && Bank.count(COINS) > 0) {
            await Bank.withdrawX(COINS, Math.min(needCoins, Bank.count(COINS)));
        } else if (Inventory.count(COINS) < 500) {
            this.bot.log('NatureCrafter runner: out of coins (bank + pack) for fares. Stopping.');
            ScriptRunner.stop();
            return;
        }

        const banked = Bank.count(ESSENCE);
        if (banked === 0) {
            this.bot.log('NatureCrafter runner: out of Rune essence in the bank. Stopping.');
            ScriptRunner.stop();
            return;
        }
        await Bank.setNoteMode(true);
        await Bank.withdrawX(ESSENCE, banked);
        await Execution.delayUntil(() => essCount() > 0, 3000);
        await Bank.setNoteMode(false);
        this.bot.log(`withdrew ${essCount()} essence (${notedEssence() > 0 ? 'noted' : 'unnoted'}) + coins for the run`);
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
