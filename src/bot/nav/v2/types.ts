/**
 * Nav v2 transport contract.
 *
 * Docs: docs/nav-v2/README.md · docs/NAV.md
 *
 * Unified edge shape (origin, destination, skills, items, quests, currency,
 * loc id/action) for a 2004 bot that must *execute* every hop, not only plan it.
 */

export interface NavPoint {
    x: number;
    z: number;
    level: number;
}

export type TransportKind =
    | 'door'
    | 'gate'
    | 'stair'
    | 'dungeon'
    | 'ship'
    | 'gangplank'
    | 'shortcut'
    | 'portal'
    /** Originless spell/item hop (player tile → fixed landing). See PathPolicy. */
    | 'teleport'
    | 'other'

export type QuestProgress = 'not_started' | 'started' | 'complete' | 'unknown';

export interface SkillRequirement {
    name: string;
    level: number;
}

export interface ItemRequirement {
    name: string;
    count: number;
    /** If true, planning assumes the item is spent on the hop (toll coins, etc.). */
    consumed?: boolean;
}

export interface QuestRequirement {
    quest: string;
    /** Minimum status required for the edge to be usable. */
    minStatus: 'started' | 'complete';
}

/** Planner-side gates. Dialog / NPC side-trips live in CrossingRecipe, not here. */
export interface TransportRequires {
    members?: boolean;
    skills?: SkillRequirement[];
    /** Any-of sets can be expressed as multiple edges; each item is ANDed. */
    items?: ItemRequirement[];
    /**
     * Must be worn (equipment), not merely in inventory.
     * e.g. Chef's hat for the Cooking Guild.
     */
    worn?: ItemRequirement[];
    quests?: QuestRequirement[];
    freeSlots?: number;
    /**
     * Toll / charter style cost.
     * Equivalent to items[] but kept explicit for explain output.
     */
    currency?: { name: string; amount: number };
    /**
     * When true, edge is blocked if WorldState reports Entrana-restricted gear
     * (weapons/armour heuristic matching content category bans).
     */
    forbidEntranaRestricted?: boolean;
    /**
     * Essence mine exit: only usable when the *path's* session return matches
     * this id. PathFinder carries return in the A* key (entry hops set it via
     * `essenceEntrySetsReturn`); live WorldState/EssenceSession seeds the start.
     * Unset path return → fail open (offline pack).
     */
    essenceExitReturn?: string;
    /**
     * Essence mine entry: after this hop, PathFinder treats the path's session
     * return as this id (wizard entry sets server `%exit_essence_mine_coord`).
     * Not a gate — ignored by meetsRequires / hasGatingRequires.
     */
    essenceEntrySetsReturn?: string;
}

export interface TransportLoc {
    name: string;
    action: string;
    /** Map placement / closed-state loc id. */
    locId?: number;
    /** Action-bearing open-state id (closed trapdoor → open trapdoor). */
    openLocId?: number;
    locX: number;
    locZ: number;
}

export interface TransportLanding {
    toLevel?: number;
    toTile?: NavPoint;
    /** Multi-exit portals (e.g. essence mine). */
    acceptAnyLanding?: boolean;
}

export interface TransportDebug {
    name?: string;
    options?: string[];
    /** e.g. derived-door | derived-stair | pack-ladder | curated */
    source?: string;
}

/**
 * Unified non-walk edge. Compiled from doors / stairs / transports (and later
 * a single transportGraph artifact). Rows with disabledReason are audit-only.
 *
 * Teleports: `from` is a placeholder (often ignored); search attaches the edge
 * from the *player* node when policy allows. Prefer `landing.toTile` / `to` as
 * the arrival stand (e.g. Varrock square).
 */
export interface TransportEdge {
    id: string;
    from: NavPoint;
    to: NavPoint;
    kind: TransportKind;
    cost: number;
    loc?: TransportLoc;
    landing?: TransportLanding;
    requires?: TransportRequires;
    debug?: TransportDebug;
    disabledReason?: string;
    /**
     * Stable teleport id for policy allowlists (`varrock`, `lumbridge`, …).
     * Aligns with `Game.teleport` / `api/Teleport.ts` keys when kind is teleport.
     */
    teleportId?: string;
}

/**
 * Cheap snapshot used to filter edges at search time.
 * Built from reader / Skills / Quests / Inventory — never from client internals.
 */
export interface WorldState {
    members: boolean;
    skills: Readonly<Record<string, number>>;
    questStatus(quest: string): QuestProgress;
    itemCount(name: string): number;
    /** Worn equipment count (0 if not equipped). */
    wornCount(name: string): number;
    freeSlots: number;
    /** True when inv/worn matches Entrana restricted-gear heuristic. */
    entranaRestrictedGear: boolean;
    /**
     * Active essence-mine return id (`aubury`|`sedridor`|…).
     * Live: `EssenceSession` (server varp 64 is not client-transmitted).
     * Seeds PathFinder path-state; entry hops can update return mid-path.
     * Undefined when unknown.
     */
    essenceExitReturn?: string;
}

/**
 * Planner preferences (2004-sized toggles).
 * Teleport policy is intentionally first-class: few destinations, high value.
 */
export interface PathPolicy {
    /** When false, all kind==='teleport' edges are excluded. Default true when unset. */
    useTeleports?: boolean;
    /**
     * Min Chebyshev distance (start→goal, or remaining estimate) before a teleport
     * edge may be used. 0 = always allowed when other gates pass.
     */
    distanceBeforeTeleport?: number;
    /**
     * If set, only these teleportId values are admissible (e.g. `['varrock']` for wildy escape).
     * Empty/undefined = all catalogued teleports that pass requires.
     */
    allowTeleportIds?: readonly string[];
    /**
     * Teleport ids suppressed for this plan (e.g. server rejected mid-walk).
     * Applied after allowlist; empty/undefined = none denied.
     */
    denyTeleportIds?: readonly string[];
    useShips?: boolean;
    useShortcuts?: boolean;
}

export interface FindPathOptions {
    state?: WorldState;
    policy?: PathPolicy;
    avoidDoors?: readonly { x: number; z: number }[];
    maxExpansions?: number;
    timeoutMs?: number;
}

export interface PathHop {
    kind: TransportKind | 'walk';
    cost: number;
    from: NavPoint;
    to: NavPoint;
    locId?: number;
    locName?: string;
    action?: string;
}

/** Execution-only extras that must not affect A* topology. */
export interface CrossingRecipe {
    /** Matches TransportEdge.id or a loc stand key. */
    match: { edgeId?: string; locX?: number; locZ?: number; level?: number };
    dialogue?: { choose: string[] };
    unlockQuest?: {
        quest: string;
        freeSlots?: number;
        // Concrete NPC / walk target stays in specialCrossings until recipes migrate.
    };
    label?: string;
}

/** Default edge costs (v1 parity: door 4, transport 10). Teleports cost more than a door. */
export const DEFAULT_EDGE_COST: Readonly<Record<TransportKind, number>> = {
    door: 4,
    gate: 4,
    stair: 10,
    dungeon: 10,
    ship: 10,
    gangplank: 10,
    shortcut: 10,
    portal: 10,
    /** Spell cast + load; tuned later against walk tiles. */
    teleport: 40,
    other: 10
};

/** True for originless spell/item teleports (not world portals like essence exit). */
export function isTeleportKind(kind: TransportKind): boolean {
    return kind === 'teleport';
}
