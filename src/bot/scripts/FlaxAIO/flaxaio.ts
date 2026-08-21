import { TaskBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { BankTask } from './banking.js';
import { EscapeFlaxTrap, GoToFieldTask, PickTask } from './picking.js';
import { AscendTask, DescendTask, SpinTask } from './spinning.js';

// Why: these are Seers-village layout constants, not player choices — a future "location" preset would swap the whole set at once.
const FIELD = new Tile(2741, 3444, 0);
const FIELD_GATE = new Tile(2736, 3443, 0);
const BANK_STAND = new Tile(2725, 3493, 0);
const LADDER = new Tile(2714, 3471, 0);
const WHEEL = new Tile(2711, 3471, 1);
const BANK_STAND_SPAN = 4;
const FIELD_SCOPE = 12;
const FIELD_ARRIVE = 3;
const FLAX_NAME = 'Flax';
const PICK_OP = 'Pick';
const BOOTH = 'Bank booth';
const LADDER_NAME = 'Ladder';
const CLIMB_UP = 'Climb-up';
const CLIMB_DOWN = 'Climb-down';
const WHEEL_NAME = 'Spinning wheel';
const SPIN_OP = 'Spin';
const OBSTACLES = ['door'];
const LEASH = 8;

const SPUN_NAME: Record<string, string> = { Flax: 'Bow string', Wool: 'Ball of wool' };

export const SETTINGS: SettingsSchema = {
    picking: { type: 'boolean', default: true, label: 'Pick flax', help: 'pick flax at the Seers field before spinning' },
    spinning: { type: 'boolean', default: true, label: 'Spin flax', help: 'spin flax at the Seers wheel into bow strings' }
};

export default class FlaxAIO extends TaskBot {
    override loopDelay = 600;

    private picked = 0;
    private spun = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();

    private pickingMode = true;
    private spinningMode = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.pickingMode = this.settings.bool('picking', true);
        this.spinningMode = this.settings.bool('spinning', true);
        if (!this.pickingMode && !this.spinningMode) {
            ScriptRunner.stop('FlaxAIO needs at least one of Pick or Spin enabled');
            return;
        }

        this.startedAt = Date.now();
        const mode = [this.pickingMode ? 'pick' : '', this.spinningMode ? 'spin' : ''].filter(Boolean).join(' + ');
        this.log(`FlaxAIO (${mode}) — flax '${FLAX_NAME}' at ${FIELD}, wheel ${WHEEL}`);

        this.on('inventory.changed', e => {
            if (e.id !== -1 && this.isFlax(e.name)) {
                this.picked++;
            }
        });

        this.add(
            new ContinueDialog(),
            new EscapeFlaxTrap(this),
            new BankTask(this),
            new AscendTask(this),
            new SpinTask(this),
            new DescendTask(this),
            new PickTask(this),
            new GoToFieldTask(this)
        );
    }

    override recoveryAnchor(): Tile | null {
        return FIELD;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c8e06a' });
        p.title(`FlaxAIO — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((this.spun * 15) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Picked: ${this.picked}`, `Spun: ${this.spun}`);
        p.row(`Flax: ${this.flaxCount()}`, `Bow strings: ${this.bowstringCount()}`, `Bank trips: ${this.trips}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    get picking(): boolean {
        return this.pickingMode;
    }
    get spinning(): boolean {
        return this.spinningMode;
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countTrip(): void {
        this.trips++;
    }
    recordSpun(n: number): void {
        this.spun += n;
    }
    isFlax(name: string | null | undefined): boolean {
        return (name ?? '').toLowerCase().includes(FLAX_NAME.toLowerCase());
    }

    flaxName(): string {
        return FLAX_NAME;
    }
    pickOpName(): string {
        return PICK_OP;
    }
    fieldCentre(): Tile {
        return FIELD;
    }
    fieldGate(): Tile {
        return FIELD_GATE;
    }
    fieldScope(): number {
        return FIELD_SCOPE;
    }
    fieldArrive(): number {
        return FIELD_ARRIVE;
    }
    bankStand(): Tile {
        return BANK_STAND;
    }
    bankStandSpan(): number {
        return BANK_STAND_SPAN;
    }
    ladderStand(): Tile {
        return LADDER;
    }
    wheelStand(): Tile {
        return WHEEL;
    }
    boothLocName(): string {
        return BOOTH;
    }
    ladderName(): string {
        return LADDER_NAME;
    }
    climbUpOp(): string {
        return CLIMB_UP;
    }
    climbDownOp(): string {
        return CLIMB_DOWN;
    }
    wheelLocName(): string {
        return WHEEL_NAME;
    }
    spinOpName(): string {
        return SPIN_OP;
    }
    obstacleList(): string[] {
        return OBSTACLES;
    }
    leashRadius(): number {
        return LEASH;
    }

    onFloor(level: number): boolean {
        return Game.tile()?.level === level;
    }
    flaxCount(): number {
        return Inventory.count(FLAX_NAME);
    }
    fibreCount(): number {
        const pat = FLAX_NAME.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }
    bowstringCount(): number {
        const pat = (SPUN_NAME[FLAX_NAME] ?? 'Bow string').toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    needsBank(): boolean {
        // Why: banking only happens on the ground floor, so never trigger it mid-climb or at the wheel.
        if (Game.tile()?.level !== 0) {
            return false;
        }
        if (this.bowstringCount() > 0) {
            return true;
        }
        if (this.spinning && !this.picking && this.fibreCount() === 0) {
            return true;
        }
        if (this.picking && !this.spinning && Inventory.isFull()) {
            return true;
        }
        return false;
    }
}
