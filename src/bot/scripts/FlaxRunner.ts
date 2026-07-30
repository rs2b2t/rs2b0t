import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { depositAllExcept } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { Trade } from '../api/hud/Trade.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Players } from '../api/queries/Players.js';
import type { Player } from '../api/entities/index.js';
import { Traversal } from '../api/Traversal.js';
import { Reachability } from '../api/Reachability.js';
import { walkOpening } from '../api/walkOpening.js';
import { EventSignal } from '../api/EventSignal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import {
  FLAX_FIELD, FLAX_GATE, SPINNING_WHEEL_AREA, BANK_ENTRANCE, BANK_STAND, LADDER_TILE,
  TRADE_RANGE, FLAX, BOW_STRING, SPINNING_WHEEL, SPIN_OP, PICK_OP,
  BOOTH_NAME, LADDER_NAME, CLIMB_UP, CLIMB_DOWN, FIELD_SCOPE, FIELD_ARRIVE
} from './FlaxRunnerLogic.js';

const LEASH_RADIUS = 8;
const OBSTACLE = ['door'];
const RESPIN_AFTER_TICKS = 6;
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    mode: { type: 'string', default: 'Runner', options: ['Runner', 'Spinner'], label: 'Mode', help: 'Runner picks flax and delivers to Spinner; Spinner spins flax into bow strings and banks them' },
    partner: { type: 'string', default: '', label: 'Partner name', help: 'Runner: spinner\'s player name. Spinner: runner\'s player name.' },
    flaxName: { type: 'string', default: FLAX, label: 'Flax loc name' },
    pickOp: { type: 'string', default: PICK_OP, label: 'Pick op' },
    fieldTile: { type: 'tile', default: FLAX_FIELD, label: 'Field centre (x,z)' },
    fieldGate: { type: 'tile', default: FLAX_GATE, label: 'Field gate (x,z)' },
    bankEntrance: { type: 'tile', default: BANK_ENTRANCE, label: 'Bank entrance (x,z)' },
    bankStand: { type: 'tile', default: BANK_STAND, label: 'Bank stand (x,z)' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth name' },
    ladderTile: { type: 'tile', default: LADDER_TILE, label: 'Ladder stand (x,z)' },
    ladderName: { type: 'string', default: 'Ladder', label: 'Ladder name' },
    climbUpOp: { type: 'string', default: 'Climb-up', label: 'Climb-up op' },
    climbDownOp: { type: 'string', default: 'Climb-down', label: 'Climb-down op' },
    wheelTile: { type: 'tile', default: SPINNING_WHEEL_AREA, label: 'Wheel tile (x,z,level)' },
    wheelName: { type: 'string', default: SPINNING_WHEEL, label: 'Wheel loc name' },
    spinOp: { type: 'string', default: SPIN_OP, label: 'Spin op' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 20, label: 'Search radius (tiles)' }
};

function flaxCount(flaxName: string): number {
    return Inventory.count(flaxName);
}

function bowStringCount(): number {
    return Inventory.count(BOW_STRING);
}

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

export default class FlaxRunner extends TaskBot {
    override loopDelay = 600;

    private mode = 'Runner';
    private partner = '';
    private flaxName_ = FLAX;
    private pickOp_ = PICK_OP;
    private fieldTile_ = FLAX_FIELD;
    private fieldGate_ = FLAX_GATE;
    private bankEntrance_ = BANK_ENTRANCE;
    private bankStand_ = BANK_STAND;
    private boothName_ = 'Bank booth';
    private ladderTile_ = LADDER_TILE;
    private ladderName_ = 'Ladder';
    private climbUpOp_ = 'Climb-up';
    private climbDownOp_ = 'Climb-down';
    private wheelTile_ = SPINNING_WHEEL_AREA;
    private wheelName_ = SPINNING_WHEEL;
    private spinOp_ = SPIN_OP;
    private leashRadius_ = 8;

    private picked = 0;
    private delivered = 0;
    private spun = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();

    startupPending = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.mode = this.settings.str('mode', 'Runner');
        this.partner = this.settings.str('partner', '');
        this.flaxName_ = this.settings.str('flaxName', FLAX);
        this.pickOp_ = this.settings.str('pickOp', PICK_OP);
        this.fieldTile_ = this.settings.tile('fieldTile', FLAX_FIELD);
        this.fieldGate_ = this.settings.tile('fieldGate', FLAX_GATE);
        this.bankEntrance_ = this.settings.tile('bankEntrance', BANK_ENTRANCE);
        this.bankStand_ = this.settings.tile('bankStand', BANK_STAND);
        this.boothName_ = this.settings.str('bankBooth', 'Bank booth');
        this.ladderTile_ = this.settings.tile('ladderTile', LADDER_TILE);
        this.ladderName_ = this.settings.str('ladderName', 'Ladder');
        this.climbUpOp_ = this.settings.str('climbUpOp', 'Climb-up');
        this.climbDownOp_ = this.settings.str('climbDownOp', 'Climb-down');
        this.wheelTile_ = this.settings.tile('wheelTile', SPINNING_WHEEL_AREA);
        this.wheelName_ = this.settings.str('wheelName', SPINNING_WHEEL);
        this.spinOp_ = this.settings.str('spinOp', SPIN_OP);
        this.leashRadius_ = this.settings.num('leashRadius', 8);

        this.log(`${this.mode} mode — partner: ${this.partner || '(none)'}`);

        this.on('inventory.changed', e => {
            if (e.id !== -1 && this.isFlax(e.name)) {
                this.picked++;
            }
        });

        this.add(new ContinueDialog());

        if (this.mode === 'Runner') {
            this.add(
                new PickFlax(this),
                new GoToField(this),
                new BankFlax(this),
                new GoToWheel(this),
                new WaitAndTrade(this),
            );
        } else {
            this.add(
                new HandleTrade(this),
                new RequestTrade(this),
                new SpinFlax(this),
                new BankStrings(this),
                new ClimbDown(this),
                new ClimbUp(this),
                new GoToWheel(this),
            );
        }
    }

    override recoveryAnchor(): Tile | null {
        return this.mode === 'Runner' ? this.fieldTile_ : this.wheelTile_;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.mode === 'Runner' ? '#9be05b' : '#a0e0ff' });
        p.title(`${this.mode} — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Partner: ${this.partner || '—'}`);

        if (this.mode === 'Runner') {
            const size = Inventory.isFull() ? 0 : Math.max(0, 28 - Inventory.used());
            p.row(`Picked: ${this.picked}`, `Delivered: ${this.delivered}`);
            p.row(`Trips: ${this.trips}`, `Held: ${flaxCount(this.flaxName_)}`);
            p.row(`Free slots: ${size}`);
        } else {
            p.row(`Spun: ${this.spun}`, `Strings: ${bowStringCount()}`);
            p.row(`Trips: ${this.trips}`, `Flax: ${flaxCount(this.flaxName_)}`);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    // Accessors for tasks
    getMode(): string { return this.mode; }
    getPartner(): string { return this.partner; }
    isFlax(name: string | null | undefined): boolean {
        return (name ?? '').toLowerCase().includes(this.flaxName_.toLowerCase());
    }
    atField(): boolean {
        const here = Game.tile();
        return here !== null && this.fieldTile_.distanceTo(here) <= FIELD_SCOPE;
    }
    atWheel(): boolean {
        const here = Game.tile();
        return here !== null && this.wheelTile_.distanceTo(here) <= this.leashRadius_;
    }
    onFloor(level: number): boolean {
        const t = Game.tile();
        return t !== null && t.level === level;
    }
    nearestFlax(): Loc | null {
        const me = Game.tile();
        const flax = Locs.query()
            .name(this.flaxName_)
            .action(this.pickOp_)
            .where(l => l.tile().distanceTo(this.fieldTile_) <= FIELD_SCOPE)
            .results();
        if (flax.length === 0) return null;
        if (me) flax.sort((a, b) => a.tile().distanceTo(me) - b.tile().distanceTo(me));
        for (const f of flax) {
            if (Reachability.canReach(f.tile(), { adjacentOk: true, maxSteps: 400 })) return f;
        }
        return null;
    }
    nearestPartner(): Player | null {
        if (!this.partner) return null;
        return Players.query().name(this.partner).nearest();
    }
    setStatus(s: string): void { this.status = s; }
    countTrip(): void { this.trips++; }
    countDelivered(n: number): void { this.delivered += n; }
    countSpun(n: number): void { this.spun += n; }
    flaxLocName(): string { return this.flaxName_; }
    pickOpName(): string { return this.pickOp_; }
    fieldCentre(): Tile { return this.fieldTile_; }
    fieldGateTile(): Tile { return this.fieldGate_; }
    bankEntranceTile(): Tile { return this.bankEntrance_; }
    bankStandTile(): Tile { return this.bankStand_; }
    boothLocName(): string { return this.boothName_; }
    ladderStandTile(): Tile { return this.ladderTile_; }
    ladderName(): string { return this.ladderName_; }
    climbUpOp(): string { return this.climbUpOp_; }
    climbDownOp(): string { return this.climbDownOp_; }
    wheelStand(): Tile { return this.wheelTile_; }
    wheelLocName(): string { return this.wheelName_; }
    spinOpName(): string { return this.spinOp_; }
    leashRadius(): number { return this.leashRadius_; }
    flaxNameStr(): string { return this.flaxName_; }
}

// --- Runner tasks ---

class PickFlax implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        if (Inventory.isFull()) return false;
        return this.bot.atField() && this.bot.nearestFlax() !== null;
    }
    async execute(): Promise<void> {
        const loc = this.bot.nearestFlax();
        if (!loc) { await Execution.delayTicks(2); return; }
        this.bot.setStatus('picking flax');
        await loc.interact(this.bot.pickOpName());
    }
}

class GoToField implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        return !this.bot.atField();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('travelling to the flax field');
        await Traversal.walkResilient(this.bot.fieldCentre(), {
            radius: FIELD_ARRIVE,
            attempts: 6,
            timeoutMs: 240_000,
            log: m => this.bot.log(`  ${m}`),
        });
    }
}

class BankFlax implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        return Inventory.isFull() && flaxCount(this.bot.flaxNameStr()) > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('banking flax');
        await Traversal.walkResilient(this.bot.bankEntranceTile(), {
            radius: 3,
            attempts: 4,
            timeoutMs: 120_000,
            log: m => this.bot.log(`  ${m}`),
        });
        await Bank.openBooth(
            { x: this.bot.bankStandTile().x, z: this.bot.bankStandTile().z, level: this.bot.bankStandTile().level },
            this.bot.boothLocName(),
            BOOTH.op,
            m => this.bot.log(`  ${m}`),
        );
        await Bank.depositInventory();
        await Bank.close();
        this.bot.countTrip();
    }
}

class GoToWheel implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (Trade.active()) return false;
        if (this.bot.getMode() === 'Runner') {
            return flaxCount(this.bot.flaxNameStr()) >= 28 && !this.bot.atWheel();
        } else {
            return !this.bot.atWheel() && !this.bot.atField();
        }
    }
    async execute(): Promise<void> {
        this.bot.setStatus('travelling to the spinning wheel');
        const dest = this.bot.wheelStand();
        await Traversal.walkResilient(dest, {
            radius: this.bot.leashRadius(),
            attempts: 6,
            timeoutMs: 240_000,
            log: m => this.bot.log(`  ${m}`),
        });
    }
}

class WaitAndTrade implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        if (flaxCount(this.bot.flaxNameStr()) < 28) return false;
        const partner = this.bot.nearestPartner();
        return partner !== null && partner.distance() <= TRADE_RANGE;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('waiting for spinner to request trade');
        await Execution.delayTicks(2);
    }
}

// --- Spinner tasks ---

class RequestTrade implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (flaxCount(this.bot.flaxNameStr()) === 0) return false;
        const partner = this.bot.nearestPartner();
        return partner !== null && partner.distance() <= TRADE_RANGE;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('requesting trade from runner');
        await Trade.request(this.bot.getPartner());
        await Execution.delayUntil(() => Trade.active(), 4000);
    }
}

class HandleTrade implements Task {
    private pending = 0;
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        return Trade.active();
    }
    async execute(): Promise<void> {
        if (Trade.onOfferScreen()) {
            if (Trade.myOffer().length === 0) {
                const theirFlax = Trade.theirOffer().filter(o => (o.name ?? '').toLowerCase() === FLAX.toLowerCase());
                if (theirFlax.length > 0) {
                    this.bot.setStatus('accepting flax from runner');
                    this.pending = theirFlax.reduce((s, o) => s + Math.max(1, o.count), 0);
                    await Trade.accept();
                } else {
                    await Execution.delayTicks(1);
                }
            } else {
                this.bot.setStatus('accepting trade');
                await Trade.accept();
            }
            return;
        }
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming trade');
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 2500) && this.pending > 0) {
                this.bot.log(`received ${this.pending} flax from runner`);
                this.pending = 0;
            }
        }
    }
}

class SpinFlax implements Task {
    private spinningUntil = 0;
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (Date.now() < this.spinningUntil) return false;
        if (flaxCount(this.bot.flaxNameStr()) === 0) return false;
        return this.bot.onFloor(1);
    }
    async execute(): Promise<void> {
        if (Game.animating() && !ChatDialog.isMakeMenu()) {
            await this.ride();
            return;
        }
        if (!ChatDialog.isMakeMenu()) {
            const wheel = Locs.query()
                .name(this.bot.wheelLocName())
                .action(this.bot.spinOpName())
                .where(l => l.tile().distanceTo(this.bot.wheelStand()) <= this.bot.leashRadius())
                .nearest();
            if (!wheel) { await Execution.delayTicks(2); return; }
            this.bot.setStatus('opening the spinning wheel');
            if (!(await wheel.interact(this.bot.spinOpName()))) { await Execution.delayTicks(2); return; }
            if (!(await Execution.delayUntil(
                () => ChatDialog.isMakeMenu() || ChatDialog.canContinue() || Game.animating(),
                6000,
            ))) {
                return;
            }
        }
        if (ChatDialog.isMakeMenu()) {
            if (!(await ChatDialog.makeX(BOW_STRING, flaxCount(this.bot.flaxNameStr())))) {
                this.bot.log(`Spin menu open but couldn't Make-X '${BOW_STRING}' — products: [${ChatDialog.makeProducts().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }
        }
        await this.ride();
    }

    private async ride(): Promise<void> {
        this.bot.setStatus('spinning');
        let last = flaxCount(this.bot.flaxNameStr());
        let idle = 0;
        while (flaxCount(this.bot.flaxNameStr()) > 0) {
            if (ChatDialog.canContinue() || EventSignal.pending() || !this.bot.onFloor(1)) return;
            await Execution.delayTicks(1);
            const now = flaxCount(this.bot.flaxNameStr());
            if (now < last) {
                this.bot.countSpun(last - now);
                last = now;
                idle = 0;
            } else if (++idle >= 6) {
                return;
            }
        }
    }
}

class BankStrings implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (bowStringCount() === 0) return false;
        return Inventory.isFull() || flaxCount(this.bot.flaxNameStr()) === 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('banking bow strings');
        await Traversal.walkResilient(this.bot.bankEntranceTile(), {
            radius: 3,
            attempts: 4,
            timeoutMs: 120_000,
            log: m => this.bot.log(`  ${m}`),
        });
        await Bank.openBooth(
            { x: this.bot.bankStandTile().x, z: this.bot.bankStandTile().z, level: this.bot.bankStandTile().level },
            this.bot.boothLocName(),
            BOOTH.op,
            m => this.bot.log(`  ${m}`),
        );
        await Bank.depositAllMatching(
            depositAllExcept([this.bot.flaxNameStr()]),
            m => this.bot.log(`  ${m}`),
        );
        await Bank.close();
        this.bot.countTrip();
    }
}

class ClimbDown implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (!this.bot.onFloor(1)) return false;
        return flaxCount(this.bot.flaxNameStr()) === 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading back down');
        await climbLadder(this.bot.ladderName(), this.bot.climbDownOp(), m => this.bot.log(`  ${m}`));
    }
}

class ClimbUp implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (this.bot.onFloor(1)) return false;
        return flaxCount(this.bot.flaxNameStr()) > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading up to the wheel');
        const ladder = Locs.query().name(this.bot.ladderName()).action(this.bot.climbUpOp()).nearest();
        if (!ladder || ladder.distance() > 1) {
            await walkOpening(
                this.bot.ladderStandTile(),
                1,
                ['door'],
                m => this.bot.log(m),
            );
        }
        await climbLadder(this.bot.ladderName(), this.bot.climbUpOp(), m => this.bot.log(`  ${m}`));
    }
}