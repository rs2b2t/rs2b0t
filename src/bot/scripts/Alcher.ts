import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Bank } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { nearestBank } from '../api/BankLocations.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MAGIC_TAB = 6;
const ALCH_SPELL = 'High Level Alchemy';
const FIRE_STAFF = 'Staff of fire';
const NATURE_RUNE = 'Nature rune';
/** High Level Alchemy unlocks at 55 Magic. */
const ALCHEMY_REQUIRED = 55;
/** Each cast resolves over ~5 ticks — wait before clicking the next note. */
const ALCH_TICKS = 5;

export const ALCHER_SETTINGS: SettingsSchema = {
    item: {
        type: 'string',
        default: 'Rune platebody',
        label: 'Item to alch',
        help: 'withdrawn from the bank as notes (note mode) and alched by name'
    },
    alchs: {
        type: 'number',
        default: 27,
        min: 1,
        max: 1000,
        label: 'Alchs per trip',
        help: 'how many notes + nature runes to withdraw each trip; both stack in a single slot each, so even 1000 fits in 2 pack slots'
    }
};

export default class Alcher extends TaskBot {
    override loopDelay = 400;

    private item = 'Rune platebody';
    private alchs = 27;

    /** The bank access is resolved once; every trip just opens the booth. */
    private bankAccess: { name: string; op: string } = BOOTH;

    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    /** Notes of the alch item left in the bank, refreshed each restock. */
    private alchsInBank = 0;
    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.item = this.settings.str('item', 'Rune platebody');
        this.alchs = this.settings.num('alchs', 27);

        if (Skills.level('magic') < ALCHEMY_REQUIRED) {
            this.log(`${ALCH_SPELL} needs ${ALCHEMY_REQUIRED} Magic (have ${Skills.level('magic')}) — stopping`);
            ScriptRunner.stop(`${ALCH_SPELL} needs ${ALCHEMY_REQUIRED} Magic`);
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('magic');

        this.log(`Alcher — ${ALCH_SPELL} on ${this.item} (${this.alchs} per trip), keeping ${NATURE_RUNE}s`);
        if (!(await this.resolveBank())) {
            return;
        }
        this.add(
            new EnsureGear(this),
            new Restock(this),
            new Alch(this)
        );
    }

    /**
     * Resolve the nearest bank once and walk to it. Every later trip reuses
     * {@link bankAccess} and opens the booth via a scene lookup — no
     * re-pathfinding on each loop.
     */
    async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const bank = nearestBank(here);
        if (!bank) {
            this.log('no reachable bank — stopping');
            ScriptRunner.stop('no reachable bank');
            return false;
        }
        this.bankAccess = (bank.access ?? BOOTH) as { name: string; op: string };
        this.log(`banking at ${bank.name} (${this.bankAccess.name} / ${this.bankAccess.op})`);

        const near = bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4;
        if (near) {
            return true;
        }
        this.setStatus(`walking to ${bank.name}`);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) }))) {
            this.log('walk to the bank failed — stopping');
            ScriptRunner.stop('walk to the bank failed');
            return false;
        }
        return true;
    }

    /** Open the bank via the cached access. Every trip reuses this. */
    async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        this.setStatus('opening bank');
        this.log(`opening ${this.bankAccess.name} (${this.bankAccess.op})`);
        if (!(await Bank.openNearest(this.bankAccess.name, this.bankAccess.op, m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return false;
        }
        this.log('bank open');
        return true;
    }

    setStatus(s: string): void {
        this.status = s;
    }
    itemName(): string {
        return this.item;
    }
    alchTarget(): number {
        return this.alchs;
    }
    /** Whether the pack can fund one cast: a note to alch and a nature rune. */
    canAlchOne(): boolean {
        return Inventory.count(this.item) > 0 && Inventory.count(NATURE_RUNE) > 0;
    }
    /** Alchs still left in the bank (refreshed on every restock). */
    bankAlchs(): number {
        return this.alchsInBank;
    }
    setBankAlchs(n: number): void {
        this.alchsInBank = n;
    }
    countTrip(): void {
        this.trips++;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fb3ff' });
        p.title(`Alcher — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Alches in bank: ${this.bankAlchs()}`, `Magic XP/hr: ${this.xpPerHour()}`);
        p.row(`Magic: ${Skills.level('magic')}`, `Runes: ${Inventory.count(NATURE_RUNE)}/${this.alchs}`, `Bank trips: ${this.trips}`);
        p.row(`Notes: ${Inventory.count(this.item)}/${this.alchs}`, `Coins: ${Inventory.count('Coins').toLocaleString()}`, `Pack: ${Inventory.used()}`);
        p.bar('Pack', Inventory.used() / 28);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private xpPerHour(): string {
        const mins = (Date.now() - this.startedAt) / 60_000;
        if (mins < 0.5) {
            return '—';
        }
        const xp = Skills.xp('magic') - this.xpAtStart;
        return `${((xp / mins) * 60 / 1000).toFixed(1)}k`;
    }
}

/**
 * Set the staff of fire once. Deposit everything, withdraw one, close the bank
 * so Wield is a real backpack op, wield it, then reopen — the next Restock
 * uses the open bank. Re-runs skip while the staff is worn.
 */
class EnsureGear implements Task {
    constructor(private bot: Alcher) {}

    validate(): boolean {
        return !Equipment.contains(FIRE_STAFF);
    }

    async execute(): Promise<void> {
        if (!(await this.bot.openBank())) {
            return;
        }
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }
        if (Inventory.count(FIRE_STAFF) === 0) {
            if (!Bank.loaded()) {
                await Execution.delayUntil(() => Bank.loaded(), 5000);
            }
            if (!(await Bank.withdrawX(FIRE_STAFF, 1))) {
                this.bot.log(`no ${FIRE_STAFF} in the bank — stopping`);
                ScriptRunner.stop(`no ${FIRE_STAFF} in the bank`);
                return;
            }
        }
        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }
        this.bot.setStatus(`wielding ${FIRE_STAFF}`);
        if (!(await Equipment.equip(FIRE_STAFF))) {
            this.bot.log(`could not wield ${FIRE_STAFF} — stopping`);
            ScriptRunner.stop(`could not wield ${FIRE_STAFF}`);
            return;
        }
        this.bot.log(`wore ${FIRE_STAFF} — casts need only ${NATURE_RUNE}s now`);
        await this.bot.openBank();
    }
}

/**
 * Restock: deposit coins/junk (the notes are consumed by alching, so nothing
 * accumulates except coins), then flip the bank to note mode and withdraw
 * exactly one trip's notes + nature runes, and close the bank.
 */
class Restock implements Task {
    constructor(private bot: Alcher) {}

    validate(): boolean {
        // Fire whenever the pack can't do even one cast — a bank short of the
        // desired trip amount still yields a partial load that gets alched, so
        // we never loop restocking a shortfall we can't reach.
        return !this.bot.canAlchOne();
    }

    async execute(): Promise<void> {
        if (!(await this.bot.openBank())) {
            return;
        }

        // Clear coins and whatever random events left in the pack; the nature
        // rune stack stays so a short bank stock never starts from scratch.
        this.bot.setStatus('restocking');
        if (Inventory.used() > 0) {
            const before = Inventory.used();
            await Bank.depositAllMatching(name => name.toLowerCase() !== NATURE_RUNE.toLowerCase());
            await Execution.delayTicks(1);
            const cleared = before - Inventory.used();
            if (cleared > 0) {
                this.bot.log(`cleared ${cleared} items from the pack`);
            }
        }

        // Note mode: withdrawing by name returns the item as notes, which alch.
        await Bank.setNoteMode(true);

        const want = this.bot.alchTarget();

        if (Inventory.count(this.bot.itemName()) < want) {
            const before = Inventory.count(this.bot.itemName());
            const ok = await this.withdraw(this.bot.itemName(), want - before);
            const got = Inventory.count(this.bot.itemName()) - before;
            this.bot.log(`withdrew ${got} ${this.bot.itemName()} (noted)`);
            if (!ok || got === 0) {
                // An empty read here can just mean the bank list hasn't loaded
                // yet (it fills a beat after the component appears) — retry
                // instead of concluding the bank is out.
                if (!Bank.loaded()) {
                    this.bot.log('bank item list not loaded yet — retrying restock');
                    return;
                }
                this.bot.log(`no ${this.bot.itemName()} in the bank — stopping`);
                ScriptRunner.stop(`no ${this.bot.itemName()} in the bank`);
                return;
            }
        }
        this.bot.setBankAlchs(Bank.count(this.bot.itemName()));

        const haveRunes = Inventory.count(NATURE_RUNE);
        if (haveRunes < want) {
            const before = Inventory.count(NATURE_RUNE);
            const ok = await this.withdraw(NATURE_RUNE, want - haveRunes);
            const got = Inventory.count(NATURE_RUNE) - before;
            this.bot.log(`withdrew ${got} ${NATURE_RUNE}s`);
            if (!ok || got === 0) {
                if (!Bank.loaded()) {
                    this.bot.log('bank item list not loaded yet — retrying restock');
                    return;
                }
                this.bot.log(`no ${NATURE_RUNE}s in the bank — stopping`);
                ScriptRunner.stop(`no ${NATURE_RUNE}s in the bank`);
                return;
            }
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }

        this.bot.countTrip();
        this.bot.log(`restocked: ${Inventory.count(this.bot.itemName())} ${this.bot.itemName()} notes + ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s`);
    }

    /**
     * Withdraw by name once the bank's main item list has loaded. Reading it
     * before that returns zero and looks like an empty bank — the false
     * "no item in the bank" stop on a cold start.
     */
    private async withdraw(name: string, count: number): Promise<boolean> {
        if (!Bank.loaded()) {
            this.bot.log(`waiting for the bank item list (${name})`);
            await Execution.delayUntil(() => Bank.loaded(), 5000);
        }
        return Bank.withdrawX(name, count);
    }
}

/**
 * Alch the trip: cast High Level Alchemy on a note once every ~5 ticks (a cast
 * resolves in 5 ticks). Stops when either the notes or the runes run out, so a
 * short pack sends us back to Restock instead of spamming a runeless cast.
 */
class Alch implements Task {
    constructor(private bot: Alcher) {}

    validate(): boolean {
        if (Bank.isOpen()) {
            return false;
        }
        return this.bot.canAlchOne();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`${ALCH_SPELL} on ${this.bot.itemName()}`);

        if (!(await Game.openSideTab(MAGIC_TAB))) {
            this.bot.log('could not open the magic tab — retrying');
            return;
        }

        while (this.bot.canAlchOne()) {
            const left = Inventory.count(this.bot.itemName());
            this.bot.log(`alching ${this.bot.itemName()} (${left} left, ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s)`);
            const note = Inventory.first(this.bot.itemName());
            if (!note) {
                break;
            }
            if (!(await Game.castOnItem(ALCH_SPELL, note))) {
                this.bot.log('cast-on-item was rejected — retrying');
                await Execution.delayTicks(1);
                continue;
            }
            // One cast per 5 ticks keeps every click on a fresh note and never
            // leaves the targeting cursor armed for the next restock click.
            await Execution.delayTicks(ALCH_TICKS);
        }
    }
}
