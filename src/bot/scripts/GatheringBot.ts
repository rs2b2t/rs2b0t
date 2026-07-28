import { beyondLeash, createReturnToAnchorTask, resolveRunAnchor, tileWithinLeash } from '../api/Anchor.js';
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
    expandLocalFirePlot,
    firemakingLevelForLogs,
    localFirePlot,
    logsForTree,
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
    toolsNeedingEquip,
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
import { Shop } from '../api/hud/Shop.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { talkThrough } from '../quests/exec/primitives.js';
import {
    BROKEN_AXE,
    COINS,
    HAMMER as ACQUIRE_HAMMER,
    acquireKeepNames,
    canFundPlan,
    coinsToWithdraw,
    parseToolAcquireMode,
    planFishingGearAcquire,
    planGatherToolAcquire,
    type AcquireWorld,
    type ToolAcquireMode,
    type ToolAcquirePlan,
    type ToolVendor
} from './ToolAcquire.js';

/** Default half-size of the Auto (start) burn box around the script start tile. */
const LOCAL_BURN_HALF = 8;

export const GATHERING_SETTINGS: SettingsSchema = {
    targetType: { type: 'string', default: 'loc', label: "Target type ('loc' or 'npc')", help: 'loc = scenery (rocks/trees), npc = fishing spots' },
    target: { type: 'string', default: 'Rocks', label: 'Target name', help: 'in-game name, e.g. Rocks / Tree / Fishing spot' },
    action: { type: 'string', default: 'Mine', label: 'Action', help: 'right-click op, e.g. Mine / Chop down / Net' },
    dropMatch: { type: 'string', default: 'ore', label: 'Drop items containing', help: 'when full, drop items whose name contains this (the gathered product)' },
    leashRadius: { type: 'number', default: 10, min: 2, max: 30, label: 'Leash radius (tiles)' }
};

export function shouldYieldGathering(
    eventPending: boolean,
    inventoryFull: boolean,
    dialogPending: boolean,
    targetGone: boolean,
    inCombat = false
): boolean {
    return eventPending || inventoryFull || dialogPending || targetGone || inCombat;
}

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
    private burnt = 0;
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

    private toolReqs: ToolReq[] = [];

    private cookMode: CookMode = 'off';
    private burntPolicy: BurntPolicy = 'drop';
    private afterCook: AfterCookCycle = 'stop';
    private bankRawTarget = 56;

    private bankRawInBank = 0;

    private cookFishFilter = '';

    private cookingLoad = false;

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
    /** True when fireSpot=Auto: burn near start and expand/repath instead of bank strips. */
    private burnLocal = false;

    /** Off | Buy/repair — shop/repair/smith missing gather tools. */
    private toolAcquire: ToolAcquireMode = 'off';
    private acquireBackoffUntil = 0;

    private xpStart: Record<string, number> = {};

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
            this.log('cook: disabled under location None (drop-only)');
            this.cookMode = 'off';
        }
        if (this.cookMode !== 'off' && this.fishing) {
            this.resolveCookScene();
            if (!this.rangeStand) {
                this.log('cook: no Range in scene/location — disabled until one is nearby');
            } else {
                const filterNote = `; cook ${cookFilterLabel(this.cookFishFilter)}`;
                const batchNote =
                    this.cookMode === 'bank-raw-then-cook'
                        ? `; bank ${this.bankRawTarget} raw then cook; after=${this.afterCook}`
                        : '';
                this.log(
                    `cook: ${this.cookMode} @ ${this.rangeName} ${this.rangeStand}; burnt=${this.burntPolicy}${filterNote}${batchNote}`
                );
            }
        }


        if (this.chopping && 'burnMode' in this.settings.raw()) {
            this.burnMode = parseBurnMode(this.settings.str('burnMode', 'Off'));
            this.burnLogs = logsForTree(this.target);
            if (this.burnMode !== 'off' && this.powerMode) {
                this.log('burn: disabled under location None (drop-only)');
                this.burnMode = 'off';
            }
            if (this.burnMode !== 'off') {
                const needFm = firemakingLevelForLogs(this.burnLogs) ?? 1;
                const haveFm = Skills.level('firemaking');
                if (haveFm < needFm) {
                    this.log(`burn: ${this.burnLogs} need FM ${needFm} (have ${haveFm}) — disabled`);
                    this.burnMode = 'off';
                } else {
                    const spotSetting = this.settings.str('fireSpot', 'Auto');
                    if (spotSetting.toLowerCase() === 'auto') {
                        // Burn near where the script started; repath/expand when tiles fill.
                        const half = Math.max(LOCAL_BURN_HALF, Math.min(this.leash, 12));
                        this.burnSpotName = 'Auto (start)';
                        this.burnPlot = localFirePlot(here, half);
                        this.burnLocal = true;
                        if (!this.toolReqs.some(r => r.kind === 'exact' && r.name === TINDERBOX)) {
                            this.toolReqs = [...this.toolReqs, tinderboxReq()];
                        }
                        this.log(
                            `burn: chop-then-burn ${this.burnLogs} near start ${here.x},${here.z} r=${half} (need tinderbox + FM ${needFm})`
                        );
                    } else {
                        const resolved = resolveFireSpot(spotSetting);
                        if (!resolved) {
                            this.log(`burn: unknown fire spot '${spotSetting}' — disabled`);
                            this.burnMode = 'off';
                        } else {
                            this.burnSpotName = resolved.name;
                            this.burnPlot = resolved.plot;
                            this.burnLocal = false;
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
        }

        this.toolAcquire = parseToolAcquireMode(this.settings.str('toolAcquire', 'Off'));
        if (this.toolAcquire === 'on') {
            this.log('tools: acquire Buy/repair enabled (shops + broken repair + mith+ axe smith when bars ready)');
        }

        this.gearKeep = this.rebuildGearKeep();
        this.captureXpStart();

        if (this.location) {
            const auto = locSetting.toLowerCase() === 'auto' ? ' (auto)' : '';
            this.log(`location: ${this.location.name}${auto}; bank ${this.location.bankStand}`);
            if (!this.location.verified) {
                this.log(`location: ${this.location.name} coords unverified — watch first bank run`);
            }
        } else if (!this.powerMode) {
            this.log('location: no preset — nearest bank');
        }
        if (this.powerMode) {
            this.log('location: power mode — drop haul; bank only to fetch missing tools (nearest bank)');
        }
        const pairNote = this.pairOp ? ` + pair '${this.pairOp}'` : '';
        this.log(
            `gather: '${this.target}' (${this.action}${pairNote}) leash ${this.leash} @ ${this.anchor}; ${this.fullInventoryNote()}`
        );

        this.on('inventory.changed', e => {
            if (e.id === -1 || Bank.isOpen()) {
                return;
            }
            // Count gains only (new stack or count up). Bank open is ignored so withdraws don't inflate stats.
            const gained =
                e.previousId !== e.id
                    ? Math.max(1, e.count)
                    : Math.max(0, e.count - e.previousCount);
            if (gained <= 0) {
                return;
            }
            if (this.cookEnabled() && isBurntFishName(e.name)) {
                this.burnt += gained;
                this.log(`burnt: ${e.name} (+${gained}, ${this.burnt} this run)`);
                return;
            }
            if (this.cookEnabled() && isCookedFishName(e.name)) {
                this.cooked += gained;
                return;
            }
            if (this.isProduct(e.name)) {
                this.gathered += gained;
            } else if (this.mining() && (e.name ?? '').toLowerCase().startsWith('uncut ')) {
                this.gems += gained;
                this.log(`gem: ${e.name} (${this.gems} this run)`);
            }
        });

        const cookOn = this.fishing && this.cookMode !== 'off' && this.rangeStand !== null;
        const burnOn = this.burnEnabled();
        const gatherTools = (this.mining() || this.woodcutting() || this.toolReqs.length > 0) && !this.fishing;
        this.add(
            new ContinueDialog(),
            ...(this.mining() || this.woodcutting() ? [new RepairBrokenGatherTool(this)] : []),
            ...(this.fishing ? [new RestockFishingGear(this)] : []),
            ...(gatherTools
                ? [new EnsureGatherToolEquipped(this), new RestockGatherTool(this), new UpgradeGatherTool(this)]
                : []),
            ...(cookOn ? [new FishCookDialog(this), new FishCookLoad(this), new FishBankCooked(this), new FishWithdrawCookBatch(this)] : []),
            ...(burnOn ? createChopBurnTasks(this) : []),
            this.powerMode ? new DropProduct(this) : new BankCatch(this),
            new Gather(this),

            createReturnToAnchorTask(this, {
                slack: 4,
                suppress: () => this.burnEnabled() && this.isBurningLoad()
            })
        );
    }


    private rebuildGearKeep(): string[] {
        const names = new Set<string>(toolKeepNames(this.toolReqs));
        if (this.fishMethod) {
            for (const n of gearKeepNames(this.fishMethod)) {
                names.add(n);
            }
        }
        if (this.toolAcquire === 'on') {
            names.add(COINS);
            names.add(BROKEN_PICKAXE);
            names.add(BROKEN_AXE);
            names.add(ACQUIRE_HAMMER);
        }
        return [...names];
    }

    toolAcquireEnabled(): boolean {
        return this.toolAcquire === 'on';
    }

    acquireWorld(): AcquireWorld {
        return {
            skillLevel: this.skillLevel,
            heldCount: this.heldCount,
            invCount: name => Inventory.count(name),
            bankCount: name => (Bank.isOpen() || Bank.loaded() ? Bank.count(name) : 0),
            worn: name => Equipment.contains(name)
        };
    }

    /** Bank counts need an open/loaded bank. Call only after openScriptBank. */
    acquireWorldWithBank(): AcquireWorld {
        return {
            skillLevel: this.skillLevel,
            heldCount: this.heldCount,
            invCount: name => Inventory.count(name),
            bankCount: name => Bank.count(name),
            worn: name => Equipment.contains(name)
        };
    }

    hasBrokenGatherTool(): boolean {
        return (
            this.heldCount(BROKEN_PICKAXE) > 0 ||
            this.heldCount(BROKEN_AXE) > 0 ||
            Equipment.contains(BROKEN_PICKAXE) ||
            Equipment.contains(BROKEN_AXE)
        );
    }

    markAcquireBackoff(ms = 15_000): void {
        this.acquireBackoffUntil = Date.now() + ms;
    }

    acquireReady(): boolean {
        return this.toolAcquire === 'on' && Date.now() >= this.acquireBackoffUntil;
    }

    /**
     * Walk to a tool vendor. Nurmof gets an explicit surface trapdoor hop when
     * still above ground so pathing does not stall at the mine entrance.
     */
    async walkToToolVendor(vendor: ToolVendor, log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const here = Game.tile();
        if (
            vendor.hopFrom &&
            vendor.hopLoc &&
            vendor.hopAction &&
            here &&
            vendor.stand.z > 9000 &&
            here.z < 9000 &&
            Tile.from(here).distanceTo(vendor.stand) > 20
        ) {
            log(`acquire: hop ${vendor.hopLoc} @ ${vendor.hopFrom}`);
            if (!(await Traversal.walkResilient(vendor.hopFrom, { radius: 2, timeoutMs: 90_000, log }))) {
                return false;
            }
            const trap = Locs.query().name(vendor.hopLoc).action(vendor.hopAction).nearest();
            if (trap) {
                await trap.interact(vendor.hopAction);
                await Execution.delayUntil(() => {
                    const t = Game.tile();
                    return t !== null && t.z >= 9000;
                }, 8000);
            }
        }
        return Traversal.walkResilient(vendor.stand, { radius: 4, timeoutMs: 120_000, log });
    }

    async withdrawCoinsFor(need: number, log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const inv = Inventory.count(COINS);
        const take = coinsToWithdraw(need, inv);
        if (take <= 0) {
            return true;
        }
        if (!Bank.isOpen()) {
            return false;
        }
        const bankGp = Bank.count(COINS);
        if (bankGp <= 0) {
            log(`acquire: no coins in bank (need ${need}gp)`);
            return false;
        }
        const amt = Math.min(take, bankGp);
        log(`acquire: withdraw ${amt}gp`);
        if (!(await Bank.withdrawX(COINS, amt))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.count(COINS) >= Math.min(need, inv + amt), 4000);
    }

    async executeToolAcquirePlan(
        plan: ToolAcquirePlan,
        log: (m: string) => void = m => this.log(`  ${m}`)
    ): Promise<boolean> {
        if (plan.kind === 'repair') {
            return this.executeRepairPlan(plan, log);
        }
        if (plan.kind === 'buy') {
            return this.executeBuyPlan(plan, log);
        }
        return this.executeSmithPlan(plan, log);
    }

    private async executeRepairPlan(
        plan: Extract<ToolAcquirePlan, { kind: 'repair' }>,
        log: (m: string) => void
    ): Promise<boolean> {
        this.setStatus(`repair: ${plan.brokenName} @ ${plan.vendor.keeper}`);
        this.log(`acquire: repair ${plan.brokenName} via ${plan.vendor.keeper}`);

        if (Equipment.contains(plan.brokenName) && !Inventory.isFull()) {
            await Equipment.unequip(plan.brokenName);
        }

        if (!(await this.openBankAt(plan.vendor.bankStand, log))) {
            log('acquire: could not open bank before repair — trying vendor with what we hold');
        } else {
            await Bank.depositAllMatching(name => {
                const keep = new Set(acquireKeepNames(plan, this.gearKeepNamesList()).map(n => n.toLowerCase()));
                return name.length > 0 && !keep.has(name.toLowerCase());
            });
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            await this.withdrawCoinsFor(1000, log);
            if (Bank.isOpen()) {
                await Bank.close();
            }
        }

        if (this.heldCount(plan.brokenName) <= 0) {
            log(`acquire: no ${plan.brokenName} held after bank — abort repair`);
            return false;
        }

        if (!(await this.walkToToolVendor(plan.vendor, log))) {
            log(`acquire: could not reach ${plan.vendor.keeper}`);
            return false;
        }

        const beforeBroken = this.heldCount(plan.brokenName);
        if (!(await talkThrough(plan.vendor.keeper, plan.prefer, log))) {
            log(`acquire: dialogue with ${plan.vendor.keeper} failed — will retry / buy`);
            return false;
        }
        await Execution.delayTicks(2);
        const afterBroken = this.heldCount(plan.brokenName);
        if (afterBroken < beforeBroken) {
            this.log(`acquire: repaired ${plan.brokenName} at ${plan.vendor.keeper}`);
            return true;
        }
        if (plan.label === 'pickaxe' && bestPickaxe(Skills.level('mining'), n => this.heldCount(n) > 0)) {
            this.log(`acquire: usable pick after ${plan.vendor.keeper} talk`);
            return true;
        }
        log(`acquire: ${plan.vendor.keeper} did not repair — try buy path`);
        return false;
    }

    private async executeBuyPlan(
        plan: Extract<ToolAcquirePlan, { kind: 'buy' }>,
        log: (m: string) => void
    ): Promise<boolean> {
        this.setStatus(`buy: ${plan.qty}× ${plan.name}`);
        this.log(`acquire: ${plan.reason} @ ${plan.vendor.keeper} (${plan.cost}gp)`);

        if (!(await this.openBankAt(plan.vendor.bankStand, log))) {
            log('acquire: could not open bank for coins');
            return false;
        }
        await Bank.depositAllMatching(name => {
            const keep = new Set(acquireKeepNames(plan, this.gearKeepNamesList()).map(n => n.toLowerCase()));
            return name.length > 0 && !keep.has(name.toLowerCase());
        });
        await Execution.delayUntil(() => Bank.loaded(), 3000);

        if (!canFundPlan(plan, Inventory.count(COINS), Bank.count(COINS))) {
            log(`acquire: not enough coins for ${plan.name} (${plan.cost}gp)`);
            this.markAcquireBackoff(60_000);
            if (Bank.isOpen()) {
                await Bank.close();
            }
            return false;
        }
        if (!(await this.withdrawCoinsFor(plan.cost, log))) {
            if (Bank.isOpen()) {
                await Bank.close();
            }
            return false;
        }
        if (Bank.isOpen()) {
            await Bank.close();
        }

        if (!(await this.walkToToolVendor(plan.vendor, log))) {
            log(`acquire: could not reach ${plan.vendor.keeper}`);
            return false;
        }
        if (!(await Shop.open(plan.vendor.keeper))) {
            log(`acquire: could not open ${plan.vendor.keeper}'s shop`);
            return false;
        }
        const before = Inventory.count(plan.name);
        const bought = await Shop.buy(plan.name, plan.qty);
        await Shop.close();
        if (bought <= 0 && Inventory.count(plan.name) <= before) {
            log(`acquire: bought 0× ${plan.name} — stock/coins`);
            this.markAcquireBackoff(20_000);
            return false;
        }
        this.log(`acquire: bought ${bought || Inventory.count(plan.name) - before}× ${plan.name}`);
        if (plan.equip) {
            await this.equipTools([plan.name], log);
        }
        return true;
    }

    private async executeSmithPlan(
        plan: Extract<ToolAcquirePlan, { kind: 'smith' }>,
        log: (m: string) => void
    ): Promise<boolean> {
        this.setStatus(`smith: ${plan.name}`);
        this.log(`acquire: ${plan.reason} @ Varrock anvil`);

        if (!(await this.openBankAt(plan.vendorBank, log))) {
            log('acquire: could not open bank for smith materials');
            return false;
        }
        await Bank.depositAllMatching(name => {
            const keep = new Set(acquireKeepNames(plan, this.gearKeepNamesList()).map(n => n.toLowerCase()));
            return name.length > 0 && !keep.has(name.toLowerCase());
        });
        await Execution.delayUntil(() => Bank.loaded(), 3000);

        if (Inventory.count(ACQUIRE_HAMMER) < 1) {
            const h = Bank.items().find(i => (i.name ?? '').toLowerCase() === ACQUIRE_HAMMER.toLowerCase());
            if (!h) {
                log('acquire: no hammer for smithing');
                this.markAcquireBackoff(60_000);
                await Bank.close();
                return false;
            }
            const one = withdrawOp(h.ops, '1') ?? 'Withdraw-1';
            await Bank.withdraw(ACQUIRE_HAMMER, one);
            await Execution.delayUntil(() => Inventory.count(ACQUIRE_HAMMER) > 0, 3000);
        }
        if (Inventory.count(plan.bar) < 1) {
            const b = Bank.items().find(i => (i.name ?? '').toLowerCase() === plan.bar.toLowerCase());
            if (!b) {
                log(`acquire: no ${plan.bar} in bank`);
                this.markAcquireBackoff(60_000);
                await Bank.close();
                return false;
            }
            const one = withdrawOp(b.ops, '1') ?? 'Withdraw-1';
            await Bank.withdraw(plan.bar, one);
            await Execution.delayUntil(() => Inventory.count(plan.bar) > 0, 3000);
        }
        if (Bank.isOpen()) {
            await Bank.close();
        }

        if (!(await Traversal.walkResilient(plan.anvilStand, { radius: 2, timeoutMs: 90_000, log }))) {
            log('acquire: could not reach anvil');
            return false;
        }
        const bar = Inventory.first(plan.bar);
        const anvil = Locs.query().name('Anvil').nearest();
        if (!bar || !anvil) {
            log('acquire: missing bar or anvil');
            return false;
        }
        const before = Inventory.count(plan.name);
        if (!(await bar.useOn(anvil))) {
            return false;
        }
        await Execution.delayUntil(() => ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), 6000);
        if (ChatDialog.isMainMakePanel()) {
            if (!(await ChatDialog.makeFromPanelMax('Axe'))) {
                await ChatDialog.makeFromPanelMax(plan.name);
            }
        }
        await Execution.delayUntil(() => Inventory.count(plan.name) > before || !Game.animating(), 12_000);
        if (Inventory.count(plan.name) <= before) {
            log(`acquire: smith did not produce ${plan.name}`);
            this.markAcquireBackoff(20_000);
            return false;
        }
        this.log(`acquire: smithed ${plan.name}`);
        if (plan.equip) {
            await this.equipTools([plan.name], log);
        }
        return true;
    }

    async openBankAt(stand: Tile, log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        return Banking.open({
            stand,
            boothName: this.location?.boothName,
            boothOp: this.location?.boothOp,
            obstacles: this.cookEnabled() ? this.cookObstacles : (this.location?.obstacles ?? []),
            log
        });
    }

    async openScriptBank(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const loc = this.location;
        return Banking.open({
            stand: loc?.bankStand ?? null,
            boothName: loc?.boothName,
            boothOp: loc?.boothOp,
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

        const range = Locs.query().name('Range', 'Cooking range', 'Fire').nearest();
        if (range) {
            this.rangeStand = range.tile();
            this.rangeName = range.name ?? 'Range';
            this.cookObstacles = this.location?.obstacles ?? ['door', 'gate'];
            this.log(`cook: found ${this.rangeName} @ ${this.rangeStand}`);
        }
    }

    override recoveryAnchor(): Tile | null {
        return this.anchor;
    }

    private paintKind(): string {
        if (this.fishing) {
            return 'Fisher';
        }
        if (this.mining()) {
            return 'Miner';
        }
        if (this.woodcutting()) {
            return 'Woodcutter';
        }
        return 'Gathering';
    }

    private paintAccent(): string {
        if (this.fishing) {
            return '#7ec8e3';
        }
        if (this.mining()) {
            return '#e0c36a';
        }
        if (this.woodcutting()) {
            return '#9be05b';
        }
        return '#9be05b';
    }

    private paintProductLabel(): string {
        if (this.mining()) {
            return 'Ore';
        }
        if (this.woodcutting()) {
            return 'Logs';
        }
        if (this.fishing) {
            return 'Fish';
        }
        return this.productLabel() || this.target;
    }

    private paintCookMode(): string {
        if (this.cookMode === 'cook-then-bank') {
            return 'cook→bank';
        }
        if (this.cookMode === 'bank-raw-then-cook') {
            return 'bank→cook';
        }
        return this.cookMode;
    }

    private paintTitleStatus(): string {
        const s = this.status.trim() || 'idle';
        if (s.length <= 40) {
            return s;
        }
        return `${s.slice(0, 37)}…`;
    }

    private paintModeLabel(): string {
        if (this.powerMode) {
            return 'drop';
        }
        if (this.burnMode === 'chop-then-burn') {
            return 'burn';
        }
        if (this.fishing && this.cookMode === 'cook-then-bank') {
            return 'cook→bank';
        }
        if (this.fishing && this.cookMode === 'bank-raw-then-cook') {
            return 'bank→cook';
        }
        return this.location ? 'bank' : 'nearest bank';
    }

    private paintLocLabel(): string {
        if (this.location) {
            return this.location.name;
        }
        return this.powerMode ? 'power' : 'nearest bank';
    }

    private paintSkillShort(skill: string): string {
        switch (skill) {
            case 'woodcutting':
                return 'WC';
            case 'firemaking':
                return 'FM';
            case 'fishing':
                return 'Fish';
            case 'cooking':
                return 'Cook';
            case 'mining':
                return 'Mine';
            default:
                return skill;
        }
    }

    private paintSkillTitle(skill: string): string {
        switch (skill) {
            case 'woodcutting':
                return 'Woodcutting';
            case 'firemaking':
                return 'Firemaking';
            case 'fishing':
                return 'Fishing';
            case 'cooking':
                return 'Cooking';
            case 'mining':
                return 'Mining';
            default:
                return skill;
        }
    }

    private trackedSkills(): string[] {
        const skills: string[] = [];
        if (this.fishing) {
            skills.push('fishing');
        }
        if (this.mining()) {
            skills.push('mining');
        }
        if (this.woodcutting()) {
            skills.push('woodcutting');
        }
        if (this.fishing && this.cookMode !== 'off') {
            skills.push('cooking');
        }
        if (this.chopping && this.burnMode !== 'off') {
            skills.push('firemaking');
        }
        return skills;
    }

    private captureXpStart(): void {
        this.xpStart = {};
        for (const skill of this.trackedSkills()) {
            this.xpStart[skill] = Skills.xp(skill);
        }
    }

    private xpGained(skill: string): number {
        const start = this.xpStart[skill];
        if (start === undefined) {
            return 0;
        }
        return Math.max(0, Skills.xp(skill) - start);
    }

    private fmtXpHr(skill: string, mins: number): string {
        if (this.xpStart[skill] === undefined || mins <= 0.5) {
            return '—';
        }
        return `${(((this.xpGained(skill) / mins) * 60) / 1000).toFixed(1)}k`;
    }

    private fmtXpGained(skill: string): string {
        const n = this.xpGained(skill);
        if (n <= 0) {
            return '+0';
        }
        if (n >= 1000) {
            return `+${(n / 1000).toFixed(1)}k`;
        }
        return `+${n}`;
    }

    private fullInventoryNote(): string {
        if (this.burnMode === 'chop-then-burn') {
            return `burning ${this.burnLogs} when full`;
        }
        if (this.powerMode) {
            return `dropping ${this.productLabel()} when full`;
        }
        if (this.fishing && this.cookMode === 'cook-then-bank') {
            const filter = cookFilterLabel(this.cookFishFilter);
            if (this.cookFishFilter) {
                return `cook ${filter} then bank (other raw banked as-is) when full`;
            }
            return 'cook then bank when full';
        }
        if (this.fishing && this.cookMode === 'bank-raw-then-cook') {
            const filter = cookFilterLabel(this.cookFishFilter);
            return `bank ${filter} to ${this.bankRawTarget} then cook batches`;
        }
        return `banking ${this.productLabel()} when full`;
    }

    /** Compact full-pack policy for the chatbox paint (must stay ≤ ~48 chars). */
    private paintFullNote(): string {
        if (this.burnMode === 'chop-then-burn') {
            return `Full: burn ${this.burnLogs}`;
        }
        if (this.powerMode) {
            return `Full: drop ${this.productLabel()}`;
        }
        if (this.fishing && this.cookMode === 'cook-then-bank') {
            if (this.cookFishFilter) {
                return `Full: cook ${cookFilterLabel(this.cookFishFilter)} → bank`;
            }
            return 'Full: cook → bank';
        }
        if (this.fishing && this.cookMode === 'bank-raw-then-cook') {
            return `Full: bank ${cookFilterLabel(this.cookFishFilter)}→${this.bankRawTarget} cook`;
        }
        return `Full: bank ${this.productLabel()}`;
    }

    private paintClip(text: string, max = 52): string {
        const s = text.trim();
        if (s.length <= max) {
            return s;
        }
        return `${s.slice(0, Math.max(0, max - 1))}…`;
    }

    private cookPhaseLabel(): string {
        if (this.cookMode !== 'bank-raw-then-cook') {
            return this.cookingLoad ? 'cooking' : 'idle';
        }
        if (this.inCookBatch) {
            return this.cookingLoad ? 'cooking' : 'draining';
        }
        return 'fishing';
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.paintAccent() });
        p.title(`${this.paintKind()} — ${this.paintTitleStatus()}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const rate = mins > 0.5 ? `${Math.round((this.gathered / mins) * 60)}/hr` : '—/hr';
        const product = this.paintProductLabel();
        const cookOn = this.fishing && this.cookMode !== 'off';
        const burnOn = this.chopping && this.burnMode !== 'off';

        const tabNames = ['Overview', 'Skills'];
        if (cookOn) {
            tabNames.push('Cook');
        }
        if (burnOn) {
            tabNames.push('Burn');
        }
        tabNames.push('Setup');

        const tab = p.tabs('gb', tabNames);

        if (tab === 'Overview') {
            p.row(`Runtime: ${fmtDuration(mins)}`, `${product}: ${this.gathered}`, rate);
            const third =
                this.mining() && this.gems > 0
                    ? `Gems: ${this.gems}`
                    : cookOn
                      ? `Ok ${this.cooked} · Burnt ${this.burnt}`
                      : burnOn
                        ? `Burned: ${this.firesLit}`
                        : `Inv: ${Inventory.used()}/28`;
            p.row(`Banked: ${this.banked}`, `Trips: ${this.trips}`, third);
            p.bar('Pack', Inventory.used() / 28);

            const skills = this.trackedSkills();
            if (skills.length === 1) {
                const sk = skills[0];
                p.row(
                    `${this.paintSkillShort(sk)}: ${Skills.level(sk)}`,
                    `XP/hr: ${this.fmtXpHr(sk, mins)}`,
                    this.fmtXpGained(sk)
                );
            } else if (skills.length >= 2) {
                p.row(
                    ...skills.slice(0, 3).map(sk => `${this.paintSkillShort(sk)} ${this.fmtXpHr(sk, mins)}/hr`)
                );
            }

            p.text(this.paintClip(`${this.action} · ${this.target} · ${this.paintLocLabel()}`), '#8a919a');
        } else if (tab === 'Skills') {
            const skills = this.trackedSkills();
            if (skills.length === 0) {
                p.text('no tracked skills', '#8a919a');
            } else {
                for (const sk of skills) {
                    p.row(
                        `${this.paintSkillTitle(sk)} ${Skills.level(sk)}`,
                        `XP/hr: ${this.fmtXpHr(sk, mins)}`,
                        this.fmtXpGained(sk)
                    );
                }
            }
            p.text(this.paintClip(`session ${fmtDuration(mins)} · ${product} ${this.gathered} (${rate})`), '#8a919a');
        } else if (tab === 'Cook') {
            p.row(`Mode: ${this.paintCookMode()}`, `Cooked: ${this.cooked}`, `Burnt: ${this.burnt}`);
            if (this.cookMode === 'bank-raw-then-cook') {
                p.row(
                    `Raw bank: ${this.bankRawInBank}/${this.bankRawTarget}`,
                    `Phase: ${this.cookPhaseLabel()}`,
                    `After: ${this.afterCook}`
                );
                p.row(`Filter: ${this.cookFishFilter || 'all raw'}`, `Policy: ${this.burntPolicy}`);
            } else {
                p.row(`Phase: ${this.cookPhaseLabel()}`, `Policy: ${this.burntPolicy}`, `Filter: ${this.cookFishFilter || 'all raw'}`);
            }
            p.row(`Cook XP/hr: ${this.fmtXpHr('cooking', mins)}`, this.fmtXpGained('cooking'));
            p.text(
                this.rangeStand
                    ? this.paintClip(`Range: ${this.rangeName} @ (${this.rangeStand.x}, ${this.rangeStand.z})`)
                    : 'Range: not resolved',
                '#8a919a'
            );
        } else if (tab === 'Burn') {
            p.row(`Mode: ${this.burnMode}`, `Burned: ${this.firesLit}`, `Logs: ${this.burnLogs}`);
            p.row(`Spot: ${this.burnSpotName || '—'}`, `FM XP/hr: ${this.fmtXpHr('firemaking', mins)}`);
            p.row(this.fmtXpGained('firemaking'), this.hasTinderbox() ? 'Tinderbox: yes' : 'Tinderbox: missing');
            p.text(this.paintFullNote(), '#8a919a');
        } else {
            // Setup — keep ≤4 content lines so the note clears paintControls in the chatbox dock.
            const loc = this.anchor
                ? `${this.paintLocLabel()} (${this.anchor.x},${this.anchor.z})`
                : this.paintLocLabel();
            p.row(`Loc: ${this.paintClip(loc, 28)}`, `Mode: ${this.paintModeLabel()}`);
            p.row(`Action: ${this.action}`, `Target: ${this.paintClip(this.target, 22)}`);
            p.row(`Leash: ${this.leash}`, `Gear: ${this.paintClip(this.gearLabel(), 24)}`);
            p.text(this.paintFullNote(), '#8a919a');
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

    matchesSpot(actions: readonly string[]): boolean {
        return spotMatchesMethod(actions, { op: this.action, pair: this.pairOp });
    }
    fishMethodDef(): FishingMethod | null {
        return this.fishMethod;
    }
    isPowerMode(): boolean {
        return this.powerMode;
    }

    /** True when standing outside the gather leash (startup / after bank). */
    awayFromGatherSpot(slack = 4): boolean {
        return !tileWithinLeash(this, Game.tile() ?? this.getAnchor(), slack);
    }

    /**
     * True when already at/near the script bank (or bank UI open). Used so tool
     * upgrades never pull the player off trees/rocks on a cold start.
     * Draynor bank is only ~12 tiles from the willow anchor — inside ReturnToAnchor
     * slack — so "away from spot" alone is not a safe upgrade gate.
     */
    nearScriptBank(radius = 8): boolean {
        if (Bank.isOpen()) {
            return true;
        }
        const stand = this.location?.bankStand;
        const here = Game.tile();
        if (!stand || !here) {
            return false;
        }
        // Keep tight: Draynor willows are ~12 from the bank stand — must not count as "at bank".
        return Tile.from(here).distanceTo(stand) <= radius;
    }

    /**
     * If Buy/repair is on and a better affordable tool exists, buy/smith it now.
     * Caller must already be banking (bank open preferred so coin/bar counts work).
     * Returns true when an upgrade trip was attempted (success or fail with backoff).
     */
    async tryUpgradeGatherToolAtBank(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        if (!this.toolAcquireEnabled() || !this.acquireReady()) {
            return false;
        }
        if (this.isFishing() || this.toolReqs.length === 0) {
            return false;
        }
        if (!this.hasGear() || this.hasBrokenGatherTool()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.burnEnabled() && this.isBurningLoad()) {
            return false;
        }

        if (!Bank.isOpen()) {
            this.setStatus('acquire: checking tool upgrades');
            this.log('acquire: checking tool upgrades at bank');
            if (!(await this.openScriptBank(log))) {
                this.markAcquireBackoff(20_000);
                return true;
            }
            await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
        } else {
            this.setStatus('acquire: checking tool upgrades');
            this.log('acquire: checking tool upgrades at bank');
            await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 2000);
        }

        const plan = planGatherToolAcquire(this.toolReqsList(), this.acquireWorldWithBank(), {
            upgrade: true
        });
        if (!plan || plan.kind === 'repair') {
            if (Bank.isOpen()) {
                await Bank.close();
            }
            // Nothing better available — cool down so we do not re-check every bank trip.
            this.markAcquireBackoff(120_000);
            this.log('acquire: no better tool affordable right now');
            return false;
        }

        if (Bank.isOpen()) {
            await Bank.close();
        }
        this.log(`acquire: upgrade opportunity — ${plan.reason}`);
        const ok = await this.executeToolAcquirePlan(plan, log);
        this.markAcquireBackoff(ok ? 90_000 : 45_000);
        // Always head home after an upgrade attempt so BankCatch early-return is safe.
        await Traversal.walkResilient(this.getAnchor(), { radius: 3, log });
        return true;
    }

    /**
     * Power-mode tool trips clear the pack first (keep only gear names), then withdraw.
     * Bank mode keeps the same deposit-except-gear behaviour.
     */
    restockDepositMatcher(): (name: string) => boolean {
        return depositAllExcept(this.gearKeepNamesList());
    }

    stopMissingGear(reason: string, missing: string[]): void {
        const need = missing.join(' + ') || this.gearLabel();
        this.setStatus(`restock: stop — ${need}`);
        this.log(`restock: ${reason} — need ${need}; stopping`);
        ScriptRunner.stop();
    }

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

    gearKeepNamesList(): string[] {
        return this.rebuildGearKeep();
    }

    gatherToolRestockPlan() {
        return toolRestockPlan(this.toolReqs, this.skillLevel, this.heldCount, name => Bank.count(name));
    }
    toolReqsList(): readonly ToolReq[] {
        return this.toolReqs;
    }

    /** Axes/picks that are held but not worn (2004scape wieldable tools). */
    toolsToEquip(): string[] {
        if (this.toolReqs.length === 0) {
            return [];
        }
        return toolsNeedingEquip(
            this.toolReqs,
            this.skillLevel,
            this.heldCount,
            name => Equipment.contains(name)
        );
    }

    /**
     * Close bank if open, then Wield each tool. Returns false if any equip failed.
     * Must not run while bank is open — backpack ops become Deposit-*.
     */
    async equipTools(names: readonly string[], log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const unique = [...new Set(names.filter(n => n.length > 0))];
        if (unique.length === 0) {
            return true;
        }
        if (Bank.isOpen()) {
            if (!(await Bank.close())) {
                log('equip: could not close bank');
                return false;
            }
            await Execution.delayTicks(1);
        }
        let ok = true;
        for (const name of unique) {
            if (Equipment.contains(name)) {
                continue;
            }
            if (Inventory.first(name) === null) {
                log(`equip: ${name} not in inventory`);
                ok = false;
                continue;
            }
            const equipped = await Equipment.equip(name);
            if (!equipped) {
                log(`equip failed: ${name}`);
                ok = false;
            } else {
                log(`equipped ${name}`);
            }
            await Execution.delay(80 + Math.floor(Math.random() * 120));
        }
        return ok;
    }

    isLocalBurn(): boolean {
        return this.burnLocal;
    }

    /**
     * Expand the Auto start-area burn box when no clear lane remains.
     * Returns true if the plot grew.
     */
    tryExpandBurnPlot(): boolean {
        if (!this.burnLocal || !this.burnPlot) {
            return false;
        }
        const next = expandLocalFirePlot(this.burnPlot, 4, 24);
        if (!next) {
            return false;
        }
        this.burnPlot = next;
        const half = Math.floor((next.x1 - next.x0) / 2);
        this.log(`burn: expanded local plot to r=${half} around ${next.bank.x},${next.bank.z}`);
        return true;
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

    refreshBankRawTotal(): number {
        if (this.cookMode !== 'bank-raw-then-cook') {
            return this.bankRawInBank;
        }
        const total = countRawInBank(Bank.items(), this.cookFishFilter);
        this.bankRawInBank = total;

        if (!this.inCookBatch && shouldStartBankRawCookBatch(this.cookMode, total, this.bankRawTarget)) {
            this.inCookBatch = true;
            this.log(
                `cook: bank holds ${total} ${cookFilterLabel(this.cookFishFilter)} (target ${this.bankRawTarget}) — starting batch`
            );
        }
        return total;
    }

    forceBankRawEmpty(): void {
        this.bankRawInBank = 0;
    }

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
    /** @deprecated cooked/burnt now tracked via inventory.changed (raw→product). */
    recordCook(_n: number): void {
        // no-op — kept so cook tasks still compile; counts come from inventory gains
    }

    burntTotal(): number {
        return this.burnt;
    }

    cookedTotal(): number {
        return this.cooked;
    }

    finishCookCycle(): void {
        this.cookingLoad = false;
        const outcome = cookBatchAfterLoad(this.bankRawInBank, this.afterCook);
        if (outcome === 'drain-more') {

            this.inCookBatch = true;
            this.log(
                `cook: load done; bank still has ${this.bankRawInBank} ${cookFilterLabel(this.cookFishFilter)} — withdraw next`
            );
            this.setStatus('cook: withdrawing next load');
            return;
        }
        this.inCookBatch = false;
        if (outcome === 'stop') {
            this.log(
                `cook: batch drained (bank raw ${this.bankRawInBank}/${this.bankRawTarget}) — stop`
            );
            this.setStatus('cook: batch complete — stopped');
            ScriptRunner.stop();
            return;
        }
        this.log(
            `cook: batch drained (bank raw ${this.bankRawInBank}/${this.bankRawTarget}) — fish for next +${this.bankRawTarget}`
        );
        this.setStatus('cook: batch done — fishing');
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

    rawFishCount(): number {
        return Inventory.items().filter(i => isRawFishName(i.name)).length;
    }

    cookableRawCount(): number {
        return Inventory.items().filter(i => rawMatchesCookFilter(i.name, this.cookFishFilter)).length;
    }

    bankOnlyRawCount(): number {
        return Inventory.items().filter(i => isRawFishName(i.name) && !rawMatchesCookFilter(i.name, this.cookFishFilter)).length;
    }
    cookedFishCount(): number {
        return Inventory.items().filter(i => isCookedFishName(i.name)).length;
    }
    burntFishCount(): number {
        return Inventory.items().filter(i => isBurntFishName(i.name)).length;
    }

    lastRawFish() {
        const items = Inventory.items();
        const idx = lastMatchingIndex(items, n => rawMatchesCookFilter(n, this.cookFishFilter));
        return idx >= 0 ? items[idx] : null;
    }
    isCookableRaw(name: string | null | undefined): boolean {
        return rawMatchesCookFilter(name, this.cookFishFilter);
    }

    shouldDepositCookResult(name: string): boolean {
        if (this.gearKeep.length > 0 && !depositAllExcept(this.gearKeep)(name)) {
            return false;
        }
        if (isRawFishName(name)) {

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
            this.log(`burn: lit fire (+${n}, ${this.firesLit} this run)`);
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
    bot.log('drop: haul cleared');
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

            await Execution.delayUntil(() => Bank.loaded(), 3000);
            await Execution.delayTicks(1);
            const total = this.bot.refreshBankRawTotal();
            this.bot.log(`bank: raw ${cookFilterLabel(this.bot.getCookFishFilter())} ${total}/${this.bot.getBankRawTarget()}`);
        };

        this.bot.setStatus('bank: heading to bank');
        if (!(await this.bot.openScriptBank(log))) {

            this.bot.setStatus('bank: nearest bank');
            const banked = await Banking.bankNearest({
                deposit,
                log,
                afterDeposit: async () => {
                    await refreshRaw();
                }
            });
            if (!banked) {
                this.bot.setStatus('bank: unreachable — dropping');
                this.bot.log('bank: unreachable — dropping');
                await dropAll(this.bot);
                return;
            }
        } else {
            await Execution.delay(bankHumanDelayMs());
            await Bank.depositAllMatching(deposit);
            await Execution.delayTicks(1);
            await refreshRaw();
        }

        this.bot.countTrip(had);
        this.bot.log(`bank: deposited ${had} ${this.bot.productLabel()}`);

        // Opportunistic tool upgrade while already banking — never yank mid-chop.
        if (await this.bot.tryUpgradeGatherToolAtBank(log)) {
            return;
        }

        if (Bank.isOpen()) {
            await Bank.close();
        }
        if (!this.bot.isCookBatchReady()) {
            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
        }
    }
}

class FishCookDialog implements Task {
    constructor(private bot: GatheringBot) {}
    validate(): boolean {
        return this.bot.cookEnabled() && ChatDialog.isMakeMenu();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('cook: choosing product');

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

        if (this.bot.isCookingLoad()) {
            return true;
        }

        if (
            this.bot.getCookMode() === 'cook-then-bank' &&
            shouldCookThenBank(this.bot.getCookMode(), Inventory.isFull(), cookable)
        ) {
            return true;
        }

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
            this.bot.setStatus('cook: walking to range');
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
            this.bot.setStatus(`cook: ${raw.name}`);
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
                    // cooked/burnt counters update from inventory.changed
                    await Execution.delay(cookHumanDelayMs());
                }
            }
        }

        if (this.bot.cookableRawCount() === 0) {

            if (this.bot.getBurntPolicy() === 'drop' && this.bot.burntFishCount() > 0) {
                await dropBurnt(this.bot);
            }

        }
    }
}

class FishBankCooked implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || EventSignal.pending() || Game.inCombat()) {
            return false;
        }

        if (!this.bot.isCookingLoad()) {
            return false;
        }
        return this.bot.cookableRawCount() === 0;
    }

    async execute(): Promise<void> {

        if (this.bot.getBurntPolicy() === 'drop' && this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }

        const cooked = this.bot.cookedFishCount();
        const hasDeposit = Inventory.items().some(i => this.bot.shouldDepositCookResult(i.name ?? ''));
        const log = (m: string) => this.bot.log(`  ${m}`);
        const deposit = (name: string) => this.bot.shouldDepositCookResult(name);

        if (hasDeposit) {
            this.bot.setStatus('bank: cooked fish');
            if (!(await this.bot.openScriptBank(log))) {
                this.bot.log('bank: could not open for cooked — will retry');
                return;
            }
            await Execution.delay(bankHumanDelayMs());
            await Bank.depositAllMatching(deposit);
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            await Execution.delayTicks(1);

            if (this.bot.getCookMode() === 'bank-raw-then-cook') {
                this.bot.refreshBankRawTotal();
            }
            this.bot.countTrip(cooked);
            this.bot.log(`bank: deposited ${cooked} cooked (burnt=${this.bot.getBurntPolicy()})`);
        } else {
            this.bot.log('cook: load finished, nothing to bank');
        }


        if (this.bot.getCookMode() === 'bank-raw-then-cook') {
            this.bot.finishCookCycle();
            if (this.bot.isCookBatchReady()) {

                return;
            }
            if (this.bot.getAfterCook() === 'stop') {

                return;
            }

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

        return this.bot.cookableRawCount() === 0 && !EventSignal.pending() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        this.bot.setStatus('cook: withdrawing raw');

        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('cook: could not open bank for withdraw — will retry');
            return;
        }
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        await Execution.delayTicks(1);

        this.bot.refreshBankRawTotal();


        const rawItem = Bank.items().find(i => i.name !== null && this.bot.isCookableRaw(i.name));
        if (!rawItem || rawItem.name === null) {
            this.bot.log(
                `cook: no ${cookFilterLabel(this.bot.getCookFishFilter())} left in bank — ending batch`
            );

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
            this.bot.log(`cook: withdraw all ${bankName} (bank had ${this.bot.getBankRawInBank()})`);
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


        await Execution.delayUntil(() => Bank.loaded(), 2000);
        this.bot.refreshBankRawTotal();

        if (this.bot.cookableRawCount() === 0) {
            this.bot.log('cook: withdraw empty — ending batch');

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


        this.bot.beginCookingLoad();
        this.bot.log(
            `cook: withdrew ${this.bot.cookableRawCount()} ${bankName} (bank left ${this.bot.getBankRawInBank()})`
        );
    }
}

async function dropBurnt(bot: GatheringBot): Promise<void> {
    bot.setStatus('cook: dropping burnt');
    let dropped = 0;
    for (let guard = 0; guard < 30; guard++) {
        const item = Inventory.items().find(i => isBurntFishName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            dropped += before - Inventory.used();
        }
        await Execution.delay(80 + Math.floor(Math.random() * 160));
    }
    if (dropped > 0) {
        bot.log(`cook: dropped ${dropped} burnt (session ${bot.burntTotal()})`);
    }
}

/**
 * Broken pick/axe: prefer Nurmof/Bob repair when Acquire tools is on; else bank
 * for a replacement pick (legacy). Broken axe without acquire falls through to restock.
 */
class RepairBrokenGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        return this.bot.hasBrokenGatherTool();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        const brokenPick = Equipment.contains(BROKEN_PICKAXE) || Inventory.first(BROKEN_PICKAXE) !== null;
        const brokenAxe = Equipment.contains(BROKEN_AXE) || Inventory.first(BROKEN_AXE) !== null;

        if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
            const plan = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorld(), { upgrade: false });
            if (plan?.kind === 'repair') {
                const ok = await this.bot.executeToolAcquirePlan(plan, log);
                if (ok) {
                    await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
                    return;
                }
                this.bot.log('acquire: repair failed — falling back to bank/buy');
            }
        }

        // Bank replacement for broken pick (deposit broken, withdraw best).
        if (brokenPick) {
            this.bot.setStatus('pickaxe: fetching replacement');
            this.bot.log(
                this.bot.isPowerMode()
                    ? 'pickaxe: broken — power mode nearest-bank replacement'
                    : 'pickaxe: broken — banking for best replacement'
            );

            if (Equipment.contains(BROKEN_PICKAXE) && !Inventory.isFull()) {
                await Equipment.unequip(BROKEN_PICKAXE);
            }

            if (!(await this.bot.openScriptBank(log))) {
                if (this.bot.isPowerMode()) {
                    this.bot.stopMissingGear('could not open nearest bank for pickaxe', ['pickaxe']);
                    return;
                }
                this.bot.log('pickaxe: could not open bank — will retry');
                return;
            }

            await Bank.depositAllMatching(this.bot.restockDepositMatcher());
            await Bank.depositAllMatching(n => n.toLowerCase() === BROKEN_PICKAXE.toLowerCase());
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            const pick = bestPickaxe(Skills.level('mining'), name => Bank.count(name) > 0);
            if (!pick) {
                if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                    const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                        upgrade: false
                    });
                    if (buy && buy.kind !== 'repair') {
                        if (Bank.isOpen()) {
                            await Bank.close();
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log);
                        if (ok) {
                            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
                            return;
                        }
                    }
                }
                this.bot.log('pickaxe: no usable pick in bank — stopping');
                ScriptRunner.stop();
                return;
            }
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === pick.toLowerCase());
            const one = item ? withdrawOp(item.ops, '1') ?? 'Withdraw-1' : 'Withdraw-1';
            await Bank.withdraw(pick, one);
            if (!(await Execution.delayUntil(() => Inventory.first(pick) !== null, 3000))) {
                if (this.bot.isPowerMode()) {
                    this.bot.stopMissingGear('pickaxe withdraw failed', [pick]);
                    return;
                }
                this.bot.log('pickaxe: withdraw did not land — will retry');
                return;
            }
            this.bot.log(`pickaxe: replaced with ${pick}`);
            await this.bot.equipTools([pick], log);
            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
            return;
        }

        if (brokenAxe) {
            if (Equipment.contains(BROKEN_AXE) && !Inventory.isFull()) {
                await Equipment.unequip(BROKEN_AXE);
            }
            if (await this.bot.openScriptBank(log)) {
                await Bank.depositAllMatching(n => n.toLowerCase() === BROKEN_AXE.toLowerCase());
                await Execution.delayUntil(() => Bank.loaded(), 2000);
                if (Bank.isOpen()) {
                    await Bank.close();
                }
            }
            this.bot.log('axe: deposited broken — restock/acquire will fetch a usable axe');
        }
    }
}

/** Wield axes/picks already in the pack (hasGear is true when held unworn). */
class EnsureGatherToolEquipped implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.isFishing() || this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        if (this.bot.hasBrokenGatherTool()) {
            return false;
        }
        return this.bot.toolsToEquip().length > 0;
    }

    async execute(): Promise<void> {
        const need = this.bot.toolsToEquip();
        this.bot.setStatus(`equip: ${need.join(' + ')}`);
        this.bot.log(`equip: wielding ${need.join(', ')}`);
        await this.bot.equipTools(need);
    }
}

class RestockFishingGear implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isFishing() || this.bot.hasGear()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.cookEnabled() && (this.bot.isCookingLoad() || this.bot.isCookBatchReady())) {
            return false;
        }
        // Power mode only leaves the spot for tools when already away, or at start with no gear.
        // If somehow gear is lost on-spot, still allow the trip (missing gear is fatal otherwise).
        return this.bot.fishMethodDef() !== null;
    }

    async execute(): Promise<void> {
        const method = this.bot.fishMethodDef();
        if (!method) {
            return;
        }
        const missing = this.bot.missingGearNames();
        const power = this.bot.isPowerMode();
        this.bot.setStatus(`restock: ${missing.join(' + ') || this.bot.gearLabel()}`);
        this.bot.log(
            power
                ? `restock: power mode — nearest bank for ${missing.join(', ') || this.bot.gearLabel()}`
                : `restock: missing ${missing.join(', ') || this.bot.gearLabel()}`
        );
        const log = (m: string) => this.bot.log(`  ${m}`);

        if (!(await this.bot.openScriptBank(log))) {
            if (power) {
                this.bot.stopMissingGear('could not open nearest bank', missing);
                return;
            }
            this.bot.log('restock: could not open bank — will retry');
            await Execution.delayTicks(3);
            return;
        }
        await Execution.delay(bankHumanDelayMs());
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);

        // Deposit everything that is not required gear (clears haul / junk before tool withdraw).
        if (power || this.bot.awayFromGatherSpot()) {
            this.bot.log('restock: depositing non-gear first');
        }
        await Bank.depositAllMatching(this.bot.restockDepositMatcher());
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        await Execution.delayTicks(1);

        const plan = fishingRestockPlan(
            method,
            name => Inventory.count(name),
            name => Bank.count(name)
        );
        if (plan.length === 0) {
            const still = this.bot.missingGearNames();
            if (still.length > 0) {
                if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                    const buy = planFishingGearAcquire(method, this.bot.acquireWorldWithBank());
                    if (buy) {
                        if (Bank.isOpen()) {
                            await Bank.close();
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log);
                        if (ok && this.bot.hasGear()) {
                            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
                            return;
                        }
                        if (ok) {
                            // Bought one piece; loop will restock again for remaining.
                            return;
                        }
                    } else {
                        this.bot.log(
                            `restock: acquire on but cannot fund/shop ${still.join(' / ')} — need coins or stock`
                        );
                        this.bot.markAcquireBackoff(30_000);
                    }
                }
                if (power) {
                    this.bot.stopMissingGear('bank has no required fishing gear', still);
                    return;
                }
                this.bot.setStatus(`restock: missing in bank ${still.join(' + ')}`);
                this.bot.log(`restock: bank has no ${still.join(' / ')} — deposit gear or switch method`);
                await Execution.delayTicks(8);
                return;
            }
            this.bot.log('restock: gear already topped up');
            if (Bank.isOpen()) {
                await Bank.close();
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
                this.bot.log(`restock: withdraw 1× ${step.name}`);
                await Bank.withdraw(step.name, one);
            } else if (step.qty >= 50) {
                const all = withdrawOp(item.ops, 'all');
                if (all && Bank.count(step.name) <= step.qty) {
                    this.bot.log(`restock: withdraw all ${step.name} (${Bank.count(step.name)})`);
                    await Bank.withdraw(step.name, all);
                } else {
                    this.bot.log(`restock: withdraw ${step.qty}× ${step.name}`);
                    await Bank.withdrawX(step.name, step.qty);
                }
            } else {
                this.bot.log(`restock: withdraw ${step.qty}× ${step.name}`);
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
            if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                const buy = planFishingGearAcquire(method, this.bot.acquireWorldWithBank());
                if (buy) {
                    if (Bank.isOpen()) {
                        await Bank.close();
                    }
                    const ok = await this.bot.executeToolAcquirePlan(buy, log);
                    if (ok && this.bot.hasGear()) {
                        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
                        return;
                    }
                    if (ok) {
                        return;
                    }
                }
            }
            if (power) {
                this.bot.stopMissingGear('incomplete after withdraw', still);
                return;
            }
            this.bot.setStatus(`restock: still missing ${still.join(' + ')}`);
            this.bot.log(`restock: incomplete — need ${still.join(', ')}`);
            await Execution.delayTicks(5);
            return;
        }

        if (Bank.isOpen()) {
            await Bank.close();
        }
        this.bot.log(`restock: gear ok (${this.bot.gearLabel()})`);
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

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
        if (this.bot.hasBrokenGatherTool()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const missing = this.bot.missingGearNames();
        const label = missing.join(' + ') || this.bot.gearLabel();
        const power = this.bot.isPowerMode();
        this.bot.setStatus(`restock: ${label}`);
        this.bot.log(
            power
                ? `restock: power mode — nearest bank for ${label}`
                : `restock: missing ${label}`
        );
        const log = (m: string) => this.bot.log(`  ${m}`);

        if (!(await this.bot.openScriptBank(log))) {
            if (power) {
                this.bot.stopMissingGear('could not open nearest bank', missing);
                return;
            }
            this.bot.log(`restock: could not open bank for ${label} — will retry`);
            await Execution.delayTicks(3);
            return;
        }
        await Execution.delay(bankHumanDelayMs());
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);

        if (power || this.bot.awayFromGatherSpot()) {
            this.bot.log('restock: depositing non-gear first');
        }
        await Bank.depositAllMatching(this.bot.restockDepositMatcher());
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        await Execution.delayTicks(1);

        const plan = this.bot.gatherToolRestockPlan();
        if (plan.length === 0) {
            const still = this.bot.missingGearNames();
            if (still.length > 0) {
                if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                    const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                        upgrade: false
                    });
                    if (buy) {
                        if (Bank.isOpen()) {
                            await Bank.close();
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log);
                        if (ok) {
                            await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
                            return;
                        }
                    } else {
                        this.bot.log(
                            `restock: acquire on but cannot fund/shop ${still.join(' / ')} — need coins or materials`
                        );
                        this.bot.markAcquireBackoff(30_000);
                    }
                }
                if (power) {
                    this.bot.stopMissingGear('bank has no required tools', still);
                    return;
                }
                this.bot.setStatus(`restock: no ${still.join(' / ') || label} in bank`);
                this.bot.log(`restock: bank has no ${still.join(' / ')} — deposit tools and restart`);
                await Execution.delayTicks(8);
                return;
            }
            this.bot.log('restock: tools already topped up');
            // Still try to equip anything held but unworn, then leave bank.
            const leftover = this.bot.toolsToEquip();
            if (leftover.length > 0) {
                await this.bot.equipTools(leftover, log);
            } else if (Bank.isOpen()) {
                await Bank.close();
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
                this.bot.log(`restock: withdraw 1× ${step.name}`);
                await Bank.withdraw(step.name, one);
            } else {
                this.bot.log(`restock: withdraw ${step.qty}× ${step.name}`);
                await Bank.withdrawX(step.name, step.qty);
            }
            await Execution.delayUntil(
                () => Inventory.count(step.name) > before || Bank.count(step.name) === 0,
                4000
            );
            await Execution.delay(bankHumanDelayMs());
        }

        // Close bank before Wield — bank side-view turns backpack ops into Deposit-*.
        const toEquip = [
            ...plan.filter(s => s.equip).map(s => s.name),
            ...this.bot.toolsToEquip()
        ];
        if (toEquip.length > 0) {
            await this.bot.equipTools(toEquip, log);
        } else if (Bank.isOpen()) {
            await Bank.close();
        }

        if (!this.bot.hasGear()) {
            const still = this.bot.missingGearNames();
            if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                    upgrade: false
                });
                if (buy) {
                    if (Bank.isOpen()) {
                        await Bank.close();
                    }
                    const ok = await this.bot.executeToolAcquirePlan(buy, log);
                    if (ok) {
                        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
                        return;
                    }
                }
            }
            if (power) {
                this.bot.stopMissingGear('incomplete after withdraw', still);
                return;
            }
            this.bot.setStatus(`restock: still missing ${still.join(' + ')}`);
            this.bot.log(`restock: incomplete — need ${still.join(', ')}`);
            await Execution.delayTicks(5);
            return;
        }

        this.bot.log(`restock: tools ok (${this.bot.gearLabel()})`);
        await Traversal.walkResilient(this.bot.getAnchor(), { radius: 3, log });
    }
}

/**
 * Optional shop/smith upgrade when Acquire tools is on and a better tier is
 * affordable (or smithable) than what we already own.
 *
 * Only runs when already at/near the script bank (or bank UI open). Never
 * walks to bank solely to upgrade — that looked like a hang on cold start
 * (bronze axe → Bob steel) and yanked players off trees. BankCatch also
 * calls tryUpgradeGatherToolAtBank after deposits.
 */
class UpgradeGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.toolAcquireEnabled() || !this.bot.acquireReady()) {
            return false;
        }
        if (this.bot.isFishing() || this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (!this.bot.hasGear() || this.bot.hasBrokenGatherTool()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        // Bank-side only — do not open bank from the tree line for upgrades.
        return this.bot.nearScriptBank();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        await this.bot.tryUpgradeGatherToolAtBank(log);
    }
}

class Gather implements Task {
    constructor(private bot: GatheringBot) {}

    /** NPC index of the spot we last successfully started fishing on (null = no active session). */
    private activeFishIndex: number | null = null;

    private spotCandidate(n: { id: number; tile: () => Tile; actions: () => string[] }, maxDist: number): boolean {
        const t = n.tile();
        return (
            this.bot.getAnchor().distanceTo(t) <= maxDist &&
            this.bot.usable(keyOf(t)) &&
            !WHIRLPOOL_IDS.has(n.id) &&
            this.bot.matchesSpot(n.actions())
        );
    }

    /** Preferred spots inside the configured leash. */
    private findSpot() {
        const leash = this.bot.leashRadius();
        return Npcs.query()
            .name(this.bot.targetName())
            .where(n => this.spotCandidate(n, leash))
            .nearest();
    }

    /**
     * Spots that hopped just outside the leash (common on long piers).
     * Hunt radius is wider than leash so we walk to them instead of stalling.
     */
    private huntRadius(): number {
        return Math.min(40, Math.max(this.bot.leashRadius() + 10, 24));
    }

    private findHuntSpot() {
        const leash = this.bot.leashRadius();
        const hunt = this.huntRadius();
        return Npcs.query()
            .name(this.bot.targetName())
            .where(n => {
                const d = this.bot.getAnchor().distanceTo(n.tile());
                return d > leash && this.spotCandidate(n, hunt);
            })
            .nearest();
    }

    private findRock() {
        return Locs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            .where(
                l =>
                    // Allow distance 0 (standing on multi-tile tree/rock footprint).
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

        if (this.bot.cookEnabled() && (this.bot.isCookingLoad() || this.bot.isCookBatchReady())) {
            return false;
        }

        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }

        if (!this.bot.hasGear()) {
            return this.bot.isPowerMode();
        }

        if (this.bot.isFishing() && Game.animating()) {
            return true;
        }
        if (this.bot.isNpc()) {
            // Prefer in-leash spots; also stay active for pier-hop hunts just outside leash.
            if (this.findSpot() !== null || this.findHuntSpot() !== null) {
                return true;
            }
            // No spots in hunt range: keep-alive near the pier so status updates, but yield
            // to ReturnToAnchor when we've wandered off (e.g. after bank / whirlpool flee).
            return !beyondLeash(this.bot, Game.tile(), 4);
        }
        // Loc gather (mine/chop): stay active while near the anchor so we log
        // "no trees/rocks" instead of silent idle. Yield past leash+slack so
        // ReturnToAnchor can pull us back (Draynor bank is only ~12 from willows).
        if (this.findRock() !== null) {
            return true;
        }
        return !beyondLeash(this.bot, Game.tile(), 4);
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
        this.bot.log(`mine: smoking rock @ ${tile} — backing off`);
        this.bot.setStatus('mine: smoking rock');
        this.bot.cooldown(key, GAS_ROCK_TICKS + 10);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    private async fleeWhirlpool(tile: Tile): Promise<void> {
        this.bot.log(`fish: whirlpool @ ${tile} — stepping off`);
        this.bot.setStatus('fish: whirlpool');
        this.bot.cooldown(keyOf(tile), 70);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    async execute(): Promise<void> {
        if (!this.bot.hasGear()) {
            this.bot.setStatus(`gather: missing ${this.bot.gearLabel()}`);
            this.bot.log(`gather: missing ${this.bot.gearLabel()}`);
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
        const target = this.findSpot();

        if (!target) {
            this.activeFishIndex = null;
            // Pier hop: chase a nearby out-of-leash spot immediately — don't wait out leftover cast anim.
            const hunt = this.findHuntSpot();
            if (hunt) {
                const ht = hunt.tile();
                this.bot.setStatus(`fish: hunting spot @ ${ht}`);
                await Traversal.walkTo(ht, { radius: 1, timeoutMs: 20_000 });
                return;
            }
            // No hunt target either. Short finishing-cast wait, waking if a spot reappears.
            if (Game.animating()) {
                this.bot.setStatus('fish: finishing cast (no spot)');
                await Execution.delayUntil(
                    () =>
                        !Game.animating() ||
                        this.findSpot() !== null ||
                        this.findHuntSpot() !== null ||
                        EventSignal.pending() ||
                        Inventory.isFull() ||
                        Game.inCombat() ||
                        ChatDialog.canContinue(),
                    2500
                );
                return;
            }
            this.bot.setStatus(`fish: no spots within ${this.huntRadius()} of anchor`);
            await Execution.delayTicks(2);
            return;
        }

        const index = target.index;
        const startTile = target.tile();
        const key = keyOf(startTile);

        // Leftover cast anim from a previous spot — don't bind a long session to the new index.
        // Wait briefly for idle (or this spot to die), then re-click on the next pass.
        if (Game.animating() && this.activeFishIndex !== index) {
            this.bot.setStatus('fish: clearing cast before re-click');
            await Execution.delayUntil(
                () =>
                    !Game.animating() ||
                    this.fishingBroken(index, startTile) ||
                    EventSignal.pending() ||
                    Inventory.isFull() ||
                    Game.inCombat() ||
                    ChatDialog.canContinue(),
                2500
            );
            if (this.fishingBroken(index, startTile)) {
                const live = this.spotByIndex(index);
                if (live && WHIRLPOOL_IDS.has(live.id)) {
                    await this.fleeWhirlpool(live.tile());
                }
                this.activeFishIndex = null;
            }
            return;
        }

        if (!Game.animating()) {
            this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${startTile}`);
            const before = Inventory.used();
            if (!(await target.interact(this.bot.actionName()))) {
                this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
                this.activeFishIndex = null;
                await Execution.delayTicks(2);
                return;
            }

            await Execution.delayUntil(
                () => Inventory.used() > before || Game.animating() || this.fishingBroken(index, startTile),
                12000
            );

            const live = this.spotByIndex(index);
            if (live && WHIRLPOOL_IDS.has(live.id)) {
                this.activeFishIndex = null;
                await this.fleeWhirlpool(live.tile());
                return;
            }
            if (this.fishingBroken(index, startTile) && Inventory.used() === before && !Game.animating()) {
                this.activeFishIndex = null;
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key);
                }
                return;
            }
            if (Inventory.used() === before && !Game.animating()) {
                this.activeFishIndex = null;
                this.bot.cooldown(key, 4);
                return;
            }
            this.activeFishIndex = index;
        }

        for (let guard = 0; guard < 200; guard++) {
            if (this.fishingBroken(index, startTile)) {
                this.activeFishIndex = null;
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
                this.activeFishIndex = null;
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
                this.activeFishIndex = null;
                return;
            }
        }
        this.activeFishIndex = null;
    }

    private async executeMine(): Promise<void> {
        const target = this.findRock();
        if (!target) {
            // Keep-alive when near anchor with no matching loc — surface why we idle.
            if (Game.animating()) {
                this.bot.setStatus(`${this.bot.actionName()}: finishing`);
                await Execution.delayUntil(
                    () =>
                        !Game.animating() ||
                        this.findRock() !== null ||
                        EventSignal.pending() ||
                        Inventory.isFull() ||
                        Game.inCombat() ||
                        ChatDialog.canContinue(),
                    2500
                );
                return;
            }
            const kind = this.bot.woodcutting() ? 'trees' : 'rocks';
            this.bot.setStatus(`gather: no ${this.bot.targetName()} in leash`);
            this.bot.log(
                `gather: no '${this.bot.targetName()}' (${this.bot.actionName()}) ${kind} within leash ${this.bot.leashRadius()} of ${this.bot.getAnchor()}`
            );
            await Execution.delayTicks(3);
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

