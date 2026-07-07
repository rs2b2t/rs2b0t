import { reader } from '../adapter/ClientAdapter.js';
import { Area } from '../api/Area.js';
import { AbstractBot, BranchTask, LeafTask, LoopingBot, TaskBot, TreeBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { AcquireTask, hasAll, held } from '../api/ItemAcquisition.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { GroundItem, Loc, Npc, Player } from '../api/entities/index.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { InvItem, Inventory } from '../api/hud/Inventory.js';
import { Quests } from '../api/hud/Quests.js';
import { Shop } from '../api/hud/Shop.js';
import { Skills } from '../api/hud/Skills.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Players } from '../api/queries/Players.js';
import EntityQuery from '../api/queries/Query.js';
import { bus, type EventMap } from '../events/EventBus.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { defineBot, registerScript } from './defineBot.js';

/**
 * The script-facing ABI (Slice 7). `globalThis.__lcbuddy` is the ONE global
 * externally-compiled scripts bind to (via the @lcbuddy/api shim); its
 * property names are stable because the bot bundle never mangles
 * (ADR-0004). Bump API_VERSION on breaking surface changes — the shim
 * refuses mismatches.
 *
 * Runtime CLASSES are exported (not just types) because external scripts
 * subclass them and TreeBot walks nodes via instanceof — class identity must
 * be shared with the bundle.
 */
export const API_VERSION = 1;

export function installAbi(): void {
    const abi = Object.freeze({
        apiVersion: API_VERSION,

        // runtime
        Execution,
        defineBot,
        registerScript,
        events: Object.freeze({
            on: <K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): (() => void) => bus.on(event, cb),
            off: <K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void => bus.off(event, cb)
        }),

        // world + movement
        Game,
        Tile,
        Area,
        Traversal,
        DirectNavigator,

        // queries + entity classes
        Npcs,
        Players,
        Locs,
        GroundItems,
        EntityQuery,
        Npc,
        Player,
        Loc,
        GroundItem,

        // hud
        Inventory,
        InvItem,
        Equipment,
        Bank,
        Shop,
        Skills,
        ChatDialog,
        Quests,

        // item acquisition
        AcquireTask,
        hasAll,
        held,

        // bot base classes
        AbstractBot,
        LoopingBot,
        TaskBot,
        TreeBot,
        BranchTask,
        LeafTask,

        // low-level reads (escape hatch; prefer the api surface)
        reader
    });

    (globalThis as Record<string, unknown>).__lcbuddy = abi;
}
