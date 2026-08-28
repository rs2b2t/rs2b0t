import { reader } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import {
    LOG_LEVELS,
    NoLightTiles,
    TINDERBOX,
    findBurnLane,
    fireReactionTicks,
    tileKey,
    type FirePlot
} from '../../api/firemaking/Firemaking.js';
import { lightFire } from '../../api/firemaking/LightFire.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { COOK_LOCATION_OPTIONS, resolveCookLocation } from '../../api/cooking/CookLocations.js';
import { CUSTOM_LOCATION, MAX_SURFACE_CHEB, type CookLocation } from '../../data/cookLocations.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { walkOpening } from '../../event/webwalk/walkOpening.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    SURFACE_OPTIONS,
    canCook,
    cookKeepNames,
    countRaw,
    firePlotFor,
    lastRawIndex,
    logsToWithdraw,
    needsBank,
    needsLight,
    parseSurfaceMode,
    type CookState,
    type CookSurfaceMode
} from './CookBotLogic.js';

const DEFAULT_BANK_STAND = new Tile(2809, 3441, 0);
const DEFAULT_RANGE_STAND = new Tile(2817, 3443, 0);
const BOOTH = { op: 'Use-quickly' };

/** How close a lit Fire counts as the one to cook on. */
const FIRE_REACH = 2;

export const SETTINGS: SettingsSchema = {
    fish: { type: 'string', default: 'Raw salmon', label: 'Raw fish to cook (contains)', help: 'e.g. Raw salmon / Raw shark / Raw lobster' },
    location: {
        type: 'string',
        default: 'Catherby',
        options: [...COOK_LOCATION_OPTIONS],
        label: 'Where to cook',
        help: 'Auto takes the nearest bank you can open. Custom uses the tiles below.'
    },
    surface: {
        type: 'string',
        default: 'Range',
        options: [...SURFACE_OPTIONS],
        label: 'Cook on',
        help: 'Range walks to the oven or fireplace nearest the bank. Fire carries one log out to free ground beside the bank, lights it, and cooks there, which no closed door can reach.'
    },
    logType: { type: 'string', default: 'Logs', options: Object.keys(LOG_LEVELS), label: 'Logs to burn (Fire only)' },
    firePlotRadius: { type: 'number', default: 8, min: 2, max: 16, label: 'Fire ground search radius (Fire only)' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (Custom only)' },
    rangeStand: { type: 'tile', default: DEFAULT_RANGE_STAND, label: 'Range stand tile (Custom only)' },
    rangeName: { type: 'string', default: 'Range', label: 'Range loc name (Custom only)' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'doors on the way to the bank or the range get opened' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 20, label: 'Cook surface search radius (tiles)' }
};

export default class CookBot extends TaskBot {
    override loopDelay = 600;

    private cooked = 0;
    private trips = 0;
    private fires = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private fish = 'Raw salmon';
    private mode: CookSurfaceMode = 'range';
    private where: CookLocation | null = null;
    private whereName = 'Custom';
    private bankStand = DEFAULT_BANK_STAND;
    private surfaceStand = DEFAULT_RANGE_STAND;
    private surfaceApproach: Tile | null = null;
    private surfaceName = 'Range';
    private arriveRadius = 0;
    private logName = 'Logs';
    private plotHalf = 8;
    private boothName = 'Bank booth';
    private obstacle: string[] = ['door', 'gate'];
    private leash = 8;
    private readonly noLight = new NoLightTiles();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.fish = this.settings.str('fish', 'Raw salmon');
        this.mode = parseSurfaceMode(this.settings.str('surface', 'Range'));
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.obstacle = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 8);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('cooking');

        if (!this.resolveWhere() || !this.resolveSurface()) {
            return;
        }
        this.log(
            `CookBot cooking '${this.fish}' at ${this.whereName}, `
                + (this.mode === 'fire'
                    ? `${this.logName} fires beside the bank ${this.bankStand}`
                    : `${this.surfaceName} ${this.surfaceStand}`)
        );
        this.add(new ContinueDialog(), new CookDialog(this), new BankTrip(this), new LightTrip(this), new CookTrip(this));
    }

    private resolveWhere(): boolean {
        const setting = this.settings.str('location', 'Catherby');
        const custom = setting.trim().toLowerCase() === CUSTOM_LOCATION.toLowerCase();
        this.where = custom ? null : resolveCookLocation(setting, Game.tile()!);
        if (!custom && !this.where) {
            ScriptRunner.stop(`no bank called '${setting}' that this account can open`);
            return false;
        }
        this.whereName = this.where?.name ?? CUSTOM_LOCATION;
        this.bankStand = this.where?.bank.tile ?? this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        return true;
    }

    private resolveSurface(): boolean {
        if (this.mode === 'fire') {
            this.surfaceName = 'Fire';
            this.logName = this.settings.str('logType', 'Logs');
            this.plotHalf = this.settings.num('firePlotRadius', 8);
            const need = LOG_LEVELS[this.logName];
            const have = Skills.level('firemaking');
            if (need === undefined) {
                ScriptRunner.stop(`unknown logType '${this.logName}'`);
                return false;
            }
            if (have < need) {
                ScriptRunner.stop(`${this.logName} need Firemaking ${need}, you have ${have}`);
                return false;
            }
            return true;
        }
        const plan = this.where?.surface ?? null;
        if (this.where && !plan) {
            ScriptRunner.stop(
                `nothing cookable within ${MAX_SURFACE_CHEB} tiles of the ${this.where.name} bank, set 'Cook on' to Fire`
            );
            return false;
        }
        this.surfaceStand = plan?.stand ?? this.settings.tile('rangeStand', DEFAULT_RANGE_STAND);
        this.surfaceApproach = plan?.approach ?? null;
        this.surfaceName = plan?.locName ?? this.settings.str('rangeName', 'Range');
        this.arriveRadius = plan?.arriveRadius ?? 0;
        return true;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffd479' });
        p.title(`CookBot — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('cooking') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Cooked: ${this.cooked}`, `XP/hr: ${xph}`);
        p.row(`Cooking: ${this.fish}`, `Raw left: ${this.rawCount()}`, `Bank trips: ${this.trips}`);
        p.row(
            `At: ${this.whereName}`,
            this.mode === 'fire' ? `Fires: ${this.fires}` : `On: ${this.surfaceName}`,
            this.mode === 'fire' ? `Logs: ${this.logCount()}` : `Stand: ${this.surfaceStand.x},${this.surfaceStand.z}`
        );

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordCook(n: number): void { this.cooked += n; }
    recordFire(): void { this.fires++; }
    countTrip(): void { this.trips++; }
    fishName(): string { return this.fish; }
    surfaceLocName(): string { return this.surfaceName; }
    surfaceMode(): CookSurfaceMode { return this.mode; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }
    bankTile(): Tile { return this.bankStand; }
    bankPlace(): CookLocation | null { return this.where; }
    whereLabel(): string { return this.whereName; }
    surfaceTile(): Tile { return this.surfaceStand; }
    surfaceApproachTile(): Tile | null { return this.surfaceApproach; }
    surfaceArriveRadius(): number { return this.arriveRadius; }
    boothLocName(): string { return this.boothName; }
    logLocName(): string { return this.logName; }
    firePlotHalf(): number { return this.plotHalf; }
    firePlot(): FirePlot { return firePlotFor(this.whereName, this.bankStand, this.plotHalf); }
    refusedTiles(): NoLightTiles { return this.noLight; }
    rawCount(): number { return countRaw(Inventory.items(), this.fish); }
    logCount(): number { return this.mode === 'fire' ? Inventory.count(this.logName) : 0; }

    /** A Fire close enough to cook on, or null in Range mode. */
    litFire() {
        const here = Game.tile();
        if (this.mode !== 'fire' || !here) {
            return null;
        }
        return Locs.query().name('Fire').withinOf(here, FIRE_REACH).nearest();
    }

    state(): CookState {
        return {
            mode: this.mode,
            rawLeft: this.rawCount(),
            logsLeft: this.logCount(),
            fireLit: this.litFire() !== null
        };
    }

    lastRaw() {
        const items = Inventory.items();
        const idx = lastRawIndex(items, this.fish);
        return idx >= 0 ? items[idx] : null;
    }
}

class CookDialog implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return ChatDialog.isMakeMenu(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing product');
        if (!(await ChatDialog.make(this.bot.fishName()))) {
            await ChatDialog.make();
        }
        await Execution.delayTicks(1);
    }
}

class BankTrip implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return needsBank(this.bot.state()); }

    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await this.open())) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        const fire = this.bot.surfaceMode() === 'fire';
        await Bank.depositAllMatching(
            depositAllExcept(cookKeepNames(this.bot.surfaceMode(), TINDERBOX, this.bot.logLocName()))
        );
        await Execution.delayTicks(1);
        this.bot.countTrip();
        if (fire && !(await this.stockFire())) {
            return;
        }

        const pat = this.bot.fishName().toLowerCase();
        const fishItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(pat));
        if (!fishItem || fishItem.name === null) {
            this.bot.log(`no '${this.bot.fishName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const bankName = fishItem.name;
        this.bot.log(`withdrawing ${bankName}`);
        if (!(await Bank.withdrawLoad(bankName))) {
            this.bot.log(`could not withdraw ${bankName} — will retry`);
        }
    }

    /** Bank booth, chest or teller, whichever this location uses. */
    private async open(): Promise<boolean> {
        const log = (m: string): void => this.bot.log(`  ${m}`);
        const bank = this.bot.bankPlace()?.bank;
        if (bank?.npcAccess) {
            return Bank.openNpcAccess(bank.npcAccess, log);
        }
        if (bank?.access) {
            return Bank.openNearestAccess(bank.access, log);
        }
        return Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, log);
    }

    /** Tinderbox plus logs, before the fish claim the rest of the pack. */
    private async stockFire(): Promise<boolean> {
        if (Inventory.count(TINDERBOX) === 0) {
            await Bank.withdraw(TINDERBOX);
            if (!(await Execution.delayUntilTicks(() => Inventory.count(TINDERBOX) > 0, 5))) {
                ScriptRunner.stop('no tinderbox in the bank or pack');
                return false;
            }
        }
        const logName = this.bot.logLocName();
        const want = logsToWithdraw('fire', Inventory.count(logName));
        if (want > 0 && !(await Bank.withdrawX(logName, want))) {
            this.bot.log(`could not withdraw ${logName} — will retry`);
        }
        if (Inventory.count(logName) === 0) {
            ScriptRunner.stop(`no ${logName} left in the bank`);
            return false;
        }
        return true;
    }
}

class LightTrip implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return needsLight(this.bot.state()); }

    async execute(): Promise<void> {
        const refused = this.bot.refusedTiles();
        const plot = this.bot.firePlot();
        const occupied = refused.merge(reader.locs().map(l => tileKey(l.tile)));
        const lane = findBurnLane(
            plot,
            Game.tile()!,
            occupied,
            1,
            t => Reachability.walkable(t),
            (a, b) => Reachability.canStep(a, b)
        );
        if (!lane) {
            const ruled = refused.size > 0 ? ` (${refused.size} tiles refused a light)` : '';
            this.bot.log(`no free ground left in the ${this.bot.whereLabel()} burn plot${ruled} — waiting for fires to burn out`);
            this.bot.setStatus('waiting for clear ground');
            await Execution.delayTicks(25);
            return;
        }

        this.bot.setStatus(`walking out to ${lane.start.x},${lane.start.z}`);
        await walkOpening(lane.start, 0, this.bot.obstacleList(), m => this.bot.log(m));
        const at = Game.tile();
        if (!at || at.x !== lane.start.x || at.z !== lane.start.z || at.level !== lane.start.level) {
            // Why: ruling the tile out stops the next scan handing back the one we failed to reach.
            refused.add(lane.start);
            this.bot.log(`stopped at ${at?.x},${at?.z} short of ${lane.start.x},${lane.start.z} — ruling it out`);
            return;
        }

        this.bot.setStatus('lighting a fire');
        const outcome = await lightFire(this.bot.logLocName());
        if (outcome === 'lit') {
            this.bot.recordFire();
            await Execution.delayTicks(fireReactionTicks());
            return;
        }
        if (outcome === 'blocked') {
            refused.add(at);
            this.bot.log(`${at.x},${at.z} will not take a fire — ${refused.size} tiles ruled out so far`);
        }
    }
}

class CookTrip implements Task {
    constructor(private bot: CookBot) {}
    validate(): boolean { return canCook(this.bot.state()) && !ChatDialog.isOpen(); }

    async execute(): Promise<void> {
        if (this.bot.surfaceMode() === 'range' && !(await this.reachRange())) {
            return;
        }
        for (let n = 0; n < 30 && this.bot.rawCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            if (EventSignal.pending()) { return; }
            const raw = this.bot.lastRaw();
            const oven = this.surface();
            if (!raw || !oven) { await Execution.delayTicks(2); return; }
            this.bot.setStatus(`cooking ${raw.name}`);
            const before = this.bot.rawCount();
            if (!(await raw.useOn(oven))) { await Execution.delayTicks(2); continue; }
            if (await Execution.delayUntil(() => this.bot.rawCount() < before || ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 6000)) {
                if (this.bot.rawCount() < before) { this.bot.recordCook(before - this.bot.rawCount()); }
            }
        }
    }

    private surface() {
        if (this.bot.surfaceMode() === 'fire') {
            return this.bot.litFire();
        }
        return Locs.query().name(this.bot.surfaceLocName()).withinOf(this.bot.surfaceTile(), this.bot.leashRadius()).nearest();
    }

    private async reachRange(): Promise<boolean> {
        const here = Game.tile();
        const radius = this.bot.surfaceArriveRadius();
        if (here && this.bot.surfaceTile().distanceTo(here) <= Math.max(radius, 1) && this.surface()) {
            return true;
        }
        this.bot.setStatus(`crossing to the ${this.bot.surfaceLocName().toLowerCase()}`);
        const approach = this.bot.surfaceApproachTile();
        if (approach) {
            await walkOpening(approach, 0, this.bot.obstacleList(), m => this.bot.log(m));
        }
        await walkOpening(this.bot.surfaceTile(), radius, this.bot.obstacleList(), m => this.bot.log(m));
        return true;
    }
}
