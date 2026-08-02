// docs/ARCHITECTURE.md#the-abi-boundary
import { reader } from '../adapter/ClientAdapter.js';
import { PathPublish } from '../nav/pathPublish.js';
import { isNavPathPaintEnabled } from '../nav/pathOverlay.js';
import { SettingsStore } from './Settings.js';
import { Area } from '../api/Area.js';
import {
    BANK_LOCATIONS,
    bankDistance,
    bankUnlocked,
    nearestBank,
    nearestUsableBank
} from '../api/BankLocations.js';
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
} from '../api/Banking.js';
import { AbstractBot, BranchTask, LeafTask, LoopingBot, TaskBot, TreeBot } from '../api/Bot.js';
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
} from '../api/CowKillerLocations.js';
import { Execution } from '../api/Execution.js';
import {
    FISHING_LOCATIONS,
    FISHING_LOCATION_OPTIONS,
    resolveFishingLocation
} from '../api/FishingLocations.js';
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
} from '../api/FishingMethods.js';
import { Game } from '../api/Game.js';
import {
    DEFAULT_BOOTH_NAME,
    DEFAULT_BOOTH_OP,
    MAP_SQUARE,
    boothFields,
    locationOptions,
    resolveGatheringLocation,
    sameMapSquare
} from '../api/GatheringLocations.js';
import { AcquireTask, hasAll, held } from '../api/ItemAcquisition.js';
import {
    MINING_LOCATIONS,
    MINING_LOCATION_OPTIONS,
    resolveMiningLocation
} from '../api/MiningLocations.js';
import {
    BROKEN_PICKAXE,
    GAS_ROCK_IDS,
    GAS_ROCK_TICKS,
    ROCK_OPTIONS,
    ROCK_TYPES,
    resolveRockIds
} from '../api/MiningRocks.js';
import {
    ARDOUGNE_PICKPOCKET_TARGETS,
    PICKPOCKET_TARGETS,
    PICKPOCKET_TARGET_NAMES
} from '../api/PickpocketTargets.js';
import {
    DEFAULT_RUNE,
    RUNE_OPTIONS,
    RUNES
} from '../api/RuneCraftLocations.js';
import Tile from '../api/Tile.js';
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
} from '../api/ToolAcquire.js';
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
} from '../api/Tools.js';
import { Traversal } from '../api/Traversal.js';
import {
    WALK_DESTINATIONS,
    WALK_OPTIONS,
    resolveDestination
} from '../api/WalkDestinations.js';
import {
    WOODCUTTING_LOCATIONS,
    WOODCUTTING_LOCATION_OPTIONS,
    resolveWoodcuttingLocation
} from '../api/WoodcuttingLocations.js';
import { GroundItem, Loc, Npc, Player } from '../api/entities/index.js';
import { Bank, withdrawOp } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { InvItem, Inventory } from '../api/hud/Inventory.js';
import { Quests } from '../api/hud/Quests.js';
import { Shop } from '../api/hud/Shop.js';
import { Skills } from '../api/hud/Skills.js';
import { Trade } from '../api/hud/Trade.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Players } from '../api/queries/Players.js';
import EntityQuery from '../api/queries/Query.js';
import { bus, type EventMap } from '../events/EventBus.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { defineBot, registerScript } from './defineBot.js';

export const API_VERSION = 1;

export function installAbi(): void {
    const abi = Object.freeze({
        apiVersion: API_VERSION,

        Execution,
        defineBot,
        registerScript,
        events: Object.freeze({
            on: <K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): (() => void) => bus.on(event, cb),
            off: <K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void => bus.off(event, cb)
        }),

        Game,
        Tile,
        Area,
        Traversal,
        DirectNavigator,

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

        reader
    });

    (globalThis as Record<string, unknown>).__rs2b0t = abi;
}
