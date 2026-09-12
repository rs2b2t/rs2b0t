import type { Bank } from '../src/bot/api/bank/Bank.js';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Inventory, InvItem } from '../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Quests } from '../src/bot/api/ui/questlog/Quests.js';
import type { Game } from '../src/bot/api/game/Game.js';
import type { GroundItem } from '../src/bot/api/model/GroundItem.js';
import type { Traversal } from '../src/bot/api/walking/Traversal.js';
import type { AbstractBot, LoopingBot } from '../src/bot/api/bot/Bot.js';
import type { reader, actions } from '../src/bot/adapter/ClientAdapter.js';
import type { RewardItem } from './jive-reward-contract.js';

export type TraceTask = { execute(): void | Promise<void>; clueStatus?(): string };
export type TraceHost = { readonly tasks: readonly TraceTask[]; setStatus(status: string): void; onStart?(): void | Promise<void> };
export type TraceHostSource = {
    readonly runner: { readonly bot: unknown; onChange(fn: () => void): () => void };
    readonly host: { addTickListener(fn: () => void): () => void };
};
export type PrivateHostTrace = { status(): string; restore(): void };
export type PrivateRuntime = {
    readonly __rs2b0t: { readonly Bank: typeof Bank; readonly Equipment: typeof Equipment; readonly Inventory: typeof Inventory;
        readonly InvItem: typeof InvItem; readonly Skills: typeof Skills; readonly Quests: typeof Quests; readonly Game: typeof Game;
        readonly GroundItem: typeof GroundItem; readonly Traversal: typeof Traversal; readonly LoopingBot: typeof LoopingBot;
        registerScript(meta: { name: string; create: () => LoopingBot }): void };
    readonly rs2b0t: { readonly reader: typeof reader; readonly actions: typeof actions; clueProgress(): unknown;
        readonly host: { addTickListener(fn: () => void): () => void };
        readonly registry: { get(name: string): unknown };
        readonly runner: { start(meta: unknown): void; stop(reason: string): void; onChange(fn: () => void): () => void;
            readonly bot: AbstractBot | null } };
};
export type PrivateEvent = {
    readonly at: number; readonly tick: number; readonly kind: string; readonly action: string; readonly itemId: number;
    readonly inventory: readonly RewardItem[]; readonly bank: readonly RewardItem[]; readonly bankConfirmed: boolean;
    readonly hp: number; readonly maxHp: number; readonly sharks: number; readonly used: number; readonly weaponId: number;
    readonly special: number; readonly antipoisonDoses: number; readonly attack: number; readonly lostCity: boolean;
    readonly clueHeld: boolean; readonly status: string; readonly tile: { readonly x: number; readonly z: number; readonly level: number } | null;
    readonly manifest: readonly RewardItem[]; readonly modalId: number; readonly ground: readonly RewardItem[];
    readonly consumed: readonly RewardItem[]; readonly progress: unknown;
};
export type GuardianFrame = { readonly nid: number; readonly life: string; readonly name: string; readonly hp: number;
    readonly owner: string | null; readonly active: boolean };
export type PrivateFrame = { readonly at: number; readonly tick: number; readonly fixture: string;
    readonly guardians: readonly GuardianFrame[]; readonly players: readonly { readonly username: string; readonly hp: number;
        readonly inventory: readonly RewardItem[]; readonly bank: readonly RewardItem[]; readonly trailStatus: number;
        readonly ground: readonly { readonly id: number; readonly count: number; readonly owned: boolean }[] }[] };

declare global {
    var __jiveHostTraceFactory: ((source: TraceHostSource, capture: (kind: string) => void) => PrivateHostTrace) | undefined;
    var __jivePrivate: { readonly events: PrivateEvent[]; restore(): void } | undefined;
    var __jiveBank: { readonly items: readonly RewardItem[]; readonly error: string | null } | undefined;
}
