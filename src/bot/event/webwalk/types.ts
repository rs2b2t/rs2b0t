// docs/NAV.md
// Why: the nav v2 transport contract is one edge shape (origin, destination, skills, items, quests, currency, loc id/action) for a bot that must execute every hop, not only plan it.

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

interface SkillRequirement {
    name: string;
    level: number;
}

interface ItemRequirement {
    name: string;
    count: number;
    /** If true, planning assumes the item is spent on the hop (toll coins, etc.). */
    consumed?: boolean;
}

interface QuestRequirement {
    quest: string;
    /** Minimum status required for the edge to be usable. */
    minStatus: 'started' | 'complete';
}

/** Planner-side gates. Dialog / NPC side-trips live in specialCrossings, not here. */
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
    // Why: content web.rs2 wants a plain Knife by use-on, or a slash-capable weapon worn for the menu Slash or used on the web.
    // Why: plan time reads {@link WorldState.canSlashWeb} and the bank plan withdraws a Knife when missing; an undefined `canSlashWeb` (offline, no snapshot) fails open.

    /** Edge needs a slash tool for a web. */
    slashTool?: boolean;
    // Why: PathFinder carries the return in the A* key, where entry hops set it via `essenceEntrySetsReturn`, and live WorldState / EssenceSession seeds the start.
    // Why: an unset path return fails open, which is the offline-pack case.

    /** Essence mine exit: usable only when the path's session return matches this id. */
    essenceExitReturn?: string;
    // Why: a wizard entry sets the server's `%exit_essence_mine_coord`, so PathFinder treats the path's session return as this id after the hop.
    // Why: not a gate — meetsRequires and hasGatingRequires ignore it.

    /** Essence mine entry: the session return id this hop establishes. */
    essenceEntrySetsReturn?: string;
}

interface TransportLoc {
    name: string;
    action: string;
    /** Map placement / closed-state loc id. */
    locId?: number;
    /** Action-bearing open-state id (closed trapdoor → open trapdoor). */
    openLocId?: number;
    locX: number;
    locZ: number;
}

interface TransportLanding {
    toLevel?: number;
    toTile?: NavPoint;
    /** Multi-exit portals (e.g. essence mine). */
    acceptAnyLanding?: boolean;
}

interface TransportDebug {
    name?: string;
    options?: string[];
    /** e.g. derived-door | derived-stair | pack-ladder | curated */
    source?: string;
}

// Why: compiled from doors, stairs and transports (and later one transportGraph artifact); rows carrying disabledReason are audit-only.
// Why: for teleports `from` is a placeholder and often ignored — the search attaches the edge from the player node when policy allows.
// Why: `landing.toTile` or `to` is the arrival stand (e.g. Varrock square).

/** Unified non-walk edge. */
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
     * Aligns with `Game.teleport` / `api/map/Teleport.ts` keys when kind is teleport.
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
     * Knife or slash-capable blade in inv/worn (web.rs2). Undefined = unknown
     * (offline pack); meetsRequires slashTool fails open when unset.
     */
    canSlashWeb?: boolean;
    // Why: live values come from `EssenceSession`, since server varp 64 is not client-transmitted.
    // Why: this seeds PathFinder path-state and entry hops can update the return mid-path; undefined means unknown.

    /** Active essence-mine return id (`aubury` | `sedridor` | …). */
    essenceExitReturn?: string;
}

// Why: teleport policy is first-class here — few destinations, high value.

/** Planner preferences (2004-sized toggles). */
export interface PathPolicy {
    /** When false, all kind==='teleport' edges are excluded. Default true when unset. */
    useTeleports?: boolean;
    // Why: defaults to 0 when unset (`DEFAULT_DISTANCE_BEFORE_TELEPORT`), leaving A* cost to decide (`edgeCosts.ts`).
    // Why: a positive floor is set only when a caller wants a hard gate.

    /** Min Chebyshev distance (start→goal, or remaining estimate) before a teleport edge may be used. */
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

export interface PathHop {
    kind: TransportKind | 'walk';
    cost: number;
    from: NavPoint;
    to: NavPoint;
    locId?: number;
    locName?: string;
    action?: string;
}

/** Default edge costs (tile-equivalent time). Canonical source: `edgeCosts.ts`. */
export { DEFAULT_EDGE_COST } from './geometry/edgeCosts.js';

/** True for originless spell/item teleports (not world portals like essence exit). */
export function isTeleportKind(kind: TransportKind): boolean {
    return kind === 'teleport';
}
