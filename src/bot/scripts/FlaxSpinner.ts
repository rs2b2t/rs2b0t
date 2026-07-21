import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank, withdrawOp } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { walkOpening } from '../api/walkOpening.js';
import { EventSignal } from '../api/EventSignal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

// Spinning is a weakqueue (spinning.rs2): it drains the pack ~1 fibre / 2 ticks,
// replaying the anim each item — so Game.animating() FLICKERS false between items
// and any click/move CANCELS the batch. Gauge "still spinning" by the pack
// actually draining; only re-spin once it's been this many ticks with no fibre
// consumed and flax still left (i.e. it genuinely stopped).
const RESPIN_AFTER_TICKS = 6;

// Seers Village — verified live (dumped reader.locs()): the flax spinning wheel is
// UPSTAIRS. Bank (2722,3493,0) → house door (2716,3472,0) → Ladder (2715,3470)
// Climb-up → Spinning wheel (2711,3471,1) "Spin" → same Ladder Climb-down → bank.
//
// The ground-floor walk target is (2714,3471) — a walkable tile INSIDE the house
// beside the ladder, never the ladder's own loc-blocked tile. An unwalkable dest
// lets the pathfinder accept any walkable tile within 5 as the goal, and the
// cheapest one from the bank is on the STREET outside the sealed house: the walk
// "arrives" without ever planning the door crossing, and the stall-recovery door
// hunt then opened the NEIGHBOUR house's door (2713,3483) once ours stood open.
// An exactly-walkable interior dest forces the planned path through the door
// edge at (2716,3472), which walkTo opens like any other crossing. Its whole
// radius-1 arrival ball is also inside, so we can't "arrive" across a wall.
const DEFAULT_BANK_STAND = new Tile(2722, 3493, 0);
const DEFAULT_LADDER_TILE = new Tile(2714, 3471, 0);
const DEFAULT_WHEEL_TILE = new Tile(2711, 3471, 1);
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    product: { type: 'string', default: 'Flax', options: ['Flax', 'Wool'], label: 'Fibre to spin', help: 'matched against the "What would you like to spin?" menu' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    ladderTile: { type: 'tile', default: DEFAULT_LADDER_TILE, label: 'Ladder stand tile (x,z) — inside the house', help: 'walkable tile INSIDE the wheel house beside the ladder (not the ladder tile itself — see route note); the house door is opened on the way' },
    wheelTile: { type: 'tile', default: DEFAULT_WHEEL_TILE, label: 'Spinning wheel tile (x,z,level)', help: 'upstairs — search centre for the wheel' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    ladderName: { type: 'string', default: 'Ladder', label: 'Ladder/staircase loc name' },
    climbUpOp: { type: 'string', default: 'Climb-up', label: 'Ladder up op' },
    climbDownOp: { type: 'string', default: 'Climb-down', label: 'Ladder down op' },
    wheelName: { type: 'string', default: 'Spinning wheel', label: 'Spinning wheel loc name' },
    spinOp: { type: 'string', default: 'Spin', label: 'Spinning wheel op' },
    obstacle: { type: 'string', default: 'door', label: 'Openable obstacles (contains)', help: 'the house door on the bank route' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 20, label: 'Wheel/ladder search radius (tiles)' }
};

/** Interact the nearest `name` loc offering `op` (a Climb-up/Climb-down — an OPLOC,
 *  so the server walks us to the ladder and climbs) and wait for our floor to
 *  change. Returns true once `Game.tile().level` differs from before. */
async function climbLadder(name: string, op: string, log: (m: string) => void): Promise<boolean> {
    const ladder = Locs.query().name(name).action(op).nearest();
    if (!ladder) {
        log(`no '${name}' offering '${op}' nearby`);
        return false;
    }
    const before = Game.tile()?.level;
    await ladder.interact(op);
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level !== before;
    }, 8000);
}

/**
 * Seers Village flax spinner. Withdraw a full pack of flax at the Seers bank, run
 * to the spinning-wheel house (opening the door), climb the ladder up, Spin-X the
 * whole pack into bow string, climb back down, return to the bank, deposit
 * everything, repeat. Runs off bank-fed flax; stops cleanly when the bank runs
 * out. Start it at the Seers bank.
 */
export default class FlaxSpinner extends TaskBot {
    override loopDelay = 600;

    private spun = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private product = 'Flax';
    private bankStand = DEFAULT_BANK_STAND;
    private ladderTile = DEFAULT_LADDER_TILE;
    private wheelTile = DEFAULT_WHEEL_TILE;
    private boothName = 'Bank booth';
    private ladder = 'Ladder';
    private upOp = 'Climb-up';
    private downOp = 'Climb-down';
    private wheel = 'Spinning wheel';
    private spin = 'Spin';
    private obstacle: string[] = ['door'];
    private leash = 8;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.product = this.settings.str('product', 'Flax');
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.ladderTile = this.settings.tile('ladderTile', DEFAULT_LADDER_TILE);
        this.wheelTile = this.settings.tile('wheelTile', DEFAULT_WHEEL_TILE);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.ladder = this.settings.str('ladderName', 'Ladder');
        this.upOp = this.settings.str('climbUpOp', 'Climb-up');
        this.downOp = this.settings.str('climbDownOp', 'Climb-down');
        this.wheel = this.settings.str('wheelName', 'Spinning wheel');
        this.spin = this.settings.str('spinOp', 'Spin');
        this.obstacle = this.settings.str('obstacle', 'door').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 8);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('crafting');

        this.log(`FlaxSpinner spinning ${this.product} — bank ${this.bankStand}, ladder ${this.ladderTile}, wheel ${this.wheelTile}`);
        this.add(new ContinueDialog(), new BankTrip(this), new Ascend(this), new Spin(this), new Descend(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e0ff' });
        p.title(`FlaxSpinner — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('crafting') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Spun: ${this.spun}`, `XP/hr: ${xph}`);
        p.row(`${this.product} left: ${this.fibreCount()}`, `Floor: ${Game.tile()?.level ?? '?'}`, `Bank trips: ${this.trips}`);

        p.gap();
        // processing bot — switching fibre mid-batch would cancel the weak-queue
        // spin, so Pause/Stop only (no live selector)
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordSpun(n: number): void { this.spun += n; }
    countTrip(): void { this.trips++; }
    productName(): string { return this.product; }
    bankTile(): Tile { return this.bankStand; }
    ladderStand(): Tile { return this.ladderTile; }
    wheelStand(): Tile { return this.wheelTile; }
    boothLocName(): string { return this.boothName; }
    ladderName(): string { return this.ladder; }
    climbUpOp(): string { return this.upOp; }
    climbDownOp(): string { return this.downOp; }
    wheelLocName(): string { return this.wheel; }
    spinOpName(): string { return this.spin; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }
    onFloor(level: number): boolean { return Game.tile()?.level === level; }

    /** Fibre (flax/wool) still in the pack. Flax and bow string don't stack, so
     *  count slots; the bow-string product never matches the fibre keyword. */
    fibreCount(): number {
        const pat = this.product.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }
}

/** Ground floor, no flax → cross to the bank (opening the house door), deposit
 *  everything, then Withdraw-All flax. Stop cleanly when the bank runs dry. */
class BankTrip implements Task {
    constructor(private bot: FlaxSpinner) {}
    validate(): boolean { return this.bot.onFloor(0) && this.bot.fibreCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositInventory(); // bow string + any leftover flax/junk
        await Execution.delayTicks(1);
        this.bot.countTrip();

        const flaxBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(this.bot.productName().toLowerCase()));
        if (!flaxBank || flaxBank.name === null || Bank.count(flaxBank.name) === 0) {
            this.bot.log(`out of '${this.bot.productName()}' in the bank. Stopping.`);
            this.bot.setStatus(`out of ${this.bot.productName()} — stopped`);
            ScriptRunner.stop();
            return;
        }
        const flaxName = flaxBank.name;
        const allOp = withdrawOp(flaxBank.ops, 'all') ?? withdrawOp(flaxBank.ops, 'any') ?? 'Withdraw-All';
        this.bot.setStatus(`withdrawing ${flaxName}`);
        await Bank.withdraw(flaxName, allOp);
        await Execution.delayUntil(() => this.bot.fibreCount() > 0 || Bank.count(flaxName) === 0, 4000);
        // walking closes the bank; Ascend heads for the ladder next tick
    }
}

/** Ground floor, flax in the pack → walk to the ladder (opening the house door)
 *  and climb up to the spinning wheel. */
class Ascend implements Task {
    constructor(private bot: FlaxSpinner) {}
    validate(): boolean { return this.bot.onFloor(0) && this.bot.fibreCount() > 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('heading up to the wheel');
        const ladder = Locs.query().name(this.bot.ladderName()).action(this.bot.climbUpOp()).nearest();
        if (!ladder || ladder.distance() > 1) {
            await walkOpening(this.bot.ladderStand(), 1, this.bot.obstacleList(), m => this.bot.log(m));
        }
        await climbLadder(this.bot.ladderName(), this.bot.climbUpOp(), m => this.bot.log(`  ${m}`));
    }
}

/** Upstairs with flax → click the wheel, Spin-X the whole pack, and ride the batch
 *  to completion. Only (re)clicks the wheel when spinning has genuinely stopped —
 *  a mid-batch click would cancel the weak-queue spin. The wheel's Spin op is an
 *  OPLOC (forceapproach=south), so the server walks us onto it — no web-walking on
 *  the un-baked upper floor. */
class Spin implements Task {
    constructor(private bot: FlaxSpinner) {}
    validate(): boolean { return this.bot.onFloor(1) && this.bot.fibreCount() > 0 && !ChatDialog.canContinue(); }
    async execute(): Promise<void> {
        // Already mid-batch (entered while the pack is draining) → just ride it out;
        // do NOT touch anything, or the weak-queue spin cancels.
        if (Game.animating() && !ChatDialog.isMakeMenu()) {
            await this.ride();
            return;
        }
        // Open the wheel's Spin panel if it isn't already up (a click here is safe:
        // we're not currently spinning).
        if (!ChatDialog.isMakeMenu()) {
            const wheel = Locs.query().name(this.bot.wheelLocName()).action(this.bot.spinOpName())
                .where(l => l.tile().distanceTo(this.bot.wheelStand()) <= this.bot.leashRadius()).nearest();
            if (!wheel) { await Execution.delayTicks(2); return; }
            this.bot.setStatus('opening the spinning wheel');
            if (!(await wheel.interact(this.bot.spinOpName()))) { await Execution.delayTicks(2); return; }
            if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu() || ChatDialog.canContinue() || Game.animating(), 6000))) {
                return; // the wheel didn't respond — retry next tick
            }
        }
        // Spin-X the whole pack.
        if (ChatDialog.isMakeMenu()) {
            if (!(await ChatDialog.makeX(this.bot.productName(), this.bot.fibreCount()))) {
                this.bot.log(`Spin menu open but couldn't Make-X '${this.bot.productName()}' — products: [${ChatDialog.makeProducts().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }
        }
        // Ride the batch to completion in THIS execute so we never re-click mid-spin.
        await this.ride();
    }

    /** Wait while the weak-queue batch drains the pack. Returns when the pack is
     *  empty (→ Descend), a dialog/event interrupts, we leave the floor, or
     *  spinning STALLS — no fibre consumed for RESPIN_AFTER_TICKS with flax left,
     *  meaning it stopped for some reason and execute() should re-spin. Touches
     *  nothing: any action would cancel the spin. */
    private async ride(): Promise<void> {
        this.bot.setStatus('spinning');
        let last = this.bot.fibreCount();
        let idle = 0;
        while (this.bot.fibreCount() > 0) {
            if (ChatDialog.canContinue() || EventSignal.pending() || !this.bot.onFloor(1)) { return; }
            await Execution.delayTicks(1);
            const now = this.bot.fibreCount();
            if (now < last) { this.bot.recordSpun(last - now); last = now; idle = 0; }
            else if (++idle >= RESPIN_AFTER_TICKS) { return; }
        }
    }
}

/** Upstairs, no flax left → climb back down to the ground floor. */
class Descend implements Task {
    constructor(private bot: FlaxSpinner) {}
    validate(): boolean { return this.bot.onFloor(1) && this.bot.fibreCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('heading back down');
        await climbLadder(this.bot.ladderName(), this.bot.climbDownOp(), m => this.bot.log(`  ${m}`));
    }
}
