// docs/decisions/architecture.md#the-abi-boundary
import { BUILD_INFO } from './buildInfo.js';
import { reader } from '../adapter/ClientAdapter.js';
import { PathPublish } from '../event/webwalk/pathPublish.js';
import { isNavPathPaintEnabled } from '../event/webwalk/pathOverlay.js';
import {
    KNOWN_DANGER_ZONES,
    knownDangerZone,
    knownDangerZoneIds,
    resolveDangerZones,
    tileInDangerZones
} from '../event/webwalk/data/dangerZones.js';
import { SettingsStore } from './Settings.js';
import { Area } from '../geometry/Area.js';
import {
    BANK_LOCATIONS,
    bankDistance,
    bankUnlocked,
    nearestBank,
    nearestUsableBank
} from '../api/bank/BankLocations.js';
import {
    Banking,
    COMMON_BANK_LOOT,
    NEARBY_BANK_RADIUS,
    PERIODIC_BANK_SETTINGS,
    RANDOM_EVENT_CASKET_ID,
    depositAllExcept,
    depositMatcher,
    matchesCommonBankLoot,
    parseBankStrategy,
    resolveBankOpenRoute,
    shouldBankNow
} from '../api/bank/Banking.js';
import { AbstractBot, BranchTask, LeafTask, LoopingBot, TaskBot, TreeBot } from '../api/bot/Bot.js';
import {
    AL_KHARID_BANK,
    COW_LOCATIONS,
    COW_LOCATION_OPTIONS,
    TOLL_COIN_TARGET,
    isCowFieldLootTile,
    nearestCowLocation,
    needsTollCoins,
    resolveCowLocation,
    shouldBootstrapTollCoins
} from '../data/cowKillerLocations.js';
import { Execution } from '../api/execution/Execution.js';
import {
    FISHING_LOCATIONS,
    FISHING_LOCATION_OPTIONS,
    resolveFishingLocation
} from '../data/fishingLocations.js';
import {
    ALL_FISHING_GEAR_NAMES,
    FISHING_METHODS,
    FISHING_METHOD_OPTIONS,
    WHIRLPOOL_IDS,
    fishingRestockPlan,
    gearKeepNames,
    gearLabel,
    hasFishingGear,
    missingFishingGear,
    resolveFishMethod,
    spotMatchesMethod
} from '../data/fishingMethods.js';
import { Game } from '../api/game/Game.js';
import {
    DEFAULT_BOOTH_NAME,
    DEFAULT_BOOTH_OP,
    MAP_SQUARE,
    boothFields,
    locationOptions,
    resolveGatheringLocation,
    sameMapSquare
} from '../data/gatheringLocations.js';
import { AcquireTask, hasAll, held } from '../api/acquisition/ItemAcquisition.js';
import {
    MINING_LOCATIONS,
    MINING_LOCATION_OPTION_LABELS,
    MINING_LOCATION_OPTIONS,
    miningLocationLabel,
    resolveMiningLocation
} from '../data/miningLocations.js';
import {
    BROKEN_PICKAXE,
    GAS_ROCK_IDS,
    GAS_ROCK_TICKS,
    ROCK_OPTIONS,
    ROCK_TYPES,
    resolveRockIds
} from '../data/miningRocks.js';
import {
    ARDOUGNE_PICKPOCKET_TARGETS,
    PICKPOCKET_TARGETS,
    PICKPOCKET_TARGET_NAMES
} from '../data/pickpocketTargets.js';
import {
    DEFAULT_RUNE,
    RUNE_OPTIONS,
    RUNES
} from '../data/runeCraftLocations.js';
import Tile from '../geometry/Tile.js';
import {
    AXE_BAR_FOR,
    AXE_SHOP_COSTS,
    AXE_SMITH_LEVEL,
    BOB_VENDOR,
    BROKEN_AXE,
    COINS,
    FISHING_SHOP_COSTS,
    FORGETFUL_BANK_ODDS,
    FORGETFUL_BANK_SETTING,
    GERRANT_ONLY_FISHING,
    GERRANT_VENDOR,
    HARRY_VENDOR,
    NURMOF_VENDOR,
    PICKAXE_SHOP_COSTS,
    TOOL_ACQUIRE_OPTIONS,
    TOOL_ACQUIRE_SETTING,
    VARROCK_ANVIL_BANK,
    VARROCK_ANVIL_STAND,
    acquireKeepNames,
    axeShopOffers,
    bestAffordableShopTier,
    bestOwnedTier,
    bestSmithableAxe,
    buyPlansCost,
    canFundPlan,
    coinsToWithdraw,
    fishingGearShopCart,
    fishingShopCost,
    fishingVendorFor,
    isFishingBaitPiece,
    parseToolAcquireMode,
    pickaxeShopOffers,
    planAxeAcquire,
    planBrokenToolRepair,
    planFishingGearAcquire,
    planFishingGearBuys,
    planGatherToolAcquire,
    planPickaxeAcquire,
    shopableMissingFishingGear,
    withBaitTarget
} from '../api/acquisition/ToolAcquire.js';
import {
    AXES,
    CHISEL,
    HAMMER,
    KNIFE,
    NEEDLE,
    PICKAXES,
    TINDERBOX,
    axeReq,
    bankHasBetterGatherTool,
    bestAxe,
    bestFromTiers,
    bestHeldToolNames,
    bestPickaxe,
    canWieldTool,
    exactTool,
    hasAllTools,
    hasToolReq,
    missingToolLabels,
    pickaxeReq,
    surplusHeldToolNames,
    tinderboxReq,
    toolAttackLevel,
    toolKeepNames,
    toolKitLabel,
    toolRestockPlan,
    toolsNeedingEquip
} from '../api/acquisition/Tools.js';
import { Traversal } from '../api/walking/Traversal.js';
import {
    WALK_DESTINATIONS,
    WALK_OPTIONS,
    resolveDestination
} from '../api/map/WalkDestinations.js';
import {
    WOODCUTTING_LOCATIONS,
    WOODCUTTING_LOCATION_OPTIONS,
    resolveWoodcuttingLocation
} from '../data/woodcuttingLocations.js';
import { GroundItem } from '../api/model/GroundItem.js';
import { Loc } from '../api/model/Loc.js';
import { Npc } from '../api/model/Npc.js';
import { Player } from '../api/model/Player.js';
import { Bank, withdrawOp } from '../api/bank/Bank.js';
import { ChatDialog } from '../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../api/equipment/Equipment.js';
import { InvItem, Inventory } from '../api/inventory/Inventory.js';
import { Quests } from '../api/ui/questlog/Quests.js';
import { Shop } from '../api/shop/Shop.js';
import { Skills } from '../api/skills/Skills.js';
import { Trade } from '../api/trade/Trade.js';
import { GroundItems } from '../api/grounditems/GroundItems.js';
import { Locs } from '../api/locs/Locs.js';
import { Npcs } from '../api/npcs/Npcs.js';
import { Players } from '../api/players/Players.js';
import EntityQuery from '../api/query/Query.js';
import { bus, type EventMap } from '../api/events/EventBus.js';
import { DirectNavigator } from '../event/webwalk/DirectNavigator.js';
import { EssenceSession } from '../event/webwalk/essenceSession.js';
// Harness-only hooks, absent from packages/rs2b0t-api/index.d.ts and consumed
// solely by e2e/merlin-mordred-353-live.ts.
import {
    liveFortressStep,
    liveMordredBriefed,
    liveResetMordredBrief
} from '../api/ai/quests/defs/merlinscrystal.js';
import { defineBot, registerScript } from './defineBot.js';
import { Loadouts } from '../api/loadout/loadoutStore.js';

const API_VERSION = 1;

export function installAbi(): void {
    const abi = Object.freeze({
        apiVersion: API_VERSION,

        Execution,
        defineBot,
        registerScript,
        /** Live-harness hooks (Merlin #353 fortress / Mordred latch). */
        questLive: Object.freeze({
            merlinFortress: liveFortressStep,
            merlinResetMordredBrief: liveResetMordredBrief,
            merlinMordredBriefed: liveMordredBriefed
        }),
        events: Object.freeze({
            on: <K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): (() => void) => bus.on(event, cb),
            off: <K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void => bus.off(event, cb)
        }),

        Game,
        Tile,
        Area,
        Traversal,
        DirectNavigator,
        /** Bot-side essence exit return (varp 64 is server-only — not on client wire). */
        EssenceSession,

        Npcs,
        Players,
        Locs,
        GroundItems,
        EntityQuery,
        Npc,
        Player,
        Loc,
        GroundItem,

        Inventory,
        InvItem,
        Equipment,
        Bank,
        withdrawOp,
        Banking,
        depositAllExcept,
        depositMatcher,
        matchesCommonBankLoot,
        shouldBankNow,
        parseBankStrategy,
        PERIODIC_BANK_SETTINGS,
        COMMON_BANK_LOOT,
        RANDOM_EVENT_CASKET_ID,
        NEARBY_BANK_RADIUS,
        resolveBankOpenRoute,
        BANK_LOCATIONS,
        bankDistance,
        bankUnlocked,
        nearestBank,
        nearestUsableBank,
        Shop,
        Skills,
        Loadouts,
        ChatDialog,
        Quests,
        Trade,

        AcquireTask,
        hasAll,
        held,

        // Tools
        PICKAXES,
        AXES,
        TINDERBOX,
        HAMMER,
        KNIFE,
        CHISEL,
        NEEDLE,
        pickaxeReq,
        axeReq,
        exactTool,
        tinderboxReq,
        toolAttackLevel,
        canWieldTool,
        bestFromTiers,
        bestPickaxe,
        bestAxe,
        toolKeepNames,
        hasToolReq,
        hasAllTools,
        missingToolLabels,
        toolKitLabel,
        toolRestockPlan,
        bankHasBetterGatherTool,
        toolsNeedingEquip,
        bestHeldToolNames,
        surplusHeldToolNames,

        // Tool acquire (planning)
        COINS,
        BROKEN_PICKAXE,
        BROKEN_AXE,
        parseToolAcquireMode,
        TOOL_ACQUIRE_OPTIONS,
        TOOL_ACQUIRE_SETTING,
        FORGETFUL_BANK_ODDS,
        FORGETFUL_BANK_SETTING,
        BOB_VENDOR,
        NURMOF_VENDOR,
        GERRANT_VENDOR,
        HARRY_VENDOR,
        GERRANT_ONLY_FISHING,
        VARROCK_ANVIL_STAND,
        VARROCK_ANVIL_BANK,
        PICKAXE_SHOP_COSTS,
        AXE_SHOP_COSTS,
        FISHING_SHOP_COSTS,
        AXE_SMITH_LEVEL,
        AXE_BAR_FOR,
        bestOwnedTier,
        pickaxeShopOffers,
        axeShopOffers,
        bestAffordableShopTier,
        bestSmithableAxe,
        planBrokenToolRepair,
        planPickaxeAcquire,
        planAxeAcquire,
        fishingVendorFor,
        fishingShopCost,
        isFishingBaitPiece,
        withBaitTarget,
        planFishingGearBuys,
        planFishingGearAcquire,
        buyPlansCost,
        fishingGearShopCart,
        planGatherToolAcquire,
        coinsToWithdraw,
        canFundPlan,
        acquireKeepNames,
        shopableMissingFishingGear,

        // Pickpocket
        PICKPOCKET_TARGETS,
        PICKPOCKET_TARGET_NAMES,
        ARDOUGNE_PICKPOCKET_TARGETS,

        // Gathering locations
        DEFAULT_BOOTH_NAME,
        DEFAULT_BOOTH_OP,
        MAP_SQUARE,
        sameMapSquare,
        locationOptions,
        boothFields,
        resolveGatheringLocation,
        FISHING_LOCATIONS,
        FISHING_LOCATION_OPTIONS,
        resolveFishingLocation,
        MINING_LOCATIONS,
        MINING_LOCATION_OPTIONS,
        MINING_LOCATION_OPTION_LABELS,
        miningLocationLabel,
        resolveMiningLocation,
        WOODCUTTING_LOCATIONS,
        WOODCUTTING_LOCATION_OPTIONS,
        resolveWoodcuttingLocation,

        // Fishing methods + mining rocks
        WHIRLPOOL_IDS,
        FISHING_METHODS,
        FISHING_METHOD_OPTIONS,
        ALL_FISHING_GEAR_NAMES,
        resolveFishMethod,
        gearKeepNames,
        hasFishingGear,
        missingFishingGear,
        gearLabel,
        fishingRestockPlan,
        spotMatchesMethod,
        ROCK_TYPES,
        ROCK_OPTIONS,
        GAS_ROCK_IDS,
        GAS_ROCK_TICKS,
        resolveRockIds,

        // Walk destinations
        WALK_DESTINATIONS,
        WALK_OPTIONS,
        resolveDestination,

        // Cow fields
        COW_LOCATIONS,
        COW_LOCATION_OPTIONS,
        AL_KHARID_BANK,
        TOLL_COIN_TARGET,
        isCowFieldLootTile,
        resolveCowLocation,
        nearestCowLocation,
        needsTollCoins,
        shouldBootstrapTollCoins,

        // Rune craft routes
        RUNES,
        RUNE_OPTIONS,
        DEFAULT_RUNE,

        AbstractBot,
        LoopingBot,
        TaskBot,
        TreeBot,
        BranchTask,
        LeafTask,

        // Nav v2 debug / live harness surface
        PathPublish,
        isNavPathPaintEnabled,
        SettingsStore,

        // Danger zones (pathfinder avoid) — idea @lolwut
        KNOWN_DANGER_ZONES,
        knownDangerZone,
        knownDangerZoneIds,
        resolveDangerZones,
        tileInDangerZones,

        // Deploy fingerprint (git SHA baked at bundle time)
        BUILD_INFO,

        reader
    });

    (globalThis as Record<string, unknown>).__rs2b0t = abi;
}
