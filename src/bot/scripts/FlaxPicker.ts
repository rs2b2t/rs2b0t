import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Locs } from '../api/queries/Locs.js';
import { walkOpening } from '../api/walkOpening.js';
import { depositMatcher } from '../api/Banking.js';
import type { SettingsSchema } from '../runtime/Settings.js';

const DEFAULT_FIELD = new Tile(2744, 3446, 0);
// South-adjacent to the Seers bank booth at (2722,3494) — verified live (the
// booths run along z=3494; the player stands on the walkable z=3493 side).
const DEFAULT_BANK_STAND = new Tile(2722, 3493, 0);
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    flaxName: { type: 'string', default: 'Flax', label: 'Flax loc name' },
    pickOp: { type: 'string', default: 'Pick', label: 'Interact op' },
    fieldTile: { type: 'tile', default: DEFAULT_FIELD, label: 'Field centre tile (x,z)', help: 'verify/adjust live — Seers flax field' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)', help: 'Seers bank booth-adjacent tile' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'open any door/gate on the run to the bank' },
    leashRadius: { type: 'number', default: 10, min: 2, max: 30, label: 'Flax search radius (tiles)' }
};

/**
 * Seers Village flax picker. Pick raw flax from the nearest "Flax" loc within a
 * leash of the field tile until the pack is full, then walk to the Seers bank
 * (opening any door on the way), deposit all the flax (plus shared junk), walk
 * back to the field, and repeat. Same gather step as GatheringBot, but it BANKS
 * the flax instead of dropping it. Start it at the field or the bank.
 */
export default class FlaxPicker extends TaskBot {
    override loopDelay = 600;

    private picked = 0;
    private trips = 0;
    private status = 'starting';

    private flaxName = 'Flax';
    private pickOp = 'Pick';
    private fieldTile = DEFAULT_FIELD;
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';
    private obstacle: string[] = ['door', 'gate'];
    private leash = 10;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.flaxName = this.settings.str('flaxName', 'Flax');
        this.pickOp = this.settings.str('pickOp', 'Pick');
        this.fieldTile = this.settings.tile('fieldTile', DEFAULT_FIELD);
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.obstacle = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 10);

        this.log(`FlaxPicker picking '${this.flaxName}' (${this.pickOp}) within ${this.leash} of ${this.fieldTile} — bank ${this.bankStand}`);

        this.on('inventory.changed', e => {
            if (e.id !== -1 && this.isFlax(e.name)) {
                this.picked++;
            }
        });

        this.add(new ContinueDialog(), new BankTrip(this), new Pick(this));
    }

    override recoveryAnchor(): Tile | null {
        return this.fieldTile;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const size = Inventory.isFull() ? 0 : Math.max(0, 28 - Inventory.used());
        const lines = [
            `FlaxPicker — ${this.status}`,
            `${this.flaxName}: picked ${this.picked}  bank trips ${this.trips}`,
            `free slots ${size}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    countTrip(): void { this.trips++; }
    flaxLocName(): string { return this.flaxName; }
    pickOpName(): string { return this.pickOp; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }
    fieldCentre(): Tile { return this.fieldTile; }
    bankTile(): Tile { return this.bankStand; }
    boothLocName(): string { return this.boothName; }
    flaxCount(): number { return Inventory.count(this.flaxName); }

    /** True if an item name is the picked flax product. */
    isFlax(name: string | null | undefined): boolean {
        return (name ?? '').toLowerCase().includes(this.flaxName.toLowerCase());
    }

    /** The nearest pickable "Flax" loc within the leash of the field, or null. */
    nearestFlax() {
        return Locs.query()
            .name(this.flaxLocName())
            .action(this.pickOpName())
            .where(l => l.tile().distanceTo(this.fieldTile) <= this.leash)
            .nearest();
    }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** Pack full (no free slots), or carrying flax with no reachable flax loc left in
 *  the leash → walk to the bank, deposit all the flax (+ shared junk), and head
 *  back to the field. */
class BankTrip implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean {
        if (Inventory.isFull()) { return true; }
        return this.bot.flaxCount() > 0 && this.bot.nearestFlax() === null;
    }
    async execute(): Promise<void> {
        const had = this.bot.flaxCount();
        this.bot.setStatus('banking the flax');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositAllMatching(depositMatcher(name => this.bot.isFlax(name), true));
        await Execution.delayTicks(1);
        this.bot.countTrip();
        this.bot.log(`banked ${had} ${this.bot.flaxLocName()}`);
        this.bot.setStatus('heading back to the field');
        // walking closes the bank; Pick walks us the rest of the way next tick
        await walkOpening(this.bot.fieldCentre(), this.bot.leashRadius(), this.bot.obstacleList(), m => this.bot.log(m));
    }
}

/** Not full and a pickable "Flax" loc is in the leash → walk to the field if
 *  we're away, then pick the nearest flax, waiting for the flax count to rise. */
class Pick implements Task {
    constructor(private bot: FlaxPicker) {}
    validate(): boolean {
        return !Inventory.isFull() && this.bot.nearestFlax() !== null;
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (!here || this.bot.fieldCentre().distanceTo(here) > this.bot.leashRadius()) {
            this.bot.setStatus('walking to the flax field');
            await walkOpening(this.bot.fieldCentre(), this.bot.leashRadius(), this.bot.obstacleList(), m => this.bot.log(m));
        }
        // Pick is a single-shot action (the flax doesn't deplete), so re-click each
        // time. Bounded loop: pick, wait for a flax to land, repeat until full or a
        // dialog interrupts us.
        for (let n = 0; n < 30 && !Inventory.isFull(); n++) {
            if (ChatDialog.canContinue()) { return; }
            const flax = this.bot.nearestFlax();
            if (!flax) { return; }
            this.bot.setStatus(`picking ${this.bot.flaxLocName()} at ${flax.tile()}`);
            const before = this.bot.flaxCount();
            if (!(await flax.interact(this.bot.pickOpName()))) { await Execution.delayTicks(2); continue; }
            await Execution.delayUntil(() => this.bot.flaxCount() > before || Inventory.isFull() || ChatDialog.canContinue(), 6000);
        }
    }
}
