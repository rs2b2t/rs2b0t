/**
 * Nav v2 transport contract.
 *
 * Docs: docs/nav-v2/PLAN.md · docs/nav-v2/MICROBOT_SHORTEST_PATH.md
 *
 * Shape inspired by Microbot/ShortestPath `Transport` + TSV catalogs (origin,
 * destination, skills, items, quests, currency, objectId/action), sized for a
 * 2004 bot that must *execute* every hop (web walker), not only draw it.
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
    | 'other';

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
    quests?: QuestRequirement[];
    freeSlots?: number;
    /**
     * Toll / charter style cost (Microbot Transport.currency*).
     * Equivalent to items[] but kept explicit for explain output.
     */
    currency?: { name: string; amount: number };
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
    /** e.g. derived-door | derived-stair | lostcity-ladder | curated */
    source?: string;
}

/**
 * Unified non-walk edge. Compiled from doors / stairs / transports (and later
 * a single transportGraph artifact). Rows with disabledReason are audit-only.
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
    freeSlots: number;
}

export interface FindPathOptions {
    state?: WorldState;
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

/** Default edge costs (v1 parity: door 4, transport 10). */
export const DEFAULT_EDGE_COST: Readonly<Record<TransportKind, number>> = {
    door: 4,
    gate: 4,
    stair: 10,
    dungeon: 10,
    ship: 10,
    gangplank: 10,
    shortcut: 10,
    portal: 10,
    other: 10
};
