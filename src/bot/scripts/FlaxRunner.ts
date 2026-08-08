import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { depositAllExcept } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
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
    MEET_TILE, TRADE_RANGE, TRADE_REQUEST_COOLDOWN_MS, TRADE_FAIL_COOLDOWN_MS,
    FLAX, BOW_STRING, SPINNING_WHEEL, SPIN_OP, PICK_OP,
    BOOTH_NAME, LADDER_NAME, CLIMB_UP, CLIMB_DOWN, FIELD_SCOPE, FIELD_ARRIVE,
    LOCAL_PICK_RADIUS, POCKET_CAP, CARVE_DROP,
    partnerNameMatches, flaxUnitsInOffer, spinnerNeedsClearPack, canReceiveFlaxOffer,
} from './FlaxRunnerLogic.js';
import { driveActivePartnerTrade } from '../api/mule/drivePartnerTrade.js';

const LEASH = 8;
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    mode: { type: 'string', default: 'Runner', options: ['Runner', 'Spinner'], label: 'Mode', help: 'Runner picks flax and delivers to Spinner; Spinner spins flax into bow strings and banks them' },
    partner: { type: 'string', default: '', label: 'Partner name', help: 'Runner: spinner\'s player name. Spinner: runner\'s player name.' },
    minFlaxCapacity: {
        type: 'number',
        default: 24,
        min: 1,
        max: 28,
        label: 'Min flax capacity',
        help: 'Runner only: bank non-flax junk (keeps flax) when a full pack still has trash, or mid-trip when junk leaves room for fewer than this many flax',
    },
};

function flaxCount(): number {
    return Inventory.count(FLAX);
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
    return Execution.delayUntilTicks(() => {
        const t = Game.tile();
        return t !== null && t.level !== before;
    }, 14);
}

export default class FlaxRunner extends TaskBot {
    override loopDelay = 600;

    private mode = 'Runner';
    private partner = '';
    private minFlaxCapacity = 24;

    private picked = 0;
    private delivered = 0;
    private spun = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();

    /** Last flax tile we committed to picking — prefer it while it still exists. */
    private stickyFlax: Tile | null = null;

    /** Earliest wall-clock time we may call Trade.request again (stops request thrash). */
    private nextTradeRequestAtMs = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.mode = this.settings.str('mode', 'Runner');
        this.partner = this.settings.str('partner', '');
        this.minFlaxCapacity = this.settings.num('minFlaxCapacity', 24);

        this.log(`${this.mode} mode — partner: ${this.partner || '(none)'}`
            + (this.mode === 'Runner' ? `, min flax capacity ${this.minFlaxCapacity}` : ''));

        this.on('inventory.changed', e => {
            if (e.id !== -1 && this.isFlax(e.name)) {
                this.picked++;
            }
        });

        this.add(new ContinueDialog());

        if (this.mode === 'Runner') {
            this.add(
                new EscapeFlaxTrap(this),
                new OfferTrade(this),
                new BankJunk(this),
                new WaitAndTrade(this),
                new GoToMeet(this),
                new PickFlax(this),
                new WaitForFlax(this),
                new GoToField(this),
            );
        } else {
            this.add(
                new HandleTrade(this),
                new SpinFlax(this),
                new ClimbDown(this),
                new BankStrings(this),
                new ClimbUp(this),
                new RequestTrade(this),
                new GoToMeet(this),
            );
        }
    }

    override recoveryAnchor(): Tile | null {
        if (this.mode === 'Spinner') {
            // Random-event junk / leftover strings: clear pack before handoff.
            if (this.spinnerNeedsBank()) return BANK_STAND;
            return SPINNING_WHEEL_AREA;
        }
        // Junk bank mid-trip: prefer the bank so watchdog doesn't yank us to the field first.
        if (this.needsJunkBank()) return BANK_STAND;
        // Waiting on trade must not walk a full pack back to the field.
        return this.readyToDeliver() ? MEET_TILE : FLAX_FIELD;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.mode === 'Runner' ? '#9be05b' : '#a0e0ff' });
        p.title(`${this.mode} — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Partner: ${this.partner || '—'}`);

        if (this.mode === 'Runner') {
            const size = Inventory.isFull() ? 0 : Math.max(0, 28 - Inventory.used());
            p.row(`Picked: ${this.picked}`, `Delivered: ${this.delivered}`);
            p.row(`Trips: ${this.trips}`, `Held: ${flaxCount()}`);
            p.row(`Free slots: ${size}`);
        } else {
            p.row(`Spun: ${this.spun}`, `Strings: ${bowStringCount()}`);
            p.row(`Trips: ${this.trips}`, `Flax: ${flaxCount()}`);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    getMode(): string { return this.mode; }
    getPartner(): string { return this.partner; }

    isFlax(name: string | null | undefined): boolean {
        return (name ?? '').toLowerCase().includes(FLAX.toLowerCase());
    }

    isPartner(name: string | null | undefined): boolean {
        return partnerNameMatches(this.partner, name);
    }

    canRequestTrade(): boolean {
        // Wall-clock: mutual Trade-with thrash is independent of client tick rate
        // (live harness often uses 300ms ticks, which halved tick-based cooldowns).
        return Date.now() >= this.nextTradeRequestAtMs;
    }

    noteTradeRequest(): void {
        this.nextTradeRequestAtMs = Date.now() + TRADE_REQUEST_COOLDOWN_MS;
    }

    noteTradeFailed(): void {
        this.nextTradeRequestAtMs = Date.now() + TRADE_FAIL_COOLDOWN_MS;
    }

    noteTradeOk(): void {
        // Short quiet period after a successful handoff so both sides don't re-open.
        this.nextTradeRequestAtMs = Date.now() + TRADE_REQUEST_COOLDOWN_MS;
    }

    /**
     * Spinner: any non-flax in the pack with no flax held blocks a full runner
     * delivery (random-event garbage, bow strings, etc.).
     */
    spinnerNeedsBank(): boolean {
        return spinnerNeedsClearPack(flaxCount(), Inventory.used());
    }

    /** Spinner is ready to receive a full flax pack (empty inventory). */
    spinnerReadyForHandoff(): boolean {
        return flaxCount() === 0 && Inventory.used() === 0;
    }

    /** Pack is full and still holds flax — deliver, do not pick or return to the field. */
    readyToDeliver(): boolean {
        return Inventory.isFull() && flaxCount() > 0 && !this.needsJunkBank();
    }

    needsFlax(): boolean {
        return !Inventory.isFull();
    }

    /** Slots available for flax (pack size minus non-flax junk). */
    flaxCapacity(): number {
        const free = Inventory.free();
        const used = Inventory.used();
        const size = free + used;
        if (size <= 0) return 28;
        const nonFlax = Math.max(0, used - flaxCount());
        return Math.max(0, size - nonFlax);
    }

    hasNonFlax(): boolean {
        return Inventory.used() > flaxCount();
    }

    /**
     * Bank non-flax (keep flax) when:
     * - pack is full and still has junk — clear trash *before* walking to the meet; or
     * - mid-trip junk has cut flax capacity below minFlaxCapacity.
     */
    needsJunkBank(): boolean {
        if (!this.hasNonFlax()) return false;
        // Handoff-ready pack with trash: bank first, refill if needed, then meet.
        if (Inventory.isFull() && flaxCount() > 0) return true;
        return this.flaxCapacity() < this.minFlaxCapacity;
    }

    async bankNonFlax(): Promise<boolean> {
        const log = (m: string): void => this.log(`  ${m}`);
        const junkBefore = Math.max(0, Inventory.used() - flaxCount());
        this.setStatus('banking non-flax junk');
        this.clearStickyFlax();
        this.log(
            `banking ${junkBefore} non-flax slot(s) `
            + `(flax ${flaxCount()}, capacity ${this.flaxCapacity()}, min ${this.minFlaxCapacity})`,
        );

        if (this.atField()) {
            this.setStatus('leaving the field via the gate');
            await Traversal.walkResilient(FLAX_GATE, {
                radius: 0,
                attempts: 4,
                timeoutMs: 120_000,
                log,
            });
        }

        this.setStatus('walking to the bank');
        if (!(await Traversal.walkResilient(BANK_ENTRANCE, {
            radius: 1,
            attempts: 6,
            timeoutMs: 240_000,
            log,
        }))) {
            this.log('could not reach the bank entrance — will retry');
            return false;
        }

        await Traversal.walkResilient(BANK_STAND, {
            radius: 0,
            attempts: 3,
            timeoutMs: 60_000,
            log,
        });

        const opened = (await Bank.openBooth(
            { x: BANK_STAND.x, z: BANK_STAND.z, level: BANK_STAND.level },
            BOOTH_NAME,
            BOOTH.op,
            log,
        )) || (await Bank.openNearest(BOOTH_NAME, BOOTH.op, log));
        if (!opened) {
            this.log('could not open the bank — will retry');
            return false;
        }

        // Keep flax; dump random-event trash and anything else.
        await Bank.depositAllMatching(depositAllExcept([FLAX]), log);
        await Bank.close();
        await Execution.delayTicks(1);
        this.log(`deposited non-flax junk — holding ${flaxCount()} flax, capacity ${this.flaxCapacity()}`);
        return true;
    }

    atField(): boolean {
        const here = Game.tile();
        return here !== null && FLAX_FIELD.distanceTo(here) <= FIELD_SCOPE;
    }

    atWheel(): boolean {
        const here = Game.tile();
        return here !== null && SPINNING_WHEEL_AREA.distanceTo(here) <= LEASH;
    }

    atMeet(): boolean {
        const here = Game.tile();
        // Tight radius so WaitAndTrade/RequestTrade do not pre-empt GoToMeet
        // while still several tiles short of the handoff tile (LEASH would let
        // partners "meet" on opposite sides of the house and never trade).
        return here !== null && MEET_TILE.distanceTo(here) <= TRADE_RANGE;
    }

    onFloor(level: number): boolean {
        const t = Game.tile();
        return t !== null && t.level === level;
    }

    flaxLocAt(x: number, z: number, level: number): Loc | null {
        return Locs.query()
            .name(FLAX)
            .action(PICK_OP)
            .where(l => l.tile().x === x && l.tile().z === z && l.tile().level === level)
            .nearest();
    }

    flaxStillAt(tile: { x: number; z: number; level: number }): boolean {
        return this.flaxLocAt(tile.x, tile.z, tile.level) !== null;
    }

    private fieldFlax(): Loc[] {
        return Locs.query()
            .name(FLAX)
            .action(PICK_OP)
            .where(l => l.tile().distanceTo(FLAX_FIELD) <= FIELD_SCOPE)
            .results();
    }

    private reachableSorted(flax: Loc[], me: { x: number; z: number; level: number }): Loc[] {
        const reachable = flax.filter(f =>
            Reachability.canReach(f.tile(), { adjacentOk: true, maxSteps: 400 }),
        );
        reachable.sort((a, b) => a.tile().distanceTo(me) - b.tile().distanceTo(me));
        return reachable;
    }

    /**
     * Prefer sticky target, then local plants, then nearest reachable in the field.
     * Avoids thrashing across the field as plants respawn.
     */
    nearestFlax(): Loc | null {
        const me = Game.tile();
        const all = this.fieldFlax();
        if (all.length === 0) {
            this.stickyFlax = null;
            return null;
        }
        if (!me) return all[0] ?? null;

        if (this.stickyFlax && this.flaxStillAt(this.stickyFlax)) {
            const sticky = this.flaxLocAt(this.stickyFlax.x, this.stickyFlax.z, this.stickyFlax.level);
            if (sticky && Reachability.canReach(sticky.tile(), { adjacentOk: true, maxSteps: 400 })) {
                return sticky;
            }
        }

        const reachable = this.reachableSorted(all, me);
        if (reachable.length === 0) {
            this.stickyFlax = null;
            return null;
        }

        const local = reachable.filter(f => f.tile().distanceTo(me) <= LOCAL_PICK_RADIUS);
        const pick = local[0] ?? reachable[0];
        const t = pick.tile();
        this.stickyFlax = new Tile(t.x, t.z, t.level);
        return pick;
    }

    clearStickyFlax(): void {
        this.stickyFlax = null;
    }

    private pocketTiles(cap: number): { x: number; z: number }[] {
        const me = Game.tile();
        if (!me) return [];
        const level = me.level;
        const key = (x: number, z: number): string => `${x},${z}`;
        const seen = new Set<string>([key(me.x, me.z)]);
        const out: { x: number; z: number }[] = [{ x: me.x, z: me.z }];
        const queue: { x: number; z: number }[] = [{ x: me.x, z: me.z }];
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        while (queue.length > 0 && out.length < cap) {
            const cur = queue.shift()!;
            const from = { x: cur.x, z: cur.z, level };
            for (const [dx, dz] of dirs) {
                const nx = cur.x + dx, nz = cur.z + dz, k = key(nx, nz);
                if (seen.has(k) || !Reachability.canStep(from, { x: nx, z: nz, level })) continue;
                seen.add(k);
                out.push({ x: nx, z: nz });
                queue.push({ x: nx, z: nz });
            }
        }
        return out;
    }

    private boundaryFlax(pocket: { x: number; z: number }[]): Loc[] {
        const level = Game.tile()?.level ?? 0;
        const inPocket = new Set(pocket.map(t => `${t.x},${t.z}`));
        const seen = new Set<string>();
        const walls: Loc[] = [];
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const p of pocket) {
            for (const [dx, dz] of dirs) {
                const nx = p.x + dx, nz = p.z + dz, k = `${nx},${nz}`;
                if (inPocket.has(k) || seen.has(k)) continue;
                seen.add(k);
                const flax = this.flaxLocAt(nx, nz, level);
                if (flax) walls.push(flax);
            }
        }
        return walls;
    }

    /**
     * Full pack (or delivering) and reachable ground is a small pocket walled by flax.
     * 2004 flax is solid collision — the runner can be sealed in as plants respawn.
     */
    boxedByFlax(): boolean {
        if (!this.atField()) return false;
        if (!Inventory.isFull() && !this.readyToDeliver()) return false;
        const pocket = this.pocketTiles(POCKET_CAP);
        return pocket.length < POCKET_CAP && this.boundaryFlax(pocket).length > 0;
    }

    private async dropFlax(n: number): Promise<void> {
        for (let i = 0; i < n; i++) {
            const flax = Inventory.items().find(it => this.isFlax(it.name));
            if (!flax) return;
            const before = flaxCount();
            if (!(await flax.interact('Drop'))) return;
            await Execution.delayUntilTicks(() => flaxCount() < before, 4);
        }
    }

    async carveOut(): Promise<void> {
        this.setStatus('boxed in by flax — carving a way out');
        this.log(`boxed in by flax — dropping ${CARVE_DROP} flax to pick a path toward the gate`);
        this.clearStickyFlax();
        await this.dropFlax(CARVE_DROP);
        for (let n = 0; n < 20; n++) {
            if (ChatDialog.canContinue() || EventSignal.pending()) return;
            const pocket = this.pocketTiles(POCKET_CAP);
            if (pocket.length >= POCKET_CAP) {
                this.log('carved back out to open ground');
                return;
            }
            const walls = this.boundaryFlax(pocket);
            if (walls.length === 0) return; // map wall, not flax
            if (Inventory.isFull()) await this.dropFlax(CARVE_DROP);
            const target = walls.sort(
                (a, b) => a.tile().distanceTo(FLAX_GATE) - b.tile().distanceTo(FLAX_GATE),
            )[0];
            const t = target.tile();
            if (!(await target.interact(PICK_OP))) {
                await Execution.delayTicks(2);
                continue;
            }
            await Execution.delayUntilTicks(() => !this.flaxStillAt(t), 7);
        }
    }

    nearestPartner(): Player | null {
        if (!this.partner) return null;
        return Players.query().name(this.partner).nearest();
    }

    setStatus(s: string): void { this.status = s; }
    countTrip(): void { this.trips++; }
    countDelivered(n: number): void { this.delivered += n; }
    countSpun(n: number): void { this.spun += n; }
}

// --- Runner tasks ---

class EscapeFlaxTrap implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        return this.bot.boxedByFlax();
    }
    async execute(): Promise<void> {
        await this.bot.carveOut();
    }
}

class BankJunk implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        return this.bot.needsJunkBank();
    }
    async execute(): Promise<void> {
        await this.bot.bankNonFlax();
    }
}

class OfferTrade implements Task {
    private partnerWait = 0;
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        return Trade.active();
    }
    async execute(): Promise<void> {
        await driveActivePartnerTrade({
            role: 'giver',
            partners: [this.bot.getPartner()],
            theirProductMatch: () => false,
            // Empty list declines "nothing to offer" instead of thrashing offerAll on 0 flax.
            productNamesToOffer: () => (flaxCount() > 0 ? [FLAX] : []),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            inventoryMetric: () => flaxCount(),
            verifyGiverPartner: true,
            myOfferReady: () => flaxUnitsInOffer(Trade.myOffer()) > 0,
            onMissingPartner: () => {
                this.partnerWait++;
                if (this.partnerWait > 8) {
                    this.partnerWait = 0;
                    return 'decline';
                }
                return 'wait';
            },
            onDecline: () => {
                this.bot.noteTradeFailed();
            },
            onComplete: delta => {
                // Giver: flax leaves pack → delta is negative when metric is flax count.
                const gone = -delta;
                if (gone > 0) {
                    this.bot.countDelivered(gone);
                    this.bot.countTrip();
                    this.bot.noteTradeOk();
                    this.bot.log(`delivered ${gone} flax to spinner`);
                } else {
                    this.bot.noteTradeFailed();
                    this.bot.log('trade closed without delivering flax — backing off before re-request');
                }
            },
            labels: {
                confirming: 'confirming trade with spinner',
                waitHeader: 'reading trade partner',
                offering: 'offering flax to spinner',
                acceptingOffer: 'accepting trade offer',
                declining: 'declining trade'
            }
        });
        // Reset wait counter once a partner header is present.
        if (Trade.partner() !== null) {
            this.partnerWait = 0;
        }
        if (!Trade.active()) {
            this.partnerWait = 0;
        }
    }
}

class WaitAndTrade implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        if (!this.bot.readyToDeliver()) return false;
        if (!this.bot.canRequestTrade()) return false;
        return this.bot.atMeet();
    }
    async execute(): Promise<void> {
        const partner = this.bot.nearestPartner();
        if (!partner || partner.distance() > TRADE_RANGE) {
            this.bot.setStatus('waiting for spinner to arrive');
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus('requesting trade with spinner');
        this.bot.noteTradeRequest();
        await Trade.request(this.bot.getPartner());
        // Wall-clock: mutual Trade-with needs both players; tick waits shrink under speed 300.
        await Execution.delayUntil(() => Trade.active() || EventSignal.pending(), 5_000);
    }
}

class GoToMeet implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (Trade.active()) return false;
        const here = Game.tile();
        if (!here) return false;
        // Match atMeet / TRADE_RANGE — previously d<=1 fought WaitAndTrade at d=2.
        if (this.bot.atMeet()) return false;
        // Runner only leaves the field when the pack is ready to hand off.
        if (this.bot.getMode() === 'Runner') return this.bot.readyToDeliver();
        // Spinner: clear pack first (BankStrings), then meet only when empty.
        if (this.bot.getMode() === 'Spinner') {
            if (this.bot.spinnerNeedsBank()) return false;
            return this.bot.spinnerReadyForHandoff();
        }
        return true;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('travelling to meet point');
        this.bot.clearStickyFlax();
        // Outside the wheel house (east of the door) so a closed door cannot
        // trap partners mid-handoff. Nav opens doors when the spinner leaves.
        await Traversal.walkResilient(MEET_TILE, {
            radius: TRADE_RANGE,
            attempts: 6,
            timeoutMs: 240_000,
            log: m => this.bot.log(`  ${m}`),
        });
    }
}

class PickFlax implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        if (!this.bot.needsFlax()) return false;
        return this.bot.atField() && this.bot.nearestFlax() !== null;
    }
    async execute(): Promise<void> {
        for (let n = 0; n < 30 && this.bot.needsFlax(); n++) {
            if (ChatDialog.canContinue() || EventSignal.pending()) return;
            if (this.bot.boxedByFlax()) return;
            const flax = this.bot.nearestFlax();
            if (!flax) return;
            const target = flax.tile();
            this.bot.setStatus(`picking flax at ${target}`);
            const before = flaxCount();
            if (!(await flax.interact(PICK_OP))) {
                await Execution.delayTicks(2);
                continue;
            }
            await Execution.delayUntilTicks(
                () =>
                    flaxCount() > before
                    || Inventory.isFull()
                    || ChatDialog.canContinue()
                    || EventSignal.pending()
                    || !this.bot.flaxStillAt(target),
                10
            );
            if (!this.bot.flaxStillAt(target)) this.bot.clearStickyFlax();
        }
    }
}

class WaitForFlax implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        if (!this.bot.needsFlax()) return false;
        return this.bot.atField() && this.bot.nearestFlax() === null;
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (here && FLAX_FIELD.distanceTo(here) > FIELD_ARRIVE) {
            this.bot.setStatus('moving to field centre for respawns');
            await Traversal.walkResilient(FLAX_FIELD, {
                radius: FIELD_ARRIVE,
                attempts: 3,
                timeoutMs: 60_000,
                log: m => this.bot.log(`  ${m}`),
            });
            return;
        }
        this.bot.setStatus('waiting for flax to respawn');
        this.bot.clearStickyFlax();
        await Execution.delayTicks(2);
    }
}

class GoToField implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Runner') return false;
        if (Trade.active()) return false;
        if (!this.bot.needsFlax()) return false;
        return !this.bot.atField();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('travelling to the flax field');
        this.bot.clearStickyFlax();
        await Traversal.walkResilient(FLAX_FIELD, {
            radius: FIELD_ARRIVE,
            attempts: 6,
            timeoutMs: 240_000,
            log: m => this.bot.log(`  ${m}`),
        });
    }
}

// --- Spinner tasks ---

class RequestTrade implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        // Empty pack only — junk/strings must bank first or the runner's full
        // offer cannot land and both sides re-trade forever.
        if (!this.bot.spinnerReadyForHandoff()) return false;
        if (!this.bot.canRequestTrade()) return false;
        return this.bot.atMeet();
    }
    async execute(): Promise<void> {
        const partner = this.bot.nearestPartner();
        if (!partner || partner.distance() > TRADE_RANGE) {
            this.bot.setStatus('waiting for runner to arrive');
            await Execution.delayTicks(2);
            return;
        }
        // 2004 needs both players to click Trade; stagger spinner slightly so
        // both bots don't hammer request every loop (opens/closes thrash).
        this.bot.setStatus('requesting trade from runner');
        this.bot.noteTradeRequest();
        await Trade.request(this.bot.getPartner());
        // Wall-clock: mutual Trade-with needs both players; tick waits shrink under speed 300.
        await Execution.delayUntil(() => Trade.active() || EventSignal.pending(), 5_000);
    }
}

class HandleTrade implements Task {
    private pending = 0;
    private partnerWait = 0;
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        return Trade.active();
    }
    async execute(): Promise<void> {
        // Stamp pending only when we are about to accept (product + room).
        if (Trade.onOfferScreen() && Trade.partner() !== null) {
            const theirFlax = flaxUnitsInOffer(Trade.theirOffer());
            if (theirFlax > 0 && canReceiveFlaxOffer(Inventory.free(), theirFlax)) {
                this.pending = theirFlax;
            }
        }
        try {
            await driveActivePartnerTrade({
                role: 'receiver',
                partners: [this.bot.getPartner()],
                theirProductMatch: n => (n ?? '').toLowerCase().includes(FLAX.toLowerCase()),
                productNamesToOffer: () => [],
                setStatus: s => this.bot.setStatus(s),
                log: m => this.bot.log(m),
                inventoryMetric: () => flaxCount(),
                onMissingPartner: () => {
                    this.partnerWait++;
                    if (this.partnerWait > 8) {
                        this.partnerWait = 0;
                        return 'decline';
                    }
                    return 'wait';
                },
                receiverCanAccept: theirFlax => {
                    if (canReceiveFlaxOffer(Inventory.free(), theirFlax)) {
                        return true;
                    }
                    return {
                        ok: false,
                        reason:
                            `cannot take ${theirFlax} flax — only ${Inventory.free()} free slot(s) `
                            + '(random-event junk?). Declining and banking.'
                    };
                },
                onDecline: () => {
                    this.bot.noteTradeFailed();
                    this.pending = 0;
                },
                onComplete: delta => {
                    // Prefer live metric; pending only as lag fallback when flax is actually held.
                    const liveGain = delta > 0 ? delta : 0;
                    const held = flaxCount();
                    const gained =
                        liveGain > 0
                            ? liveGain
                            : held > 0 && this.pending > 0
                                ? this.pending
                                : 0;
                    if (gained > 0) {
                        this.bot.log(`received ${gained} flax from runner`);
                        this.bot.noteTradeOk();
                    } else {
                        this.bot.noteTradeFailed();
                        this.bot.log('trade closed without receiving flax — backing off before re-request');
                    }
                    this.pending = 0;
                },
                labels: {
                    confirming: 'confirming trade',
                    waitHeader: 'reading trade partner',
                    waitOffer: 'waiting for runner to offer flax',
                    accepting: 'accepting flax from runner',
                    declining: 'declining trade'
                }
            });
        } finally {
            // Confirm timeout / external cancel never hits onDecline or onComplete.
            if (!Trade.active()) {
                this.pending = 0;
                this.partnerWait = 0;
            } else if (Trade.partner() !== null) {
                this.partnerWait = 0;
            }
        }
    }
}

class SpinFlax implements Task {
    private spinningUntilTick = 0;
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (Game.tick() < this.spinningUntilTick) return false;
        if (flaxCount() === 0) return false;
        return this.bot.onFloor(1);
    }
    async execute(): Promise<void> {
        if (Game.animating() && !ChatDialog.isMakeMenu()) {
            await this.ride();
            return;
        }
        if (!ChatDialog.isMakeMenu()) {
            const wheel = Locs.query()
                .name(SPINNING_WHEEL)
                .action(SPIN_OP)
                .where(l => l.tile().distanceTo(SPINNING_WHEEL_AREA) <= LEASH)
                .nearest();
            if (!wheel) { await Execution.delayTicks(2); return; }
            this.bot.setStatus('opening the spinning wheel');
            if (!(await wheel.interact(SPIN_OP))) { await Execution.delayTicks(2); return; }
            if (!(await Execution.delayUntilTicks(
                () => ChatDialog.isMakeMenu() || ChatDialog.canContinue() || Game.animating(),
                10
            ))) {
                return;
            }
        }
        if (ChatDialog.isMakeMenu()) {
            if (!(await ChatDialog.makeX(FLAX, flaxCount()))) {
                this.bot.log(`Spin menu open but couldn't Make-X '${FLAX}' — products: [${ChatDialog.makeProducts().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }
        }
        await this.ride();
    }

    private async ride(): Promise<void> {
        this.bot.setStatus('spinning');
        let last = flaxCount();
        let idle = 0;
        while (flaxCount() > 0) {
            if (ChatDialog.canContinue() || EventSignal.pending() || !this.bot.onFloor(1)) return;
            await Execution.delayTicks(1);
            const now = flaxCount();
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

/**
 * Spinner pack clear before handoff / after spinning.
 * Previously only ran when bow strings were held — random-event garbage alone
 * left the spinner at the meet with no free slots, so the runner's full flax
 * offer could never land and both sides re-traded forever.
 */
class BankStrings implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        return this.bot.spinnerNeedsBank();
    }
    async execute(): Promise<void> {
        const strings = bowStringCount();
        const used = Inventory.used();
        this.bot.setStatus(
            strings > 0 ? 'banking bow strings' : 'banking junk before handoff'
        );
        this.bot.log(
            `spinner banking pack (${used} slot(s) used, ${strings} string(s), `
            + `${flaxCount()} flax) so the next trade can take a full flax load`
        );
        await Traversal.walkResilient(BANK_ENTRANCE, {
            radius: 3,
            attempts: 4,
            timeoutMs: 120_000,
            log: m => this.bot.log(`  ${m}`),
        });
        await Bank.openBooth(
            { x: BANK_STAND.x, z: BANK_STAND.z, level: BANK_STAND.level },
            BOOTH_NAME,
            BOOTH.op,
            m => this.bot.log(`  ${m}`),
        );
        // Deposit everything — strings, leftover fibre, and random-event trash.
        await Bank.depositInventory();
        await Bank.close();
        if (strings > 0) {
            this.bot.countTrip();
        }
    }
}

class ClimbDown implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (!this.bot.onFloor(1)) return false;
        return flaxCount() === 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading back down');
        await climbLadder(LADDER_NAME, CLIMB_DOWN, m => this.bot.log(`  ${m}`));
    }
}

class ClimbUp implements Task {
    constructor(private bot: FlaxRunner) {}
    validate(): boolean {
        if (this.bot.getMode() !== 'Spinner') return false;
        if (Trade.active()) return false;
        if (this.bot.onFloor(1)) return false;
        return flaxCount() > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading up to the wheel');
        const ladder = Locs.query().name(LADDER_NAME).action(CLIMB_UP).nearest();
        if (!ladder || ladder.distance() > 1) {
            await walkOpening(
                LADDER_TILE,
                1,
                ['door'],
                m => this.bot.log(m),
            );
        }
        await climbLadder(LADDER_NAME, CLIMB_UP, m => this.bot.log(`  ${m}`));
    }
}
