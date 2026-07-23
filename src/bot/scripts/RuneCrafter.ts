import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { depositAllExcept } from '../api/Banking.js';
import { Bank } from '../api/hud/Bank.js';
import { withdrawOp } from '../api/hud/bankOps.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore, type SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const ESSENCE = 'Rune essence';
const RUINS = 'Mysterious ruins';
const ALTAR = { name: 'Altar', op: 'Craft-rune' };
const PORTAL = { name: 'Portal', op: 'Use' };
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const TEMPLE_Z = 4000; // altar temples sit at z ~4800; the overworld is < 4000
const MAX_BANK_FAILS = 6;
const MAX_ENTER_FAILS = 3;

interface RuneType {
    talisman: string;
    rune: string;
    level: number;
    ruins: Tile; // the Mysterious ruins loc — walk here + use the talisman
    bank: Tile;
}

// Air only for now. Adding a rune = one row (talisman/rune/level from
// runecraft.dbrow) + its Mysterious-ruins tile (exit_coord) + nearest bank.
const RUNES: Record<string, RuneType> = {
    'Air runes': { talisman: 'Air talisman', rune: 'Air rune', level: 1, ruins: new Tile(2983, 3288, 0), bank: new Tile(3013, 3355, 0) }
};
const RUNE_OPTIONS = Object.keys(RUNES);

export const SETTINGS: SettingsSchema = {
    rune: { type: 'string', default: 'Air runes', options: RUNE_OPTIONS, label: 'Rune', help: 'which rune to craft — runs its bank↔altar loop (Air = the ruins south of Falador)' }
};

function inTemple(): boolean {
    const t = Game.tile();
    return t !== null && t.z > TEMPLE_Z;
}
function essCount(): number {
    return Inventory.count(ESSENCE);
}

export default class RuneCrafter extends TaskBot {
    override loopDelay = 600;

    private cfg: RuneType = RUNES['Air runes'];
    private choice = 'Air runes';
    private trips = 0;
    private crafted = 0;
    private bankFails = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.choice = this.settings.str('rune', 'Air runes');
        this.cfg = RUNES[this.choice] ?? RUNES['Air runes'];
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('runecraft');

        if (Skills.level('runecraft') < this.cfg.level) {
            this.log(`RuneCrafter: Runecrafting ${this.cfg.level} required for ${this.choice} (have ${Skills.level('runecraft')}) — stopping.`);
            throw new Error('RuneCrafter: runecrafting level too low');
        }
        this.log(`RuneCrafter starting — ${this.choice}, ruins ${this.cfg.ruins}, bank ${this.cfg.bank}`);
        this.add(new ContinueDialog(), new Craft(this), new Exit(this), new BankTrip(this), new Enter(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        p.title(`RuneCrafter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('runecraft') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `RC lvl: ${Skills.level('runecraft')}`, `XP/hr: ${xph}`);
        p.row(`${this.choice}: ${this.crafted}`, `Trips: ${this.trips}`, `Pack ess: ${essCount()}`);
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
    countBankFail(): number { return ++this.bankFails; }
    resetBankFail(): void { this.bankFails = 0; }
    talismanName(): string { return this.cfg.talisman; }
    runeName(): string { return this.cfg.rune; }
    ruinsTile(): Tile { return this.cfg.ruins; }
    bankTile(): Tile { return this.cfg.bank; }

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
        await this.bot.walkTo(this.bot.ruinsTile(), 2);
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
