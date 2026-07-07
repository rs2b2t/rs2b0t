import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Tunable parameters (panel + `?IronBanker.<key>=...`). */
export const SETTINGS: SettingsSchema = {
    pickup: { type: 'string', default: 'iron ore', label: 'Ground item to bank (name contains)', help: 'the ore a Miner bot drops nearby; the banker sweeps and banks it' },
    bankTile: { type: 'string', default: '', label: 'Bank stand tile (x,z or x,z,level)', help: 'the tile to stand on to operate the bank booth; required' },
    bankName: { type: 'string', default: 'Bank booth', label: 'Bank object name' },
    bankOp: { type: 'string', default: 'Use-quickly', label: 'Bank object action' },
    sweepRadius: { type: 'number', default: 12, min: 3, max: 30, label: 'Sweep radius around the mine (tiles)' }
};

/** Parse an "x,z" / "x,z,level" setting into a Tile, or null if blank/bad. */
function parseTile(s: string): Tile | null {
    const parts = s.split(',').map(p => parseInt(p.trim(), 10));
    if (parts.length < 2 || parts.some(n => Number.isNaN(n))) {
        return null;
    }
    return new Tile(parts[0], parts[1], parts[2] ?? 0);
}

/**
 * The banking half of a mining→banking pair. The Miner bot mines iron and drops
 * it (GatheringBot with dropMatch='iron ore'); this bot camps that same mine,
 * sweeps up the dropped ore, and shuttles it to a bank — no IPC between the two
 * processes: the ground items ARE the shared signal, and a separate account only
 * sees another player's drops once they go public (~60s), which the GroundItems
 * query already reflects. Start it standing in the mine (that tile becomes the
 * sweep anchor); set bankTile to a tile adjacent to a bank booth.
 *
 * Bank-run mechanics are the surface-only version of ChaosDruidKiller's (no
 * dungeon ladders): walk to the booth, open it from an adjacent tile, deposit
 * everything matching the ore, walk back.
 */
export default class IronBanker extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private bankTile: Tile | null = null;
    private pickup = 'iron ore';
    private bankName = 'Bank booth';
    private bankOp = 'Use-quickly';
    private sweep = 12;

    private banked = 0;
    private trips = 0;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.pickup = this.settings.str('pickup', 'iron ore').toLowerCase();
        this.bankName = this.settings.str('bankName', 'Bank booth');
        this.bankOp = this.settings.str('bankOp', 'Use-quickly');
        this.sweep = this.settings.num('sweepRadius', 12);
        this.bankTile = parseTile(this.settings.str('bankTile', ''));

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`banking *${this.pickup}* dropped within ${this.sweep} of ${this.anchor}, to bank at ${this.bankTile ?? '(bankTile UNSET!)'}`);
        if (!this.bankTile) {
            this.log('warning: bankTile is unset — set IronBanker.bankTile=x,z,level; will sweep but cannot bank');
        }

        this.add(new ContinueDialog(), new BankRun(this), new Sweep(this), new GoToMine(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`IronBanker — ${this.status}`, `banked ${this.banked}  trips ${this.trips}`, `inv ${Inventory.used()} used  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    getAnchor(): Tile {
        return this.anchor!;
    }
    getBankTile(): Tile | null {
        return this.bankTile;
    }
    bankObjectName(): string {
        return this.bankName;
    }
    bankObjectOp(): string {
        return this.bankOp;
    }
    sweepRadius(): number {
        return this.sweep;
    }
    pickupKeyword(): string {
        return this.pickup;
    }
    wantsItem(name: string | null): boolean {
        return name !== undefined && name !== null && name.toLowerCase().includes(this.pickup);
    }
    countTrip(n: number): void {
        this.trips++;
        this.banked += n;
    }
}

class ContinueDialog implements Task {
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

/** Sweep dropped ore near the mine anchor into the pack. */
class Sweep implements Task {
    constructor(private bot: IronBanker) {}

    private find() {
        return GroundItems.query()
            .where(g => this.bot.wantsItem(g.name))
            .within(this.bot.sweepRadius())
            .nearest();
    }

    validate(): boolean {
        return !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        this.bot.setStatus(`taking ${drop.name} at ${drop.tile()}`);
        const before = Inventory.used();
        if (!(await drop.interact('Take'))) {
            await Execution.delayTicks(2);
            return;
        }
        await Execution.delayUntil(() => Inventory.used() > before || this.find() === null, 4000);
    }
}

/** Full pack -> walk to the bank -> deposit the ore -> walk back to the mine. */
class BankRun implements Task {
    constructor(private bot: IronBanker) {}

    validate(): boolean {
        return Inventory.isFull() && this.bot.getBankTile() !== null;
    }

    async execute(): Promise<void> {
        const bankTile = this.bot.getBankTile()!;
        const had = Inventory.items().filter(i => this.bot.wantsItem(i.name)).length;

        this.bot.setStatus('banking: walking to bank');
        await Traversal.walkTo(bankTile, { radius: 2, timeoutMs: 120000, log: m => this.bot.log(`  ${m}`) });

        if (!(await Bank.openBooth(bankTile, this.bot.bankObjectName(), this.bot.bankObjectOp(), m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        this.bot.setStatus('banking: depositing ore');
        await Bank.depositAllMatching(name => this.bot.wantsItem(name));
        await Execution.delayTicks(1);
        this.bot.countTrip(had);
        this.bot.log(`deposited ${had} ${this.bot.pickupKeyword()}`);

        // walking away closes the booth on its own
        this.bot.setStatus('banking: heading back to the mine');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 120000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Wandered off (e.g. after a bank run drop-off): walk back to the mine. */
class GoToMine implements Task {
    constructor(private bot: IronBanker) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && !Inventory.isFull() && this.bot.getAnchor().distanceTo(here) > this.bot.sweepRadius() + 4;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to the mine');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 120000, log: m => this.bot.log(`  ${m}`) });
    }
}
