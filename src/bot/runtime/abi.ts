// docs/ARCHITECTURE.md#the-abi-boundary
import { reader } from '../adapter/ClientAdapter.js';
import { Area } from '../api/Area.js';
import {
    Banking,
    COMMON_BANK_LOOT,
    PERIODIC_BANK_SETTINGS,
    RANDOM_EVENT_CASKET_ID,
    depositAllExcept,
    depositMatcher,
    matchesCommonBankLoot,
    parseBankStrategy,
    shouldBankNow
} from '../api/Banking.js';
import { AbstractBot, BranchTask, LeafTask, LoopingBot, TaskBot, TreeBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { AcquireTask, hasAll, held } from '../api/ItemAcquisition.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
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
        Shop,
        Skills,
        ChatDialog,
        Quests,
        Trade,

        AcquireTask,
        hasAll,
        held,

        AbstractBot,
        LoopingBot,
        TaskBot,
        TreeBot,
        BranchTask,
        LeafTask,

        reader
    });

    (globalThis as Record<string, unknown>).__rs2b0t = abi;
}
