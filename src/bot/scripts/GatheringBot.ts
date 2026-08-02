import {
    beyondLeash,
    createReturnToAnchorTask,
    HOME_ARRIVE_RADIUS,
    resolveRunAnchor,
    shouldSoftHomeFromGatherMiss,
    shouldWalkHomeToGatherAnchor,
    tileWithinLeash
} from '../api/Anchor.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import type { Npc } from '../api/entities/index.js';
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
import { isOpenableObstacle, openOp, walkOpening } from '../api/walkOpening.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { cookSurfaceForFishCamp, resolveFishCampCookSurface } from '../api/CookingRanges.js';
import { resolveFishingLocation, type FishingLocation } from '../api/FishingLocations.js';
import {
    effectiveGatherLeash,
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    isAutoLocation,
    NAMED_CAMP_LEASH_FLOOR,
    resourceWithinCamp,
    spotWithinGatherRange
} from '../api/GatherCamp.js';
import {
    DEFAULT_CHASE_RADIUS,
    resolveCampRadius,
    resolveChaseRadius,
    type GatheringLocation
} from '../api/GatheringLocations.js';
import { LOCAL_MINE_PREFER_RADIUS, shouldCooldownGatherTile } from '../api/TargetPick.js';
import { Trade } from '../api/hud/Trade.js';
import { Players } from '../api/queries/Players.js';
import {
    DEFAULT_TRADE_RANGE,
    countOfferMatching,
    decideGiverOfferScreen,
    decideReceiverOfferScreen,
    isConfiguredPartner,
    muleCookerActive,
    muleGathererHandoffActive,
    muleNonGathererActive,
    muleReceiverActive,
    muleSupplierActive,
    parseMuleMode,
    parsePartnerList,
    type MuleMode,
    MULE_MODE_OPTIONS
} from '../api/mule/PartnerTrade.js';
import { resolveMiningLocation } from '../api/MiningLocations.js';
import { resolveWoodcuttingLocation } from '../api/WoodcuttingLocations.js';
import { BROKEN_PICKAXE, GAS_ROCK_IDS, GAS_ROCK_TICKS, ROCK_OPTIONS, resolveRockIds } from '../api/MiningRocks.js';
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
    bestHeldToolNames,
    bestPickaxe,
    canWieldTool,
    hasAllTools,
    missingToolLabels,
    pickaxeReq,
    surplusHeldToolNames,
    tinderboxReq,
    toolAttackLevel,
    toolKeepNames,
    toolKitLabel,
    toolRestockPlan,
    toolsNeedingEquip,
    type ToolReq
} from '../api/Tools.js';
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
} from '../api/FishingMethods.js';
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
import {
    FLETCHABLE_LOG_NAMES,
    KNIFE_DELAY_MAKE_MATCH,
    SHORTBOW_NAMES,
    TICK_MANIP_KNIFE,
    combatBreaksGather,
    extraDelayLogsToDrop,
    farmerWillowPhase,
    isFletchableLogName,
    isShortbowName,
    knifeDelayPhase,
    miningRateForPickaxe,
    nextGatherClickTick,
    profileForSetting,
    shouldCookForTannerfish,
    shouldEatForTannerfish,
    type TickManipProfile
} from './TickManipLogic.js';
import {
    Banking,
    depositAllExcept,
    isDisposableGatherJunk,
    purgePackAtBank
} from '../api/Banking.js';
import { parseRangeStyle } from '../api/CombatStyle.js';
import { Shop } from '../api/hud/Shop.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { driveDialog } from '../quests/exec/primitives.js';
import {
    AXE_BAR_FOR,
    BROKEN_AXE,
    COINS,
    FORGETFUL_BANK_ODDS,
    HAMMER as ACQUIRE_HAMMER,
    acquireKeepNames,
    buyPlansCost,
    canFundPlan,
    coinsToWithdraw,
    fishingGearShopCart,
    parseToolAcquireMode,
    isFishingBaitPiece,
    planGatherToolAcquire,
    withBaitTarget,
    type AcquireWorld,
    type FishingGearBuyPlan,
    type ToolAcquireMode,
    type ToolAcquirePlan,
    type ToolVendor
} from '../api/ToolAcquire.js';

/** Default half-size of the Auto (start) burn box around the script start tile. */
const LOCAL_BURN_HALF = 8;

// Re-export pure policy from api/ so existing `#/bot/scripts/GatheringBot` imports keep working.
export {
    HOME_ARRIVE_RADIUS,
    shouldSoftHomeFromGatherMiss,
    shouldWalkHomeToGatherAnchor
} from '../api/Anchor.js';
export {
    effectiveGatherLeash,
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    isAutoLocation,
    NAMED_CAMP_LEASH_FLOOR,
    resourceWithinCamp,
    spotWithinGatherRange,
    START_TILE_LEASH_FLOOR
} from '../api/GatherCamp.js';
export { DEFAULT_CHASE_RADIUS } from '../api/GatheringLocations.js';
export {
    LOCAL_MINE_PREFER_RADIUS,
    pickNearestPreferLocal,
    shouldCooldownGatherTile
} from '../api/TargetPick.js';

/** Hostile NPCs that should keep us from re-entering camp after a kite (wildy). */
export function hostileAttackerNearby(
    npcs: readonly {
        inCombat: boolean;
        targetsMe: () => boolean;
        targetsAnotherPlayer: () => boolean;
        actions: () => string[];
        distance: () => number;
    }[],
    radius = 8
): boolean {
    const r = Math.max(1, Math.floor(radius));
    return npcs.some(n => {
        if (n.distance() > r) {
            return false;
        }
        if (!n.actions().includes('Attack')) {
            return false;
        }
        // On us, or fighting in our face (multi-combat pack).
        if (n.targetsMe()) {
            return true;
        }
        if (n.inCombat && !n.targetsAnotherPlayer() && n.distance() <= 2) {
            return true;
        }
        return false;
    });
}

/**
 * Whether FleeCombat should take the loop (multi-combat kite).
 *
 * Sticky `inCombat` with no face target is common after randoms / login and used
 * to trigger blind east walks that bung gather for tens of seconds. Only kite
 * when a real attacker is in play; yield to random-event handling otherwise.
 */
export function shouldFleeCombat(opts: {
    inCombat: boolean;
    eventPending: boolean;
    hasAttacker: boolean;
}): boolean {
    return opts.inCombat && !opts.eventPending && opts.hasAttacker;
}

export const GATHERING_SETTINGS: SettingsSchema = {
    targetType: { type: 'string', default: 'loc', label: "Target type ('loc' or 'npc')", help: 'loc = scenery (rocks/trees), npc = fishing spots' },
    target: { type: 'string', default: 'Rocks', label: 'Target name', help: 'in-game name, e.g. Rocks / Tree / Fishing spot' },
    action: { type: 'string', default: 'Mine', label: 'Action', help: 'right-click op, e.g. Mine / Chop down / Net' },
    dropMatch: { type: 'string', default: 'ore', label: 'Drop items containing', help: 'when full, drop items whose name contains this (the gathered product)' },
    // Named camps / None floor membership to NAMED_CAMP_LEASH_FLOOR. Auto alone keeps the setting.
    // Named-camp fishing hops use a separate player-relative chase disk (see DEFAULT_CHASE_RADIUS).
    leashRadius: {
        type: 'number',
        default: 10,
        min: 2,
        max: 64,
        label: 'Leash radius (tiles)',
        help:
            'Camp/start membership radius (ReturnToAnchor). Only Location Auto uses this as-is (freeform and unverified chunk snaps). Named camps and None floor to 64. Fishing spots at named camps chase from the player inside the camp, not from this pin disk alone.'
    },
    muleMode: {
        type: 'string',
        default: 'Off',
        options: [...MULE_MODE_OPTIONS],
        label: 'Mule mode',
        group: 'Mule',
        help:
            'Off = bank/drop. Gatherer = trade full haul at camp meet. Mule = accept→bank (demo for ore/logs). Cooker = accept raw fish→cook→bank cooked (Fisher + cook mode). Supplier = withdraw raw from bank→trade at meet (pairs with Cooker). Needs Partner. Disabled under location None.'
    },
    mulePartner: {
        type: 'string',
        default: '',
        label: 'Mule partner name(s)',
        group: 'Mule',
        help:
            'Comma-separated names. Gatherer/Supplier → Cooker or Mule. Cooker/Mule → gatherer/supplier name(s).'
    },
    purgePackOnStart: {
        type: 'boolean',
        default: true,
        label: 'Bank junk on start',
        group: 'Banking',
        help:
            'Deposit non-tool stacks at the camp bank before gathering so you can start with a junk pack. Skipped under location None, Cooker (raw pack), and Supplier.'
    },
    packJunk: {
        type: 'string',
        default: 'Bank',
        options: ['Bank', 'Drop', 'Off'],
        label: 'Event junk while gathering',
        group: 'Banking',
        help:
            'When random-event loot (caskets, fruit, gems, …) steals pack slots under chop-then-burn or power mode: Bank at the camp (default), Drop, or Off. Location None has no camp bank — Bank falls back to Drop. (Future: shared API helper for other scripts.)'
    }
};

export function shouldYieldGathering(
    eventPending: boolean,
    inventoryFull: boolean,
    dialogPending: boolean,
    targetGone: boolean,
    inCombat = false,
    /** When true (retaliate tick-manip), combat alone does not break the gather wait. */
    allowCombat = false
): boolean {
    return (
        eventPending ||
        inventoryFull ||
        dialogPending ||
        targetGone ||
        combatBreaksGather(inCombat, allowCombat)
    );
}

export function fishingSessionBroken(opts: {
    eventPending: boolean;
    inventoryFull: boolean;
    dialogPending: boolean;
    inCombat: boolean;
    spotGone: boolean;
    spotMoved: boolean;
    becameWhirlpool: boolean;
    /** When true (Tannerfishing / retaliate), combat alone does not break the session. */
    allowCombat?: boolean;
}): boolean {
    return (
        opts.eventPending ||
        opts.inventoryFull ||
        opts.dialogPending ||
        combatBreaksGather(opts.inCombat, opts.allowCombat === true) ||
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
    private location: GatheringLocation | null = null;
    private banked = 0;
    private trips = 0;
    private startedAt = Date.now();

    private targetType = 'loc';
    private target = 'Rocks';
    private action = 'Mine';
    private pairOp = '';
    private dropMatch = 'ore';
    private leash = 10;
    /** Raw location setting — Auto skips mob flee (expert / may-die). */
    private locationSetting = 'None';

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
    /** How to clear random-event junk that steals slots under burn/power. */
    private packJunkPolicy: 'bank' | 'drop' | 'off' = 'bank';

    private bankRawInBank = 0;

    private cookFishFilter = '';

    private cookingLoad = false;

    private inCookBatch = false;
    private rangeStand: Tile | null = null;
    /** Optional waypoint before rangeStand (e.g. exterior of a Large door). */
    private rangeApproach: Tile | null = null;
    /** Map loc SW of the oven when known (helps findRange after multi-step walk). */
    private rangeLocTile: Tile | null = null;
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

    /**
     * Optional tick-manipulation method (#160). Defaults Off.
     * Forced Off under power mode (Location None).
     */
    private tickManip: TickManipProfile = profileForSetting('mine', 'Off');
    /** Last inventory-used mark used to detect a resource roll for tick manip. */
    private lastRollTick = -1;
    /** Farmer willows 6-tick cycle anchor (Game.tick at cycle start). */
    private farmerCycleStart = -1;

    /** Off | Buy/repair — shop/repair/smith missing gather tools. */
    private toolAcquire: ToolAcquireMode = 'off';
    private acquireBackoffUntil = 0;
    /**
     * One-shot bank trip at run start when Buy/repair is on (withdraw better banked
     * axe/pick, then optional shop upgrade). Needed for chop-then-burn which never
     * hits BankCatch, and for cold starts with bronze equipped + steel in bank.
     */
    private startupToolBankSyncPending = false;
    /**
     * When true, ~1/{@link FORGETFUL_BANK_ODDS} bank closes walk out and re-open
     * as if something was forgotten. Off by default (settings: forgetfulBank).
     */
    private forgetfulBank = false;
    /** Buy/withdraw target for bait & feathers when the method needs them. */
    private baitQty = 1000;

    /** Off / gatherer (handoff) / mule (bank-side). See muleMode settings. */
    private muleMode: MuleMode = 'off';
    private mulePartners: string[] = [];
    private muleTrades = 0;

    private xpStart: Record<string, number> = {};

    private rejected = new Set<string>();
    private cooldownUntil = new Map<string, number>();
    /**
     * After FleeCombat kites off a multi-combat pack, suppress ReturnToAnchor /
     * gather re-entry until this timestamp so we don't walk straight back onto spiders.
     */
    private combatClearUntil = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.targetType = this.settings.str('targetType', 'loc').toLowerCase();
        this.target = this.settings.str('target', 'Rocks');
        this.action = this.settings.str('action', 'Mine');
        this.dropMatch = this.settings.str('dropMatch', 'ore').toLowerCase();
        // Final leash applied after location is resolved (named/None floor; Auto keeps setting).
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
            // Empty multi-select falls back to every ROCK_OPTIONS entry; log so a
            // wrong ore type (e.g. Copper at tin-only SW Varrock) is obvious.
            this.log(
                `rocks: ${rocks.join(', ') || '(none)'} → ${this.rockIds.size} loc id(s)`
                    + (chosen.length === 0 ? ' [defaulted — multi-select empty]' : '')
            );
        } else if ('fishMethod' in this.settings.raw()) {
            const method = resolveFishMethod(this.settings.str('fishMethod', FISHING_METHOD_OPTIONS[0]));
            this.targetType = 'npc';
            this.target = 'Fishing spot';
            this.action = method.op;
            this.pairOp = method.pair;
            this.baitQty = Math.max(1, Math.floor(this.settings.num('baitQty', 1000)));
            // Apply bait/feather target only to pieces that need them; tools stay min=1.
            this.fishMethod = { ...method, gear: withBaitTarget(method, this.baitQty).gear };
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
            // Every tree uses "Chop down" — no per-script action setting.
            this.chopping = true;
            this.targetType = 'loc';
            this.target = this.settings.str('treeName', 'Tree');
            this.action = 'Chop down';
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
                this.action = 'Chop down';
                this.toolReqs = [axeReq()];
                this.productKeywords = this.dropMatch.includes('log') ? [this.dropMatch] : ['log'];
            } else if (act.includes('mine') || tgt.includes('rock')) {
                this.toolReqs = [pickaxeReq()];
            }
        }

        const here = Game.tile()!;
        const locSetting = this.settings.str('location', 'None');
        this.locationSetting = locSetting;
        // Skill-branched location tables — Miner/WC must not resolve fishing piers.
        if (this.fishing) {
            this.location = resolveFishingLocation(locSetting, here);
        } else if (this.mining()) {
            this.location = resolveMiningLocation(locSetting, here);
        } else if (this.woodcutting()) {
            this.location = resolveWoodcuttingLocation(locSetting, here);
        } else {
            this.location = null;
        }

        // Membership:
        // - Resolved camp (named or Auto-snap) → camp geography (campRadius / floor 64),
        //   never the Auto UI leash (that was clipping camp scan to e.g. 18).
        // - Freeform Auto / power None → start-tile leash from UI (+ None floor).
        // Fishing discovery for named camps is any matching spot inside membership;
        // freeform uses player-relative hunt (see Gather.findFishSpot).
        if (this.location?.spot) {
            this.anchor = resolveRunAnchor(new Tile(here.x, here.z, here.level), this.location.spot);
            this.leash = resolveCampRadius(this.location.campRadius, NAMED_CAMP_LEASH_FLOOR);
        } else {
            this.anchor = new Tile(here.x, here.z, here.level);
            this.leash = effectiveGatherLeash(this.leash, locSetting);
        }

        // After ::tele / zone load, Locs+Npcs are empty for a beat (docs/NAV.md
        // #level-change-loc-lag). Blank ≠ absent — wait before first gather tick
        // so we don't idle on "no rocks/trees in leash" with an empty scene.
        if (this.fishing) {
            await Execution.delayUntil(() => Npcs.query().results().length > 0, 5000);
        } else {
            await Execution.delayUntil(() => Locs.query().results().length > 0, 5000);
        }

        this.powerMode = locSetting.toLowerCase() === 'none';

        // Mule / partner trade (NatureCrafter-style). Power mode forces Off.
        {
            this.muleMode = parseMuleMode(this.settings.str('muleMode', 'Off'));
            this.mulePartners = parsePartnerList(this.settings.str('mulePartner', ''));
            if (this.muleMode !== 'off' && this.powerMode) {
                this.log(`mule: '${this.muleMode}' disabled under location None (drop-only)`);
                this.muleMode = 'off';
            } else if (this.muleMode !== 'off' && this.mulePartners.length === 0) {
                this.log('mule: no partner names — falling back to Off (bank/drop)');
                this.muleMode = 'off';
            } else if (this.muleMode !== 'off') {
                this.log(
                    `mule: ${this.muleMode} with [${this.mulePartners.join(', ')}] ` +
                        `meet=${this.getMeetTile()}`
                );
                // Cooker needs a cook path + range; default cook-then-bank when Off.
                if (this.isMuleCooker() && this.fishing) {
                    if (this.cookMode === 'off') {
                        this.cookMode = 'cook-then-bank';
                        this.log('mule: cooker forced cookMode=cook-then-bank');
                    }
                    if (!this.rangeStand) {
                        this.resolveCookScene();
                    }
                    if (!this.rangeStand) {
                        this.log('mule: cooker has no range — falling back to Off');
                        this.muleMode = 'off';
                    }
                }
                if (this.isMuleSupplier() && !this.fishing) {
                    this.log('mule: supplier is Fisher-only — falling back to Off');
                    this.muleMode = 'off';
                }
            }
        }

        // Tick manip (#160) — per-skill dropdown; forced Off under power mode.
        {
            const skill = this.fishing ? 'fish' : this.mining() ? 'mine' : this.woodcutting() ? 'wc' : null;
            const rawLabel =
                skill && 'tickManip' in this.settings.raw()
                    ? this.settings.str('tickManip', 'Off')
                    : 'Off';
            this.tickManip = skill ? profileForSetting(skill, rawLabel) : profileForSetting('mine', 'Off');
            if (this.tickManip.method !== 'off' && this.powerMode) {
                this.log(`tick manip: '${this.tickManip.label}' disabled under location None`);
                this.tickManip = profileForSetting(skill ?? 'mine', 'Off');
            } else if (this.tickManip.method !== 'off') {
                this.log(
                    `tick manip: ${this.tickManip.label}` +
                        (this.tickManip.mayDie ? ' (may die — retaliate / no flee)' : '') +
                        (this.tickManip.useKnifeDelay ? ' [knife+log delay]' : '') +
                        (this.tickManip.timedReclick ? ' [timed reclick]' : '') +
                        (this.tickManip.shortbowRapid ? ' [shortbow rapid]' : '') +
                        (this.tickManip.farmerWillowCycle ? ' [farmer 6t]' : '') +
                        (this.tickManip.cookEatInterleave ? ' [cook/eat interleave]' : '')
                );
            }
        }

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
        this.forgetfulBank = this.settings.bool('forgetfulBank', false);
        this.startupToolBankSyncPending = false;
        if (this.toolAcquire === 'on') {
            this.log('tools: acquire Buy/repair enabled (shops + broken repair + mith+ axe smith when bars ready)');
            if (this.fishing && this.fishMethod?.gear.some(g => isFishingBaitPiece(g))) {
                this.log(`tools: bait/feather buy-up-to ${this.baitQty} when bank+inv are short`);
            }
            // WC/mining: one bank check at start so banked steel beats equipped bronze
            // even when chop-then-burn never deposits (no BankCatch upgrade hook).
            if ((this.mining() || this.woodcutting()) && this.toolReqs.length > 0) {
                this.startupToolBankSyncPending = true;
                this.log('tools: will check bank once for a better axe/pick before gathering');
            }
        }
        if (this.forgetfulBank) {
            this.log(`bank: forgetful exits on (~1/${FORGETFUL_BANK_ODDS} chance after close)`);
        }

        this.gearKeep = this.rebuildGearKeep();
        this.captureXpStart();

        {
            const raw = this.settings.str('packJunk', 'Bank').trim().toLowerCase();
            this.packJunkPolicy = raw === 'drop' ? 'drop' : raw === 'off' ? 'off' : 'bank';
            if (this.packJunkPolicy !== 'off' && (this.burnEnabled() || this.powerMode)) {
                this.log(
                    `pack junk: ${this.packJunkPolicy}` +
                        (this.powerMode && this.packJunkPolicy === 'bank' ? ' (None → drop if no bank)' : '')
                );
            }
        }

        // #170 — bank junk so gather can start with a full pack of trash.
        // Skip power drop-only, Cooker (raw pack to cook), Supplier (empty/feeder).
        if (
            this.settings.bool('purgePackOnStart', true)
            && !this.powerMode
            && !this.isMuleCooker()
            && !this.isMuleSupplier()
        ) {
            const keep = new Set(this.gearKeep.map(n => n));
            for (const n of toolKeepNames(this.toolReqs)) {
                keep.add(n);
            }
            for (const g of this.fishMethod?.gear ?? []) {
                keep.add(g.name);
            }
            await purgePackAtBank({
                keep: [...keep],
                stand: this.location?.bankStand ?? null,
                boothName: this.location?.boothName,
                boothOp: this.location?.boothOp,
                obstacles: this.location?.obstacles ?? ['door', 'gate'],
                log: m => this.log(m)
            });
        }

        // Combat policy:
        // - Tick-manip retaliate methods: Auto Retaliate ON, no FleeCombat (may die).
        // - Location Auto: expert / may-die — leave combat alone (no flee babysitting).
        // - Named/None AFK: Auto Retaliate off + FleeCombat walks hits off.
        if (this.tickManip.allowCombat) {
            if (Game.setAutoRetaliate(true)) {
                this.log('combat: Auto Retaliate ON (tick manip — may die)');
            } else {
                this.log('combat: could not enable Auto Retaliate (controls missing?)');
            }
        } else if (!isAutoLocation(this.locationSetting)) {
            if (Game.setAutoRetaliate(false)) {
                this.log('combat: Auto Retaliate off (gather — flee, do not fight)');
            } else {
                this.log('combat: could not toggle Auto Retaliate (controls missing?)');
            }
        } else {
            this.log('combat: Location Auto — mob flee off (may die)');
        }

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
                // Stamp roll tick for knife-delay / timed reclick planners (#160).
                if (this.tickManip.method !== 'off') {
                    this.noteGatherRoll();
                }
            } else if (this.mining() && (e.name ?? '').toLowerCase().startsWith('uncut ')) {
                this.gems += gained;
                this.log(`gem: ${e.name} (${this.gems} this run)`);
            }
        });

        const cookOn = this.fishing && this.cookMode !== 'off' && this.rangeStand !== null;
        const burnOn = this.burnEnabled();
        // Non-gatherer partner roles skip gather / tool restock thrash.
        const muleSide = this.isMuleNonGatherer();
        const cooker = this.isMuleCooker();
        const supplier = this.isMuleSupplier();
        const bankMule = this.isMuleReceiver();
        const gatherTools =
            !muleSide && (this.mining() || this.woodcutting() || this.toolReqs.length > 0) && !this.fishing;
        // Flee only for AFK named/None — Auto and retaliate tick-manip skip FleeCombat.
        const mobFlee = !muleSide && !isAutoLocation(this.locationSetting) && !this.tickManip.allowCombat;
        // Tannerfishing is a power-train (cook/eat on the pier) — drop haul, no bank loop.
        const tannerPower = this.tickManip.cookEatInterleave;
        // Cooker always runs cook tasks; gatherer/solo use cookOn when enabled.
        const cookTasks = cookOn || cooker;
        this.add(
            new ContinueDialog(),
            // Sticky combatCycle (no face target) — wait; do not thrash-walk.
            ...(mobFlee ? [new WaitStickyCombat(this), new FleeCombat(this)] : []),
            // Named/None only: break multi-combat pulls (wildy spiders) by walking off.
            // Auto / retaliate tick-manip = may-die — no mob flee.
            ...(!muleSide && this.tickManip.shortbowRapid ? [new EnsureShortbowRapid(this)] : []),
            ...(!muleSide && this.tickManip.cookEatInterleave ? [new TannerfishSustain(this)] : []),
            ...(!muleSide && this.tickManip.useKnifeDelay ? [new TrimKnifeDelayLogs(this)] : []),
            ...(!muleSide && (this.mining() || this.woodcutting()) ? [new RepairBrokenGatherTool(this)] : []),
            ...(!muleSide && this.fishing ? [new RestockFishingGear(this)] : []),
            ...(gatherTools
                ? [new EnsureGatherToolEquipped(this), new RestockGatherTool(this), new UpgradeGatherTool(this)]
                : []),
            ...(cookTasks
                ? [new FishCookDialog(this), new FishCookLoad(this), new FishBankCooked(this), new FishWithdrawCookBatch(this)]
                : []),
            // Random-event junk steals log slots under chop-then-burn (BankCatch deferred).
            ...(!muleSide ? [new ClearPackJunk(this)] : []),
            ...(!muleSide && burnOn ? createChopBurnTasks(this) : []),
            // Mule trade owns the loop while the modal is open (movement cancels trade).
            ...(this.muleMode !== 'off' ? [new HandleGatherMuleTrade(this)] : []),
            ...(bankMule ? [new MuleBankHaul(this), new MuleGoMeet(this), new MuleRequestOrWait(this)] : []),
            ...(cooker ? [new MuleGoMeet(this), new MuleRequestOrWait(this)] : []),
            ...(supplier
                ? [new SupplierWithdrawRaw(this), new MuleGoMeet(this), new MuleRequestOrWait(this)]
                : []),
            ...(this.isMuleGatherer() ? [new MuleGoMeet(this), new MuleRequestOrWait(this)] : []),
            this.powerMode || tannerPower ? new DropProduct(this) : new BankCatch(this),
            // Partner bank/cook/supplier sides do not gather.
            ...(muleSide ? [] : [new Gather(this)]),

            createReturnToAnchorTask(this, {
                slack: 4,
                // Long bank→camp legs (Varrock W → SW mine ≈ 60+) need web path first.
                longRangeTiles: 24,
                suppress: () =>
                    (this.burnEnabled() && this.isBurningLoad()) ||
                    this.shouldSuppressCampReentry() ||
                    this.muleMode !== 'off'
            })
        );
    }

    /** Mark a recent combat kite — hold camp re-entry briefly. */
    noteCombatFlee(holdMs = 14_000): void {
        this.combatClearUntil = Math.max(this.combatClearUntil, Date.now() + Math.max(0, holdMs));
    }

    /**
     * True while we should not walk back onto the gather anchor after fleeing
     * multi-combat (Lava Maze spiders) or while a hostile is still in our face.
     */
    shouldSuppressCampReentry(): boolean {
        if (Date.now() < this.combatClearUntil) {
            return true;
        }
        if (isAutoLocation(this.locationSetting) || this.tickManip.allowCombat) {
            return false;
        }
        return hostileAttackerNearby(
            Npcs.query().action('Attack').within(10).results(),
            10
        );
    }

    private rebuildGearKeep(): string[] {
        const names = new Set<string>(toolKeepNames(this.toolReqs));
        if (this.fishMethod) {
            for (const n of gearKeepNames(this.fishMethod)) {
                names.add(n);
            }
        }
        // Knife + one delay log for knife-delay / farmer 6t (#160).
        if (this.tickManip.useKnifeDelay || this.tickManip.farmerWillowCycle) {
            names.add(TICK_MANIP_KNIFE);
            // Prefer the log type matching the tree when chopping; else keep any fletchable.
            if (this.chopping) {
                names.add(logsForTree(this.target));
            } else {
                for (const log of FLETCHABLE_LOG_NAMES) {
                    names.add(log);
                }
            }
        }
        if (this.tickManip.shortbowRapid) {
            for (const bow of SHORTBOW_NAMES) {
                names.add(bow);
            }
        }
        // Tannerfishing is power-train: cooked catch is eaten, not banked — no gearKeep names.
        if (this.toolAcquire === 'on') {
            names.add(COINS);
            names.add(BROKEN_PICKAXE);
            names.add(BROKEN_AXE);
            names.add(ACQUIRE_HAMMER);
            // Smith materials must survive restock deposit — otherwise a Draynor
            // camp bank dumps the Runite bar before executeSmithPlan can use it.
            for (const bar of Object.values(AXE_BAR_FOR)) {
                names.add(bar);
            }
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

    /** Pause between bank UI actions so tool checks don't flash open/close. */
    async bankPace(log?: (m: string) => void): Promise<void> {
        const ms = bankHumanDelayMs();
        log?.(`bank: pause ${ms}ms`);
        await Execution.delay(ms);
    }

    /**
     * Wait for bank item list after open. Counts stay 0 until loaded — without a
     * human pause this looks like an instant open→scan→close.
     */
    async waitBankReady(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        if (!Bank.isOpen()) {
            return false;
        }
        await this.bankPace(log);
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 4000);
        if (!Bank.isOpen()) {
            return false;
        }
        // Second beat: side backpack / counts settle after the main list.
        await Execution.delayTicks(1);
        await this.bankPace();
        return Bank.isOpen();
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
        await this.bankPace();
        if (!(await Bank.withdrawX(COINS, amt))) {
            return false;
        }
        const ok = await Execution.delayUntil(() => Inventory.count(COINS) >= Math.min(need, inv + amt), 4000);
        if (ok) {
            await this.bankPace();
        }
        return ok;
    }

    /**
     * Deposit worse tiered tools (and any extra names) while the bank is open.
     * Keeps the best held tier per req + coins + optional extras (hammer/bar/broken).
     */
    async depositSurplusGatherTools(
        log: (m: string) => void = m => this.log(`  ${m}`),
        extraKeep: readonly string[] = []
    ): Promise<void> {
        if (!Bank.isOpen() || this.toolReqs.length === 0) {
            return;
        }
        const surplus = surplusHeldToolNames(this.toolReqs, this.skillLevel, this.heldCount);
        if (surplus.length === 0 && extraKeep.length === 0) {
            // Still may need to bank displaced non-tool gear after equip — handled separately.
        }
        const keep = new Set<string>([
            ...bestHeldToolNames(this.toolReqs, this.skillLevel, this.heldCount).map(n => n.toLowerCase()),
            ...extraKeep.map(n => n.toLowerCase()),
            COINS.toLowerCase()
        ]);
        // Exact tool reqs (tinderbox, etc.) stay in pack.
        for (const r of this.toolReqs) {
            if (r.kind === 'exact') {
                keep.add(r.name.toLowerCase());
            }
        }
        const toBank = surplus.filter(n => Inventory.first(n) !== null || Equipment.contains(n));
        if (toBank.length === 0) {
            // Check inventory for any tiered tool not in keep (covers worn→inv after equip).
            const tierNames = new Set(
                this.toolReqs
                    .filter((r): r is Extract<ToolReq, { kind: 'tiered' }> => r.kind === 'tiered')
                    .flatMap(r => r.tiers.map(t => t.name.toLowerCase()))
            );
            const invSurplus = Inventory.items()
                .map(i => i.name ?? '')
                .filter(n => n.length > 0 && tierNames.has(n.toLowerCase()) && !keep.has(n.toLowerCase()));
            if (invSurplus.length === 0) {
                return;
            }
            log(`bank: depositing surplus tools (${[...new Set(invSurplus)].join(', ')})`);
        } else {
            log(`bank: depositing surplus tools (${toBank.join(', ')})`);
        }
        await this.bankPace();
        await Bank.depositAllMatching(name => {
            if (!name) {
                return false;
            }
            const key = name.toLowerCase();
            if (keep.has(key)) {
                return false;
            }
            // Only auto-deposit known tiered gather tools — never random loot here.
            return this.toolReqs.some(
                r => r.kind === 'tiered' && r.tiers.some(t => t.name.toLowerCase() === key)
            );
        });
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
        await this.bankPace();
    }

    /**
     * After wielding a tool, anything that was previously equipped may land in the
     * inventory (old axe/pick, or a weapon/shield). Re-open bank if needed and
     * deposit those so users don't lose gear mid-run.
     *
     * Prefer {@link prepareWornSurplusForDeposit} + deposit while the bank is
     * already open so the happy path never needs this recovery reopen.
     */
    async bankDisplacedAfterEquip(
        displaced: readonly string[],
        log: (m: string) => void = m => this.log(`  ${m}`)
    ): Promise<void> {
        const names = [...new Set(displaced.map(n => n.trim()).filter(n => n.length > 0))];
        const stillInInv = names.filter(n => Inventory.first(n) !== null);
        // Also bank any worse tiered tools now sitting in the pack.
        const surplus = surplusHeldToolNames(this.toolReqs, this.skillLevel, name => Inventory.count(name));
        const depositNames = [...new Set([...stillInInv, ...surplus])];
        if (depositNames.length === 0) {
            return;
        }

        if (!Bank.isOpen()) {
            log(`bank: re-open to store displaced (${depositNames.join(', ')})`);
            if (!(await this.openScriptBank(log))) {
                log(`bank: could not re-open — leaving ${depositNames.join(', ')} in pack`);
                return;
            }
            if (!(await this.waitBankReady(log))) {
                return;
            }
        } else {
            await this.bankPace();
        }

        const want = new Set(depositNames.map(n => n.toLowerCase()));
        log(`bank: depositing displaced (${depositNames.join(', ')})`);
        await Bank.depositAllMatching(name => want.has((name ?? '').toLowerCase()));
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
        await this.bankPace();
    }

    /**
     * Unequip worse worn tiered tools (and optional extras) into the pack while
     * the bank is open so they can be deposited in the same session.
     * Equipment.unequip does not require the bank to be closed.
     */
    async prepareWornSurplusForDeposit(
        log: (m: string) => void = m => this.log(`  ${m}`),
        extraKeep: readonly string[] = []
    ): Promise<void> {
        if (this.toolReqs.length === 0) {
            return;
        }
        const keep = new Set(
            bestHeldToolNames(this.toolReqs, this.skillLevel, this.heldCount).map(n => n.toLowerCase())
        );
        for (const n of extraKeep) {
            keep.add(n.toLowerCase());
        }
        for (const r of this.toolReqs) {
            if (r.kind === 'exact') {
                keep.add(r.name.toLowerCase());
            }
        }
        for (const item of Equipment.items()) {
            const name = item.name ?? '';
            if (!name) {
                continue;
            }
            const key = name.toLowerCase();
            if (keep.has(key)) {
                continue;
            }
            const isTiered = this.toolReqs.some(
                r => r.kind === 'tiered' && r.tiers.some(t => t.name.toLowerCase() === key)
            );
            if (!isTiered) {
                continue;
            }
            if (Inventory.isFull()) {
                log(`bank: pack full — cannot unequip surplus ${name}`);
                break;
            }
            log(`bank: unequip surplus ${name} for deposit`);
            await Equipment.unequip(name);
            await Execution.delayUntil(() => !Equipment.contains(name) || Inventory.first(name) !== null, 3000);
            await this.bankPace();
        }
    }

    /**
     * Close the bank once. When forgetfulBank is on, ~1/FORGETFUL_BANK_ODDS chance
     * to walk a few tiles out and re-open briefly as if something was forgotten.
     */
    async closeScriptBank(
        log: (m: string) => void = m => this.log(`  ${m}`),
        opts: { allowForgetful?: boolean } = {}
    ): Promise<void> {
        if (!Bank.isOpen()) {
            return;
        }
        await this.bankPace();
        await Bank.close();
        await Execution.delayTicks(1);

        const allowForgetful = opts.allowForgetful !== false;
        if (!allowForgetful || !this.forgetfulBank) {
            return;
        }
        if (Math.floor(Math.random() * FORGETFUL_BANK_ODDS) !== 0) {
            return;
        }

        const here = Game.tile();
        if (!here) {
            return;
        }
        log(`bank: forgot something — stepping out then back (1/${FORGETFUL_BANK_ODDS})`);
        const stand = this.location?.bankStand ?? here;
        // A few tiles off the booth, not a full trip home.
        const away = new Tile(here.x + (Math.random() < 0.5 ? -3 : 3), here.z + (Math.random() < 0.5 ? -2 : 2), here.level);
        await Traversal.walkResilient(away, { radius: 1, timeoutMs: 12_000, log });
        await Execution.delay(400 + Math.floor(Math.random() * 700));
        if (await this.openScriptBank(log)) {
            await this.waitBankReady(log);
            // Glance only — no real withdraw; just the double-take.
            await this.bankPace();
            if (Bank.isOpen()) {
                await Bank.close();
            }
        }
        // Nudge back toward the booth stand so callers that walk home aren't stranded sideways.
        if (stand) {
            await Traversal.walkResilient(stand, { radius: 3, timeoutMs: 12_000, log });
        }
    }

    async executeToolAcquirePlan(
        plan: ToolAcquirePlan,
        log: (m: string) => void = m => this.log(`  ${m}`),
        opts: { bankPrepared?: boolean } = {}
    ): Promise<boolean> {
        if (plan.kind === 'repair') {
            return this.executeRepairPlan(plan, log);
        }
        if (plan.kind === 'buy') {
            return this.executeBuyPlan(plan, log, opts);
        }
        return this.executeSmithPlan(plan, log, opts);
    }

    /**
     * Buy several fishing gear lines at one vendor in a single bank fund + shop visit.
     * Fly rod + feathers at Gerrant must not bank between pieces.
     */
    async executeFishingGearShopCart(
        plans: readonly FishingGearBuyPlan[],
        log: (m: string) => void = m => this.log(`  ${m}`),
        opts: { bankPrepared?: boolean } = {}
    ): Promise<boolean> {
        if (plans.length === 0) {
            return false;
        }
        if (plans.length === 1) {
            return this.executeBuyPlan(plans[0]!, log, opts);
        }
        return this.executeBuyPlans(plans, log, opts);
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
        } else if (await this.waitBankReady(log)) {
            const keep = new Set(acquireKeepNames(plan, this.gearKeepNamesList()).map(n => n.toLowerCase()));
            await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));
            await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
            await this.bankPace();
            // Same bank open: bank surplus tools + withdraw repair float.
            await this.prepareWornSurplusForDeposit(log, acquireKeepNames(plan));
            await this.depositSurplusGatherTools(log, acquireKeepNames(plan));
            await this.withdrawCoinsFor(1000, log);
            await this.closeScriptBank(log, { allowForgetful: false });
        }

        if (this.heldCount(plan.brokenName) <= 0) {
            log(`acquire: no ${plan.brokenName} held after bank — abort repair`);
            return false;
        }

        if (!(await this.walkToToolVendor(plan.vendor, log))) {
            log(`acquire: could not reach ${plan.vendor.keeper}`);
            return false;
        }

        // Repair is item-on-NPC + chat (not Trade/shop). Use the broken tool on
        // Bob/Nurmof, then drive the repair dialogue options.
        const broken = Inventory.first(plan.brokenName);
        if (!broken) {
            log(`acquire: ${plan.brokenName} not in pack to use on ${plan.vendor.keeper}`);
            return false;
        }
        const vendor = Npcs.query().name(plan.vendor.keeper).within(12).nearest();
        if (!vendor) {
            log(`acquire: no '${plan.vendor.keeper}' nearby for repair`);
            return false;
        }

        const beforeBroken = this.heldCount(plan.brokenName);
        log(`acquire: use ${plan.brokenName} on ${plan.vendor.keeper}`);
        if (!(await broken.useOn(vendor))) {
            log(`acquire: use-on ${plan.vendor.keeper} failed — will retry / buy`);
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
            log(`acquire: ${plan.vendor.keeper} never opened repair dialogue`);
            return false;
        }
        if (!(await driveDialog(plan.prefer, log))) {
            log(`acquire: repair dialogue with ${plan.vendor.keeper} failed — will retry / buy`);
            return false;
        }
        await Execution.delayTicks(2);
        const afterBroken = this.heldCount(plan.brokenName);
        if (afterBroken < beforeBroken) {
            this.log(`acquire: repaired ${plan.brokenName} at ${plan.vendor.keeper}`);
            return true;
        }
        if (plan.label === 'pickaxe' && bestPickaxe(Skills.level('mining'), n => this.heldCount(n) > 0)) {
            this.log(`acquire: usable pick after ${plan.vendor.keeper} repair`);
            return true;
        }
        log(`acquire: ${plan.vendor.keeper} did not repair — try buy path`);
        return false;
    }

    private async executeBuyPlan(
        plan: Extract<ToolAcquirePlan, { kind: 'buy' }>,
        log: (m: string) => void,
        opts: { bankPrepared?: boolean } = {}
    ): Promise<boolean> {
        return this.executeBuyPlans([plan], log, opts);
    }

    /**
     * Fund once (vendor bankStand), open shop once, buy every line, close once.
     * All plans must share the same vendor keeper.
     */
    private async executeBuyPlans(
        plans: readonly Extract<ToolAcquirePlan, { kind: 'buy' }>[],
        log: (m: string) => void,
        opts: { bankPrepared?: boolean } = {}
    ): Promise<boolean> {
        if (plans.length === 0) {
            return false;
        }
        const vendor = plans[0]!.vendor;
        for (const p of plans) {
            if (p.vendor.keeper !== vendor.keeper) {
                log(`acquire: multi-buy mixed vendors (${p.vendor.keeper} vs ${vendor.keeper}) — abort`);
                return false;
            }
        }
        const totalCost = buyPlansCost(plans);
        const label = plans.map(p => `${p.qty}× ${p.name}`).join(' + ');
        this.setStatus(`buy: ${label}`);
        this.log(
            plans.length === 1
                ? `acquire: ${plans[0]!.reason} @ ${vendor.keeper} (${totalCost}gp)`
                : `acquire: multi-buy ${label} @ ${vendor.keeper} (${totalCost}gp)`
        );

        // Caller already deposited surplus + withdrew shop GP in the same bank session.
        const skipBank = opts.bankPrepared === true && Inventory.count(COINS) >= totalCost;
        if (!skipBank) {
            if (!(await this.openBankAt(vendor.bankStand, log))) {
                log('acquire: could not open bank for coins');
                return false;
            }
            if (!(await this.waitBankReady(log))) {
                log('acquire: bank did not load for coin withdraw');
                return false;
            }
            const keepExtra = [
                ...this.gearKeepNamesList(),
                ...plans.map(p => p.name)
            ];
            const keep = new Set(acquireKeepNames(plans[0]!, keepExtra).map(n => n.toLowerCase()));
            await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));
            await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
            await this.bankPace();
            // Same open: stash worse tools, then pull GP for the whole cart.
            await this.prepareWornSurplusForDeposit(log, acquireKeepNames(plans[0]!, keepExtra));
            await this.depositSurplusGatherTools(log, acquireKeepNames(plans[0]!, keepExtra));

            if (Inventory.count(COINS) + Bank.count(COINS) < totalCost) {
                log(`acquire: not enough coins for ${label} (${totalCost}gp)`);
                this.markAcquireBackoff(60_000);
                await this.closeScriptBank(log, { allowForgetful: false });
                return false;
            }
            if (!(await this.withdrawCoinsFor(totalCost, log))) {
                await this.closeScriptBank(log, { allowForgetful: false });
                return false;
            }
            await this.closeScriptBank(log, { allowForgetful: false });
        } else {
            log('acquire: bank already prepared — heading to shop');
            if (Bank.isOpen()) {
                await this.closeScriptBank(log, { allowForgetful: false });
            }
        }

        if (!(await this.walkToToolVendor(vendor, log))) {
            log(`acquire: could not reach ${vendor.keeper}`);
            return false;
        }
        if (!(await Shop.open(vendor.keeper))) {
            log(`acquire: could not open ${vendor.keeper}'s shop`);
            return false;
        }

        let anyBought = false;
        for (const plan of plans) {
            const before = Inventory.count(plan.name);
            const bought = await Shop.buy(plan.name, plan.qty);
            const got = bought > 0 ? bought : Math.max(0, Inventory.count(plan.name) - before);
            if (got <= 0) {
                log(`acquire: bought 0× ${plan.name} — stock/coins`);
                continue;
            }
            anyBought = true;
            this.log(`acquire: bought ${got}× ${plan.name}`);
            if (plan.equip && canWieldTool(plan.name, Skills.level('attack'))) {
                // Shop floor: equip offline. Do not walk back to bank just to stash a
                // displaced bronze tool — next BankCatch / restock deposits surplus.
                await this.equipTools([plan.name], log, { bankDisplaced: false });
            } else if (plan.equip) {
                log(`equip: skip ${plan.name} (need Attack ${toolAttackLevel(plan.name)})`);
            }
        }
        await Shop.close();

        if (!anyBought) {
            this.markAcquireBackoff(20_000);
            return false;
        }
        return true;
    }

    private async executeSmithPlan(
        plan: Extract<ToolAcquirePlan, { kind: 'smith' }>,
        log: (m: string) => void,
        opts: { bankPrepared?: boolean } = {}
    ): Promise<boolean> {
        this.setStatus(`smith: ${plan.name}`);
        this.log(`acquire: ${plan.reason} @ Varrock anvil`);

        // Restock / seed already left hammer + bar in the pack — skip the vendor
        // bank open (and a second deposit that could strand materials elsewhere).
        // opts.bankPrepared is API-symmetric with buy; materials-held alone is enough.
        void opts;
        const materialsHeld =
            Inventory.count(ACQUIRE_HAMMER) >= 1 && Inventory.count(plan.bar) >= 1;
        if (materialsHeld) {
            log('acquire: smith materials already held — heading to anvil');
            if (Bank.isOpen()) {
                await this.closeScriptBank(log, { allowForgetful: false });
            }
        } else {
            if (!(await this.openBankAt(plan.vendorBank, log))) {
                log('acquire: could not open bank for smith materials');
                return false;
            }
            if (!(await this.waitBankReady(log))) {
                log('acquire: bank did not load for smith materials');
                return false;
            }
            const keep = new Set(acquireKeepNames(plan, this.gearKeepNamesList()).map(n => n.toLowerCase()));
            await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));
            await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
            await this.bankPace();
            await this.prepareWornSurplusForDeposit(log, acquireKeepNames(plan));
            await this.depositSurplusGatherTools(log, acquireKeepNames(plan));

            if (Inventory.count(ACQUIRE_HAMMER) < 1) {
                const h = Bank.items().find(i => (i.name ?? '').toLowerCase() === ACQUIRE_HAMMER.toLowerCase());
                if (!h) {
                    log('acquire: no hammer for smithing');
                    this.markAcquireBackoff(60_000);
                    await this.closeScriptBank(log, { allowForgetful: false });
                    return false;
                }
                const one = withdrawOp(h.ops, '1') ?? 'Withdraw-1';
                await this.bankPace();
                await Bank.withdraw(ACQUIRE_HAMMER, one);
                await Execution.delayUntil(() => Inventory.count(ACQUIRE_HAMMER) > 0, 3000);
                await this.bankPace();
            }
            if (Inventory.count(plan.bar) < 1) {
                const b = Bank.items().find(i => (i.name ?? '').toLowerCase() === plan.bar.toLowerCase());
                if (!b) {
                    log(`acquire: no ${plan.bar} in bank`);
                    this.markAcquireBackoff(60_000);
                    await this.closeScriptBank(log, { allowForgetful: false });
                    return false;
                }
                const one = withdrawOp(b.ops, '1') ?? 'Withdraw-1';
                await this.bankPace();
                await Bank.withdraw(plan.bar, one);
                await Execution.delayUntil(() => Inventory.count(plan.bar) > 0, 3000);
                await this.bankPace();
            }
            await this.closeScriptBank(log, { allowForgetful: false });
        }

        if (Inventory.count(ACQUIRE_HAMMER) < 1 || Inventory.count(plan.bar) < 1) {
            log(`acquire: missing hammer or ${plan.bar} before anvil walk`);
            this.markAcquireBackoff(30_000);
            return false;
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
        // Make-X panel can linger and steal inv ops — clear before Wield.
        if (ChatDialog.isMainMakePanel() || ChatDialog.isOpen()) {
            await Execution.delayUntil(
                () => !ChatDialog.isMainMakePanel() && !ChatDialog.isOpen(),
                2500
            );
            await Execution.delayTicks(1);
        }
        // Ensure backpack tab is focused so Wield ops resolve.
        await Game.openSideTab(3);
        await Execution.delayTicks(1);
        if (plan.equip && canWieldTool(plan.name, Skills.level('attack'))) {
            // Anvil floor: same as shop — don't bank-trip solely for displaced tools.
            // Retry once — smith panel / anim lag often eats the first Wield.
            let equipped = await this.equipTools([plan.name], log, { bankDisplaced: false });
            if (!equipped && Inventory.first(plan.name) && !Equipment.contains(plan.name)) {
                log(`equip: retry ${plan.name} after smith`);
                await Execution.delayTicks(2);
                await Game.openSideTab(3);
                equipped = await this.equipTools([plan.name], log, { bankDisplaced: false });
            }
        } else if (plan.equip) {
            log(`equip: skip ${plan.name} (need Attack ${toolAttackLevel(plan.name)})`);
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
        const fishLoc = this.fishingLocation();
        // bank-raw-then-cook → bank surface; cook-then-bank → pier, unless the player
        // is already much closer to a distinct bank oven (Seers village vs Sinclair).
        let role: 'pier' | 'bank' = this.cookMode === 'bank-raw-then-cook' ? 'bank' : 'pier';
        if (fishLoc && role === 'pier') {
            const pier = cookSurfaceForFishCamp(fishLoc.name, 'pier');
            const bank = cookSurfaceForFishCamp(fishLoc.name, 'bank');
            const here = Game.tile();
            if (here && pier && bank && (pier.stand.x !== bank.stand.x || pier.stand.z !== bank.stand.z)) {
                const dp = Math.max(Math.abs(here.x - pier.stand.x), Math.abs(here.z - pier.stand.z));
                const db = Math.max(Math.abs(here.x - bank.stand.x), Math.abs(here.z - bank.stand.z));
                if (db + 12 < dp) {
                    role = 'bank';
                }
            }
        }
        const origin =
            role === 'bank' && fishLoc?.bankStand
                ? fishLoc.bankStand
                : (fishLoc?.spot ?? this.anchor);
        if (fishLoc && origin) {
            const curated = resolveFishCampCookSurface(fishLoc.name, origin, 64, role);
            if (curated) {
                this.rangeStand = curated.stand;
                this.rangeApproach = curated.approach ?? null;
                this.rangeLocTile = curated.loc ?? null;
                this.rangeName = curated.locName;
                this.cookObstacles = fishLoc.obstacles ?? ['door', 'gate'];
                this.log(
                    `cook: ${role} surface ${curated.label ?? curated.locName} ` +
                        `stand=${curated.stand}` +
                        (curated.approach ? ` approach=${curated.approach}` : '')
                );
                return;
            }
        }
        this.rangeApproach = null;
        this.rangeLocTile = null;
        if (fishLoc?.rangeStand) {
            this.rangeStand = fishLoc.rangeStand;
            this.rangeName = fishLoc.rangeName ?? 'Range';
            this.cookObstacles = fishLoc.obstacles ?? ['door', 'gate'];
            return;
        }

        const range = Locs.query().name('Range', 'Cooking range', 'Fire', 'Fireplace').nearest();
        if (range) {
            this.rangeStand = range.tile();
            this.rangeLocTile = range.tile();
            this.rangeName = range.name ?? 'Range';
            this.cookObstacles = this.location?.obstacles ?? ['door', 'gate'];
            this.log(`cook: found ${this.rangeName} @ ${this.rangeStand}`);
        }
    }

    /** Narrow location to fishing camp when cook presets (rangeStand) are needed. */
    private fishingLocation(): FishingLocation | null {
        if (!this.fishing || !this.location) {
            return null;
        }
        return this.location as FishingLocation;
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
        if (this.tickManip.cookEatInterleave) {
            return 'tanner drop';
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
        if (this.tickManip.cookEatInterleave) {
            return 'tannerfishing: cook/eat on pier; drop haul when full (may die)';
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
        if (this.tickManip.cookEatInterleave) {
            return 'Full: tanner cook/eat · drop';
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

            if (this.tickManip.method !== 'off') {
                const flags = [
                    this.tickManip.mayDie ? 'may-die' : null,
                    this.tickManip.useKnifeDelay ? 'knife' : null,
                    this.tickManip.timedReclick || this.tickManip.method === 'iron-cadence' ? 'reclick' : null,
                    this.tickManip.shortbowRapid ? 'rapid' : null,
                    this.tickManip.farmerWillowCycle ? 'farmer' : null,
                    this.tickManip.cookEatInterleave ? 'cook/eat' : null
                ]
                    .filter(Boolean)
                    .join(' · ');
                p.row(
                    `Tick: ${this.paintClip(this.tickManip.label, 22)}`,
                    flags || 'on',
                    this.tickManip.allowCombat ? 'combat OK' : 'flee'
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
            if (this.tickManip.method !== 'off') {
                p.row(
                    `Tick: ${this.paintClip(this.tickManip.label, 24)}`,
                    this.tickManip.mayDie ? 'may die' : 'safe'
                );
            }
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
    /**
     * Camp membership / wander bound (ReturnToAnchor, rock disk from home).
     * Named camps floor to {@link NAMED_CAMP_LEASH_FLOOR}; Auto freeform uses UI leash.
     */
    leashRadius(): number {
        return this.leash;
    }
    /** True when a named (or Auto-snapped) camp preset is active. */
    isNamedCamp(): boolean {
        return this.location !== null;
    }
    /**
     * Player-relative fishing primary disk.
     * Named camps: location.chaseRadius or {@link DEFAULT_CHASE_RADIUS}.
     * Freeform: same as membership leash (UI / floor).
     */
    chaseRadius(): number {
        if (this.location) {
            return resolveChaseRadius(this.location.chaseRadius, DEFAULT_CHASE_RADIUS);
        }
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

    /** Bait/feather restock + shop buy-up-to target (Fisher setting). */
    baitTargetQty(): number {
        return this.baitQty;
    }

    /**
     * Tile used to pick Harry vs Gerrant (spot/anchor preferred over current tile).
     * Catherby lobster → Harry; Port Sarim / Draynor → Gerrant.
     */
    fishingVendorNear(): { x: number; z: number } {
        const t = this.location?.spot ?? this.anchor ?? Game.tile();
        if (!t) {
            return { x: 0, z: 0 };
        }
        return { x: t.x, z: t.z };
    }

    /** Options for fishingGearShopCart / planFishingGearBuys (proximity vendor + bait qty). */
    fishingAcquireOpts(): { near: { x: number; z: number }; baitQty: number } {
        return { near: this.fishingVendorNear(), baitQty: this.baitQty };
    }

    /**
     * True when a bait/feather stack is below its restock target and we can
     * top up from bank or (with acquire) the fishing shop.
     */
    needsFishingBaitTopUp(): boolean {
        const method = this.fishMethod;
        if (!method) {
            return false;
        }
        for (const g of method.gear) {
            if (!isFishingBaitPiece(g)) {
                continue;
            }
            const inv = Inventory.count(g.name);
            if (inv >= g.restock) {
                continue;
            }
            // Bank may be closed — treat unknown bank as "maybe" when acquire is on,
            // or when we already know bank has stock (open/loaded).
            if (Bank.isOpen() || Bank.loaded()) {
                if (Bank.count(g.name) > 0 || (this.toolAcquire === 'on' && inv + Bank.count(g.name) < g.restock)) {
                    return true;
                }
            } else if (inv < g.min || this.toolAcquire === 'on') {
                // Missing min bait, or acquire may buy up to target.
                return inv < g.min || inv < g.restock;
            }
        }
        return false;
    }

    isPowerMode(): boolean {
        return this.powerMode;
    }

    /** Active tick-manip profile (#160). Off when unused / power mode. */
    tickManipProfile(): TickManipProfile {
        return this.tickManip;
    }

    /** Gather while in combat (retaliate methods). */
    allowCombatGather(): boolean {
        return this.tickManip.allowCombat;
    }

    /** Mark a resource roll tick for knife-delay / timed reclick planners. */
    noteGatherRoll(tick = Game.tick()): void {
        this.lastRollTick = Math.floor(tick);
    }

    lastGatherRollTick(): number {
        return this.lastRollTick;
    }

    farmerCycleStartTick(): number {
        return this.farmerCycleStart;
    }

    noteFarmerCycleStart(tick = Game.tick()): void {
        this.farmerCycleStart = Math.floor(tick);
    }

    /**
     * Native gather cycle length in ticks for timed reclick methods.
     * Mining uses pickaxe mining_rate; fly/WC use profile defaults.
     */
    gatherCycleTicks(): number | null {
        if (this.tickManip.method === 'iron-cadence') {
            const pick = bestPickaxe(this.skillLevel('mining'), n => this.heldCount(n) > 0);
            return miningRateForPickaxe(pick);
        }
        return this.tickManip.nativeCycleTicks;
    }

    /** Knife + one fletchable log available for delay arm. */
    hasKnifeDelayKit(): boolean {
        if (!this.tickManip.useKnifeDelay) {
            return false;
        }
        if (Inventory.count(TICK_MANIP_KNIFE) < 1) {
            return false;
        }
        return this.delayLogItem() !== null;
    }

    /** Prefer tree-matched log, else any fletchable log in pack. */
    delayLogItem() {
        if (this.chopping) {
            const want = logsForTree(this.target);
            const exact = Inventory.first(want);
            if (exact) {
                return exact;
            }
        }
        for (const name of FLETCHABLE_LOG_NAMES) {
            const item = Inventory.first(name);
            if (item) {
                return item;
            }
        }
        // Loose match (case / partial).
        return (
            Inventory.items().find(i => isFletchableLogName(i.name)) ?? null
        );
    }

    /**
     * Arm knife+log delay (+2 server).
     *
     * Server only sets %action_delay after a Make confirm (process_fletch_logs).
     * Make-X / count dialog is a failure mode for tick manip — always Make-1.
     * Product completion is incidental; re-click gather on the next tick.
     */
    async armKnifeDelay(): Promise<boolean> {
        if (ChatDialog.isMakeMenu()) {
            return this.confirmKnifeDelayMake();
        }
        const knife = Inventory.first(TICK_MANIP_KNIFE);
        const log = this.delayLogItem();
        if (!knife || !log) {
            return false;
        }
        this.setStatus('tick: knife delay');
        if (!(await knife.useOn(log))) {
            return false;
        }
        // Wait briefly for the skill-multi menu (not a full fletch).
        await Execution.delayUntil(
            () => ChatDialog.isMakeMenu() || ChatDialog.canContinue(),
            1200
        );
        if (ChatDialog.isMakeMenu()) {
            return this.confirmKnifeDelayMake();
        }
        // No menu — use-on may have no-op'd; treat as failed arm.
        return false;
    }

    /** Make-1 only (shafts when offered, else first product). Never Make-X. */
    private async confirmKnifeDelayMake(): Promise<boolean> {
        if (await ChatDialog.makeOne(KNIFE_DELAY_MAKE_MATCH)) {
            return true;
        }
        const products = ChatDialog.makeProducts();
        if (products[0] && (await ChatDialog.makeOne(products[0]))) {
            return true;
        }
        // Last resort: first product Make-1 without name match already tried;
        // do not fall back to ChatDialog.make (largest qty) or makeX.
        this.log(
            `tick: knife Make-1 failed (menu: [${products.join(', ')}]) — never Make-X`
        );
        return false;
    }

    /**
     * Drop surplus fletchable logs so knife-delay keeps exactly one delay log.
     * Prefer dropping non-tree-matched logs first when chopping.
     */
    async trimDelayLogs(keep = 1): Promise<number> {
        if (!this.tickManip.useKnifeDelay) {
            return 0;
        }
        const prefer =
            this.chopping ? logsForTree(this.target).toLowerCase() : '';
        let dropped = 0;
        for (let guard = 0; guard < 12; guard++) {
            const logs = Inventory.items().filter(i => isFletchableLogName(i.name));
            const total = logs.reduce((s, i) => s + Math.max(1, i.count), 0);
            const extra = extraDelayLogsToDrop(total, keep);
            if (extra <= 0) {
                break;
            }
            // Prefer dropping a log that is not the tree-matched delay type.
            const item =
                (prefer
                    ? logs.find(i => (i.name ?? '').toLowerCase() !== prefer)
                    : null) ??
                logs.find(i => (i.name ?? '').toLowerCase() !== prefer) ??
                logs[logs.length - 1];
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            if (await Execution.delayUntil(() => Inventory.used() < before, 2500)) {
                dropped += before - Inventory.used();
            } else {
                break;
            }
        }
        if (dropped > 0) {
            this.log(`tick: dropped ${dropped} extra delay log(s)`);
        }
        return dropped;
    }

    /** Best shortbow held or worn for 3t rapid retaliate. */
    heldShortbowName(): string | null {
        for (const n of SHORTBOW_NAMES) {
            if (Equipment.contains(n)) {
                return n;
            }
        }
        for (const n of SHORTBOW_NAMES) {
            if (Inventory.count(n) > 0) {
                return n;
            }
        }
        const loose = Inventory.items().find(i => isShortbowName(i.name));
        return loose?.name ?? null;
    }

    async ensureShortbowEquipped(): Promise<boolean> {
        if (!this.tickManip.shortbowRapid) {
            return true;
        }
        const worn = Equipment.items().some(i => isShortbowName(i.name));
        if (worn) {
            return true;
        }
        const name = this.heldShortbowName();
        if (!name) {
            return false;
        }
        this.setStatus('tick: equip shortbow');
        return Equipment.equip(name);
    }

    /**
     * Tannerfishing: cook one raw on nearest Fire/Range (scene-local).
     * Does not walk to a bank range — stays near the pier.
     */
    async tannerCookOne(): Promise<boolean> {
        if (!this.tickManip.cookEatInterleave) {
            return false;
        }
        if (ChatDialog.isMakeMenu()) {
            const raw = this.lastRawFish();
            const hint = raw?.name ?? undefined;
            if (!(await ChatDialog.make(hint))) {
                await ChatDialog.make();
            }
            await Execution.delayTicks(1);
            return true;
        }
        const raw = this.lastRawFish();
        if (!raw) {
            return false;
        }
        const oven =
            Locs.query()
                .name('Fire', 'Range', 'Cooking range')
                .where(l => l.distance() <= 8)
                .nearest() ??
            Locs.query().name('Fire', 'Range', 'Cooking range').nearest();
        if (!oven) {
            this.log('tick: tannerfish — no Fire/Range in scene (light a fire or stand near one)');
            return false;
        }
        this.setStatus(`tick: cook ${raw.name}`);
        const before = this.cookableRawCount();
        if (!(await raw.useOn(oven))) {
            return false;
        }
        await Execution.delayUntil(
            () =>
                this.cookableRawCount() < before ||
                ChatDialog.isMakeMenu() ||
                ChatDialog.canContinue(),
            5000
        );
        if (ChatDialog.isMakeMenu()) {
            const hint = raw.name ?? undefined;
            if (!(await ChatDialog.make(hint))) {
                await ChatDialog.make();
            }
            await Execution.delayTicks(1);
        }
        return true;
    }

    /** Tannerfishing: eat one cooked fish when HP is low. */
    async tannerEatOne(): Promise<boolean> {
        if (!this.tickManip.cookEatInterleave) {
            return false;
        }
        const food = Inventory.items().find(i => isCookedFishName(i.name));
        if (!food) {
            return false;
        }
        this.setStatus(`tick: eat ${food.name}`);
        const before = Skills.effective('hitpoints');
        if (!(await food.interact('Eat'))) {
            return false;
        }
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
        return true;
    }

    /** Drop one product log (farmer t6 / power-style). */
    async dropOneProductLog(): Promise<boolean> {
        const item =
            Inventory.items().find(i => this.isProduct(i.name) && isFletchableLogName(i.name)) ??
            Inventory.items().find(i => this.isProduct(i.name));
        if (!item) {
            return false;
        }
        this.setStatus(`tick: drop ${item.name}`);
        const before = Inventory.used();
        await item.interact('Drop');
        return Execution.delayUntil(() => Inventory.used() < before, 2500);
    }

    /** True when standing outside the gather leash (startup / after bank). */
    awayFromGatherSpot(slack = 4): boolean {
        return !tileWithinLeash(this, Game.tile() ?? this.getAnchor(), slack);
    }

    /**
     * Soft return toward the gather anchor after bank/shop/repair.
     * Skips only when already inside the soft arrive disk ({@link HOME_ARRIVE_RADIUS})
     * — not the full gather leash. Bank stands at named camps often sit inside the
     * leash but far from resources (Catherby bank is ~36 from the pier).
     */
    async walkHomeIfNeeded(
        log: (m: string) => void = m => this.log(`  ${m}`),
        arriveRadius = HOME_ARRIVE_RADIUS
    ): Promise<boolean> {
        const here = Game.tile();
        const anchor = this.getAnchor();
        if (here && !shouldWalkHomeToGatherAnchor(anchor.distanceTo(here), arriveRadius)) {
            return true;
        }
        this.setStatus('returning to camp');
        return Traversal.walkResilient(anchor, { radius: arriveRadius, log });
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

    /** Clear the one-shot startup bank tool check (success, fail, or nothing to do). */
    clearStartupToolBankSync(): void {
        this.startupToolBankSyncPending = false;
    }

    startupToolBankSyncNeeded(): boolean {
        return this.startupToolBankSyncPending && this.toolAcquire === 'on';
    }

    /**
     * Withdraw better banked tiered tools (steel while bronze is held) and deposit
     * the worse tier in the **same** bank open. Does **not** equip — caller closes
     * once then wields offline so we never open/close thrice for one upgrade.
     * Bank must already be open/loaded.
     * Returns names that should be equipped after the bank closes.
     */
    async withdrawBetterGatherToolsFromBank(
        log: (m: string) => void = m => this.log(`  ${m}`)
    ): Promise<{ withdrew: boolean; toEquip: string[] }> {
        if (!Bank.isOpen() || this.toolReqs.length === 0) {
            return { withdrew: false, toEquip: [] };
        }
        const plan = this.gatherToolRestockPlan();
        const upgrades = plan.filter(step =>
            this.toolReqs.some(
                r =>
                    r.kind === 'tiered' &&
                    r.tiers.some(t => t.name.toLowerCase() === step.name.toLowerCase())
            )
        );
        if (upgrades.length === 0) {
            return { withdrew: false, toEquip: [] };
        }

        for (const step of upgrades) {
            const before = this.heldCount(step.name);
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === step.name.toLowerCase());
            if (!item) {
                continue;
            }
            log(`bank: withdraw better ${step.name}`);
            const one = withdrawOp(item.ops, '1') ?? 'Withdraw-1';
            await Bank.withdraw(step.name, one);
            await Execution.delayUntil(
                () => this.heldCount(step.name) > before || Bank.count(step.name) === 0,
                4000
            );
            await this.bankPace();
        }

        // Unequip bronze (etc.) into pack while bank stays open, then deposit.
        await this.prepareWornSurplusForDeposit(log);
        await this.depositSurplusGatherTools(log);

        const attack = Skills.level('attack');
        const toEquip = [
            ...upgrades.filter(s => s.equip && canWieldTool(s.name, attack)).map(s => s.name),
            ...this.toolsToEquip()
        ];
        this.log(`tools: banked better gear ready (${this.gearLabel()})`);
        return { withdrew: true, toEquip: [...new Set(toEquip)] };
    }

    /**
     * If Buy/repair is on and a better banked or affordable tool exists, take it now.
     * Prefer bank withdraw (steel in bank + bronze held) before shop/smith.
     * Single bank session: withdraw → unequip surplus → deposit → optional coins → close once → equip.
     * Returns true when a bank/shop trip was attempted (success or fail with backoff).
     */
    async tryUpgradeGatherToolAtBank(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const startup = this.startupToolBankSyncNeeded();
        if (!this.toolAcquireEnabled()) {
            return false;
        }
        // Startup sync may run even during acquire backoff so cold-start bank steel is used.
        if (!startup && !this.acquireReady()) {
            return false;
        }
        if (this.isFishing() || this.toolReqs.length === 0) {
            if (startup) {
                this.clearStartupToolBankSync();
            }
            return false;
        }
        if (this.hasBrokenGatherTool()) {
            return false;
        }
        // Missing gear is RestockGatherTool's job — except startup still opens bank once.
        if (!this.hasGear() && !startup) {
            return false;
        }

        this.setStatus(startup ? 'tools: startup bank check' : 'acquire: checking tool upgrades');
        this.log(startup ? 'tools: startup bank check for better axe/pick' : 'acquire: checking tool upgrades at bank');
        if (!Bank.isOpen()) {
            if (!(await this.openScriptBank(log))) {
                if (startup) {
                    this.clearStartupToolBankSync();
                }
                this.markAcquireBackoff(20_000);
                return true;
            }
        }
        if (!(await this.waitBankReady(log))) {
            if (startup) {
                this.clearStartupToolBankSync();
            }
            this.markAcquireBackoff(20_000);
            return true;
        }

        // Banked steel while bronze is held: withdraw + deposit surplus (equip after close).
        const { withdrew: withdrewBetter, toEquip } = await this.withdrawBetterGatherToolsFromBank(log);
        if (startup) {
            this.clearStartupToolBankSync();
        }

        // While we're here: bank worse tools and only then plan the shop upgrade (needs bank GP).
        if (!withdrewBetter) {
            await this.prepareWornSurplusForDeposit(log);
            await this.depositSurplusGatherTools(log);
        }

        const finishEquipAndHome = async (didWork: boolean): Promise<boolean> => {
            if (Bank.isOpen()) {
                await this.closeScriptBank(log);
            }
            if (toEquip.length > 0) {
                // Surplus already banked in-session — do not reopen for displaced tools.
                await this.equipTools(toEquip, log, { bankDisplaced: false });
            }
            if (didWork || withdrewBetter) {
                await this.walkHomeIfNeeded(log);
            }
            return didWork || withdrewBetter;
        };

        if (!this.acquireReady()) {
            return finishEquipAndHome(withdrewBetter);
        }

        const plan = planGatherToolAcquire(this.toolReqsList(), this.acquireWorldWithBank(), {
            upgrade: true
        });
        if (!plan || plan.kind === 'repair') {
            // Nothing better in shop — cool down so we do not re-check every bank trip.
            this.markAcquireBackoff(120_000);
            if (withdrewBetter) {
                this.log('acquire: bank tool upgraded; no better shop tool right now');
            } else {
                this.log('acquire: no better tool affordable right now');
            }
            return finishEquipAndHome(withdrewBetter);
        }

        // Same bank open: pull shop GP before closing for the vendor walk.
        if (plan.kind === 'buy') {
            if (!canFundPlan(plan, Inventory.count(COINS), Bank.count(COINS))) {
                log(`acquire: not enough coins for ${plan.name} (${plan.cost}gp)`);
                this.markAcquireBackoff(60_000);
                return finishEquipAndHome(withdrewBetter);
            }
            if (!(await this.withdrawCoinsFor(plan.cost, log))) {
                this.markAcquireBackoff(30_000);
                return finishEquipAndHome(withdrewBetter);
            }
        }

        if (Bank.isOpen()) {
            await this.closeScriptBank(log, { allowForgetful: false });
        }
        if (toEquip.length > 0) {
            await this.equipTools(toEquip, log, { bankDisplaced: false });
        }
        this.log(`acquire: upgrade opportunity — ${plan.reason}`);
        // Coins + surplus already handled — skip the second bank open in executeBuyPlan.
        const ok = await this.executeToolAcquirePlan(plan, log, {
            bankPrepared: plan.kind === 'buy'
        });
        this.markAcquireBackoff(ok ? 90_000 : 45_000);
        // Always head home after an upgrade attempt so BankCatch early-return is safe.
        await this.walkHomeIfNeeded(log);
        return true;
    }

    /**
     * Withdraw bait/feathers toward baitQty from an already-open bank.
     * If bank is short and Buy/repair is on, buy the remainder from Harry/Gerrant.
     */
    async topUpFishingBaitAtBank(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        const method = this.fishMethod;
        if (!method || !Bank.isOpen()) {
            return false;
        }
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 3000);
        if (!Bank.isOpen()) {
            return false;
        }

        const plan = fishingRestockPlan(
            method,
            name => Inventory.count(name),
            name => Bank.count(name)
        ).filter(step => {
            const g = method.gear.find(x => x.name.toLowerCase() === step.name.toLowerCase());
            return g != null && isFishingBaitPiece(g);
        });

        for (const step of plan) {
            const before = Inventory.count(step.name);
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === step.name.toLowerCase());
            if (!item) {
                continue;
            }
            log(`bait: withdraw ${step.qty}× ${step.name}`);
            if (step.qty === 1) {
                const one = withdrawOp(item.ops, '1') ?? 'Withdraw-1';
                await Bank.withdraw(step.name, one);
            } else {
                await Bank.withdrawX(step.name, step.qty);
            }
            await Execution.delayUntil(
                () => Inventory.count(step.name) > before || Bank.count(step.name) === 0,
                4000
            );
            await this.bankPace();
        }

        // Shop buy when still under target and acquire is enabled.
        // Same-vendor cart so multi-bait lines (if any) share one shop visit.
        if (this.toolAcquireEnabled() && this.acquireReady()) {
            const cart = fishingGearShopCart(method, this.acquireWorldWithBank(), this.fishingAcquireOpts()).filter(
                p => isFishingBaitPiece({ name: p.name, restock: this.baitQty })
            );
            if (cart.length > 0) {
                const cartCost = buyPlansCost(cart);
                const invFunded = Inventory.count(COINS) >= cartCost;
                if (Bank.isOpen()) {
                    await this.closeScriptBank(log, { allowForgetful: false });
                }
                const ok = await this.executeFishingGearShopCart(cart, log, {
                    bankPrepared: invFunded
                });
                if (!ok) {
                    this.markAcquireBackoff(20_000);
                }
                return ok;
            }
        }
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

    /**
     * True when inventory already holds what executeBuy/Smith needs so restock can
     * pass bankPrepared and skip a second bank open (or a wrong-camp bank hop).
     */
    acquireMaterialsHeld(plan: ToolAcquirePlan): boolean {
        if (plan.kind === 'buy') {
            return Inventory.count(COINS) >= plan.cost;
        }
        if (plan.kind === 'smith') {
            return Inventory.count(ACQUIRE_HAMMER) >= 1 && Inventory.count(plan.bar) >= 1;
        }
        // repair: broken tool must be held; coins optional float handled in executeRepairPlan
        return this.heldCount(plan.brokenName) > 0;
    }

    gatherToolRestockPlan() {
        return toolRestockPlan(this.toolReqs, this.skillLevel, this.heldCount, name => Bank.count(name));
    }
    toolReqsList(): readonly ToolReq[] {
        return this.toolReqs;
    }

    /** Axes/picks that are held but not worn (wieldable tools on this pack). */
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
     *
     * @param opts.bankDisplaced when true (default), reopen bank to deposit gear
     *   shoved into the pack by the wield. Prefer false when surplus was already
     *   unequipped+deposited in the same bank session before this call.
     */
    async equipTools(
        names: readonly string[],
        log: (m: string) => void = m => this.log(`  ${m}`),
        opts: { bankDisplaced?: boolean } = {}
    ): Promise<boolean> {
        const attack = Skills.level('attack');
        // Drop tools we cannot wield — backpack use is still valid for mining/wc.
        const unique = [
            ...new Set(
                names.filter(n => {
                    if (!n || n.length === 0) {
                        return false;
                    }
                    if (!canWieldTool(n, attack)) {
                        log(`equip: skip ${n} (need Attack ${toolAttackLevel(n)}, have ${attack})`);
                        return false;
                    }
                    return true;
                })
            )
        ];
        if (unique.length === 0) {
            return true;
        }
        const bankDisplaced = opts.bankDisplaced !== false;
        if (Bank.isOpen()) {
            if (!(await Bank.close())) {
                log('equip: could not close bank');
                return false;
            }
            await Execution.delayTicks(1);
        }
        // Make-X / shop / dialog can leave the main modal open — Wield ops fail until clear.
        if (ChatDialog.isMainMakePanel() || ChatDialog.isOpen()) {
            await Execution.delayUntil(
                () => !ChatDialog.isMainMakePanel() && !ChatDialog.isOpen(),
                2500
            );
            await Execution.delayTicks(1);
        }
        // Backpack side-tab (3) so inv ops are live after anvil/shop main modal.
        await Game.openSideTab(3);
        await Execution.delayTicks(1);

        // Snapshot worn gear before wield — equipping an axe/pick can shove the
        // previous weapon (or worse axe) into the inventory.
        const wornBefore = new Set(
            Equipment.items()
                .map(i => i.name ?? '')
                .filter(n => n.length > 0)
                .map(n => n.toLowerCase())
        );

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
            let equipped = await Equipment.equip(name);
            // One immediate retry — first click often races smith/shop close.
            if (!equipped && Inventory.first(name) !== null && !Equipment.contains(name)) {
                await Execution.delayTicks(1);
                await Game.openSideTab(3);
                equipped = await Equipment.equip(name);
            }
            if (!equipped) {
                const item = Inventory.first(name);
                const ops = item ? item.actions().join(',') : 'missing';
                log(`equip failed: ${name} (ops=[${ops}])`);
                ok = false;
            } else {
                log(`equipped ${name}`);
            }
            await Execution.delay(180 + Math.floor(Math.random() * 220));
        }

        if (!bankDisplaced) {
            return ok;
        }

        const keepWorn = new Set(unique.map(n => n.toLowerCase()));
        const displaced: string[] = [];
        for (const item of Inventory.items()) {
            const n = item.name ?? '';
            if (!n) {
                continue;
            }
            const key = n.toLowerCase();
            if (keepWorn.has(key)) {
                continue;
            }
            // Previously worn item now in pack, or a surplus tiered tool.
            if (wornBefore.has(key)) {
                displaced.push(n);
            }
        }
        for (const n of surplusHeldToolNames(this.toolReqs, this.skillLevel, name => Inventory.count(name))) {
            displaced.push(n);
        }
        if (displaced.length > 0) {
            await this.bankDisplacedAfterEquip(displaced, log);
            if (Bank.isOpen()) {
                await this.closeScriptBank(log, { allowForgetful: false });
            }
        }
        return ok;
    }

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

    /**
     * Random-event / common junk that should not permanently occupy pack slots
     * during chop-then-burn (BankCatch is blocked while a fire load is pending).
     */
    isPackJunk(name: string | null | undefined, id: number = -1): boolean {
        if (!name) {
            return false;
        }
        const n = name.toLowerCase();
        if (this.gearKeep.length > 0 && !depositAllExcept(this.gearKeep)(name)) {
            return false;
        }
        if (n === TINDERBOX.toLowerCase()) {
            return false;
        }
        if (this.burnEnabled() && n === this.burnLogs.toLowerCase()) {
            return false;
        }
        if (this.fishMethod?.gear.some(g => g.name.toLowerCase() === n)) {
            return false;
        }
        // Keep intentional product (ore/raw) in bank mode — only drop true junk.
        if (!this.powerMode && !this.burnEnabled() && this.isProduct(name)) {
            return false;
        }
        return isDisposableGatherJunk(name, id);
    }

    packJunkItems() {
        return Inventory.items().filter(i => this.isPackJunk(i.name, i.id));
    }

    packJunkPolicyMode(): 'bank' | 'drop' | 'off' {
        return this.packJunkPolicy;
    }

    getLocation(): GatheringLocation | null {
        return this.location;
    }

    /**
     * No named camp preset — Auto freeform or power None.
     * Fisher spot search is player-relative; start tile still bounds wander via ReturnToAnchor.
     * Named camps also chase fish from the player, but fence spots to camp membership.
     */
    isFreeformCamp(): boolean {
        return this.location === null;
    }

    /** Meet tile for mule handoff — camp spot when set, else run anchor. */
    getMeetTile(): Tile {
        return this.location?.spot ?? this.getAnchor();
    }

    getMuleMode(): MuleMode {
        return this.muleMode;
    }

    getMulePartners(): readonly string[] {
        return this.mulePartners;
    }

    isMuleGatherer(): boolean {
        return muleGathererHandoffActive(this.muleMode, this.mulePartners, this.powerMode);
    }

    isMuleReceiver(): boolean {
        return muleReceiverActive(this.muleMode, this.mulePartners);
    }

    isMuleCooker(): boolean {
        return muleCookerActive(this.muleMode, this.mulePartners);
    }

    isMuleSupplier(): boolean {
        return muleSupplierActive(this.muleMode, this.mulePartners, this.powerMode);
    }

    /** Bank mule / cooker / supplier — no Gather task. */
    isMuleNonGatherer(): boolean {
        return muleNonGathererActive(this.muleMode, this.mulePartners);
    }

    atMuleMeet(radius = 2): boolean {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        return this.getMeetTile().distanceTo(here) <= radius;
    }

    nearestMulePartner() {
        if (this.mulePartners.length === 0) {
            return null;
        }
        return Players.query().name(...this.mulePartners).within(DEFAULT_TRADE_RANGE + 6).nearest();
    }

    noteMuleTrade(): void {
        this.muleTrades++;
    }

    muleTradeCount(): number {
        return this.muleTrades;
    }

    /** Product names currently held that should go to the mule / bank. */
    depositableProductNames(): string[] {
        const names = new Set<string>();
        for (const i of Inventory.items()) {
            const n = i.name ?? '';
            if (n && this.shouldDeposit(n)) {
                names.add(n);
            }
        }
        return [...names];
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
    /** Intermediate waypoint before {@link rangeTile} (building entrances). */
    rangeApproachTile(): Tile | null {
        return this.rangeApproach;
    }
    rangeLocMapTile(): Tile | null {
        return this.rangeLocTile;
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

/** First kite step away from a mob (named camps only — Auto skips FleeCombat). */
const FLEE_STEP = 12;
/** Second kite if still stuck after the first walk. */
const FLEE_STEP_HARD = 20;

/**
 * Keep empty shortbow equipped + rapid style for 3t shortbow retaliate WC (#160).
 * Re-applies after login (combat-mode varp is not persisted).
 */
class EnsureShortbowRapid implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.tickManipProfile().shortbowRapid) {
            return false;
        }
        if (Date.now() < this.retryAt) {
            return false;
        }
        const rapid = parseRangeStyle('rapid');
        const needStyle = Game.combatMode() !== rapid;
        const needBow = !Equipment.items().some(i => isShortbowName(i.name));
        return needStyle || needBow;
    }

    async execute(): Promise<void> {
        if (!(await this.bot.ensureShortbowEquipped())) {
            if (++this.fails >= 3) {
                this.fails = 0;
                this.retryAt = Date.now() + 15_000;
                this.bot.log('combat: no shortbow in pack — bring one for 3t rapid');
            }
            return;
        }
        const rapid = parseRangeStyle('rapid');
        if (Game.combatMode() === rapid) {
            this.fails = 0;
            return;
        }
        this.bot.setStatus('tick: set rapid style');
        Game.setCombatMode(rapid);
        if (await Execution.delayUntil(() => Game.combatMode() === rapid, 3000)) {
            this.fails = 0;
            this.bot.log('combat: range style → rapid (3t shortbow)');
        } else if (++this.fails >= 3) {
            this.fails = 0;
            this.retryAt = Date.now() + 15_000;
            this.bot.log('combat: could not set rapid style — retrying later');
        }
    }
}

/** Keep knife-delay pack at one fletchable log so Make-X does not multi-queue. */
class TrimKnifeDelayLogs implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.tickManipProfile().useKnifeDelay || EventSignal.pending() || Bank.isOpen()) {
            return false;
        }
        const logs = Inventory.items().filter(i => isFletchableLogName(i.name));
        const total = logs.reduce((s, i) => s + Math.max(1, i.count), 0);
        return extraDelayLogsToDrop(total, 1) > 0;
    }

    async execute(): Promise<void> {
        await this.bot.trimDelayLogs(1);
    }
}

/**
 * Tannerfishing sustain: eat cooked catch when low HP; cook raw on a nearby Fire/Range.
 * Runs above Gather so combat ticks can still heal without leaving the pier.
 * Yields to DropProduct when the pack is full and there is no oven in scene.
 */
class TannerfishSustain implements Task {
    constructor(private bot: GatheringBot) {}

    private nearestOven() {
        return (
            Locs.query()
                .name('Fire', 'Range', 'Cooking range')
                .where(l => l.distance() <= 8)
                .nearest() ??
            Locs.query().name('Fire', 'Range', 'Cooking range').nearest()
        );
    }

    validate(): boolean {
        if (!this.bot.tickManipProfile().cookEatInterleave) {
            return false;
        }
        if (EventSignal.pending() || Bank.isOpen() || ChatDialog.canContinue()) {
            return false;
        }
        const cooked = this.bot.cookedFishCount() > 0;
        if (shouldEatForTannerfish(Skills.hpFraction(), cooked)) {
            return true;
        }
        if (ChatDialog.isMakeMenu() && this.bot.cookableRawCount() > 0) {
            return true;
        }
        if (
            !shouldCookForTannerfish({
                rawCount: this.bot.cookableRawCount(),
                cookedCount: this.bot.cookedFishCount(),
                freeSlots: Inventory.free(),
                hpFraction: Skills.hpFraction()
            })
        ) {
            return false;
        }
        // Need an oven to cook — if pack is full and none in scene, let DropProduct run.
        if (!this.nearestOven()) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const cooked = this.bot.cookedFishCount() > 0;
        if (shouldEatForTannerfish(Skills.hpFraction(), cooked)) {
            await this.bot.tannerEatOne();
            return;
        }
        // Drop burnt so pack stays usable.
        if (this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }
        await this.bot.tannerCookOne();
    }
}

/**
 * Sticky combatCycle with no face-target attacker: wait (do not east-kite).
 * Lets burn/gather resume once the cycle drains instead of deadlocking the loop.
 */
class WaitStickyCombat implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return (
            Game.inCombat()
            && !EventSignal.pending()
            && !shouldFleeCombat({
                inCombat: true,
                eventPending: false,
                hasAttacker: this.hasAttacker()
            })
        );
    }

    private hasAttacker(): boolean {
        return (
            Npcs.query()
                .where(n => n.inCombat && n.targetsMe() && n.actions().includes('Attack'))
                .nearest() !== null
            || Npcs.query()
                .where(
                    n =>
                        n.inCombat
                        && !n.targetsAnotherPlayer()
                        && n.actions().includes('Attack')
                        && n.distance() <= 2
                )
                .nearest() !== null
        );
    }

    async execute(): Promise<void> {
        Game.setAutoRetaliate(false);
        this.bot.setStatus('combat: waiting clear (no attacker)');
        await Execution.delayUntil(() => !Game.inCombat() || this.hasAttacker(), 3_000);
    }
}

/**
 * Break multi-combat pulls from aggressive NPCs (lava-maze spiders, dark wizards, etc.).
 * Not for random events — those are handled by Supervisor / RandomEvents first.
 * Auto Retaliate is off at start — walking away ends the fight instead of trading hits.
 * Always kite *away* from the attacker (never walk back onto the camp anchor while
 * spiders sit on it). Prefer east when the vector is ambiguous (Lava Maze exit).
 *
 * Sticky combatCycle with no face target: {@link WaitStickyCombat} — do not blind-kite east
 * (that used to freeze chop-then-burn / pier gather for 60–90s).
 */
class FleeCombat implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return shouldFleeCombat({
            inCombat: Game.inCombat(),
            eventPending: EventSignal.pending(),
            hasAttacker: this.attacker() !== null
        });
    }

    private attacker(): Npc | null {
        return (
            Npcs.query()
                .where(n => n.inCombat && n.targetsMe() && n.actions().includes('Attack'))
                .nearest() ??
            Npcs.query()
                .where(n => n.inCombat && !n.targetsAnotherPlayer() && n.actions().includes('Attack') && n.distance() <= 2)
                .nearest()
        );
    }

    private fleeTile(
        here: { x: number; z: number; level: number },
        attacker: Npc | null,
        step: number
    ): Tile {
        if (!attacker) {
            // No face target — east first (Lava Maze spiders / wildy approach), then south.
            return new Tile(here.x + step, here.z, here.level);
        }
        const at = attacker.tile();
        let dx = here.x - at.x;
        let dz = here.z - at.z;
        // Stacked on the attacker or zero vector — default east (named wildy camps).
        if (dx === 0 && dz === 0) {
            dx = 1;
            dz = 0;
        }
        const sx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
        const sz = dz === 0 ? 0 : dz > 0 ? 1 : -1;
        // Pure north/south kite: bias a half-step east so we don't re-enter spider packs.
        const ox = sx === 0 ? 1 : sx;
        const oz = sz;
        return new Tile(here.x + ox * step, here.z + oz * step, here.level);
    }

    async execute(): Promise<void> {
        // Re-assert off in case a death/relog restored the default.
        Game.setAutoRetaliate(false);

        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(1);
            return;
        }
        const attacker = this.attacker();
        if (!attacker) {
            // validate should have filtered this; still avoid a blind kite.
            this.bot.setStatus('combat: waiting clear (no attacker)');
            await Execution.delayUntil(() => !Game.inCombat() || this.attacker() !== null, 4_000);
            return;
        }

        // Hold ReturnToAnchor / gather re-entry so we don't walk back onto the pack.
        this.bot.noteCombatFlee(12_000);

        const dest = this.fleeTile(here, attacker, FLEE_STEP);
        const who = attacker.name ?? 'attacker';
        this.bot.setStatus(`combat: fleeing ${who} → ${dest.x},${dest.z}`);
        this.bot.log(`combat: under attack by ${who} — walking off to ${dest.x},${dest.z}`);

        await Traversal.walkTo(dest, { radius: 2, timeoutMs: 16_000 });
        await Execution.delayUntil(() => !Game.inCombat(), 10_000);
        if (Game.inCombat()) {
            // Still stuck — longer kite away from whoever is on us.
            const still = Game.tile();
            const againAtk = this.attacker();
            if (still && againAtk) {
                const again = this.fleeTile(still, againAtk, FLEE_STEP_HARD);
                this.bot.log(`combat: still in combat — second kite to ${again.x},${again.z}`);
                this.bot.noteCombatFlee(14_000);
                await Traversal.walkTo(again, { radius: 2, timeoutMs: 12_000 });
                await Execution.delayUntil(() => !Game.inCombat(), 8_000);
            }
        }
        // If hostiles are still stacked on us after the kite, hold camp longer.
        if (
            Game.inCombat() ||
            hostileAttackerNearby(Npcs.query().action('Attack').within(6).results(), 6)
        ) {
            this.bot.noteCombatFlee(10_000);
        }
    }
}

/** Fletch leftovers from knife-delay / farmer Make-X (not product logs). */
function isFletchByproductName(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    return (
        n.includes('shaft') ||
        n.includes('arrow shaft') ||
        n === 'headless arrow' ||
        n.includes('stock') ||
        (n.includes('shortbow') && n.includes('(u)')) ||
        (n.includes('longbow') && n.includes('(u)'))
    );
}

// ── Mule / partner trade (shared policy: api/mule/PartnerTrade) ───────────────

class HandleGatherMuleTrade implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return this.bot.getMuleMode() !== 'off' && Trade.active();
    }

    async execute(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('mule: confirming trade');
            const before = Inventory.used();
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 4000)) {
                this.bot.noteMuleTrade();
                const delta = Inventory.used() - before;
                this.bot.log(
                    `mule: trade complete (inv Δ${delta >= 0 ? '+' : ''}${delta}, trades=${this.bot.muleTradeCount()})`
                );
            }
            return;
        }

        if (!Trade.onOfferScreen()) {
            return;
        }

        if (this.bot.isMuleReceiver() || this.bot.isMuleCooker()) {
            const matchOffer = (n: string) =>
                this.bot.isMuleCooker()
                    ? this.bot.shouldDepositRawCatch(n) || this.bot.shouldDeposit(n)
                    : this.bot.shouldDeposit(n);
            const decision = decideReceiverOfferScreen({
                partnerHeader: Trade.partner(),
                partners: this.bot.getMulePartners(),
                myOfferSlots: Trade.myOffer().length,
                theirProductCount: countOfferMatching(Trade.theirOffer(), matchOffer)
            });
            if (decision.action === 'wait-header' || decision.action === 'wait-offer') {
                this.bot.setStatus(
                    decision.action === 'wait-header' ? 'mule: reading partner' : 'mule: waiting for product offer'
                );
                await Execution.delayTicks(1);
                return;
            }
            if (decision.action === 'decline') {
                this.bot.setStatus('mule: declining trade');
                this.bot.log(`mule: ${decision.reason}`);
                await Trade.decline();
                return;
            }
            this.bot.setStatus(this.bot.isMuleCooker() ? 'mule: accepting raw for cook' : 'mule: accepting product');
            await Trade.accept();
            return;
        }

        // Gatherer / supplier: offer haul then accept.
        const step = decideGiverOfferScreen(Trade.myOffer().length);
        if (step === 'offer') {
            const names = this.bot.depositableProductNames();
            if (names.length === 0) {
                this.bot.setStatus('mule: nothing to offer — declining');
                await Trade.decline();
                return;
            }
            this.bot.setStatus(`mule: offering ${names.join(', ')}`);
            for (const name of names) {
                await Trade.offerAll(name);
            }
            await Execution.delayUntil(
                () => Trade.myOffer().length > 0 || Trade.onConfirmScreen() || !Trade.active(),
                4000
            );
            return;
        }
        this.bot.setStatus('mule: accepting handoff');
        await Trade.accept();
        await Execution.delayUntil(() => Trade.onConfirmScreen() || !Trade.active(), 4000);
    }
}

class MuleGoMeet implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (Trade.active() || EventSignal.pending()) {
            return false;
        }
        if (this.bot.atMuleMeet()) {
            return false;
        }
        if (this.bot.isMuleGatherer() || this.bot.isMuleSupplier()) {
            return Inventory.isFull() && this.bot.hasDepositable();
        }
        if (this.bot.isMuleReceiver()) {
            // Mule returns to meet when pack empty (after bank) or still empty.
            return !this.bot.hasDepositable() || !Inventory.isFull();
        }
        if (this.bot.isMuleCooker()) {
            // Idle empty → meet; if holding cookable raw, cook tasks own the loop.
            return this.bot.cookableRawCount() === 0 && this.bot.cookedFishCount() === 0;
        }
        return false;
    }

    async execute(): Promise<void> {
        const meet = this.bot.getMeetTile();
        this.bot.setStatus(`mule: walking to meet ${meet}`);
        await Traversal.walkResilient(meet, {
            radius: 2,
            timeoutMs: 90_000,
            log: m => this.bot.log(`  ${m}`)
        });
    }
}

class MuleRequestOrWait implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (Trade.active() || EventSignal.pending()) {
            return false;
        }
        if (!this.bot.atMuleMeet()) {
            return false;
        }
        if (this.bot.isMuleGatherer() || this.bot.isMuleSupplier()) {
            return Inventory.isFull() && this.bot.hasDepositable();
        }
        if (this.bot.isMuleReceiver() || this.bot.isMuleCooker()) {
            // Idle at meet waiting for gatherer/supplier (cook when we hold raw).
            if (this.bot.isMuleCooker() && this.bot.cookableRawCount() > 0) {
                return false;
            }
            return !this.bot.hasDepositable() || this.bot.isMuleCooker();
        }
        return false;
    }

    async execute(): Promise<void> {
        const partner = this.bot.nearestMulePartner();
        if (!partner || partner.distance() > DEFAULT_TRADE_RANGE) {
            const msg =
                this.bot.isMuleGatherer() || this.bot.isMuleSupplier()
                    ? 'mule: waiting for partner at meet'
                    : this.bot.isMuleCooker()
                      ? 'mule: cooker waiting for raw'
                      : 'mule: waiting for gatherer';
            this.bot.setStatus(msg);
            // Log once every few waits so harness/single-account smokes can assert.
            this.bot.log(msg);
            await Execution.delayTicks(2);
            return;
        }
        const name = partner.name ?? this.bot.getMulePartners()[0] ?? '';
        if (!isConfiguredPartner(name, this.bot.getMulePartners()) && name) {
            // name from query should match
        }
        this.bot.setStatus(`mule: requesting trade with ${name || 'partner'}`);
        await Trade.request(name);
        await Execution.delayUntil(() => Trade.active() || EventSignal.pending(), 4000);
    }
}

/**
 * Supplier: bank holds raw → withdraw a pack → meet → trade (pairs with Cooker).
 * bankRawBeforeCook is the "N ready" gate (default 28) before a trip starts.
 */
class SupplierWithdrawRaw implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isMuleSupplier() || Trade.active() || EventSignal.pending()) {
            return false;
        }
        // Already carrying raw for the handoff.
        if (this.bot.rawFishCount() > 0) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        const target = Math.max(1, this.bot.getBankRawTarget() || 28);
        this.bot.setStatus(`mule: supplier withdraw raw (need bank ≥${target})`);
        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('mule: supplier bank open failed — retry');
            return;
        }
        await Execution.delayTicks(1);
        // Count raw stacks in open bank (same filter as cook).
        const bankRaw = Bank.items()
            .filter(i => this.bot.isCookableRaw(i.name))
            .reduce((s, i) => s + Math.max(1, i.count), 0);
        if (bankRaw < target) {
            this.bot.log(`mule: supplier bank raw ${bankRaw} < ${target} — waiting`);
            if (Bank.isOpen()) {
                await Bank.close();
            }
            await Execution.delayTicks(8);
            return;
        }
        this.bot.log(`mule: supplier withdrawing raw (bank ${bankRaw})`);
        for (let i = 0; i < 40 && Inventory.free() > 0; i++) {
            const stack = Bank.items().find(it => this.bot.isCookableRaw(it.name) && it.count > 0);
            if (!stack?.name) {
                break;
            }
            const before = this.bot.rawFishCount();
            await Bank.withdraw(stack.name, 'Withdraw-All');
            await Execution.delayUntil(() => this.bot.rawFishCount() > before || Inventory.isFull(), 2500);
            if (this.bot.rawFishCount() === before) {
                // Try single withdraw if All failed.
                await Bank.withdraw(stack.name, 'Withdraw-1');
                await Execution.delayUntil(() => this.bot.rawFishCount() > before || Inventory.isFull(), 2000);
                if (this.bot.rawFishCount() === before) {
                    break;
                }
            }
        }
        if (Bank.isOpen()) {
            await Bank.close();
        }
        this.bot.log(`mule: supplier pack raw=${this.bot.rawFishCount()} free=${Inventory.free()}`);
    }
}

class MuleBankHaul implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isMuleReceiver() || Trade.active() || EventSignal.pending()) {
            return false;
        }
        return this.bot.hasDepositable();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        const had = this.bot.products().length;
        this.bot.setStatus('mule: banking haul');
        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('mule: bank open failed — will retry');
            return;
        }
        await Execution.delayTicks(1);
        await Bank.depositAllMatching(name => this.bot.shouldDeposit(name));
        await Execution.delayUntil(() => !this.bot.hasDepositable() || !Bank.isOpen(), 5000);
        if (Bank.isOpen()) {
            await Bank.close();
        }
        this.bot.countTrip(had);
        this.bot.log(`mule: deposited haul (${had} stacks, trades=${this.bot.muleTradeCount()})`);
        // Walk back toward meet (camp).
        await this.bot.walkHomeIfNeeded(log);
    }
}

/**
 * Clear random-event leftovers that steal slots. Critical for chop-then-burn:
 * BankCatch is deferred while a log load is pending, so caskets/gems/fruit would
 * otherwise permanently shrink free space for logs on long AFK runs.
 *
 * Default is **bank** at the camp; **drop** remains for power/None or preference.
 * (Future: lift to api/ for other scripts — see plan docs.)
 */
class ClearPackJunk implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (EventSignal.pending()) {
            return false;
        }
        if (this.bot.packJunkPolicyMode() === 'off') {
            return false;
        }
        // Power + burn do not bank every full pack of product with the haul.
        // Normal bank-mode gather already deposits junk via depositAllExcept(gear).
        if (!this.bot.burnEnabled() && !this.bot.isPowerMode()) {
            return false;
        }
        const junk = this.bot.packJunkItems();
        if (junk.length === 0) {
            return false;
        }
        const free = Inventory.free();
        if (this.bot.burnEnabled()) {
            return free <= 6 || Inventory.isFull();
        }
        return free <= 2 || Inventory.isFull();
    }

    async execute(): Promise<void> {
        const junkN = this.bot.packJunkItems().length;
        const preferBank = this.bot.packJunkPolicyMode() === 'bank' && !this.bot.isPowerMode();
        if (preferBank) {
            this.bot.setStatus('bank: event junk');
            const log = (m: string) => this.bot.log(`  ${m}`);
            if (await this.bot.openScriptBank(log)) {
                await Bank.depositAllMatching((name, id) => this.bot.isPackJunk(name, id));
                await Execution.delayTicks(1);
                if (Bank.isOpen()) {
                    await this.bot.closeScriptBank(log);
                }
                const left = this.bot.packJunkItems().length;
                this.bot.log(
                    `bank: deposited event junk (${junkN - left} stack(s); ${left} left)`
                );
                if (left === 0) {
                    return;
                }
                this.bot.log('bank: some junk still held — falling back to drop');
            } else {
                this.bot.log('bank: could not open for event junk — falling back to drop');
            }
        }

        this.bot.setStatus('dropping junk');
        let dropped = 0;
        for (let guard = 0; guard < 28; guard++) {
            const item = this.bot.packJunkItems()[0];
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
                dropped += before - Inventory.used();
            } else {
                break;
            }
        }
        if (dropped > 0) {
            this.bot.log(`drop: cleared ${dropped} random/common junk stack(s) (pack space)`);
        }
    }
}

class DropProduct implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!Inventory.isFull()) {
            return false;
        }
        if (this.bot.tickManipProfile().cookEatInterleave) {
            // Burnt always goes; raw haul drops; excess cooked beyond food buffer.
            return (
                this.bot.burntFishCount() > 0 ||
                this.bot.products().length > 0 ||
                this.bot.cookedFishCount() > 4
            );
        }
        if (
            (this.bot.tickManipProfile().useKnifeDelay ||
                this.bot.tickManipProfile().farmerWillowCycle) &&
            Inventory.items().some(i => isFletchByproductName(i.name))
        ) {
            return true;
        }
        return this.bot.products().length > 0;
    }

    async execute(): Promise<void> {
        // Drop burnt first during Tannerfishing so pack space opens for cook/eat.
        if (this.bot.tickManipProfile().cookEatInterleave && this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }
        // Knife/farmer: clear Make-X leftovers so the pack cannot soft-lock on shafts.
        if (
            this.bot.tickManipProfile().useKnifeDelay ||
            this.bot.tickManipProfile().farmerWillowCycle
        ) {
            await dropFletchByproducts(this.bot);
        }
        await dropAll(this.bot);
        // Tannerfishing: if still full of cooked food, trim to a small buffer.
        if (this.bot.tickManipProfile().cookEatInterleave && Inventory.isFull()) {
            await dropExcessCooked(this.bot, 3);
        }
    }
}

async function dropAll(bot: GatheringBot): Promise<void> {
    bot.setStatus('dropping');
    // Tannerfishing keeps cooked catch as food — products() is raw-only for Fisher.
    for (let guard = 0; guard < 30; guard++) {
        const item = bot.products()[0];
        if (!item) {
            break;
        }
        // Knife-delay: never drop the last fletchable delay log.
        if (
            bot.tickManipProfile().useKnifeDelay &&
            isFletchableLogName(item.name)
        ) {
            const logs = Inventory.items().filter(i => isFletchableLogName(i.name));
            const total = logs.reduce((s, i) => s + Math.max(1, i.count), 0);
            if (total <= 1) {
                // Only the delay log left among products — stop.
                const other = bot.products().find(i => !isFletchableLogName(i.name));
                if (!other) {
                    break;
                }
                const beforeOther = Inventory.used();
                await other.interact('Drop');
                await Execution.delayUntil(() => Inventory.used() < beforeOther, 3000);
                continue;
            }
        }
        const before = Inventory.used();
        await item.interact('Drop');
        await Execution.delayUntil(() => Inventory.used() < before, 3000);
    }
    bot.log('drop: haul cleared');
}

/** Drop cooked fish above `keep` (Tannerfishing food buffer). */
async function dropExcessCooked(bot: GatheringBot, keep = 3): Promise<void> {
    let dropped = 0;
    for (let guard = 0; guard < 28; guard++) {
        if (bot.cookedFishCount() <= keep) {
            break;
        }
        const item = Inventory.items().find(i => isCookedFishName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            dropped += before - Inventory.used();
        } else {
            break;
        }
    }
    if (dropped > 0) {
        bot.log(`tick: dropped ${dropped} excess cooked (keep ${keep})`);
    }
}

/** Drop arrow shafts / unstrung bows from knife Make-X so knife-delay cannot soft-lock. */
async function dropFletchByproducts(bot: GatheringBot): Promise<void> {
    let dropped = 0;
    for (let guard = 0; guard < 28; guard++) {
        const item = Inventory.items().find(i => isFletchByproductName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            dropped += before - Inventory.used();
        } else {
            break;
        }
    }
    if (dropped > 0) {
        bot.log(`tick: dropped ${dropped} fletch byproduct(s)`);
    }
}

class BankCatch implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.bankCatchBlockedByCook() || this.bot.bankCatchBlockedByBurn()) {
            return false;
        }
        // Partner modes: hand off / cooker / supplier — not BankCatch.
        if (
            this.bot.isMuleGatherer()
            || this.bot.isMuleReceiver()
            || this.bot.isMuleCooker()
            || this.bot.isMuleSupplier()
        ) {
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

        // Same bank open: top up bait/feathers toward baitQty before heading back.
        if (this.bot.isFishing() && this.bot.needsFishingBaitTopUp()) {
            await this.bot.topUpFishingBaitAtBank(log);
        }

        // Opportunistic tool upgrade while already banking — never yank mid-chop.
        if (await this.bot.tryUpgradeGatherToolAtBank(log)) {
            return;
        }

        if (Bank.isOpen()) {
            await this.bot.closeScriptBank(log);
        }
        // Always leave the bank toward camp after a deposit (unless cook-batch stays).
        // walkHomeIfNeeded short-circuits inside the soft arrive disk; long bank→mine
        // legs (Varrock W → SW mine) need the full walkResilient budget.
        if (!this.bot.isCookBatchReady()) {
            this.bot.setStatus('bank: returning to camp');
            const home = await this.bot.walkHomeIfNeeded(log);
            if (!home) {
                this.bot.log('bank: walk home incomplete — will retry via gather/return');
            }
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
        // Cooker mule: cook any received raw even when the pack is not full.
        if (this.bot.isMuleCooker() && cookable > 0) {
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
                .name(this.bot.rangeLocName(), 'Range', 'Cooking range', 'Fire', 'Fireplace')
                .where(l => l.tile().distanceTo(rangeTile) <= this.bot.rangeLeash())
                .nearest() ??
            Locs.query()
                .name(this.bot.rangeLocName(), 'Range', 'Cooking range', 'Fire', 'Fireplace')
                .nearest();

        // Two-step path when curated: approach (door exterior) then interior stand.
        // Street-side stands path without doors; useOn then clicks the oven through a wall.
        const approach = this.bot.rangeApproachTile();
        const obs = this.bot.cookObstacleList();

        const walkToOven = async (why: string): Promise<void> => {
            const tag = why ? ` (${why})` : '';
            this.bot.setStatus(`cook: walking to range${tag}`);
            if (approach) {
                const at = Game.tile();
                if (!at || approach.distanceTo(at) > 2) {
                    this.bot.log(`cook: walking to approach ${approach}${why ? ` — ${why}` : ''}`);
                    await walkOpening(approach, 1, obs, m => this.bot.log(m));
                }
                // Proactively open Large door / house Door at the approach tile.
                const shut = Locs.query()
                    .where(l => isOpenableObstacle(l.name, l.actions(), obs))
                    .where(l => l.distance() <= 3)
                    .nearest();
                if (shut) {
                    const op = openOp(shut.actions());
                    if (op) {
                        this.bot.log(`cook: opening ${shut.name} at approach`);
                        await shut.interact(op);
                        await Execution.delayTicks(2);
                    }
                }
            }
            await walkOpening(rangeTile, 0, obs, m => this.bot.log(m));
            if (!findRange()) {
                const loc = this.bot.rangeLocMapTile();
                if (loc) {
                    this.bot.log(`cook: no oven in leash — closing on loc ${loc}`);
                    await walkOpening(loc, 1, obs, m => this.bot.log(m));
                }
            }
            // Open any still-shut door next to us (street-side stand → house door).
            const nearDoor = Locs.query()
                .where(l => isOpenableObstacle(l.name, l.actions(), obs))
                .where(l => l.distance() <= 3)
                .nearest();
            if (nearDoor) {
                const op = openOp(nearDoor.actions());
                if (op) {
                    this.bot.log(`cook: opening ${nearDoor.name} near stand`);
                    await nearDoor.interact(op);
                    await Execution.delayTicks(2);
                    await walkOpening(rangeTile, 0, obs, m => this.bot.log(m));
                }
            }
        };

        const here = Game.tile();
        if (!here || rangeTile.distanceTo(here) > 1 || !findRange()) {
            await walkToOven(approach ? 'approach→stand' : '');
        }

        // useOn can "click" the oven through a wall; cooking then never starts.
        // A real cook starts within ~2 ticks (XP / raw drop / make-X). After that,
        // assume the stand is wrong-side and re-path through doors.
        let wallRecoveries = 0;
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
                this.bot.log(
                    `cook: cannot cook (raw=${raw?.name ?? 'none'} oven=${oven ? 'yes' : 'no'})`
                );
                if (wallRecoveries < 3) {
                    wallRecoveries++;
                    await walkToOven('no oven');
                    continue;
                }
                await Execution.delayTicks(2);
                return;
            }
            this.bot.setStatus(`cook: ${raw.name}`);
            const beforeRaw = this.bot.cookableRawCount();
            const beforeXp = Skills.xp('cooking');
            if (!(await raw.useOn(oven))) {
                await Execution.delayTicks(2);
                continue;
            }
            // One cook action finishes in a few ticks. Wait that long for any progress
            // (XP, raw drop, make-X). If still nothing while on the stand, treat as a
            // wall-side / wrong-room useOn and re-path through doors.
            const cookStarted = (): boolean =>
                this.bot.cookableRawCount() < beforeRaw
                || Skills.xp('cooking') > beforeXp
                || ChatDialog.isMakeMenu()
                || ChatDialog.canContinue();
            // ~4 game ticks — short enough to fail-fast on street-side stands, long
            // enough that a real adjacent cook is not aborted mid-animation.
            const started = await Execution.delayUntil(cookStarted, 2400);
            if (started || cookStarted()) {
                // Batch may still be running — wait out more of the pack cook.
                if (
                    await Execution.delayUntil(
                        () =>
                            this.bot.cookableRawCount() === 0
                            || ChatDialog.isMakeMenu()
                            || ChatDialog.canContinue()
                            || EventSignal.pending()
                            || Game.inCombat(),
                        6000
                    )
                ) {
                    if (this.bot.cookableRawCount() < beforeRaw) {
                        await Execution.delay(cookHumanDelayMs());
                    }
                }
                wallRecoveries = 0;
                continue;
            }
            const at = Game.tile();
            const atStand = at !== null && rangeTile.distanceTo(at) <= 2;
            if (atStand && wallRecoveries < 3) {
                wallRecoveries++;
                this.bot.log(
                    `cook: useOn produced no cook progress at stand — re-path (try ${wallRecoveries})`
                );
                await walkToOven('useOn stall');
                continue;
            }
            await Execution.delayTicks(1);
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
        await this.bot.walkHomeIfNeeded(log);
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
                await this.bot.walkHomeIfNeeded(log);
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
                await this.bot.walkHomeIfNeeded(log);
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
                    await this.bot.walkHomeIfNeeded(log);
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
                            await this.bot.closeScriptBank(log, { allowForgetful: false });
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log);
                        if (ok) {
                            await this.bot.walkHomeIfNeeded(log);
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
            // Close once, then equip offline (replacement may displace broken/other gear).
            if (Bank.isOpen()) {
                await this.bot.closeScriptBank(log);
            }
            await this.bot.equipTools([pick], log, { bankDisplaced: true });
            await this.bot.walkHomeIfNeeded(log);
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
                    await this.bot.closeScriptBank(log);
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

        // Coins already cover the shop cart (seeded restock at a booth that isn't
        // the camp bank) — skip bank entirely and walk straight to Gerrant/Harry.
        // Prefer-nearby Banking still helps when we *do* need the bank, but held GP
        // must not force Edgeville from Draynor just to glance at an empty booth.
        if (this.bot.toolAcquireEnabled() && this.bot.acquireReady() && missing.length > 0) {
            const preCart = fishingGearShopCart(
                method,
                this.bot.acquireWorldWithBank(),
                this.bot.fishingAcquireOpts()
            );
            if (preCart.length > 0 && Inventory.count(COINS) >= buyPlansCost(preCart)) {
                this.bot.log('restock: coins held for shop cart — skipping bank, heading to vendor');
                const ok = await this.bot.executeFishingGearShopCart(preCart, log, {
                    bankPrepared: true
                });
                // Always leave the shop toward camp after any successful buy —
                // partial carts used to soft-lock on Gerrant's tile.
                if (ok) {
                    this.bot.setStatus('restock: returning to camp');
                    await this.bot.walkHomeIfNeeded(log);
                    return;
                }
                // Shop failed — fall through to bank path for a normal retry.
            }
        }

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
                    // Same-vendor cart (rod + feathers at Gerrant) — one bank fund + one shop.
                    const cart = fishingGearShopCart(
                        method,
                        this.bot.acquireWorldWithBank(),
                        this.bot.fishingAcquireOpts()
                    );
                    if (cart.length > 0) {
                        const cartCost = buyPlansCost(cart);
                        // Inv already covers the cart (coins kept through deposit) —
                        // skip a second bank open and walk straight to Gerrant/Harry.
                        // Otherwise executeBuyPlans funds at vendor.bankStand itself.
                        const invFunded = Inventory.count(COINS) >= cartCost;
                        if (Bank.isOpen()) {
                            await this.bot.closeScriptBank(log, { allowForgetful: false });
                        }
                        const ok = await this.bot.executeFishingGearShopCart(cart, log, {
                            bankPrepared: invFunded
                        });
                        if (ok) {
                            // Full or partial cart — leave the shop toward camp either way.
                            this.bot.setStatus('restock: returning to camp');
                            await this.bot.walkHomeIfNeeded(log);
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
                await this.bot.closeScriptBank(log);
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
                const cart = fishingGearShopCart(
                    method,
                    this.bot.acquireWorldWithBank(),
                    this.bot.fishingAcquireOpts()
                );
                if (cart.length > 0) {
                    const cartCost = buyPlansCost(cart);
                    const invFunded = Inventory.count(COINS) >= cartCost;
                    if (Bank.isOpen()) {
                        await this.bot.closeScriptBank(log, { allowForgetful: false });
                    }
                    const ok = await this.bot.executeFishingGearShopCart(cart, log, {
                        bankPrepared: invFunded
                    });
                    if (ok) {
                        this.bot.setStatus('restock: returning to camp');
                        await this.bot.walkHomeIfNeeded(log);
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
            await this.bot.closeScriptBank(log);
        }
        this.bot.log(`restock: gear ok (${this.bot.gearLabel()})`);
        this.bot.setStatus('restock: returning to camp');
        await this.bot.walkHomeIfNeeded(log);
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

        // Hammer+bar (or shop GP / broken tool) already in pack — skip the camp-bank
        // hop entirely. Suite seeds materials at Varrock West; walking Draynor first
        // burns the budget before the anvil walk even starts.
        if (this.bot.toolAcquireEnabled() && this.bot.acquireReady() && missing.length > 0) {
            const preBuy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                upgrade: false
            });
            if (preBuy && this.bot.acquireMaterialsHeld(preBuy)) {
                this.bot.log(`restock: materials held for ${preBuy.kind} — skipping bank`);
                const ok = await this.bot.executeToolAcquirePlan(preBuy, log, { bankPrepared: true });
                if (ok) {
                    await this.bot.walkHomeIfNeeded(log);
                    return;
                }
                // Acquire failed — fall through to bank path.
            }
        }

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
                        // After deposit-except-gear, smith bars/hammer (or shop GP)
                        // stay in pack when gearKeep includes them — hand off prepared.
                        const bankPrepared = this.bot.acquireMaterialsHeld(buy);
                        if (Bank.isOpen()) {
                            await this.bot.closeScriptBank(log, { allowForgetful: false });
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log, { bankPrepared });
                        if (ok) {
                            await this.bot.walkHomeIfNeeded(log);
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
            if (Bank.isOpen()) {
                await this.bot.prepareWornSurplusForDeposit(log);
                await this.bot.depositSurplusGatherTools(log);
                await this.bot.closeScriptBank(log);
            }
            if (leftover.length > 0) {
                await this.bot.equipTools(leftover, log, { bankDisplaced: false });
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

        // Same open: unequip/deposit surplus, close once, then Wield offline.
        await this.bot.prepareWornSurplusForDeposit(log);
        await this.bot.depositSurplusGatherTools(log);
        const toEquip = [
            ...plan.filter(s => s.equip).map(s => s.name),
            ...this.bot.toolsToEquip()
        ];
        if (Bank.isOpen()) {
            await this.bot.closeScriptBank(log);
        }
        if (toEquip.length > 0) {
            await this.bot.equipTools(toEquip, log, { bankDisplaced: false });
        }

        if (!this.bot.hasGear()) {
            const still = this.bot.missingGearNames();
            if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                    upgrade: false
                });
                if (buy) {
                    const bankPrepared = this.bot.acquireMaterialsHeld(buy);
                    if (Bank.isOpen()) {
                        await this.bot.closeScriptBank(log, { allowForgetful: false });
                    }
                    const ok = await this.bot.executeToolAcquirePlan(buy, log, { bankPrepared });
                    if (ok) {
                        await this.bot.walkHomeIfNeeded(log);
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
        await this.bot.walkHomeIfNeeded(log);
    }
}

/**
 * Optional bank/shop/smith upgrade when Acquire tools is on.
 *
 * - One-shot startup: walk bank once to withdraw a better banked tier (steel
 *   while bronze is equipped) even under chop-then-burn (no BankCatch).
 * - Ongoing: only when already at/near the script bank (or bank UI open).
 *   Never walks to bank solely for shop upgrades mid-run — that looked like a
 *   hang on cold start and yanked players off trees. BankCatch also calls
 *   tryUpgradeGatherToolAtBank after deposits.
 */
class UpgradeGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.toolAcquireEnabled()) {
            return false;
        }
        if (this.bot.isFishing() || this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (this.bot.hasBrokenGatherTool()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        // Cold start: allow one bank trip from the tree line for banked better tools.
        if (this.bot.startupToolBankSyncNeeded()) {
            return this.bot.hasGear() || this.bot.toolAcquireEnabled();
        }
        if (!this.bot.acquireReady()) {
            return false;
        }
        if (!this.bot.hasGear()) {
            return false;
        }
        // Bank-side only after startup — do not open bank from the tree line for shop upgrades.
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

    /**
     * Distance origin for ranking fishing spots (prefer nearest to player).
     * Game.tile() is a plain WorldTile — wrap with Tile.from for distanceTo.
     */
    private fishSpotOrigin(): Tile {
        const freeformFish = this.bot.isNpc() && this.bot.isFreeformCamp();
        const namedCamp = this.bot.isNamedCamp();
        const here = Game.tile();
        if (gatherSpotRangeOrigin(freeformFish, here !== null, namedCamp) === 'player' && here) {
            return Tile.from(here);
        }
        return this.bot.getAnchor();
    }

    /** Freeform primary disk = UI/start leash; hunt extends past it. */
    private freeformHuntRadius(): number {
        return gatherHuntRadius(this.bot.leashRadius());
    }

    /** Shared filters: usable, not whirlpool, method matches. */
    private fishSpotBaseOk(n: { id: number; tile: () => Tile; actions: () => string[] }): boolean {
        return (
            this.bot.usable(keyOf(n.tile())) &&
            !WHIRLPOOL_IDS.has(n.id) &&
            this.bot.matchesSpot(n.actions())
        );
    }

    /**
     * Whether a fishing spot is in range for this camp mode.
     * - Named / Auto-snap: any spot inside camp membership (home pin). No player-distance wall.
     * - Freeform: spot within hunt of the player, or still within hunt of the start-tile anchor
     *   (so we can walk along a river hop without idling on "within 40 of you").
     */
    private fishSpotInRange(spotTile: Tile): boolean {
        if (this.bot.isNamedCamp()) {
            return resourceWithinCamp(this.bot.getAnchor().distanceTo(spotTile), this.bot.leashRadius());
        }
        const origin = this.fishSpotOrigin();
        const hunt = this.freeformHuntRadius();
        if (spotWithinGatherRange(origin.distanceTo(spotTile), hunt)) {
            return true;
        }
        // Spot still near the freeform start pin — walk the river even if far from the player.
        return spotWithinGatherRange(this.bot.getAnchor().distanceTo(spotTile), hunt);
    }

    /**
     * Nearest matching fishing spot in scene for this mode.
     * Named camps: entire membership disk (fixes "no spots within 40 of you" mid-pier).
     * Freeform: player/start hunt disks.
     */
    private findFishSpot() {
        return Npcs.query()
            .name(this.bot.targetName())
            .where(n => this.fishSpotBaseOk(n) && this.fishSpotInRange(n.tile()))
            .nearest();
    }

    /** @deprecated Prefer {@link findFishSpot} — kept for call sites that meant "nearby only". */
    private findSpot() {
        return this.findFishSpot();
    }

    /** Freeform-only: spots just outside primary leash of the player (legacy hunt path). */
    private huntRadius(): number {
        return this.bot.isNamedCamp() ? this.bot.leashRadius() : this.freeformHuntRadius();
    }

    private findHuntSpot() {
        // Named: findFishSpot already covers full camp — no separate hunt tier.
        if (this.bot.isNamedCamp()) {
            return null;
        }
        const primary = this.bot.leashRadius();
        const hunt = this.freeformHuntRadius();
        const origin = this.fishSpotOrigin();
        return Npcs.query()
            .name(this.bot.targetName())
            .where(n => {
                if (!this.fishSpotBaseOk(n)) {
                    return false;
                }
                const d = origin.distanceTo(n.tile());
                return d > primary && d <= hunt;
            })
            .nearest();
    }

    /** Named: same as findFishSpot (full membership). Freeform: null. */
    private findCampScanSpot() {
        if (!this.bot.isNamedCamp()) {
            return null;
        }
        return this.findFishSpot();
    }

    private findRock() {
        // Camp membership fence (anchor leash) + ore/tree type filters, then prefer
        // rocks near the player so we do not path across Dwarven tunnels / SE Varrock
        // while a matching ore is already underfoot.
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
            .nearestPreferLocal(LOCAL_MINE_PREFER_RADIUS);
    }

    validate(): boolean {
        // Combat only blocks AFK gather — retaliate tick-manip keeps gathering.
        if (Inventory.isFull() || EventSignal.pending()) {
            return false;
        }
        if (combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())) {
            return false;
        }
        // After FleeCombat, don't walk back onto spiders while the hold is active.
        if (this.bot.shouldSuppressCampReentry()) {
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
            // Freeform fish measures spots from the player — still yield past the start-tile
            // leash so ReturnToAnchor bounds wander (don't chase the whole river).
            if (this.bot.isFreeformCamp() && beyondLeash(this.bot, Game.tile(), 4)) {
                return false;
            }
            // Named: any matching spot in camp membership. Freeform: player/start hunt disks.
            if (this.findFishSpot() !== null || this.findHuntSpot() !== null) {
                return true;
            }
            // No spots in range: keep-alive near the pier so status updates, but yield
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
            becameWhirlpool,
            allowCombat: this.bot.allowCombatGather()
        });
    }

    private shouldYieldMine(tile: Tile): boolean {
        return shouldYieldGathering(
            EventSignal.pending(),
            Inventory.isFull(),
            ChatDialog.canContinue(),
            this.findRock() === null || this.gasAt(tile),
            Game.inCombat(),
            this.bot.allowCombatGather()
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

        if (EventSignal.pending()) {
            return;
        }
        if (combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())) {
            return;
        }

        if (this.bot.isFishing()) {
            await this.executeFish();
            return;
        }
        await this.executeMine();
    }

    /**
     * After a resource roll, optionally arm knife delay or schedule timed reclick.
     * Returns true when the caller should skip the normal AFK wait loop this beat.
     */
    private async afterRollTickManip(reclick: () => Promise<boolean>): Promise<boolean> {
        const profile = this.bot.tickManipProfile();
        if (profile.method === 'off') {
            return false;
        }
        this.bot.noteGatherRoll();

        if (profile.useKnifeDelay) {
            if (!this.bot.hasKnifeDelayKit() && !ChatDialog.isMakeMenu()) {
                this.bot.log('tick: knife delay needs Knife + 1 fletchable log');
                return false;
            }
            // t1: knife+Make-1 arms +2. t2: reclick gather. t3: delay expires / roll window.
            const phase = knifeDelayPhase(Game.tick(), this.bot.lastGatherRollTick());
            if (phase === 'delay-action' || ChatDialog.isMakeMenu()) {
                const armed = await this.bot.armKnifeDelay();
                if (!armed && !ChatDialog.isMakeMenu()) {
                    this.bot.log('tick: knife delay arm failed');
                    return false;
                }
            }
            // Do not wait for fletch product — reclick on the next game tick.
            await Execution.delayUntil(() => Game.tick() >= this.bot.lastGatherRollTick() + 1, 1200);
            await reclick();
            return true;
        }

        // Farmer 6t is driven by executeFarmerWillow — only stamp the roll here.
        if (profile.farmerWillowCycle) {
            return false;
        }

        // Timed reclick: fly 4t, iron pick-rate, and retaliate methods with a known
        // native cycle (2t oaks / 3t shortbow / tannerfish fly). Combat allowed.
        const cycle = this.bot.gatherCycleTicks();
        if (
            cycle != null &&
            cycle >= 1 &&
            (profile.timedReclick ||
                profile.method === 'iron-cadence' ||
                profile.allowCombat ||
                profile.nativeCycleTicks != null)
        ) {
            const due = nextGatherClickTick(this.bot.lastGatherRollTick(), cycle);
            this.bot.setStatus(`tick: wait ${cycle}t reclick`);
            await Execution.delayUntil(
                () =>
                    Game.tick() >= due ||
                    Inventory.isFull() ||
                    EventSignal.pending() ||
                    combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather()),
                cycle * 700 + 2000
            );
            if (
                Inventory.isFull() ||
                EventSignal.pending() ||
                combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())
            ) {
                return true;
            }
            await reclick();
            return true;
        }

        // Unknown cycle retaliate: stamp the roll; keep AFK wait (combat allowed).
        return false;
    }

    private async reclickFish(index: number, _startTile: Tile): Promise<boolean> {
        const live = this.spotByIndex(index);
        if (!live || WHIRLPOOL_IDS.has(live.id)) {
            return false;
        }
        this.bot.setStatus(`tick: reclick ${this.bot.actionName()}`);
        return live.interact(this.bot.actionName());
    }

    private async reclickMine(tile: Tile): Promise<boolean> {
        const rock = this.findRock();
        if (!rock) {
            return false;
        }
        // Prefer same tile when still up; otherwise nearest in leash.
        const same =
            Locs.query()
                .name(this.bot.targetName())
                .action(this.bot.actionName())
                .where(
                    l =>
                        l.tile().equals(tile) &&
                        this.bot.matchesRock(l.id) &&
                        !GAS_ROCK_IDS.has(l.id) &&
                        this.bot.usable(keyOf(l.tile()))
                )
                .nearest() ?? rock;
        this.bot.setStatus(`tick: reclick ${this.bot.actionName()}`);
        return same.interact(this.bot.actionName());
    }

    private async executeFish(): Promise<void> {
        // Named: nearest matching spot in camp membership. Freeform: player/start hunt.
        // If the spot is far, interact will path; we still walk when beyond a short step.
        const target = this.findFishSpot() ?? this.findHuntSpot();

        if (!target) {
            this.activeFishIndex = null;
            // No target. Short finishing-cast wait, waking if a spot reappears.
            if (Game.animating()) {
                this.bot.setStatus('fish: finishing cast (no spot)');
                await Execution.delayUntil(
                    () =>
                        !Game.animating() ||
                        this.findFishSpot() !== null ||
                        this.findHuntSpot() !== null ||
                        EventSignal.pending() ||
                        Inventory.isFull() ||
                        combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather()) ||
                        ChatDialog.canContinue(),
                    2500
                );
                return;
            }
            // Scene-local query found nothing. Soft-home only when clearly off-camp
            // (bank square / long wander) — not the tight 8-tile disk (hunt thrash).
            const here = Game.tile();
            const anchor = this.bot.getAnchor();
            if (
                here &&
                shouldSoftHomeFromGatherMiss(anchor.distanceTo(here), this.bot.leashRadius())
            ) {
                this.bot.setStatus('fish: returning to camp');
                await this.bot.walkHomeIfNeeded(m => this.bot.log(`  ${m}`));
                return;
            }
            // Named: membership disk from home. Freeform: hunt from player/start.
            if (this.bot.isNamedCamp()) {
                this.bot.setStatus(`fish: no spots in camp (r${this.bot.leashRadius()} of home)`);
            } else {
                this.bot.setStatus(`fish: no spots within ${this.freeformHuntRadius()} of you/start`);
            }
            await Execution.delayTicks(2);
            return;
        }

        // Walk when the spot is more than a few tiles away (pier hop / camp scan).
        const here0 = Game.tile();
        const spotTile = target.tile();
        if (here0 && Tile.from(here0).distanceTo(spotTile) > 2) {
            this.bot.setStatus(`fish: walking to spot @ ${spotTile}`);
            await Traversal.walkTo(spotTile, { radius: 1, timeoutMs: 20_000 });
            // Re-resolve after walk — hop may have moved.
            const again = this.findFishSpot() ?? this.findHuntSpot();
            if (!again) {
                this.activeFishIndex = null;
                return;
            }
            // Fall through to interact with the (possibly new) nearest spot.
            return this.executeFishAfterArrive(again);
        }

        await this.executeFishAfterArrive(target);
    }

    private async executeFishAfterArrive(target: {
        index: number;
        tile: () => Tile;
        actions: () => string[];
        interact: (op: string) => boolean | Promise<boolean>;
        id: number;
    }): Promise<void> {

        const index = target.index;
        const startTile = target.tile();
        const key = keyOf(startTile);

        // Click immediately when idle OR when the target is a different spot than the
        // active session. A fresh interact cancels leftover cast anim — no need to
        // wait it out ("clearing cast before re-click").
        const needsClick = !Game.animating() || this.activeFishIndex !== index;
        if (needsClick) {
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
            if (Inventory.used() > before) {
                if (await this.afterRollTickManip(() => this.reclickFish(index, startTile))) {
                    return;
                }
            }
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
                if (await this.afterRollTickManip(() => this.reclickFish(index, startTile))) {
                    return;
                }
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
        // Farmer willows 6-tick machine (#160) — dedicated phase loop.
        if (this.bot.tickManipProfile().farmerWillowCycle) {
            await this.executeFarmerWillow();
            return;
        }

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
                        combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather()) ||
                        ChatDialog.canContinue(),
                    2500
                );
                return;
            }
            // Same post-bank / off-camp miss as fishing: soft-home only when clearly
            // off-camp — not the tight 8-tile disk (hunt thrash on freeform).
            const here = Game.tile();
            const anchor = this.bot.getAnchor();
            if (
                here &&
                shouldSoftHomeFromGatherMiss(anchor.distanceTo(here), this.bot.leashRadius())
            ) {
                this.bot.setStatus('gather: returning to camp');
                await this.bot.walkHomeIfNeeded(m => this.bot.log(`  ${m}`));
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
        // Track whether this session produced ore/logs — successful deplete must not
        // soft-cooldown the tile (iron respawn ~6t < old 8t cooldown → far path thrash).
        let gotProduct = false;

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
            if (Inventory.used() > before) {
                gotProduct = true;
            }
            if (Inventory.used() === before && !Game.animating()) {
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key);
                } else if (shouldCooldownGatherTile(false, this.findRock() !== null)) {
                    // Failed click with other targets available — brief skip only.
                    this.bot.cooldown(key);
                }
                return;
            }
            if (gotProduct) {
                if (await this.afterRollTickManip(() => this.reclickMine(tile))) {
                    return;
                }
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
                gotProduct = true;
                if (await this.afterRollTickManip(() => this.reclickMine(tile))) {
                    return;
                }
                continue;
            }
            if (!Game.animating()) {
                // Natural end (deplete / stop). Never soft-cooldown here — empty/stump
                // already drops out of findRock, and iron respawns faster than the old
                // 8t tile skip (nearby ore up while bot paths across the mine).
                return;
            }
        }
    }

    /**
     * Farmer willows 6-tick cycle (#160):
     * t1 click tree · t2–t4 wait · t5 knife log · t6 drop log · repeat.
     * Auto Retaliate stays ON (may die). Needs Knife + willow logs in pack.
     */
    private async executeFarmerWillow(): Promise<void> {
        if (EventSignal.pending() || Inventory.isFull() || ChatDialog.canContinue()) {
            return;
        }

        // Resync cycle clock when unset or stale (login / long AFK).
        const now0 = Game.tick();
        let start = this.bot.farmerCycleStartTick();
        if (start < 0 || now0 - start > 18) {
            this.bot.noteFarmerCycleStart(now0);
            start = now0;
        }

        const phase = farmerWillowPhase(Game.tick(), start);
        if (phase === 'click-tree') {
            const tree = this.findRock();
            if (!tree) {
                const here = Game.tile();
                const anchor = this.bot.getAnchor();
                if (
                    here &&
                    shouldSoftHomeFromGatherMiss(anchor.distanceTo(here), this.bot.leashRadius())
                ) {
                    this.bot.setStatus('farmer: returning to camp');
                    await this.bot.walkHomeIfNeeded(m => this.bot.log(`  ${m}`));
                    return;
                }
                this.bot.setStatus('farmer: no tree in leash');
                await Execution.delayTicks(2);
                return;
            }
            const tile = tree.tile();
            this.bot.setStatus(`farmer t1: chop ${this.bot.targetName()} @ ${tile}`);
            // Stamp cycle start on the click beat so phase 0 stays aligned.
            this.bot.noteFarmerCycleStart(Game.tick());
            const before = Inventory.used();
            if (!(await tree.interact(this.bot.actionName()))) {
                this.bot.log(`farmer: no '${this.bot.actionName()}' on tree`);
                await Execution.delayTicks(1);
                return;
            }
            // Brief wait for anim/log; do not AFK the full cut — t5 will process.
            await Execution.delayUntil(
                () =>
                    Inventory.used() > before ||
                    Game.animating() ||
                    EventSignal.pending() ||
                    Inventory.isFull(),
                1800
            );
            if (Inventory.used() > before) {
                this.bot.noteGatherRoll();
            }
            // Advance toward t5 without blocking the whole cycle in one task beat.
            await Execution.delayUntil(
                () => {
                    const s = this.bot.farmerCycleStartTick();
                    const p = farmerWillowPhase(Game.tick(), s);
                    return p === 'cut-log' || p === 'drop-log' || p === 'click-tree';
                },
                4500
            );
            return;
        }

        if (phase === 'cut-log') {
            // Knife the newest product log (arms +2 delay / processes the roll).
            if (ChatDialog.isMakeMenu()) {
                this.bot.setStatus('farmer t5: make-x');
                await this.bot.armKnifeDelay();
                return;
            }
            const log =
                Inventory.items().find(i => this.bot.isProduct(i.name) && isFletchableLogName(i.name)) ??
                this.bot.delayLogItem();
            const knife = Inventory.first(TICK_MANIP_KNIFE);
            if (!knife || !log) {
                this.bot.setStatus('farmer t5: need knife + log');
                this.bot.log('farmer: cut-log needs Knife + a fletchable log');
                await Execution.delayTicks(1);
                return;
            }
            this.bot.setStatus(`farmer t5: knife ${log.name}`);
            if (!(await knife.useOn(log))) {
                await Execution.delayTicks(1);
                return;
            }
            await Execution.delayUntil(
                () => ChatDialog.isMakeMenu() || ChatDialog.canContinue() || !Game.animating(),
                1500
            );
            if (ChatDialog.isMakeMenu()) {
                await this.bot.armKnifeDelay();
            }
            // Wait into drop phase.
            await Execution.delayUntil(
                () => farmerWillowPhase(Game.tick(), this.bot.farmerCycleStartTick()) === 'drop-log',
                2000
            );
            return;
        }

        if (phase === 'drop-log') {
            this.bot.setStatus('farmer t6: drop log');
            // Drop one product log (prefer fletch leftovers / shafts stay).
            const dropped = await this.bot.dropOneProductLog();
            if (!dropped) {
                // Nothing to drop — still advance the cycle clock.
                this.bot.log('farmer: drop-log with empty product slot');
            }
            // Next cycle starts on the following tick.
            await Execution.delayUntil(
                () => {
                    const s = this.bot.farmerCycleStartTick();
                    const elapsed = Game.tick() - s;
                    return elapsed >= 6 || farmerWillowPhase(Game.tick(), s) === 'click-tree';
                },
                2000
            );
            // Roll cycle start forward by 6 so phase 0 lands on the next click beat.
            const s = this.bot.farmerCycleStartTick();
            if (Game.tick() - s >= 6) {
                this.bot.noteFarmerCycleStart(s + 6 * Math.floor((Game.tick() - s) / 6));
            }
            return;
        }

        // wait phases (t2–t4): sleep until cut-log / drop / next click.
        this.bot.setStatus('farmer: wait');
        await Execution.delayUntil(
            () => {
                if (EventSignal.pending() || Inventory.isFull() || ChatDialog.canContinue()) {
                    return true;
                }
                const p = farmerWillowPhase(Game.tick(), this.bot.farmerCycleStartTick());
                return p !== 'wait';
            },
            4000
        );
    }
}
