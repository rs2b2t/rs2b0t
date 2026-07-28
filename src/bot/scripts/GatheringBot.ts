import { createReturnToAnchorTask, resolveRunAnchor, tileWithinLeash } from '../api/Anchor.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Bank, withdrawOp } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { walkOpening } from '../api/walkOpening.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { resolveLocation, type FishingLocation } from './FishingLocations.js';
import { BROKEN_PICKAXE, GAS_ROCK_IDS, GAS_ROCK_TICKS, ROCK_OPTIONS, resolveRockIds } from './MiningRocks.js';
import {
    TINDERBOX,
    firemakingLevelForLogs,
    logsForTree,
    nearestFireSpot,
    parseBurnMode,
    resolveFireSpot,
    shouldBurnFullLoad,
    type BurnMode,
    type FirePlot
} from './FiremakingLogic.js';
import {
    axeReq,
    bestPickaxe,
    hasAllTools,
    missingToolLabels,
    pickaxeReq,
    tinderboxReq,
    toolKeepNames,
    toolKitLabel,
    toolRestockPlan,
    type ToolReq
} from './Tools.js';
import { createChopBurnTasks } from './ChopBurnTasks.js';
import {
    FISHING_METHOD_OPTIONS,
    WHIRLPOOL_IDS,
    fishingRestockPlan,
    gearKeepNames,
    gearLabel as formatGearLabel,
    hasFishingGear,
    missingFishingGear,
    resolveFishMethod,
    spotMatchesMethod,
    type FishingMethod
} from './FishingMethods.js';
import {
    bankHumanDelayMs,
    cookBatchAfterLoad,
    cookFilterLabel,
    cookHumanDelayMs,
    countRawInBank,
    isBurntFishName,
    isCookedFishName,
    isRawFishName,
    lastMatchingIndex,
    parseAfterCookCycle,
    parseBurntPolicy,
    parseCookMode,
    parsePositiveInt,
    rawMatchesCookFilter,
    resolveCookFishFilter,
    shouldCookThenBank,
    shouldStartBankRawCookBatch,
    type AfterCookCycle,
    type BurntPolicy,
    type CookMode
} from './FishCookLogic.js';
import { Banking, depositAllExcept } from '../api/Banking.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

export const GATHERING_SETTINGS: SettingsSchema = {
    targetType: { type: 'string', default: 'loc', label: "Target type ('loc' or 'npc')", help: 'loc = scenery (rocks/trees), npc = fishing spots' },
    target: { type: 'string', default: 'Rocks', label: 'Target name', help: 'in-game name, e.g. Rocks / Tree / Fishing spot' },
    action: { type: 'string', default: 'Mine', label: 'Action', help: 'right-click op, e.g. Mine / Chop down / Net' },
    dropMatch: { type: 'string', default: 'ore', label: 'Drop items containing', help: 'when full, drop items whose name contains this (the gathered product)' },
    leashRadius: { type: 'number', default: 10, min: 2, max: 30, label: 'Leash radius (tiles)' }
};

/** Interrupt an active gather wait so the Supervisor / bank / dialog tasks can run. */
export function shouldYieldGathering(
    eventPending: boolean,
    inventoryFull: boolean,
    dialogPending: boolean,
    targetGone: boolean,
    inCombat = false
): boolean {
    return eventPending || inventoryFull || dialogPending || targetGone || inCombat;
}

/**
 * Fishing-session end conditions while we believe we are still on a spot.
 * Spot hop / whirlpool swap / combat / event must break the wait even if the
 * player anim is still playing (harpoon anims linger between catches).
 */
export function fishingSessionBroken(opts: {
    eventPending: boolean;
    inventoryFull: boolean;
    dialogPending: boolean;
    inCombat: boolean;
    spotGone: boolean;
    spotMoved: boolean;
    becameWhirlpool: boolean;
}): boolean {
    return (
        opts.eventPending ||
        opts.inventoryFull ||
        opts.dialogPending ||
        opts.inCombat ||
        opts.spotGone ||
        opts.spotMoved ||
        opts.becameWhirlpool
    );
}

export default class GatheringBot extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private gathered = 0;
    private gems = 0;
    private cooked = 0;
    private status = 'starting';
    private location: FishingLocation | null = null;
    private banked = 0;
    private trips = 0;
    private startedAt = Date.now();

    private targetType = 'loc';
    private target = 'Rocks';
    private action = 'Mine';
    private pairOp = '';
    private dropMatch = 'ore';
    private leash = 10;

    private rockIds = new Set<number>();
    private productKeywords: string[] = [];
    private gearKeep: string[] = [];
    private fishMethod: FishingMethod | null = null;
    private fishing = false;
    private chopping = false;
    /** Declared tools for this run (ladders + exact). gearKeep is derived. */
    private toolReqs: ToolReq[] = [];

    private cookMode: CookMode = 'off';
    private burntPolicy: BurntPolicy = 'drop';
    private afterCook: AfterCookCycle = 'stop';
    private bankRawTarget = 56;
    /**
     * Live bank total of cook-filter raw fish (Bank API after deposit/withdraw).
     * Painted as Bank raw: X/N when bank-raw-then-cook is on.
     */
    private bankRawInBank = 0;
    /** Contains-filter for which raw fish to cook (empty = all raw). */
    private cookFishFilter = '';
    /** True while a cook load is in progress (raw still on person). */
    private cookingLoad = false;
    /**
     * Sticky cook-batch phase for bank-raw-then-cook.
     * Armed when bank raw ≥ N; stays true through every withdraw/cook/bank
     * load until the bank is drained of cookable raw (even if total drops
     * below N after the first 28). Prevents thrash: withdraw tools → cook 28
     * → see bank &lt; N → fish again with tools.
     */
    private inCookBatch = false;
    private rangeStand: Tile | null = null;
    private rangeName = 'Range';
    private cookObstacles: string[] = ['door', 'gate'];
    private rangeSearchRadius = 14;
    private powerMode = false;

    private burnMode: BurnMode = 'off';
    private burnPlot: FirePlot | null = null;
    private burnSpotName = '';
    private burnLogs = 'Logs';
    private burningLoad = false;
    private firesLit = 0;
    private burnLaneRemain = 0;

    private rejected = new Set<string>();
    private cooldownUntil = new Map<string, number>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.targetType = this.settings.str('targetType', 'loc').toLowerCase();
        this.target = this.settings.str('target', 'Rocks');
        this.action = this.settings.str('action', 'Mine');
        this.dropMatch = this.settings.str('dropMatch', 'ore').toLowerCase();
        this.leash = this.settings.num('leashRadius', 10);

        if ('rocks' in this.settings.raw()) {
            const chosen = this.settings.list('rocks');
            const rocks = chosen.length > 0 ? chosen : ROCK_OPTIONS;
            this.targetType = 'loc';
            this.target = 'Rocks';
            this.action = 'Mine';
            this.rockIds = resolveRockIds(rocks);
            this.productKeywords = rocks.map(r => r.trim().toLowerCase());
            this.toolReqs = [pickaxeReq()];
        } else if ('fishMethod' in this.settings.raw()) {
            const method = resolveFishMethod(this.settings.str('fishMethod', FISHING_METHOD_OPTIONS[0]));
            this.targetType = 'npc';
            this.target = 'Fishing spot';
            this.action = method.op;
            this.pairOp = method.pair;
            this.fishMethod = method;
            this.fishing = true;
            this.productKeywords = ['raw'];
            this.cookMode = parseCookMode(this.settings.str('cookMode', 'Off'));
            this.burntPolicy = parseBurntPolicy(this.settings.str('burntPolicy', 'Drop'));
            this.afterCook = parseAfterCookCycle(this.settings.str('afterCookCycle', 'Stop'));
            this.bankRawTarget = parsePositiveInt(
                this.settings.raw()['bankRawBeforeCook'] ?? this.settings.num('bankRawBeforeCook', 56),
                56
            );
            this.cookFishFilter = resolveCookFishFilter(
                this.settings.str('cookFish', 'All raw'),
                this.settings.str('cookFishCustom', '')
            );
        } else if ('treeName' in this.settings.raw()) {
            // Woodcutter facade — same engine as Miner/Fisher.
            this.chopping = true;
            this.targetType = 'loc';
            this.target = this.settings.str('treeName', 'Tree');
            this.action = this.settings.str('chopAction', 'Chop down');
            this.dropMatch = 'log';
            this.toolReqs = [axeReq()];
            this.productKeywords = ['log'];
        } else {
            this.productKeywords = [this.dropMatch];
            const act = this.action.toLowerCase();
            const tgt = this.target.toLowerCase();
            if (act.includes('chop') || tgt.includes('tree') || this.dropMatch.includes('log')) {
                this.chopping = true;
                this.targetType = 'loc';
                if (!this.action || this.action === 'Mine') {
                    this.action = 'Chop down';
                }
                this.toolReqs = [axeReq()];
                this.productKeywords = this.dropMatch.includes('log') ? [this.dropMatch] : ['log'];
            } else if (act.includes('mine') || tgt.includes('rock')) {
                this.toolReqs = [pickaxeReq()];
            }
        }

        const here = Game.tile()!;
        const locSetting = this.settings.str('location', 'None');
        this.location = resolveLocation(locSetting, here);

        this.anchor = resolveRunAnchor(new Tile(here.x, here.z, here.level), this.location?.spot ?? null);

        this.powerMode = locSetting.toLowerCase() === 'none';
        if (this.cookMode !== 'off' && this.powerMode) {
            this.log('cook mode needs a bank — location None forces drop-only; cook disabled');
            this.cookMode = 'off';
        }
        if (this.cookMode !== 'off' && this.fishing) {
            this.resolveCookScene();
            if (!this.rangeStand) {
                this.log('cook mode on but no Range found in the scene / location — cook disabled until a range is nearby');
            } else {
                const filterNote = `; cook ${cookFilterLabel(this.cookFishFilter)}`;
                const batchNote =
                    this.cookMode === 'bank-raw-then-cook'
                        ? `; bank ${this.bankRawTarget} raw then cook; after=${this.afterCook}`
                        : '';
                this.log(
                    `cook: ${this.cookMode} @ range ${this.rangeStand} (${this.rangeName}); burnt=${this.burntPolicy}${filterNote}${batchNote}`
                );
            }
        }

        // Chop → burn (Woodcutter): like cook extends fishing, but FM lives in ChopBurnTasks.
        if (this.chopping && 'burnMode' in this.settings.raw()) {
            this.burnMode = parseBurnMode(this.settings.str('burnMode', 'Off'));
            this.burnLogs = logsForTree(this.target);
            if (this.burnMode !== 'off' && this.powerMode) {
                this.log('burn mode needs a bank path / fire plot — location None forces drop-only; burn disabled');
                this.burnMode = 'off';
            }
            if (this.burnMode !== 'off') {
                const needFm = firemakingLevelForLogs(this.burnLogs) ?? 1;
                const haveFm = Skills.level('firemaking');
                if (haveFm < needFm) {
                    this.log(`${this.burnLogs} need Firemaking ${needFm}, you have ${haveFm} — burn disabled`);
                    this.burnMode = 'off';
                } else {
                    const spotSetting = this.settings.str('fireSpot', 'Auto');
                    const resolved =
                        spotSetting.toLowerCase() === 'auto'
                            ? nearestFireSpot(here)
                            : resolveFireSpot(spotSetting);
                    if (!resolved) {
                        this.log(`unknown fire spot '${spotSetting}' — burn disabled`);
                        this.burnMode = 'off';
                    } else {
                        this.burnSpotName = resolved.name;
                        this.burnPlot = resolved.plot;
                        if (!this.toolReqs.some(r => r.kind === 'exact' && r.name === TINDERBOX)) {
                            this.toolReqs = [...this.toolReqs, tinderboxReq()];
                        }
                        this.log(
                            `burn: chop-then-burn ${this.burnLogs} @ ${this.burnSpotName} (need tinderbox + FM ${needFm})`
                        );
                    }
                }
            }
        }

        // Derive deposit keep-list from tool kit + fishing gear names.
        this.gearKeep = this.rebuildGearKeep();

        if (this.location) {
            this.log(`location: ${this.location.name}${locSetting.toLowerCase() === 'auto' ? ' (auto-detected)' : ''} — banking the catch at ${this.location.bankStand}`);
            if (!this.location.verified) {
                this.log(`warning: ${this.location.name} coordinates are UNVERIFIED — watch the first bank run`);
            }
        } else if (!this.powerMode) {
            this.log('no preset location — will web-walk to the nearest bank');
        }
        const pairNote = this.pairOp ? ` + pair '${this.pairOp}'` : '';
        const fullNote =
            this.burnMode === 'chop-then-burn'
                ? 'burning'
                : this.powerMode
                  ? 'dropping'
                  : 'banking';
        this.log(
            `gathering '${this.target}' (${this.action}${pairNote}) within ${this.leash} of ${this.anchor}, ${fullNote} *${this.productLabel()}* when full`
        );

        this.on('inventory.changed', e => {
            if (e.id === -1) {
                return;
            }
            if (this.isProduct(e.name)) {
                this.gathered++;
            } else if (this.mining() && (e.name ?? '').toLowerCase().startsWith('uncut ')) {
                this.gems++;
                this.log(`gem! ${e.name} (${this.gems} this run)`);
            }
        });

        const cookOn = this.fishing && this.cookMode !== 'off' && this.rangeStand !== null;
        const burnOn = this.burnEnabled();
        this.add(
            new ContinueDialog(),
            ...(this.mining() ? [new ReplacePickaxe(this)] : []),
            ...(this.fishing ? [new RestockFishingGear(this)] : []),
            ...((this.mining() || this.woodcutting() || this.toolReqs.length > 0) && !this.fishing
                ? [new RestockGatherTool(this)]
                : []),
            ...(cookOn ? [new FishCookDialog(this), new FishCookLoad(this), new FishBankCooked(this), new FishWithdrawCookBatch(this)] : []),
            ...(burnOn ? createChopBurnTasks(this) : []),
            this.powerMode ? new DropProduct(this) : new BankCatch(this),
            new Gather(this),
            // Shared anchor task — suppress while burning off-leash at a fire plot.
            createReturnToAnchorTask(this, {
                slack: 4,
                suppress: () => this.burnEnabled() && this.isBurningLoad()
            })
        );
    }

    /** Keep-list for depositAllExcept: tool kit names ∪ fishing gear names. */
    private rebuildGearKeep(): string[] {
        const names = new Set<string>(toolKeepNames(this.toolReqs));
        if (this.fishMethod) {
            for (const n of gearKeepNames(this.fishMethod)) {
                names.add(n);
            }
        }
        return [...names];
    }

    /** Open the location bank (or nearest) — single path for all bank tasks. */
    async openScriptBank(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const loc = this.location;
        return Banking.open({
            stand: loc?.bankStand ?? null,
            boothName: loc?.boothName,
            boothOp: loc?.boothOp,
            // Cook scenes often put a door between range and bank; fishing-only
            // locations usually have a clear path (empty obstacles → walkResilient).
            obstacles: this.cookEnabled() ? this.cookObstacles : (loc?.obstacles ?? []),
            log
        });
    }

    private resolveCookScene(): void {
        if (this.location?.rangeStand) {
            this.rangeStand = this.location.rangeStand;
            this.rangeName = this.location.rangeName ?? 'Range';
            this.cookObstacles = this.location.obstacles ?? ['door', 'gate'];
            return;
        }
        // Auto-discover a Range (or Fire) in the loaded scene near the player / bank.
        const range = Locs.query().name('Range', 'Cooking range', 'Fire').nearest();
        if (range) {
            this.rangeStand = range.tile();
            this.rangeName = range.name ?? 'Range';
            this.cookObstacles = this.location?.obstacles ?? ['door', 'gate'];
            this.log(`auto-found cook surface '${this.rangeName}' at ${this.rangeStand}`);
        }
    }

    override recoveryAnchor(): Tile | null {
        return this.anchor;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`Gathering — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const label = this.mining() ? 'Ore' : this.woodcutting() ? 'Logs' : this.target;
        const perHr = mins > 0.5 ? ` (${Math.round((this.gathered / mins) * 60)}/hr)` : '';
        p.row(`Runtime: ${fmtDuration(mins)}`, `${label}: ${this.gathered}${perHr}`, `Inv: ${Inventory.used()}/28`);
        const extras: string[] = [];
        if (this.mining()) {
            extras.push(`Gems: ${this.gems}`);
        }
        if (this.location) {
            extras.push(`Loc: ${this.location.name}`, `Banked: ${this.banked} (${this.trips} trips)`);
        } else if (!this.powerMode && (this.mining() || this.woodcutting() || this.fishing)) {
            extras.push(`Banked: ${this.banked} (${this.trips} trips)`);
        }
        if (this.cookMode !== 'off' && this.fishing) {
            extras.push(`Cooked: ${this.cooked}`, `Mode: ${this.cookMode}`);
            if (this.cookFishFilter) {
                extras.push(`Cook: ${this.cookFishFilter}`);
            }
            if (this.cookMode === 'bank-raw-then-cook') {
                const phase = this.inCookBatch ? (this.cookingLoad ? 'cooking' : 'draining') : 'fishing';
                extras.push(`Bank raw: ${this.bankRawInBank}/${this.bankRawTarget}`, `Batch: ${phase}`);
            }
        }
        if (this.burnMode !== 'off' && this.chopping) {
            extras.push(`Fires: ${this.firesLit}`, `Burn: ${this.burnSpotName || this.burnMode}`);
        }
        if (extras.length > 0) {
            p.row(...extras);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void {
        this.status = s;
    }
    getAnchor(): Tile {
        return this.anchor!;
    }
    leashRadius(): number {
        return this.leash;
    }
    targetName(): string {
        return this.target;
    }
    actionName(): string {
        return this.action;
    }
    isNpc(): boolean {
        return this.targetType === 'npc';
    }
    isFishing(): boolean {
        return this.fishing;
    }
    pairAction(): string {
        return this.pairOp;
    }

    isProduct(name: string | null | undefined): boolean {
        const n = (name ?? '').toLowerCase();
        return this.productKeywords.some(k => n.includes(k));
    }
    matchesRock(id: number): boolean {
        return this.rockIds.size === 0 || this.rockIds.has(id);
    }
    mining(): boolean {
        return this.rockIds.size > 0;
    }
    /** Spot must offer the primary op (+ pair when the method declares one). */
    matchesSpot(actions: readonly string[]): boolean {
        return spotMatchesMethod(actions, { op: this.action, pair: this.pairOp });
    }
    fishMethodDef(): FishingMethod | null {
        return this.fishMethod;
    }
    isPowerMode(): boolean {
        return this.powerMode;
    }
    /** Names held in pack or worn (tools can be equipped). */
    heldItemNames(): string[] {
        return [...Equipment.items(), ...Inventory.items()].map(i => i.name ?? '').filter(n => n.length > 0);
    }
    private heldHas(name: string): boolean {
        const want = name.toLowerCase();
        return this.heldItemNames().some(n => n.toLowerCase() === want);
    }
    woodcutting(): boolean {
        return this.chopping;
    }
    private skillLevel = (skill: string): number => Skills.level(skill);
    /** Count held in pack or worn (tools can be equipped). */
    private heldCount = (name: string): number => {
        const want = name.toLowerCase();
        let n = 0;
        for (const item of Equipment.items()) {
            if ((item.name ?? '').toLowerCase() === want) {
                n += item.count;
            }
        }
        n += Inventory.count(name);
        return n;
    };

    hasGear(): boolean {
        if (this.fishMethod) {
            return hasFishingGear(this.fishMethod, name => Inventory.count(name));
        }
        if (this.toolReqs.length > 0) {
            return hasAllTools(this.toolReqs, this.skillLevel, this.heldCount);
        }
        if (this.gearKeep.length === 0) {
            return true;
        }
        return this.gearKeep.every(g => this.heldHas(g));
    }
    gearLabel(): string {
        if (this.fishMethod) {
            return formatGearLabel(this.fishMethod);
        }
        if (this.toolReqs.length > 0) {
            return toolKitLabel(this.toolReqs, this.skillLevel, this.heldCount);
        }
        return this.gearKeep.join(' + ') || 'gear';
    }
    missingGearNames(): string[] {
        if (this.fishMethod) {
            return missingFishingGear(this.fishMethod, name => Inventory.count(name)).map(g => g.name);
        }
        if (this.toolReqs.length > 0) {
            return missingToolLabels(this.toolReqs, this.skillLevel, this.heldCount);
        }
        if (this.hasGear()) {
            return [];
        }
        return this.gearKeep.filter(g => !this.heldHas(g));
    }
    /** Exact keep-list names for depositAllExcept / restock. */
    gearKeepNamesList(): string[] {
        return this.rebuildGearKeep();
    }
    /** Restock plan for declared toolReqs (pick/axe/tinderbox/…). Bank must be open. */
    gatherToolRestockPlan() {
        return toolRestockPlan(this.toolReqs, this.skillLevel, this.heldCount, name => Bank.count(name));
    }
    toolReqsList(): readonly ToolReq[] {
        return this.toolReqs;
    }

    shouldDeposit(name: string): boolean {
        if (this.gearKeep.length > 0) {
            return depositAllExcept(this.gearKeep)(name);
        }
        if (this.mining()) {
            return this.isProduct(name) || name.toLowerCase().startsWith('uncut ');
        }
        return this.isProduct(name);
    }
    productLabel(): string {
        return this.productKeywords.join('/');
    }

    products() {
        return Inventory.items().filter(i => this.isProduct(i.name));
    }
    hasDepositable(): boolean {
        return Inventory.items().some(i => this.shouldDeposit(i.name ?? ''));
    }
    getLocation(): FishingLocation | null {
        return this.location;
    }
    countTrip(n: number): void {
        this.trips++;
        this.banked += n;
    }

    cookEnabled(): boolean {
        return this.fishing && this.cookMode !== 'off' && this.rangeStand !== null;
    }
    getCookMode(): CookMode {
        return this.cookMode;
    }
    getBurntPolicy(): BurntPolicy {
        return this.burntPolicy;
    }
    getAfterCook(): AfterCookCycle {
        return this.afterCook;
    }
    getBankRawTarget(): number {
        return this.bankRawTarget;
    }
    getBankRawInBank(): number {
        return this.bankRawInBank;
    }
    getCookFishFilter(): string {
        return this.cookFishFilter;
    }
    /**
     * Refresh live bank raw total from Bank API (must be called while bank is open
     * and after Bank.loaded() settles). Arms a sticky cook batch when threshold is met.
     * Does NOT clear an in-progress batch when total drops below N after a withdraw.
     */
    refreshBankRawTotal(): number {
        if (this.cookMode !== 'bank-raw-then-cook') {
            return this.bankRawInBank;
        }
        const total = countRawInBank(Bank.items(), this.cookFishFilter);
        this.bankRawInBank = total;
        // Only arm from fishing→threshold. Once inCookBatch, we drain to 0 regardless of N.
        if (!this.inCookBatch && shouldStartBankRawCookBatch(this.cookMode, total, this.bankRawTarget)) {
            this.inCookBatch = true;
            this.log(
                `bank holds ${total} ${cookFilterLabel(this.cookFishFilter)} (target ${this.bankRawTarget}) — entering cook batch (drain all)`
            );
        }
        return total;
    }
    /** Force paint/total to 0 when withdraw finds nothing (avoids drain-more thrash). */
    forceBankRawEmpty(): void {
        this.bankRawInBank = 0;
    }
    /** Sticky batch phase: withdraw/cook until bank cookable raw is empty. */
    isCookBatchReady(): boolean {
        return this.inCookBatch;
    }
    clearCookBatchReady(): void {
        this.inCookBatch = false;
    }
    isCookingLoad(): boolean {
        return this.cookingLoad;
    }
    beginCookingLoad(): void {
        this.cookingLoad = true;
    }
    endCookingLoad(): void {
        this.cookingLoad = false;
    }
    recordCook(n: number): void {
        if (n > 0) {
            this.cooked += n;
        }
    }
    /**
     * After banking one cooked inventory load (bank-raw-then-cook).
     * Batch is sticky: keep withdrawing while ANY cookable raw remains in bank
     * (N is only the entry threshold — not re-checked per load).
     * When drained: Stop ends the script; Continue returns to fishing for +N more.
     */
    finishCookCycle(): void {
        this.cookingLoad = false;
        const outcome = cookBatchAfterLoad(this.bankRawInBank, this.afterCook);
        if (outcome === 'drain-more') {
            // Stay in batch — next task is another withdraw. Do NOT clear inCookBatch.
            this.inCookBatch = true;
            this.log(
                `cook load done — bank still holds ${this.bankRawInBank} ${cookFilterLabel(this.cookFishFilter)} — withdrawing another load (batch drain)`
            );
            this.setStatus('cook batch continues — withdrawing');
            return;
        }
        this.inCookBatch = false;
        if (outcome === 'stop') {
            this.log(
                `cook batch drained (bank raw ${this.bankRawInBank}/${this.bankRawTarget}) — stopping (after cook = Stop)`
            );
            this.setStatus('cook batch complete — stopped');
            ScriptRunner.stop();
            return;
        }
        this.log(
            `cook batch drained (bank raw ${this.bankRawInBank}/${this.bankRawTarget}) — fishing for next +${this.bankRawTarget}`
        );
        this.setStatus('cook batch done — fishing again');
    }
    rangeTile(): Tile | null {
        return this.rangeStand;
    }
    rangeLocName(): string {
        return this.rangeName;
    }
    cookObstacleList(): string[] {
        return this.cookObstacles;
    }
    rangeLeash(): number {
        return this.rangeSearchRadius;
    }
    /** All raw fish in inventory (any species). */
    rawFishCount(): number {
        return Inventory.items().filter(i => isRawFishName(i.name)).length;
    }
    /** Raw fish that match the cook filter (what we actually cook). */
    cookableRawCount(): number {
        return Inventory.items().filter(i => rawMatchesCookFilter(i.name, this.cookFishFilter)).length;
    }
    /** Raw fish that should stay raw / be banked without cooking. */
    bankOnlyRawCount(): number {
        return Inventory.items().filter(i => isRawFishName(i.name) && !rawMatchesCookFilter(i.name, this.cookFishFilter)).length;
    }
    cookedFishCount(): number {
        return Inventory.items().filter(i => isCookedFishName(i.name)).length;
    }
    burntFishCount(): number {
        return Inventory.items().filter(i => isBurntFishName(i.name)).length;
    }
    /** Last cookable raw (for use-on-range). Falls back to any raw if filter empty. */
    lastRawFish() {
        const items = Inventory.items();
        const idx = lastMatchingIndex(items, n => rawMatchesCookFilter(n, this.cookFishFilter));
        return idx >= 0 ? items[idx] : null;
    }
    isCookableRaw(name: string | null | undefined): boolean {
        return rawMatchesCookFilter(name, this.cookFishFilter);
    }
    /** Deposit cooked (+ burnt if banking burnt); keep gear and leftover raw during cook. */
    shouldDepositCookResult(name: string): boolean {
        if (this.gearKeep.length > 0 && !depositAllExcept(this.gearKeep)(name)) {
            return false;
        }
        if (isRawFishName(name)) {
            // Bank non-cook raw (e.g. keep tuna raw while cooking swordfish)
            return !rawMatchesCookFilter(name, this.cookFishFilter);
        }
        if (isBurntFishName(name)) {
            return this.burntPolicy === 'bank';
        }
        return isCookedFishName(name) || this.shouldDeposit(name);
    }
    shouldDepositRawCatch(name: string): boolean {
        if (this.gearKeep.length > 0 && !depositAllExcept(this.gearKeep)(name)) {
            return false;
        }
        return isRawFishName(name);
    }
    /**
     * When cook is active, BankCatch must wait for cook loads / cookable full packs.
     * Non-cookable raw (filter split) can still bank while cookable raw is cooking.
     */
    bankCatchBlockedByCook(): boolean {
        if (!this.cookEnabled()) {
            return false;
        }
        if (this.cookingLoad || this.inCookBatch) {
            return true;
        }
        if (
            this.cookMode === 'cook-then-bank' &&
            shouldCookThenBank(this.cookMode, Inventory.isFull(), this.cookableRawCount())
        ) {
            return true;
        }
        return false;
    }

    // ── Chop → burn surface (ChopBurnTasks) ──────────────────────────────────
    burnEnabled(): boolean {
        return this.chopping && this.burnMode === 'chop-then-burn' && this.burnPlot !== null;
    }
    isBurningLoad(): boolean {
        return this.burningLoad;
    }
    beginBurningLoad(): void {
        this.burningLoad = true;
    }
    endBurningLoad(): void {
        this.burningLoad = false;
        this.burnLaneRemain = 0;
    }
    recordFire(n = 1): void {
        if (n > 0) {
            this.firesLit += n;
        }
    }
    burnPlotOrNull(): FirePlot | null {
        return this.burnPlot;
    }
    burnLogName(): string {
        return this.burnLogs;
    }
    burnLaneLeft(): number {
        return this.burnLaneRemain;
    }
    setBurnLaneLeft(n: number): void {
        this.burnLaneRemain = Math.max(0, n);
    }
    hasTinderbox(): boolean {
        return this.heldCount(TINDERBOX) > 0;
    }
    logCount(): number {
        return Inventory.count(this.burnLogs);
    }
    /** BankCatch waits while a burn load is in progress (or pack is full of logs to burn). */
    bankCatchBlockedByBurn(): boolean {
        if (!this.burnEnabled()) {
            return false;
        }
        if (this.burningLoad) {
            return true;
        }
        return shouldBurnFullLoad(this.burnMode, Inventory.isFull(), this.logCount(), this.hasTinderbox());
    }

    reject(key: string): void {
        if (!this.rejected.has(key)) {
            this.rejected.add(key);
            this.log(`skipping ${this.target} at ${key} (can't ${this.action.toLowerCase()} it)`);
        }
    }
    cooldown(key: string, ticks = 8): void {
        this.cooldownUntil.set(key, Game.tick() + ticks);
    }
    usable(key: string): boolean {
        if (this.rejected.has(key)) {
            return false;
        }
        const until = this.cooldownUntil.get(key);
        return until === undefined || Game.tick() >= until;
    }
}

function keyOf(t: { x: number; z: number }): string {
    return `${t.x},${t.z}`;
}

class DropProduct implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return Inventory.isFull() && this.bot.products().length > 0;
    }

    async execute(): Promise<void> {
        await dropAll(this.bot);
    }
}

async function dropAll(bot: GatheringBot): Promise<void> {
    bot.setStatus('dropping');
    for (let guard = 0; guard < 30; guard++) {
        const item = bot.products()[0];
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
    bot.log('dropped the haul');
}

class BankCatch implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.bankCatchBlockedByCook() || this.bot.bankCatchBlockedByBurn()) {
            return false;
        }
        return Inventory.isFull() && this.bot.hasDepositable();
    }

    async execute(): Promise<void> {
        const had = this.bot.products().length;
        const log = (m: string) => this.bot.log(`  ${m}`);
        const deposit = (name: string) => this.bot.shouldDeposit(name);
        const refreshRaw = async () => {
            if (!(this.bot.isFishing() && this.bot.getCookMode() === 'bank-raw-then-cook')) {
                return;
            }
            // Bank API truth after deposit settles — not an inventory tally.
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            await Execution.delayTicks(1);
            const total = this.bot.refreshBankRawTotal();
            this.bot.log(`bank raw (${cookFilterLabel(this.bot.getCookFishFilter())}): ${total}/${this.bot.getBankRawTarget()}`);
        };

        this.bot.setStatus('banking: heading to the bank');
        if (!(await this.bot.openScriptBank(log))) {
            // No preset location and no booth in scene — try nearest known bank + deposit.
            this.bot.setStatus('banking: heading to the nearest bank');
            const banked = await Banking.bankNearest({
                deposit,
                log,
                afterDeposit: async () => {
                    await refreshRaw();
                }
            });
            if (!banked) {
                this.bot.setStatus('no bank reachable — dropping the haul');
                this.bot.log('no bank reachable — dropping instead');
                await dropAll(this.bot);
                return;
            }
        } else {
            await Execution.delay(bankHumanDelayMs());
            await Bank.depositAllMatching(deposit);
            await Execution.delayTicks(1);
            await refreshRaw();
        }

        // Stay at bank if a cook batch is ready so withdraw can run next tick
        if (!this.bot.isCookBatchReady()) {
            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
        }

        this.bot.countTrip(had);
        this.bot.log(`banked ${had} *${this.bot.productLabel()}*`);
    }
}

// ─── Fish → cook pipeline (CookBot patterns, any bank+range scene) ───────────

class FishCookDialog implements Task {
    constructor(private bot: GatheringBot) {}
    validate(): boolean {
        return this.bot.cookEnabled() && ChatDialog.isMakeMenu();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing cook product');
        // Prefer the raw fish name so multi-product menus pick the right one
        const raw = this.bot.lastRawFish();
        const hint = raw?.name ?? undefined;
        if (!(await ChatDialog.make(hint))) {
            await ChatDialog.make();
        }
        await Execution.delayTicks(1);
    }
}

class FishCookLoad implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || ChatDialog.isOpen() || EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        const cookable = this.bot.cookableRawCount();
        if (cookable <= 0) {
            return false;
        }
        // Mid-load: keep cooking remaining cookable raw
        if (this.bot.isCookingLoad()) {
            return true;
        }
        // Cook-then-bank: start when pack is full and has cookable raw
        if (
            this.bot.getCookMode() === 'cook-then-bank' &&
            shouldCookThenBank(this.bot.getCookMode(), Inventory.isFull(), cookable)
        ) {
            return true;
        }
        // Bank-raw-then-cook: after withdraw, inv has cookable raw and batch was armed
        if (this.bot.getCookMode() === 'bank-raw-then-cook' && this.bot.isCookBatchReady() && cookable > 0) {
            return true;
        }
        return false;
    }

    async execute(): Promise<void> {
        const rangeTile = this.bot.rangeTile();
        if (!rangeTile) {
            return;
        }
        this.bot.beginCookingLoad();

        const findRange = () =>
            Locs.query()
                .name(this.bot.rangeLocName(), 'Range', 'Cooking range', 'Fire')
                .where(l => l.tile().distanceTo(rangeTile) <= this.bot.rangeLeash())
                .nearest() ??
            Locs.query()
                .name('Range', 'Cooking range', 'Fire')
                .nearest();

        const here = Game.tile();
        if (!here || rangeTile.distanceTo(here) > 1 || !findRange()) {
            this.bot.setStatus('walking to the range');
            await walkOpening(rangeTile, 0, this.bot.cookObstacleList(), m => this.bot.log(m));
        }

        for (let n = 0; n < 32 && this.bot.cookableRawCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) {
                return;
            }
            if (EventSignal.pending() || Game.inCombat()) {
                return;
            }
            const raw = this.bot.lastRawFish();
            const oven = findRange();
            if (!raw || !oven) {
                await Execution.delayTicks(2);
                return;
            }
            this.bot.setStatus(`cooking ${raw.name}`);
            const before = this.bot.cookableRawCount();
            if (!(await raw.useOn(oven))) {
                await Execution.delayTicks(2);
                continue;
            }
            if (
                await Execution.delayUntil(
                    () => this.bot.cookableRawCount() < before || ChatDialog.isMakeMenu() || ChatDialog.canContinue(),
                    6000
                )
            ) {
                if (this.bot.cookableRawCount() < before) {
                    this.bot.recordCook(before - this.bot.cookableRawCount());
                    await Execution.delay(cookHumanDelayMs());
                }
            }
        }

        if (this.bot.cookableRawCount() === 0) {
            // Drop burnt before banking cooked (default human-ish: clear the ash first)
            if (this.bot.getBurntPolicy() === 'drop' && this.bot.burntFishCount() > 0) {
                await dropBurnt(this.bot);
            }
            // cookingLoad stays true until FishBankCooked finishes depositing
        }
    }
}

class FishBankCooked implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        // After a cook load finishes (no cookable raw left) bank cooked / burnt / bank-only raw
        if (!this.bot.isCookingLoad()) {
            return false;
        }
        return this.bot.cookableRawCount() === 0;
    }

    async execute(): Promise<void> {
        // Safety: drop burnt if still holding and policy is drop
        if (this.bot.getBurntPolicy() === 'drop' && this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }

        const cooked = this.bot.cookedFishCount();
        const hasDeposit = Inventory.items().some(i => this.bot.shouldDepositCookResult(i.name ?? ''));
        const log = (m: string) => this.bot.log(`  ${m}`);
        const deposit = (name: string) => this.bot.shouldDepositCookResult(name);

        if (hasDeposit) {
            this.bot.setStatus('banking cooked fish');
            if (!(await this.bot.openScriptBank(log))) {
                this.bot.log('could not open bank for cooked fish — will retry');
                return;
            }
            await Execution.delay(bankHumanDelayMs());
            await Bank.depositAllMatching(deposit);
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            await Execution.delayTicks(1);
            // Keep paint total honest after depositing cooked / leftover raw
            if (this.bot.getCookMode() === 'bank-raw-then-cook') {
                this.bot.refreshBankRawTotal();
            }
            this.bot.countTrip(cooked);
            this.bot.log(`banked ${cooked} cooked fish (burnt policy: ${this.bot.getBurntPolicy()})`);
        } else {
            this.bot.log('cook load finished with nothing to bank');
        }

        // bank-raw-then-cook: drain more / stop / fish again (sticky batch — N not re-checked)
        if (this.bot.getCookMode() === 'bank-raw-then-cook') {
            this.bot.finishCookCycle();
            if (this.bot.isCookBatchReady()) {
                // Still draining — stay near bank for the next withdraw.
                return;
            }
            if (this.bot.getAfterCook() === 'stop') {
                // ScriptRunner.stop already called inside finishCookCycle.
                return;
            }
            // fish-again
        } else {
            this.bot.endCookingLoad();
        }
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

class FishWithdrawCookBatch implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || this.bot.getCookMode() !== 'bank-raw-then-cook') {
            return false;
        }
        if (!this.bot.isCookBatchReady() || this.bot.isCookingLoad()) {
            return false;
        }
        // Need no cookable raw in inv so we can withdraw a full cook load
        return this.bot.cookableRawCount() === 0 && !EventSignal.pending() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        this.bot.setStatus('withdrawing raw for cook batch');

        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('could not open bank for cook withdraw — will retry');
            return;
        }
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        await Execution.delayTicks(1);
        // Update paint total only — does NOT exit the sticky batch when total < N.
        this.bot.refreshBankRawTotal();

        // Only withdraw cook-filter raw (e.g. swordfish while tuna stays banked)
        const rawItem = Bank.items().find(i => i.name !== null && this.bot.isCookableRaw(i.name));
        if (!rawItem || rawItem.name === null) {
            this.bot.log(
                `no ${cookFilterLabel(this.bot.getCookFishFilter())} left in bank — ending cook batch`
            );
            // Force remaining=0 so finishCookCycle cannot re-arm drain-more on a stale total.
            this.bot.forceBankRawEmpty();
            this.bot.finishCookCycle();
            if (!this.bot.isCookBatchReady() && this.bot.getAfterCook() === 'continue') {
                await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
            }
            return;
        }
        const bankName = rawItem.name;
        const allOp = withdrawOp(rawItem.ops, 'all');
        if (allOp) {
            this.bot.log(`withdrawing all ${bankName} (batch drain; bank had ${this.bot.getBankRawInBank()})`);
            await Bank.withdraw(bankName, allOp);
            await Execution.delayUntil(() => this.bot.cookableRawCount() > 0 || Bank.count(bankName) === 0, 4000);
        } else {
            const tenOp = withdrawOp(rawItem.ops, '10') ?? withdrawOp(rawItem.ops, 'any') ?? 'Withdraw-10';
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(bankName) > 0; n++) {
                const before = this.bot.cookableRawCount();
                await Bank.withdraw(bankName, tenOp);
                if (!(await Execution.delayUntil(() => this.bot.cookableRawCount() > before || Inventory.isFull(), 3000))) {
                    break;
                }
                await Execution.delay(cookHumanDelayMs());
            }
        }

        // Paint: remaining bank raw after this withdraw (may be << N — batch stays armed).
        await Execution.delayUntil(() => Bank.loaded(), 2000);
        this.bot.refreshBankRawTotal();

        if (this.bot.cookableRawCount() === 0) {
            this.bot.log('withdraw landed empty — ending cook batch');
            // Re-count; if still nothing withdrawable, treat bank as drained for this filter.
            this.bot.refreshBankRawTotal();
            if (this.bot.getBankRawInBank() === 0 || !Bank.items().some(i => i.name !== null && this.bot.isCookableRaw(i.name))) {
                this.bot.forceBankRawEmpty();
            }
            this.bot.finishCookCycle();
            if (!this.bot.isCookBatchReady() && this.bot.getAfterCook() === 'continue') {
                await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
            }
            return;
        }

        // Stay in sticky batch; cook this load next. Bank may already be < N — that is fine.
        this.bot.beginCookingLoad();
        this.bot.log(
            `withdrew ${this.bot.cookableRawCount()} ${bankName} (bank left ${this.bot.getBankRawInBank()}) — heading to range`
        );
    }
}

async function dropBurnt(bot: GatheringBot): Promise<void> {
    bot.setStatus('dropping burnt fish');
    for (let guard = 0; guard < 30; guard++) {
        const item = Inventory.items().find(i => isBurntFishName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
        await Execution.delay(80 + Math.floor(Math.random() * 160));
    }
    bot.log('dropped burnt fish');
}


class ReplacePickaxe implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return this.bot.mining() && (Equipment.contains(BROKEN_PICKAXE) || Inventory.first(BROKEN_PICKAXE) !== null);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('pickaxe broke — fetching a replacement');
        this.bot.log('pickaxe is broken — banking for the best replacement');
        const log = (m: string) => this.bot.log(`  ${m}`);

        if (Equipment.contains(BROKEN_PICKAXE) && !Inventory.isFull()) {
            await Equipment.unequip(BROKEN_PICKAXE);
        }

        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('could not open a bank — will retry');
            return;
        }

        await Bank.depositAllMatching(n => n.toLowerCase() === BROKEN_PICKAXE.toLowerCase());
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        const pick = bestPickaxe(Skills.level('mining'), name => Bank.count(name) > 0);
        if (!pick) {
            this.bot.log('WARNING: no usable pickaxe in the bank — stopping. Deposit one and restart.');
            ScriptRunner.stop();
            return;
        }
        const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === pick.toLowerCase());
        const one = item ? withdrawOp(item.ops, '1') ?? 'Withdraw-1' : 'Withdraw-1';
        await Bank.withdraw(pick, one);
        if (!(await Execution.delayUntil(() => Inventory.first(pick) !== null, 3000))) {
            this.bot.log('withdraw did not land — will retry');
            return;
        }
        this.bot.log(`replaced the broken pickaxe with a ${pick}`);
        await Equipment.equip(pick);
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

/**
 * Restock fishing tools/bait from the bank when the pack is missing required gear.
 * Runs above Gather so missing-gear no longer just stalls with a status message.
 */
class RestockFishingGear implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isFishing() || this.bot.hasGear()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        // Don't interrupt an active cook load / withdraw cycle.
        if (this.bot.cookEnabled() && (this.bot.isCookingLoad() || this.bot.isCookBatchReady())) {
            return false;
        }
        return this.bot.fishMethodDef() !== null;
    }

    async execute(): Promise<void> {
        const method = this.bot.fishMethodDef();
        if (!method) {
            return;
        }
        const missing = this.bot.missingGearNames();
        this.bot.setStatus(`restocking gear: ${missing.join(' + ') || this.bot.gearLabel()}`);
        this.bot.log(`missing fishing gear (${missing.join(', ') || this.bot.gearLabel()}) — banking to restock`);
        const log = (m: string) => this.bot.log(`  ${m}`);

        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('could not open bank to restock gear — will retry');
            await Execution.delayTicks(3);
            return;
        }
        await Execution.delay(bankHumanDelayMs());
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);

        // Free pack space while keeping tools/bait already held.
        await Bank.depositAllMatching(depositAllExcept(this.bot.gearKeepNamesList()));
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        await Execution.delayTicks(1);

        const plan = fishingRestockPlan(
            method,
            name => Inventory.count(name),
            name => Bank.count(name)
        );
        if (plan.length === 0) {
            const still = this.bot.missingGearNames();
            this.bot.log(
                still.length > 0
                    ? `WARNING: bank has no ${still.join(' / ')} — deposit gear and restart, or switch method`
                    : 'gear already topped up after deposit'
            );
            if (still.length > 0) {
                this.bot.setStatus(`missing gear in bank: ${still.join(' + ')}`);
                await Execution.delayTicks(8);
            }
            return;
        }

        for (const step of plan) {
            const before = Inventory.count(step.name);
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === step.name.toLowerCase());
            if (!item) {
                continue;
            }
            if (step.qty === 1) {
                const one = withdrawOp(item.ops, '1') ?? 'Withdraw-1';
                this.bot.log(`withdrawing 1× ${step.name}`);
                await Bank.withdraw(step.name, one);
            } else if (step.qty >= 50) {
                // Bait/feathers: prefer Withdraw-All when topping a large stack.
                const all = withdrawOp(item.ops, 'all');
                if (all && Bank.count(step.name) <= step.qty) {
                    this.bot.log(`withdrawing all ${step.name} (${Bank.count(step.name)})`);
                    await Bank.withdraw(step.name, all);
                } else {
                    this.bot.log(`withdrawing ${step.qty}× ${step.name}`);
                    await Bank.withdrawX(step.name, step.qty);
                }
            } else {
                this.bot.log(`withdrawing ${step.qty}× ${step.name}`);
                await Bank.withdrawX(step.name, step.qty);
            }
            await Execution.delayUntil(
                () => Inventory.count(step.name) > before || Bank.count(step.name) === 0,
                4000
            );
            await Execution.delay(bankHumanDelayMs());
        }

        if (!this.bot.hasGear()) {
            const still = this.bot.missingGearNames();
            this.bot.setStatus(`still missing: ${still.join(' + ')}`);
            this.bot.log(`restock incomplete — still need ${still.join(', ')}`);
            await Execution.delayTicks(5);
            return;
        }

        this.bot.log(`restocked fishing gear: ${this.bot.gearLabel()}`);
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

/**
 * Restock declared tool kit (pickaxe / axe / tinderbox / …) via Tools.toolRestockPlan.
 * Broken pickaxes are handled by ReplacePickaxe first.
 */
class RestockGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.isFishing() || this.bot.hasGear()) {
            return false;
        }
        if (this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        // Broken pick takes ReplacePickaxe instead.
        if (this.bot.mining() && (Equipment.contains(BROKEN_PICKAXE) || Inventory.first(BROKEN_PICKAXE) !== null)) {
            return false;
        }
        // Don't interrupt an active burn load.
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const missing = this.bot.missingGearNames();
        const label = missing.join(' + ') || this.bot.gearLabel();
        this.bot.setStatus(`restocking ${label}`);
        this.bot.log(`missing tools (${label}) — banking to restock`);
        const log = (m: string) => this.bot.log(`  ${m}`);

        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log(`could not open bank to restock ${label} — will retry`);
            await Execution.delayTicks(3);
            return;
        }
        await Execution.delay(bankHumanDelayMs());
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);

        // Keep any tools already in the pack; dump ore/logs/etc.
        await Bank.depositAllMatching(depositAllExcept(this.bot.gearKeepNamesList()));
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        await Execution.delayTicks(1);

        const plan = this.bot.gatherToolRestockPlan();
        if (plan.length === 0) {
            const still = this.bot.missingGearNames();
            this.bot.setStatus(`no ${still.join(' / ') || label} in bank`);
            this.bot.log(
                still.length > 0
                    ? `WARNING: bank has no ${still.join(' / ')} — deposit tools and restart`
                    : 'tools already topped up after deposit'
            );
            await Execution.delayTicks(8);
            return;
        }

        for (const step of plan) {
            const before = Inventory.count(step.name);
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === step.name.toLowerCase());
            if (!item) {
                continue;
            }
            if (step.qty === 1) {
                const one = withdrawOp(item.ops, '1') ?? 'Withdraw-1';
                this.bot.log(`withdrawing 1× ${step.name}`);
                await Bank.withdraw(step.name, one);
            } else {
                this.bot.log(`withdrawing ${step.qty}× ${step.name}`);
                await Bank.withdrawX(step.name, step.qty);
            }
            await Execution.delayUntil(
                () => Inventory.count(step.name) > before || Bank.count(step.name) === 0,
                4000
            );
            if (step.equip && Inventory.first(step.name)) {
                await Equipment.equip(step.name);
            }
            await Execution.delay(bankHumanDelayMs());
        }

        if (!this.bot.hasGear()) {
            const still = this.bot.missingGearNames();
            this.bot.setStatus(`still missing: ${still.join(' + ')}`);
            this.bot.log(`restock incomplete — still need ${still.join(', ')}`);
            await Execution.delayTicks(5);
            return;
        }

        this.bot.log(`restocked tools: ${this.bot.gearLabel()}`);
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

class Gather implements Task {
    constructor(private bot: GatheringBot) {}

    private findSpot() {
        return Npcs.query()
            .name(this.bot.targetName())
            .where(
                n =>
                    tileWithinLeash(this.bot, n.tile()) &&
                    this.bot.usable(keyOf(n.tile())) &&
                    !WHIRLPOOL_IDS.has(n.id) &&
                    this.bot.matchesSpot(n.actions())
            )
            .nearest();
    }

    private findRock() {
        return Locs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            .where(
                l =>
                    l.distance() >= 1 &&
                    tileWithinLeash(this.bot, l.tile()) &&
                    this.bot.matchesRock(l.id) &&
                    !GAS_ROCK_IDS.has(l.id) &&
                    this.bot.usable(keyOf(l.tile()))
            )
            .nearest();
    }

    validate(): boolean {
        if (Inventory.isFull() || Game.inCombat() || EventSignal.pending()) {
            return false;
        }
        // Don't start a new fish session while a cook load / withdraw is in flight.
        if (this.bot.cookEnabled() && (this.bot.isCookingLoad() || this.bot.isCookBatchReady())) {
            return false;
        }
        // Don't chop while burning a full load.
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        // Missing gear/tool: Restock* tasks handle bank mode; power-mode still
        // validates so execute can surface a status (tool lost / banked).
        if (!this.bot.hasGear()) {
            return this.bot.isPowerMode();
        }
        // Already mid-action (e.g. harpoon anim between catches) — keep the session
        // alive without re-clicking, which is what stuck tuna/swordfish on a dead spot.
        if (this.bot.isFishing() && Game.animating()) {
            return true;
        }
        return this.bot.isNpc() ? this.findSpot() !== null : this.findRock() !== null;
    }

    private gasAt(t: Tile): boolean {
        return (
            Locs.query()
                .where(l => {
                    const lt = l.tile();
                    return lt.x === t.x && lt.z === t.z && GAS_ROCK_IDS.has(l.id);
                })
                .nearest() !== null
        );
    }

    /** Live snapshot of the NPC we clicked, by index (survives tile hops of other spots). */
    private spotByIndex(index: number) {
        return Npcs.query()
            .where(n => n.index === index)
            .nearest();
    }

    private fishingBroken(index: number, startTile: Tile): boolean {
        const live = this.spotByIndex(index);
        const spotGone = live === null;
        const spotMoved = live !== null && !live.tile().equals(startTile);
        const becameWhirlpool = live !== null && WHIRLPOOL_IDS.has(live.id);
        return fishingSessionBroken({
            eventPending: EventSignal.pending(),
            inventoryFull: Inventory.isFull(),
            dialogPending: ChatDialog.canContinue(),
            inCombat: Game.inCombat(),
            spotGone,
            spotMoved,
            becameWhirlpool
        });
    }

    private shouldYieldMine(tile: Tile): boolean {
        return shouldYieldGathering(
            EventSignal.pending(),
            Inventory.isFull(),
            ChatDialog.canContinue(),
            this.findRock() === null || this.gasAt(tile),
            Game.inCombat()
        );
    }

    private async fleeGas(key: string, tile: Tile): Promise<void> {
        this.bot.log(`rock at ${tile} is smoking — backing off before it blows`);
        this.bot.setStatus('smoking rock — backing off');
        this.bot.cooldown(key, GAS_ROCK_TICKS + 10);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    private async fleeWhirlpool(tile: Tile): Promise<void> {
        this.bot.log(`whirlpool at ${tile} — stepping off (do not re-click)`);
        this.bot.setStatus('whirlpool — stepping away');
        this.bot.cooldown(keyOf(tile), 70);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    async execute(): Promise<void> {
        if (!this.bot.hasGear()) {
            this.bot.setStatus(`missing gear: ${this.bot.gearLabel()}`);
            this.bot.log(`can't gather — missing ${this.bot.gearLabel()} (bank / whirlpool?)`);
            await Execution.delayTicks(5);
            return;
        }

        if (Game.inCombat() || EventSignal.pending()) {
            return;
        }

        if (this.bot.isFishing()) {
            await this.executeFish();
            return;
        }
        await this.executeMine();
    }

    private async executeFish(): Promise<void> {
        // Resume an in-progress session only if we can still identify the spot under us.
        // Otherwise click a fresh matching Cage/Harpoon or Net/Harpoon spot.
        const target = this.findSpot();
        if (!target && Game.animating()) {
            // Animating with no matching spot nearby — wait for anim to end rather than thrash.
            this.bot.setStatus('waiting for fishing anim to finish');
            await Execution.delayUntil(
                () => !Game.animating() || EventSignal.pending() || Inventory.isFull() || Game.inCombat() || ChatDialog.canContinue(),
                8000
            );
            return;
        }
        if (!target) {
            return;
        }

        const index = target.index;
        const startTile = target.tile();
        const key = keyOf(startTile);

        if (!Game.animating()) {
            this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${startTile}`);
            const before = Inventory.used();
            if (!(await target.interact(this.bot.actionName()))) {
                this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }

            // Wait for the first swing / catch / interrupt. Do NOT treat "another
            // matching spot exists elsewhere" as success — that was the tuna stuck loop.
            await Execution.delayUntil(
                () => Inventory.used() > before || Game.animating() || this.fishingBroken(index, startTile),
                12000
            );

            const live = this.spotByIndex(index);
            if (live && WHIRLPOOL_IDS.has(live.id)) {
                await this.fleeWhirlpool(live.tile());
                return;
            }
            if (this.fishingBroken(index, startTile) && Inventory.used() === before && !Game.animating()) {
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key);
                }
                return;
            }
            if (Inventory.used() === before && !Game.animating()) {
                // Click did nothing (pathing fail / level / no bait). Brief cooldown.
                this.bot.cooldown(key, 4);
                return;
            }
        }

        // Hold the session while animating / catching. Break on hop, whirlpool,
        // combat, event, full pack, or a long silent gap with no anim.
        for (let guard = 0; guard < 200; guard++) {
            if (this.fishingBroken(index, startTile)) {
                const live = this.spotByIndex(index);
                if (live && WHIRLPOOL_IDS.has(live.id)) {
                    await this.fleeWhirlpool(live.tile());
                }
                return;
            }
            const mark = Inventory.used();
            await Execution.delayUntil(
                () => Inventory.used() > mark || !Game.animating() || this.fishingBroken(index, startTile),
                8000
            );
            if (this.fishingBroken(index, startTile)) {
                const live = this.spotByIndex(index);
                if (live && WHIRLPOOL_IDS.has(live.id)) {
                    await this.fleeWhirlpool(live.tile());
                }
                return;
            }
            if (Inventory.used() > mark) {
                continue;
            }
            if (!Game.animating()) {
                // Idle gap — session over; next loop will re-find.
                return;
            }
        }
    }

    private async executeMine(): Promise<void> {
        const target = this.findRock();
        if (!target) {
            return;
        }
        const tile = target.tile();
        const key = keyOf(tile);

        if (!Game.animating()) {
            this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${tile}`);
            const before = Inventory.used();
            if (!(await target.interact(this.bot.actionName()))) {
                this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }

            await Execution.delayUntil(
                () => Inventory.used() > before || Game.animating() || this.shouldYieldMine(tile),
                12000
            );
            if (this.gasAt(tile)) {
                await this.fleeGas(key, tile);
                return;
            }
            if (Inventory.used() === before && !Game.animating()) {
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key);
                } else if (this.findRock() !== null) {
                    this.bot.cooldown(key);
                }
                return;
            }
        }

        for (let guard = 0; guard < 200; guard++) {
            if (this.shouldYieldMine(tile)) {
                if (this.gasAt(tile)) {
                    await this.fleeGas(key, tile);
                }
                return;
            }
            const mark = Inventory.used();
            await Execution.delayUntil(
                () => Inventory.used() > mark || !Game.animating() || this.shouldYieldMine(tile),
                8000
            );
            if (this.gasAt(tile)) {
                await this.fleeGas(key, tile);
                return;
            }
            if (Inventory.used() > mark) {
                continue;
            }
            if (!Game.animating()) {
                if (this.findRock() !== null && !Inventory.isFull() && !ChatDialog.canContinue()) {
                    this.bot.cooldown(key);
                }
                return;
            }
        }
    }
}

