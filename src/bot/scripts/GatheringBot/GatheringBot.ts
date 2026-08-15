import {
    createReturnToAnchorTask,
    HOME_ARRIVE_RADIUS,
    resolveRunAnchor,
    shouldWalkHomeToGatherAnchor,
    tileWithinLeash
} from '../../api/tasks/Anchor.js';
import { TaskBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import {
    foodCount as countFood,
    foodForms,
    foodHealAmount,
    isFoodItem
} from '../../api/combat/food.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { cookSurfaceForFishCamp, resolveFishCampCookSurface } from '../../data/cookingRanges.js';
import { resolveFishingLocation, type FishingLocation } from '../../data/fishingLocations.js';
import { effectiveGatherLeash, isAutoLocation, NAMED_CAMP_LEASH_FLOOR } from './GatherCamp.js';
import {
    DEFAULT_CHASE_RADIUS,
    resolveCampRadius,
    resolveChaseRadius,
    type GatheringLocation
} from '../../data/gatheringLocations.js';
import { Players } from '../../api/players/Players.js';
import {
    DEFAULT_TRADE_RANGE,
    muleCookerActive,
    muleGathererHandoffActive,
    muleNonGathererActive,
    muleReceiverActive,
    muleSupplierActive,
    parseMuleMode,
    parsePartnerList,
    type MuleMode,
    MULE_MODE_OPTIONS
} from '../../api/trade/PartnerTrade.js';
import { resolveMiningLocation } from '../../data/miningLocations.js';
import { resolveWoodcuttingLocation } from '../../data/woodcuttingLocations.js';
import { BROKEN_PICKAXE, ROCK_OPTIONS, resolveRockIds } from '../../data/miningRocks.js';
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
} from '../../api/firemaking/Firemaking.js';
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
} from '../../api/acquisition/Tools.js';
import { createChopBurnTasks } from './ChopBurnTasks.js';
import {
    FISHING_METHOD_OPTIONS,
    fishingRestockPlan,
    gearKeepNames,
    gearLabel as formatGearLabel,
    hasFishingGear,
    missingFishingGear,
    resolveFishMethod,
    spotMatchesMethod,
    type FishingMethod
} from '../../data/fishingMethods.js';
import {
    cookBatchAfterLoad,
    cookFilterLabel,
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
    extraDelayLogsToDrop,
    isFletchableLogName,
    isShortbowName,
    miningRateForPickaxe,
    profileForSetting,
    type TickManipProfile
} from './TickManipLogic.js';
import {
    Banking,
    bankPace,
    depositAllExcept,
    isDisposableGatherJunk,
    purgePackAtBank,
    waitBankReady,
    withdrawCoins
} from '../../api/bank/Banking.js';
import {
    fmtDuration,
    fmtXpGained as fmtXpGainedPaint,
    fmtXpHr as fmtXpHrPaint,
    gatherPaintAccent,
    paintClip,
    paintSkillShort,
    paintSkillTitle
} from '../../paint/paintLogic.js';
import { driveDialog } from '../../api/ai/quests/exec/primitives.js';
import {
    AXE_BAR_FOR,
    BROKEN_AXE,
    COINS,
    FORGETFUL_BANK_ODDS,
    HAMMER as ACQUIRE_HAMMER,
    buyPlansCost,
    canFundPlan,
    fishingGearShopCart,
    parseToolAcquireMode,
    isFishingBaitPiece,
    planGatherToolAcquire,
    walkToToolVendor,
    withBaitTarget,
    type AcquireWorld,
    type FishingGearBuyPlan,
    type ToolAcquireMode,
    type ToolAcquirePlan,
    type ToolVendor
} from '../../api/acquisition/ToolAcquire.js';
import {
    executeFishingGearShopCart as execFishingGearShopCart,
    executeToolAcquirePlan as execToolAcquirePlan,
    type ToolAcquireHost
} from './ToolAcquireExec.js';
import {
    gatheringCombatPolicy,
    hostileAttackerNearby,
    incomingPlayerAttacker,
    wildernessMinerAt,
    wildernessMinerStanceNeeded,
    type GatheringCombatPolicy
} from './GatheringBotLogic.js';
import {
    minerFoodConfig,
    minerFoodRestockNeeded,
    planMinerFoodWithdrawal,
    shouldEatMinerFood,
    type MinerFoodConfig
} from './MinerLogic.js';
import {
    BankCatch,
    ClearPackJunk,
    DropProduct,
    EnsureGatherToolEquipped,
    EnsureShortbowRapid,
    FishBankCooked,
    FishCookDialog,
    FishCookLoad,
    FishWithdrawCookBatch,
    FleeCombat,
    Gather,
    HandleGatherMuleTrade,
    MaintainWildernessMinerStance,
    MuleBankHaul,
    MuleGoMeet,
    MuleRequestOrWait,
    MinerEatFood,
    RepairBrokenGatherTool,
    RestockFishingGear,
    RestockGatherTool,
    SupplierWithdrawRaw,
    TannerfishSustain,
    TrimKnifeDelayLogs,
    UpgradeGatherTool,
    WaitStickyCombat
} from './GatheringBotTasks.js';


/** Default half-size of the Auto (start) burn box around the script start tile. */
const LOCAL_BURN_HALF = 8;

// Re-export pure policy from api/ so existing `#/bot/scripts/GatheringBot` imports keep working.
export {
    HOME_ARRIVE_RADIUS,
    shouldSoftHomeFromGatherMiss,
    shouldWalkHomeToGatherAnchor
} from '../../api/tasks/Anchor.js';
export {
    effectiveGatherLeash,
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    isAutoLocation,
    NAMED_CAMP_LEASH_FLOOR,
    resourceWithinCamp,
    spotWithinGatherRange,
    START_TILE_LEASH_FLOOR
} from './GatherCamp.js';
export { DEFAULT_CHASE_RADIUS } from '../../data/gatheringLocations.js';
export {
    LOCAL_MINE_PREFER_RADIUS,
    pickNearestPreferLocal,
    shouldCooldownGatherTile
} from './TargetPick.js';

// Pure policy (also in GatheringBotLogic) — re-export for existing test/import paths.
export {
    fishingSessionBroken,
    gatheringCombatPolicy,
    hostileAttackerNearby,
    incomingPlayerAttacker,
    shouldFleeCombat,
    shouldYieldGathering,
    wildernessMinerAt,
    wildernessMinerStanceNeeded
} from './GatheringBotLogic.js';

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

    /** Opt-in Miner trip food; null keeps every pre-#521 mining path unchanged. */
    private minerFood: MinerFoodConfig | null = null;
    private minerFoodStartupPending = false;
    private minerFoodEaten = 0;

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
    /** Game tick when acquire backoff ends (not wall-clock). */
    private acquireBackoffUntilTick = 0;
    // Why: chop-then-burn never hits BankCatch, and a cold start can have bronze equipped with steel in the bank.

    /** One-shot bank trip at run start when Buy/repair is on: withdraw a better banked axe or pick, then an optional shop upgrade. */
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
    // Why: after FleeCombat kites off a multi-combat pack, ReturnToAnchor and gather re-entry are suppressed so the bot does not walk straight back onto spiders.

    /** Game tick when camp re-entry hold ends after combat kite. */
    private combatClearUntilTick = 0;

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
            this.minerFood = minerFoodConfig(
                this.settings.str('food', 'Lobster'),
                this.settings.num('foodWithdraw', 0)
            );
            this.minerFoodStartupPending =
                this.minerFood !== null && this.minerFoodCount() < this.minerFood.target;
            if (this.minerFood) {
                this.log(
                    `food: ${this.minerFood.name} x${this.minerFood.target}; eat when its full heal fits or the pack needs an ore slot`
                );
            }
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

        // Why: a resolved camp, named or Auto-snap, takes camp geography (campRadius or the floor of 64), never the Auto UI leash, which clips the camp scan to as little as 18.
        // Why: freeform Auto and power None take the start-tile leash from the UI, plus the None floor.
        // Why: fishing discovery for named camps is any matching spot inside membership, while freeform uses the player-relative hunt in Gather.findFishSpot.
        if (this.location?.spot) {
            this.anchor = resolveRunAnchor(new Tile(here.x, here.z, here.level), this.location.spot);
            this.leash = resolveCampRadius(this.location.campRadius, NAMED_CAMP_LEASH_FLOOR);
        } else {
            this.anchor = new Tile(here.x, here.z, here.level);
            this.leash = effectiveGatherLeash(this.leash, locSetting);
        }

        // Why: after ::tele or a zone load, Locs and Npcs are empty for a beat (docs/decisions/level-change-lag.md).
        // Why: blank is not absent, so the first gather tick waits rather than idling on "no rocks/trees in leash" with an empty scene.
        if (this.fishing) {
            await Execution.delayUntilTicks(() => Npcs.query().results().length > 0, 9);
        } else {
            await Execution.delayUntilTicks(() => Locs.query().results().length > 0, 9);
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
            if (this.minerFood && this.muleMode !== 'off') {
                this.log('food: disabled while Miner mule mode owns the haul/bank loop');
                this.minerFood = null;
                this.minerFoodStartupPending = false;
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

        // Why: tick-manip retaliate methods run Auto Retaliate ON with no FleeCombat, and may die.
        // Why: Wilderness Miner holds ground against NPCs so an aggressive camp stays mineable, but a detectable player attack still yields to FleeCombat.
        // Why: Location Auto is expert and may-die, so combat is left alone with no flee babysitting.
        // Why: named and None AFK run Auto Retaliate off with FleeCombat walking hits off.
        if (this.tickManip.allowCombat) {
            if (Game.setAutoRetaliate(true)) {
                this.log('combat: Auto Retaliate ON (tick manip — may die)');
            } else {
                this.log('combat: could not enable Auto Retaliate (controls missing?)');
            }
        } else if (wildernessMinerAt({ isMiner: this.mining(), tile: Game.tile() })) {
            // MaintainWildernessMinerStance owns the one OFF toggle and waits for
            // its varp, including after later zone entry or relogin.
            this.log(
                'combat: Wilderness Miner holds ground against NPCs; player attacks still flee'
            );
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
            this.log(
                this.minerFood
                    ? 'location: power mode — eat food for ore slots; nearest-bank restock when empty'
                    : 'location: power mode — drop haul; bank only to fetch missing tools (nearest bank)'
            );
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
        // Why: Miner always carries the combat tasks, so its live wilderness policy can switch from holding NPC aggro to fleeing a detectable player attack.
        // Why: other gatherers keep the named/None-only registration policy.
        const mobFlee =
            !muleSide &&
            (this.mining() ||
                (!isAutoLocation(this.locationSetting) && !this.tickManip.allowCombat));
        // Tannerfishing is a power-train (cook/eat on the pier) — drop haul, no bank loop.
        const tannerPower = this.tickManip.cookEatInterleave;
        // Cooker always runs cook tasks; gatherer/solo use cookOn when enabled.
        const cookTasks = cookOn || cooker;
        const bankCatch = new BankCatch(this);
        const minerFoodLoop = this.minerFoodEnabled();
        this.add(
            new ContinueDialog(),
            ...(minerFoodLoop ? [new MinerEatFood(this)] : []),
            // Why: a sticky combatCycle with no face target waits rather than thrash-walking.
            // Why: named and None only break multi-combat pulls, such as wildy spiders, by walking off.
            // Why: Auto and retaliate tick-manip are may-die, so there is no mob flee.
            ...(mobFlee ? [new WaitStickyCombat(this), new FleeCombat(this)] : []),
            // Entry/relogin can restore Auto Retaliate. Re-assert the Wilderness
            // Miner stance after dialog/eating/player flee, before any gather work.
            new MaintainWildernessMinerStance(this),
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
            // Opt-in Miner food owns the full→eat→restock loop even under power mode.
            ...(minerFoodLoop ? [bankCatch] : []),
            ...(this.powerMode || tannerPower
                ? [new DropProduct(this)]
                : minerFoodLoop
                    ? []
                    : [bankCatch]),
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

    /** Mark a recent combat kite — hold camp re-entry for `holdTicks` game ticks. */
    noteCombatFlee(holdTicks = 24): void {
        this.combatClearUntilTick = Math.max(
            this.combatClearUntilTick,
            Game.tick() + Math.max(0, holdTicks)
        );
    }

    /**
     * True while we should not walk back onto the gather anchor after fleeing
     * multi-combat (Lava Maze spiders) or while a hostile is still in our face.
     */
    shouldSuppressCampReentry(): boolean {
        const combat = this.combatPolicy();
        // Preserve a player-attack kite hold even after the face-target signal clears.
        if (Game.tick() < this.combatClearUntilTick) {
            return true;
        }
        // Aggressive wilderness NPCs are expected camp occupants. Their presence
        // alone must not keep Miner away from its rocks.
        if (combat.mode === 'wilderness-miner-npc') {
            return false;
        }
        if (!combat.flee) {
            return false;
        }
        return hostileAttackerNearby(
            Npcs.query().action('Attack').within(10).results(),
            10
        );
    }

    private rebuildGearKeep(): string[] {
        const names = new Set<string>(toolKeepNames(this.toolReqs));
        if (this.minerFood) {
            for (const form of foodForms(this.minerFood.name)) {
                names.add(form);
            }
        }
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

    // Why: an existing longer cooldown is never shortened, so inner scarcity is not clobbered by an outer upgrade-fail.

    /** Defer tool acquire for `ticks` game ticks. */
    markAcquireBackoff(ticks = 25): void {
        this.acquireBackoffUntilTick = Math.max(
            this.acquireBackoffUntilTick,
            Game.tick() + Math.max(0, ticks)
        );
    }

    acquireReady(): boolean {
        return this.toolAcquire === 'on' && Game.tick() >= this.acquireBackoffUntilTick;
    }

    /** @see walkToToolVendor in api/acquisition/ToolAcquire — Nurmof surface hop included. */
    async walkToToolVendor(vendor: ToolVendor, log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        return walkToToolVendor(vendor, log);
    }

    /** @see bankPace in api/bank/Banking */
    async bankPace(log?: (m: string) => void): Promise<void> {
        return bankPace(log);
    }

    /** @see waitBankReady in api/bank/Banking */
    async waitBankReady(log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        return waitBankReady(log);
    }

    async withdrawCoinsFor(need: number, log: (m: string) => void = m => this.log(`  ${m}`)): Promise<boolean> {
        return withdrawCoins(need, {
            invCoins: Inventory.count(COINS),
            bankCoins: Bank.isOpen() ? Bank.count(COINS) : 0,
            coinName: COINS,
            log
        });
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
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);
        await this.bankPace();
    }

    // Why: wielding a tool can shove whatever was equipped — an old axe or pick, a weapon or shield — into the inventory, and it must be deposited so users do not lose gear mid-run.
    // Why: prefer {@link prepareWornSurplusForDeposit} plus a deposit while the bank is already open, so the happy path never needs this recovery reopen.

    /** Re-opens the bank when needed and deposits gear displaced by a wield. */
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
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);
        await this.bankPace();
    }

    // Why: Equipment.unequip does not require the bank to be closed, so the surplus can be deposited in the same session.

    /** Unequips worse worn tiered tools, and optional extras, into the pack while the bank is open. */
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
            await Execution.delayUntilTicks(() => !Equipment.contains(name) || Inventory.first(name) !== null, 5);
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
        await Execution.delayTicks(1);
        if (await this.openScriptBank(log)) {
            await this.waitBankReady(log);
            // Glance only — no withdraw; the double-take.
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

    /** Host surface for api/acquisition/ToolAcquireExec (buy / repair / smith). */
    private toolAcquireHost(): ToolAcquireHost {
        return {
            setStatus: s => this.setStatus(s),
            log: m => this.log(m),
            openBankAt: (stand, log) => this.openBankAt(stand, log),
            waitBankReady: log => this.waitBankReady(log),
            bankPace: log => this.bankPace(log),
            closeScriptBank: (log, opts) => this.closeScriptBank(log, opts),
            walkToToolVendor: (vendor, log) => this.walkToToolVendor(vendor, log),
            heldCount: name => this.heldCount(name),
            gearKeepNamesList: () => this.gearKeepNamesList(),
            prepareWornSurplusForDeposit: (log, extra) => this.prepareWornSurplusForDeposit(log, extra),
            depositSurplusGatherTools: (log, extra) => this.depositSurplusGatherTools(log, extra),
            withdrawCoinsFor: (need, log) => this.withdrawCoinsFor(need, log),
            equipTools: (names, log, opts) => this.equipTools(names, log, opts),
            markAcquireBackoff: ticks => this.markAcquireBackoff(ticks),
            attackLevel: () => Skills.level('attack'),
            miningLevel: () => Skills.level('mining'),
            driveDialog: (prefer, log) => driveDialog([...prefer], log)
        };
    }

    async executeToolAcquirePlan(
        plan: ToolAcquirePlan,
        log: (m: string) => void = m => this.log(`  ${m}`),
        opts: { bankPrepared?: boolean } = {}
    ): Promise<boolean> {
        return execToolAcquirePlan(this.toolAcquireHost(), plan, log, opts);
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
        return execFishingGearShopCart(this.toolAcquireHost(), plans, log, opts);
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
            return gatherPaintAccent('fish');
        }
        if (this.mining()) {
            return gatherPaintAccent('mine');
        }
        if (this.woodcutting()) {
            return gatherPaintAccent('wc');
        }
        return gatherPaintAccent('other');
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
        return paintClip(this.status.trim() || 'idle', 40);
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
        return paintSkillShort(skill);
    }

    private paintSkillTitle(skill: string): string {
        return paintSkillTitle(skill);
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
        if (this.xpStart[skill] === undefined) {
            return '—';
        }
        return fmtXpHrPaint(this.xpGained(skill), mins);
    }

    private fmtXpGained(skill: string): string {
        return fmtXpGainedPaint(this.xpGained(skill));
    }

    private fullInventoryNote(): string {
        if (this.burnMode === 'chop-then-burn') {
            return `burning ${this.burnLogs} when full`;
        }
        if (this.minerFood) {
            return `eating ${this.minerFood.name} for ore slots, then banking to restock`;
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
        if (this.minerFood) {
            return `Full: eat ${this.minerFood.name} → bank`;
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
        return paintClip(text, max);
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
                    : this.minerFood
                        ? `Food: ${this.minerFoodCount()}/${this.minerFood.target} · ate ${this.minerFoodEaten}`
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
    // Why: named camps take location.chaseRadius or {@link DEFAULT_CHASE_RADIUS}.
    // Why: freeform takes the same value as the membership leash, from the UI or the floor.

    /** Player-relative fishing primary disk. */
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
        return this.combatPolicy().allowGather;
    }

    /** Whether WaitStickyCombat / FleeCombat own the current combat state. */
    mobFleeEnabled(): boolean {
        return this.combatPolicy().flee;
    }

    /** Player-attack signal for the wilderness-only Miner override. */
    wildernessMinerPlayerAttack(): boolean {
        return this.combatPolicy().mode === 'wilderness-miner-player';
    }

    wildernessMinerStanceNeeded(): boolean {
        return wildernessMinerStanceNeeded({
            isMiner: this.mining(),
            tile: Game.tile(),
            tickManipAllowCombat: this.tickManip.allowCombat,
            autoRetaliateOn: Game.autoRetaliateOn()
        });
    }

    private combatPolicy(): GatheringCombatPolicy {
        return gatheringCombatPolicy({
            isMiner: this.mining(),
            tile: Game.tile(),
            incomingPlayerAttacker: incomingPlayerAttacker(Players.query().results()),
            autoLocation: isAutoLocation(this.locationSetting),
            tickManipAllowCombat: this.tickManip.allowCombat
        });
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

    // Why: the server only sets %action_delay after a Make confirm (process_fletch_logs).
    // Why: the Make-X count dialog is a failure mode for tick manip, so this always uses Make-1.
    // Why: product completion is incidental — gather is re-clicked on the next tick.

    /** Arms the knife+log delay (+2 server). */
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
        await Execution.delayUntilTicks(() => ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 2);
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
     * Drop surplus fletchable logs so knife-delay keeps one delay log.
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
            if (await Execution.delayUntilTicks(() => Inventory.used() < before, 5)) {
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
        await Execution.delayUntilTicks(
            () =>
                this.cookableRawCount() < before
                || ChatDialog.isMakeMenu()
                || ChatDialog.canContinue(),
            9
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
        await Execution.delayUntilTicks(() => Skills.effective('hitpoints') > before, 5);
        return true;
    }

    minerFoodEnabled(): boolean {
        return this.minerFood !== null;
    }

    minerFoodCount(): number {
        return this.minerFood ? countFood(Inventory.items(), this.minerFood.name) : 0;
    }

    minerFoodRestockNeeded(): boolean {
        return minerFoodRestockNeeded({
            configured: this.minerFood !== null,
            foodCount: this.minerFoodCount(),
            startupPending: this.minerFoodStartupPending
        });
    }

    shouldEatMinerFood(): boolean {
        const config = this.minerFood;
        if (!config) {
            return false;
        }
        return shouldEatMinerFood({
            hp: Skills.effective('hitpoints'),
            maxHp: Skills.level('hitpoints'),
            heal: foodHealAmount(config.name),
            foodCount: this.minerFoodCount(),
            inventoryFull: Inventory.isFull()
        });
    }

    async eatMinerFood(): Promise<boolean> {
        const config = this.minerFood;
        if (!config || Bank.isOpen()) {
            return false;
        }
        const food = Inventory.items().find(i => isFoodItem(i.name, config.name));
        if (!food) {
            return false;
        }
        const before = {
            hp: Skills.effective('hitpoints'),
            used: Inventory.used(),
            count: this.minerFoodCount(),
            slot: food.slot,
            id: food.id,
            name: food.name
        };
        const reason = Inventory.isFull() ? 'ore room' : 'full heal';
        this.setStatus(`food: eating ${food.name} (${reason})`);
        this.log(
            `food: eat ${food.name} (${reason}; hp ${before.hp}/${Skills.level('hitpoints')}, pack ${before.used}/28)`
        );
        if (!(await food.interact('Eat'))) {
            this.log(`food: '${food.name}' has no usable Eat action`);
            return false;
        }
        const consumed = await Execution.delayUntilTicks(() => {
            const sameSlot = Inventory.items().find(i => i.slot === before.slot);
            return (
                Skills.effective('hitpoints') > before.hp
                || Inventory.used() < before.used
                || this.minerFoodCount() < before.count
                || sameSlot?.id !== before.id
                || sameSlot?.name !== before.name
            );
        }, 6);
        if (consumed) {
            this.minerFoodEaten++;
        } else {
            this.log(`food: ${food.name} did not change the pack or HP — will retry`);
        }
        return consumed;
    }

    /** Top up the configured Miner food while BankCatch already has the bank open. */
    async topUpMinerFoodAtBank(log: (m: string) => void): Promise<boolean> {
        const config = this.minerFood;
        if (!config) {
            return true;
        }
        await Execution.delayUntilTicks(() => Bank.loaded(), 6);
        await Execution.delayTicks(1);

        const held = this.minerFoodCount();
        const banked = Bank.count(config.name);
        const plan = planMinerFoodWithdrawal({
            target: config.target,
            held,
            banked,
            freeSlots: Inventory.free()
        });
        if (!plan.ok) {
            const detail =
                plan.reason === 'bank-stock'
                    ? `bank + pack are short by ${plan.missing}`
                    : `pack needs ${plan.missing} more free slot(s)`;
            const message = `food: cannot prepare ${config.target} ${config.name} (${detail})`;
            this.setStatus(`${message} — stopped`);
            this.log(`${message}; stopping`);
            if (Bank.isOpen()) {
                await this.closeScriptBank(log, { allowForgetful: false });
            }
            ScriptRunner.stop(message);
            return false;
        }

        if (plan.withdraw > 0) {
            this.setStatus(`food: withdrawing ${plan.withdraw} ${config.name}`);
            log(`food: withdraw ${plan.withdraw} ${config.name} (${held} → ${config.target})`);
            if (!(await Bank.withdrawX(config.name, plan.withdraw))) {
                const message = `food: withdraw failed for ${plan.withdraw} ${config.name}`;
                this.setStatus(`${message} — stopped`);
                this.log(`${message}; stopping`);
                if (Bank.isOpen()) {
                    await this.closeScriptBank(log, { allowForgetful: false });
                }
                ScriptRunner.stop(message);
                return false;
            }
            await Execution.delayUntilTicks(() => this.minerFoodCount() >= config.target, 7);
        }

        const after = this.minerFoodCount();
        if (after < config.target) {
            const message = `food: restock verification failed (${after}/${config.target} ${config.name})`;
            this.setStatus(`${message} — stopped`);
            this.log(`${message}; stopping`);
            if (Bank.isOpen()) {
                await this.closeScriptBank(log, { allowForgetful: false });
            }
            ScriptRunner.stop(message);
            return false;
        }
        this.minerFoodStartupPending = false;
        this.log(`food: trip ready with ${after} ${config.name}`);
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
        return Execution.delayUntilTicks(() => Inventory.used() < before, 5);
    }

    /** True when standing outside the gather leash (startup / after bank). */
    awayFromGatherSpot(slack = 4): boolean {
        return !tileWithinLeash(this, Game.tile() ?? this.getAnchor(), slack);
    }

    // Why: the skip uses the soft arrive disk ({@link HOME_ARRIVE_RADIUS}), not the full gather leash.
    // Why: bank stands at named camps often sit inside the leash but far from resources — the Catherby bank is ~36 from the pier.

    /** Soft return toward the gather anchor after bank, shop or repair. */
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

    // Why: tool upgrades must never pull the player off trees or rocks on a cold start.
    // Why: the Draynor bank is only ~12 tiles from the willow anchor, inside ReturnToAnchor slack, so "away from spot" alone is not a safe upgrade gate.

    /** True when already at or near the script bank, or the bank UI is open. */
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

    // Why: the worse tier is deposited in the same bank open, and nothing is equipped here — the caller closes once then wields offline, so one upgrade never opens and closes the bank three times.
    // Why: the bank must already be open and loaded.
    // Why: the returned names are what should be equipped after the bank closes.

    /** Withdraws better banked tiered tools, steel while bronze is held. */
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
            await Execution.delayUntilTicks(() => this.heldCount(step.name) > before || Bank.count(step.name) === 0, 7);
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

    // Why: a bank withdraw — steel in bank with bronze held — is preferred before shop or smith.
    // Why: it runs as one bank session: withdraw, unequip surplus, deposit, optional coins, close once, equip.
    // Why: true means a bank or shop trip was attempted, whether it succeeded or failed with backoff.

    /** Takes a better banked or affordable tool when Buy/repair is on. */
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
                this.markAcquireBackoff(35);
                return true;
            }
        }
        if (!(await this.waitBankReady(log))) {
            if (startup) {
                this.clearStartupToolBankSync();
            }
            this.markAcquireBackoff(35);
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
            this.markAcquireBackoff(200);
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
                this.markAcquireBackoff(100);
                return finishEquipAndHome(withdrewBetter);
            }
            if (!(await this.withdrawCoinsFor(plan.cost, log))) {
                this.markAcquireBackoff(50);
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
        this.markAcquireBackoff(ok ? 150 : 75);
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
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);
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
            await Execution.delayUntilTicks(() => Inventory.count(step.name) > before || Bank.count(step.name) === 0, 7);
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
                    this.markAcquireBackoff(35);
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
        ScriptRunner.stop(`restock: ${reason} — need ${need}`);
    }

    heldItemNames(): string[] {
        return [...Equipment.items(), ...Inventory.items()].map(i => i.name ?? '').filter(n => n.length > 0);
    }
    private heldHas(name: string): boolean {
        const want = name.toLowerCase();
        for (const item of Equipment.items()) {
            if ((item.name ?? '').toLowerCase() === want) {
                return true;
            }
        }
        return Inventory.count(name) > 0;
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

    /** Cached gear-keep names from onStart (toolReqs / tick-manip kit do not change mid-run). */
    gearKeepNamesList(): string[] {
        return this.gearKeep;
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

    // Why: this must not run while the bank is open, since backpack ops become Deposit-*.
    // Why: opts.bankDisplaced defaults to true and reopens the bank to deposit gear shoved into the pack by the wield; pass false when the surplus was already unequipped and deposited in the same bank session.

    /** Closes the bank if open, then Wields each tool. False when any equip failed. */
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
            await Execution.delayUntilTicks(() => !ChatDialog.isMainMakePanel() && !ChatDialog.isOpen(), 5);
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
            await Execution.delayTicks(1);
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
        if (this.gearKeep.length > 0 && !depositAllExcept(this.gearKeep)(name)) {
            return false;
        }
        // Why: cooked fish, and banked burnt, must stay depositable through BankCatch as a safety net when FishBankCooked never ran because cookingLoad was cleared or interrupted.
        // Why: mid-cook BankCatch is blocked separately.
        if (
            this.cookEnabled()
            && !this.cookingLoad
            && !this.inCookBatch
            && (this.cookMode === 'cook-then-bank' || this.cookMode === 'bank-raw-then-cook')
        ) {
            if (isCookedFishName(name) || isBurntFishName(name)) {
                return this.shouldDepositCookResult(name);
            }
            // Non-cookable raw (filter leftover) still banks as-is.
            if (isRawFishName(name) && !rawMatchesCookFilter(name, this.cookFishFilter)) {
                return true;
            }
        }
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
        if (Inventory.items().some(i => this.shouldDeposit(i.name ?? ''))) {
            return true;
        }
        // Cooked haul after a cook load (product keywords are "raw" only).
        if (
            this.cookEnabled()
            && !this.cookingLoad
            && !this.inCookBatch
            && Inventory.items().some(i => this.shouldDepositCookResult(i.name ?? ''))
        ) {
            return true;
        }
        return false;
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

    // Why: the fisher spot search is player-relative, and the start tile still bounds wander through ReturnToAnchor.
    // Why: named camps also chase fish from the player, but fence spots to camp membership.

    /** True when there is no named camp preset: Auto freeform or power None. */
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
            this.setStatus('cook: batch complete — stopped');
            ScriptRunner.stop(`cook: batch drained (bank raw ${this.bankRawInBank}/${this.bankRawTarget})`);
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
            // Filter leftovers (e.g. Raw shrimps while cooking Lobster only).
            return !rawMatchesCookFilter(name, this.cookFishFilter);
        }
        if (isBurntFishName(name)) {
            return this.burntPolicy === 'bank';
        }
        // Cooked fish only — do not call shouldDeposit (that routes cooked back here).
        return isCookedFishName(name);
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
