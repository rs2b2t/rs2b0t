import type Tile from '../../../../geometry/Tile.js';
import type { WorldTile } from '../../../../adapter/ClientAdapter.js';
import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

export interface QuestProgress {
    stage: number;
    /** Journal-visible sub-progress. `name`, or `name:N` for a counted flag. */
    flags: ReadonlySet<string>;
}

export function hasFlag(progress: QuestProgress | undefined, name: string): boolean {
    return progress?.flags.has(name) ?? false;
}

export function flagValue(progress: QuestProgress | undefined, name: string): number | undefined {
    const prefix = name + ':';
    for (const flag of progress?.flags ?? []) {
        if (flag.startsWith(prefix)) {
            const value = Number(flag.slice(prefix.length));
            return Number.isFinite(value) ? value : undefined;
        }
    }
    return undefined;
}

export interface QuestSnapshot {
    journal: QuestStatus;
    inv: Map<string, number>;
    /** Inventory totals keyed by exact server object ID. */
    invIds?: ReadonlyMap<number, number>;
    worn: Set<string>;
    /** Equipped object IDs. */
    wornIds?: ReadonlySet<number>;
    noProgress: number;
    bankCoins: number;
    /** Exact server quest stage when the quest module exposes one. */
    stage?: number;
    /** Stage plus journal sub-progress, when the module exposes readProgress. */
    progress?: QuestProgress;
    /** Last complete bank view observed by this engine instance. */
    bank?: ReadonlyMap<string, number>;
    /** Last complete bank view keyed by exact server object ID. */
    bankIds?: ReadonlyMap<number, number>;
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}

export type QuestStep =
    | { kind: 'talk'; stop: NpcStop }
    | { kind: 'grabGround'; item: string; anchor: Tile; waitIfMissing?: boolean }
    | { kind: 'pickLoc'; loc: string; op: string; item: string; anchor: Tile }
    | { kind: 'interactLoc'; loc: string; op: string; anchor: Tile; expectItem?: string }
    | { kind: 'useOn'; item: string; targetKind: 'npc' | 'loc' | 'item'; target: string; anchor: Tile; product?: string }
    | { kind: 'equip'; item: string }
    | { kind: 'scanBank'; bank?: Tile }
    | { kind: 'withdraw'; items: { name: string; qty: number; id?: number }[]; bank?: Tile; leaveOpen?: boolean }
    | { kind: 'deposit'; keep: string[]; keepIds?: readonly number[]; bank?: Tile; leaveOpen?: boolean; exactKeep?: boolean }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestSustain {
    /** Food display names this quest can source and use for traversal upkeep. */
    foods: readonly string[];
    /** Hitpoints fraction below which the host should eat, from 0 to 1. */
    eatBelowHp: number;
}

export interface QuestModule {
    record: QuestRecord;
    hops?: LadderHop[];
    // Why: most quests sit in one town, where naming its bank is shorter and more predictable than working it out.
    // Why: `'nearest'` is for the ones that do not, as a quest spread across four kingdoms pays for a pinned bank on every leg.

    /** The bank this quest uses. */
    bank?: Tile | 'nearest';
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    tools?: string[];
    // Why: this exists for the quests that end somewhere the navigator cannot leave on its own.

    /** Walked when the quest is finished, before the retreat to a bank; true once a bank walk can start. */
    exit?: (log: (m: string) => void) => Promise<boolean>;
    /** The module owns all banking/loadout decisions, including restarts in bankless areas. */
    ownsInventory?: boolean;
    // Why: food is the bulkiest withdrawal a quest makes, so a module that arms itself from the bank has to be dressed before the pack fills, or the gear has nowhere to land.
    /** False to hold the food float back this pass; absent means withdraw it as soon as the bank is known. */
    foodReady?: (snap: QuestSnapshot) => boolean;
    /** Read an exact quest stage from client-visible state. Async journals are supported. */
    readStage?: () => number | undefined | Promise<number | undefined>;
    /** Supersedes readStage: the stage plus sub-progress the stage number cannot carry. */
    readProgress?: () => QuestProgress | undefined | Promise<QuestProgress | undefined>;
    /** Optional quest-specific survival policy applied while this module is active. */
    sustain?: QuestSustain;
    // Why: set 0 when the module fetches coins at the point of sale, as the float is restored on every provisioning loop and a standing balance means a bank trip per purchase.

    /** Spending money to keep in the pack, default `COIN_FLOAT`. */
    coinFloat?: number;
    // Why: this is for advisories such as "the live harness only proved X stats" rather than hard gates.

    /** One-shot advisory when this module becomes the active runner; null when the account looks fine. */
    warnReadiness?: () => string | null;
    /**
     * Extra log lines when this quest decides a step (or on death). Pilot for
     * Tourist Trap observability — copy-pasteable context for stuck runs.
     */
    observe?: (snap: QuestSnapshot, step: QuestStep) => readonly string[];
    decide(snap: QuestSnapshot): QuestStep;
}
