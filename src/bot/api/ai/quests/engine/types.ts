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
    // Why: absent means the snapshot doesn't report it, and a step that needs prayer treats that as "not short".
    /** Current prayer points. */
    prayer?: number;
    /** Attack level, which is the tier of melee weapon the account can wield. */
    attack?: number;
    /** Ranged level, which is the tier of bow the account can wield. */
    ranged?: number;
    freeSlots?: number;
}

// Why: display names collide: "Broken shield", "Certificate", "Fishing spot" and "Gate" each name more than one thing, so a name lookup silently accepts the wrong object.

/** How many of an exact object id the pack holds. */
export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

// Why: Preserve unknown bank state instead of treating an unread bank as empty.

/** How many of an exact object id the last bank read saw; 0 until one lands. */
export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankKnown ? (snap.bankIds?.get(id) ?? 0) : 0;
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
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number; bank?: Tile }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export type ProtectionKind = 'melee' | 'magic' | 'missiles';

export interface QuestPrayer {
    protect: ProtectionKind;
    /** Prayer potion doses drawn into the float alongside the food. */
    potions?: number;
}

export interface QuestSustain {
    /** Food display names this quest can source and use for traversal upkeep. */
    foods: readonly string[];
    /** Hitpoints fraction below which the host should eat, from 0 to 1. */
    eatBelowHp: number;
}

export interface QuestModule {
    record: QuestRecord;
    onStart?: () => void;
    hops?: LadderHop[];
    // Why: most quests sit in one town, so naming its bank beats working it out.
    // Why: `'nearest'` is for the ones that don't; a quest spread across 4 kingdoms pays for a pinned bank on every leg.

    /** The bank this quest uses. */
    bank?: Tile | 'nearest';
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    tools?: string[];
    // Why: for the quests that end somewhere the navigator can't leave on its own.

    /** Walked when the quest is finished, before the retreat to a bank; true once a bank walk can start. */
    exit?: (log: (m: string) => void) => Promise<boolean>;
    /** The module owns all banking/loadout decisions, including restarts in bankless areas. */
    ownsInventory?: boolean;
    // Why: food is the bulkiest withdrawal, so a module that arms itself from the bank has to be dressed before the pack fills.
    /** False to hold the food float back this pass; absent means withdraw it as soon as the bank is known. */
    foodReady?: (snap: QuestSnapshot) => boolean;
    /** Read an exact quest stage from client-visible state. Async journals are supported. */
    readStage?: () => number | undefined | Promise<number | undefined>;
    /** Supersedes readStage: the stage plus sub-progress the stage number cannot carry. */
    readProgress?: () => QuestProgress | undefined | Promise<QuestProgress | undefined>;
    /** Optional quest-specific survival policy applied while this module is active. */
    sustain?: QuestSustain;
    // Why: declared only on the quests whose fights threaten the account; a level-2 goblin isn't worth the points.
    /** Protection prayer to hold through this quest's fights, and the doses it carries. */
    pray?: QuestPrayer;
    // Why: set 0 when the quest spends nothing, as a default 1000 still draws walking-around money on the first provision pass.

    /** Spending money to keep in the pack, default `COIN_FLOAT`. */
    coinFloat?: number;
    // Why: for advisories such as "the live harness only proved X stats", never a hard gate.

    /** One-shot advisory when this module becomes the active runner; null when the account looks fine. */
    warnReadiness?: () => string | null;
    /** Extra log lines when this quest decides a step (or on death); context for stuck runs. Piloted on Tourist Trap. */
    observe?: (snap: QuestSnapshot, step: QuestStep) => readonly string[];
    decide(snap: QuestSnapshot): QuestStep;
}
