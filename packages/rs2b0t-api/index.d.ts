// Type declarations for the rs2b0t script ABI (apiVersion 1), mirroring the client's src/bot/api surface.
// interact()-style methods return boolean | Promise<boolean>: always await them, then verify the outcome with Execution.delayUntil on game state.

/**
 * The client rejects bundles with a different ABI version.
 * @see docs/decisions/architecture.md#the-abi-boundary
 */
export const apiVersion: number;

// world primitives

/**
 * World coordinates accepted by position-based APIs.
 * @see docs/reference/api-game.md#world-primitives
 */
export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

/**
 * A world tile with distance and translation helpers.
 * @see docs/reference/api-game.md#world-primitives
 */
export class Tile implements WorldTile {
    readonly x: number;
    readonly z: number;
    readonly level: number;
    constructor(x: number, z: number, level?: number);
    static from(tile: WorldTile): Tile;
    /** Chebyshev distance (game movement metric). */
    distanceTo(other: WorldTile): number;
    translate(dx: number, dz: number): Tile;
    equals(other: WorldTile): boolean;
    toString(): string;
}

/**
 * A rectangular or circular map area with containment and random-tile helpers.
 * @see docs/reference/api-game.md#world-primitives
 */
export abstract class Area {
    static rectangular(a: WorldTile, b: WorldTile): Area;
    static circular(center: WorldTile, radius: number): Area;
    abstract contains(tile: WorldTile): boolean;
    abstract getRandomTile(): Tile;
}

// execution

/**
 * Use these waits in bots: the client settles them each frame and cancels them on Stop. Bare setTimeout calls bypass the runtime and trigger the watchdog.
 * @see docs/reference/api-bots.md#execution
 * @see docs/decisions/architecture.md#frame-gap-insurance
 */
export const Execution: {
    /** Resolve after at least `ms` wall-clock milliseconds. */
    delay(ms: number): Promise<void>;
    /** Resolve after `n` more server ticks (~600ms each). */
    delayTicks(n: number): Promise<void>;
    /** Check cond() each frame; return true when it holds, false after timeoutMs (default 6000). Use Execution waits so Stop can cancel them. */
    delayUntil(cond: () => boolean, timeoutMs?: number): Promise<boolean>;
    /** Check cond() each game tick, up to maxTicks. */
    delayUntilTicks(cond: () => boolean, maxTicks: number): Promise<boolean>;
    /** Report observed progress that movement and XP cannot show, such as a completed trade. Calling this every loop disables stall detection. */
    noteProgress(): void;
};

// game state

export type MeleeCombatStyle = 'attack' | 'strength' | 'controlled' | 'defence';

/** An available combat mode and its interface label. */
export interface CombatModeLabel {
    mode: number;
    label: string;
}

export interface CombatStyleResolution {
    /** Style requested by the script. */
    requested: MeleeCombatStyle;
    /** Selected style; may fall back to defence. */
    effective: MeleeCombatStyle;
    mode: number;
}

/**
 * Local player and world state: position, energy, combat, animation, ticks.
 * @see docs/reference/api-game.md
 */
export const Game: {
    ingame(): boolean;
    /** Local player's world tile, or null before login/scene load. */
    tile(): WorldTile | null;
    energy(): number;
    /** Orbit camera yaw 0-2047 (client-only). */
    cameraYaw(): number;
    /** Orbit camera pitch 128-383 (client-only). */
    cameraPitch(): number;
    /** Set camera yaw (0-2047, client only). For walking, prefer Global.navCameraFollow. */
    setCameraYaw(yaw: number): boolean;
    /** The run toggle is on. */
    runEnabled(): boolean;
    weight(): number;
    /** Local player in combat (health bar showing). */
    inCombat(): boolean;
    /** Local player is playing a non-idle animation. */
    animating(): boolean;
    /** Server ticks observed since the client booted. */
    tick(): number;
    /** Current com_mode varp (combat style index). */
    combatMode(): number;
    /** Resolve from interface labels; fall back to the last defensive button if unavailable. */
    combatStyleResolution(style: MeleeCombatStyle): CombatStyleResolution | null;
    combatStyleMode(style: MeleeCombatStyle): number | null;
    hasCombatStyle(style: MeleeCombatStyle): boolean;
    setCombatStyle(style: MeleeCombatStyle): boolean;
    /** @deprecated Use setCombatMode for an exact numeric mode. */
    setCombatStyle(mode: number): boolean;
    /** Set the combat-tab mode by number, usually for ranged styles. */
    setCombatMode(mode: number): boolean;
    /** Local player's display name, or null before login. */
    myName(): string | null;
    openSideTab(tab: number): Promise<boolean>;
    castOnNpc(spell: string, npc: Npc): Promise<boolean>;
    /** Cast a standard teleport by destination name, using the loaded button or its 2004 component ID. Does not switch tabs; success means dispatched, so check arrival. */
    teleport(name: string): Promise<boolean>;
    /** Cast a targeted spell at a piece of scenery. */
    castOnLoc(spell: string, loc: Loc): Promise<boolean>;
    /** Cast on an inventory item, using the TGT_HELD action required by Superheat Item. */
    castOnItem(spell: string, item: InvItem): Promise<boolean>;
    /** The scene accepts input. Before this, menu and walk packets may be dropped or retried. */
    sceneReady(): boolean;
    /** Raw client scene build state: 0 idle/loading, 1 building, 2 ready. */
    sceneState(): number;
    /** Every combat mode the equipped weapon offers, with its interface label; null before the tab loads. */
    combatStyles(): readonly CombatModeLabel[] | null;
    autoRetaliateOn(): boolean;
    /** Toggle auto-retaliate; true means the click was dispatched. */
    setAutoRetaliate(on: boolean): boolean;
    /** The local player's combat target is another player. */
    attackedByPlayer(): boolean;
};

// entities and queries

/**
 * An entity with named right-click actions.
 * @see docs/reference/api-entities.md
 */
export interface Interactable {
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * An entity with a world position and distance from the local player.
 * @see docs/reference/api-entities.md
 */
export interface Locatable {
    tile(): Tile;
    distance(): number;
}

/**
 * A non-player character in the loaded scene.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class Npc implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    readonly level: number;
    readonly index: number;
    readonly inCombat: boolean;
    readonly health: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    valid(): boolean;
    /** This NPC's combat target is the local player. */
    targetsMe(): boolean;
    /** This NPC's combat target is another player. */
    targetsAnotherPlayer(): boolean;
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Another player in the loaded scene.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class Player implements Locatable {
    readonly name: string | null;
    /** Slot in the client's player list. */
    readonly index: number;
    readonly inCombat: boolean;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    /** This player's combat target is the local player. */
    targetsMe(): boolean;
}

/**
 * A scenery object: door, tree, rock, bank booth, altar.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class Loc implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * An item lying on the ground in the loaded scene.
 * @see docs/reference/api-entities.md#entity-shapes
 */
export class GroundItem implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    readonly count: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Fields used by EntityQuery filters.
 * @see docs/reference/api-entities.md#entityquery
 */
interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

/**
 * Chain filters, then evaluate them against the current scene with nearest(), results(), exists(), etc.
 * @see docs/reference/api-entities.md#entityquery
 */
export class EntityQuery<E extends QueryableEntity> {
    /** Case-insensitive exact name match against any of the given names. */
    name(...names: string[]): this;
    /** Entity offers this action (case-insensitive). */
    action(action: string): this;
    /** Within `dist` tiles of the local player. */
    within(dist: number): this;
    /** Within `dist` tiles of an arbitrary tile (a camp pin, booth stand or furnace). */
    withinOf(origin: WorldTile, dist: number): this;
    /** Within a rectangle (inclusive). */
    inside(area: { minX: number; maxX: number; minZ: number; maxZ: number }): this;
    where(pred: (e: E) => boolean): this;
    results(): E[];
    nearest(): E | null;
    /** Nearest to the player, considering only results within `preferRadius` when any exist. */
    nearestPreferLocal(preferRadius: number): E | null;
    first(): E | null;
    exists(): boolean;
    count(): number;
}

/**
 * NPC queries.
 * @see docs/reference/api-entities.md
 */
export const Npcs: {
    query(): EntityQuery<Npc>;
    all(): Npc[];
    nearest(count?: number): Npc[];
};
/**
 * Player queries.
 * @see docs/reference/api-entities.md
 */
export const Players: { query(): EntityQuery<Player> };
/**
 * Scenery queries. Results may be empty for about a tick after changing floors.
 * @see docs/reference/api-entities.md
 * @see docs/decisions/level-change-lag.md
 */
export const Locs: { query(): EntityQuery<Loc> };
/**
 * Ground-item queries.
 * @see docs/reference/api-entities.md
 */
export const GroundItems: { query(): EntityQuery<GroundItem> };

// hud

/**
 * One backpack slot.
 * @see docs/reference/api-items.md#invitem
 */
export class InvItem {
    readonly name: string | null;
    readonly id: number;
    readonly slot: number;
    readonly count: number;
    actions(): string[];
    /** Held op by name, e.g. item.interact('Bury'). */
    interact(action: string): boolean | Promise<boolean>;
    /** Use this item on another item, scenery or an NPC. Returns false for off-scene scenery. */
    useOn(target: InvItem | Loc | Npc): boolean | Promise<boolean>;
}

/**
 * The backpack.
 * @see docs/reference/api-items.md
 */
export const Inventory: {
    items(): InvItem[];
    first(name: string): InvItem | null;
    contains(name: string): boolean;
    /** Total quantity of an item across the backpack (sums stacks + slots). */
    count(name: string): number;
    /** Occupied slots. */
    used(): number;
    isFull(): boolean;
    /** Total quantity by object id, for items that share a display name. */
    countById(id: number): number;
    /** Empty slots; 0 until the pack interface has loaded. */
    free(): number;
};

/**
 * Worn equipment.
 * @see docs/reference/api-items.md
 */
export const Equipment: {
    items(): InvItem[];
    contains(name: string): boolean;
    /** Wear/wield from the backpack (Wield/Wear/Equip op). */
    equip(name: string): Promise<boolean>;
    /** Remove from a worn slot into the backpack. */
    unequip(name: string): Promise<boolean>;
};

/**
 * Skill levels and experience.
 * @see docs/reference/api-skills.md
 */
export const Skills: {
    /** Skill index by lowercase name ('woodcutting', ...), -1 if unknown. */
    index(name: string): number;
    /** Base (unboosted) level. */
    level(name: string): number;
    /** Current (boosted/drained) level. */
    effective(name: string): number;
    xp(name: string): number;
    /** Effective/base hitpoints, 1 while the stat isn't readable yet. */
    hpFraction(): number;
};

/**
 * One row of the open bank.
 * @see docs/reference/api-items.md#bank
 */
export interface BankItemSnapshot {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    comId: number;
}

/** Bank booth or chest access; some locations need openFirst. */
export interface BankObjectAccess {
    name: string;
    op: string;
    openFirst?: { name: string; op: string };
}

/**
 * Pick a withdraw menu label from a bank item's `ops` list.
 * Handles both "Withdraw-All" and "Withdraw All" spellings.
 */
export function withdrawOp(
    ops: readonly (string | null)[],
    amount: 'all' | '10' | '5' | '1' | 'x' | 'any'
): string | null;

/**
 * Bank interface access. The item list arrives after the interface opens and updates after deposits; wait before trusting a zero count.
 * @see docs/reference/api-items.md#bank
 */
export const Bank: {
    isOpen(): boolean;
    /** True after a nonempty item list arrives. False also describes an empty bank; use ready() to distinguish an empty snapshot from missing data. */
    loaded(): boolean;
    /** True when loaded() or an open bank has a snapshot, including an empty one. */
    ready(): boolean;
    /** Wait for the bank item snapshot after opening. */
    waitReady(timeoutMs?: number, log?: (msg: string) => void): Promise<boolean>;
    /** A bank snapshot has arrived since opening. */
    snapshotReady(): boolean;
    /** Snapshot counter; pass it to waitSnapshotAfter. */
    snapshotGeneration(): number;
    /** Wait for a snapshot newer than generation. */
    waitSnapshotAfter(generation: number, timeoutMs?: number): Promise<boolean>;
    /** Toggle note/item withdraw mode (resets to Item when the bank opens). */
    setNoteMode(on: boolean): Promise<void>;
    items(): BankItemSnapshot[];
    /** Exact name match (case-insensitive). */
    count(name: string): number;
    /** Count by object id, for stock whose display name is shared. */
    countById(id: number): number;
    /**
     * Withdraw by context-menu op label (default `'Withdraw-1'`).
     * Prefer `withdrawOp(item.ops, 'all'|'10'|'5'|'1'|'x'|'any')` for the label the bank shows.
     */
    withdraw(name: string, op?: string): boolean | Promise<boolean>;
    /** `withdraw` by object id (default op `'Withdraw-1'`). */
    withdrawById(id: number, op?: string): boolean | Promise<boolean>;
    /** Withdraw-X + count dialog for an exact quantity. */
    withdrawX(name: string, count: number): Promise<boolean>;
    /** `withdrawX` by object id; in note mode `landsAsId` names the noted obj the pack receives. */
    withdrawXById(id: number, count: number, landsAsId?: number): Promise<boolean>;
    /** Fill the pack: Withdraw-All when present, otherwise Withdraw-X for free slots. */
    withdrawLoad(name: string): Promise<boolean>;
    deposit(name: string, op?: string): boolean | Promise<boolean>;
    /** Deposit every backpack slot (Deposit-All each). */
    depositInventory(): Promise<void>;
    /**
     * Deposit every side-backpack item for which `match(name, id)` is true.
     * Prefer building matchers with `depositAllExcept` / `depositMatcher`.
     */
    depositAllMatching(
        match: (name: string, id: number) => boolean,
        log?: (msg: string) => void
    ): Promise<void>;
    /**
     * Open a booth near a known stand tile (walk onto the counter if needed).
     * Prefer `Banking.open({ stand, boothName, boothOp })` for script work.
     */
    openBooth(
        stand: WorldTile,
        boothName: string,
        op: string,
        log?: (msg: string) => void
    ): Promise<boolean>;
    /** Open the nearest named bank object already in the loaded scene. */
    openNearest(
        boothName: string,
        op: string,
        log?: (msg: string) => void
    ): Promise<boolean>;
    /** Like openNearest, but may open a chest/door first via `access.openFirst`. */
    openNearestAccess(
        access: BankObjectAccess,
        log?: (msg: string) => void
    ): Promise<boolean>;
    /** Close the bank modal so inventory ops (Wield, Use, Bury, ...) hit the backpack again. */
    close(timeoutMs?: number): Promise<boolean>;
};

// high-level banking

export type BankStrategy = 'off' | 'items' | 'time' | 'either';

export interface BankDestination {
    name: string;
    tile: WorldTile;
    access?: BankObjectAccess;
}

export interface BankTriggerState {
    lootCount: number;
    minutesSinceLastBank: number;
    itemsThreshold: number;
    minutesThreshold: number;
}

/** Whether a periodic-bank strategy should fire given current counters. */
export function shouldBankNow(strategy: BankStrategy, s: BankTriggerState): boolean;

/** Parse a settings dropdown label ('Off' | 'Loot count' | 'Time' | 'Either'). */
export function parseBankStrategy(label: string): BankStrategy;

/**
 * Ready-made settingsSchema fragment for combat/loot scripts:
 * `bankStrategy`, `bankEveryItems`, `bankEveryMinutes`, `bankCommonJunk`.
 */
export const PERIODIC_BANK_SETTINGS: SettingsSchema;

/** Substrings matched as optional "common junk" when banking loot. */
export const COMMON_BANK_LOOT: string[];

/** Random-event casket obj id, always treated as common bank loot. */
export const RANDOM_EVENT_CASKET_ID: number;

export function matchesCommonBankLoot(name: string, id?: number): boolean;

/** Combine a script's own deposit predicate with optional common-junk matching. */
export function depositMatcher(
    own: (name: string) => boolean,
    includeCommon: boolean
): (name: string, id?: number) => boolean;

/**
 * Deposit predicate that keeps the named tools/consumables and banks everything else.
 * Pass the result to `Bank.depositAllMatching`.
 *
 * @example
 * await Bank.depositAllMatching(depositAllExcept(['Harpoon', 'Lobster pot']));
 */
export function depositAllExcept(keep: Iterable<string>): (name: string) => boolean;

export interface OpenBankOpts {
    /** Bank stand to use when no bank is nearby; see preferNearby. */
    stand?: WorldTile | null;
    boothName?: string;
    boothOp?: string;
    /** Obstacles to open on the way, e.g. ['door', 'gate']. Without these, use Traversal.walkResilient. */
    obstacles?: string[];
    /** Forced destination when no booth is in scene and `stand` is unset. */
    destination?: BankDestination;
    /** Use a nearby bank before walking to the preset stand. Default true. */
    preferNearby?: boolean;
    /** Nearby bank radius. Default {@link NEARBY_BANK_RADIUS}. */
    nearbyRadius?: number;
    log?: (msg: string) => void;
}

/** Radius for treating a bank as already nearby. */
export const NEARBY_BANK_RADIUS: number;

export type BankOpenRoute = 'already-open' | 'scene-booth' | 'local-bank' | 'preset-stand' | 'nearest-fallback';

/** Choose a bank for Banking.open; prefer a nearby booth or known bank over a distant preset stand. */
export function resolveBankOpenRoute(input: {
    bankOpen?: boolean;
    here: WorldTile | null;
    stand?: WorldTile | null;
    nearbyBoothDist: number | null;
    nearest: { name: string; tile: WorldTile; access?: BankObjectAccess } | null;
    preferNearby?: boolean;
    nearbyRadius?: number;
}): BankOpenRoute;

/** Open and deposit helpers. Prefer Banking.open over manually walking to a booth. */
export const Banking: {
    /** Open a bank, preferring nearby banks by default. The caller handles deposits, withdrawals and the return trip. */
    open(opts?: OpenBankOpts): Promise<boolean>;
    /** Open a bank, deposit matching items, run afterDeposit if supplied, then walk to returnTo if supplied. */
    bankNearest(opts: {
        deposit: (name: string) => boolean;
        commonJunk?: boolean;
        destination?: BankDestination;
        returnTo?: WorldTile;
        boothName?: string;
        boothOp?: string;
        afterDeposit?: () => void | Promise<void>;
        log?: (msg: string) => void;
    }): Promise<boolean>;
};

/**
 * A shop interface. Nothing here walks; be near the keeper first.
 * @see docs/reference/api-bots.md#registering-a-bot
 */
export const Shop: {
    isOpen(): boolean;
    /** Trade with npcName; the caller must walk to the keeper first. */
    open(npcName: string): Promise<boolean>;
    /** The shop-side stock rows of the open shop. */
    stock(): { name: string; count: number; slot: number }[];
    /** Buy up to `n` of `name`; resolves the units bought. */
    buy(name: string, n: number): Promise<number>;
    /** `buy` by exact object id, for stock whose display name is shared. */
    buyById(id: number, n: number): Promise<number>;
    /** Sell up to `n` of `name`; resolves the units sold. */
    sell(name: string, n: number): Promise<number>;
    close(): Promise<void>;
};

/**
 * A quest's journal colour.
 * @see docs/reference/quest-engine.md#quest-state
 */
export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

/**
 * The quest tab. It's the authoritative source of quest progress; don't
 * infer it from varps.
 * @see docs/reference/quest-engine.md#quest-state
 */
export const Quests: {
    /** Every quest on the quest tab with its journal-colour status. */
    all(): { name: string; status: QuestStatus }[];
    status(name: string): QuestStatus;
    /** Quest points shown on the tab. */
    points(): number;
    /** Open the journal and read its lines. Prefer an item or message check when it proves progress. */
    journal(name: string): Promise<string[]>;
};

/**
 * Chat modals: dialogue pages, option lists, and make-x menus.
 * @see docs/reference/api-dialogue.md
 */
export const ChatDialog: {
    /** A chat modal is open (dialog, make-x, ...). */
    isOpen(): boolean;
    /** A "Click here to continue" button is up. */
    canContinue(): boolean;
    /** Press continue and wait for the dialog page to change. */
    continue(): Promise<boolean>;
    /** Selectable option lines in the current dialog (text only). */
    options(): string[];
    /** Pick the option whose text contains `match` (or the first). */
    chooseOption(match?: string): Promise<boolean>;
    /** A "What would you like to make?" skill-multi menu is open. */
    isMakeMenu(): boolean;
    /** Product names offered by the open make menu. */
    makeProducts(): string[];
    /**
     * In a make menu, pick the product whose name contains `match` (or the
     * first) at the largest fixed quantity offered (prefer 10).
     */
    make(match?: string): Promise<boolean>;
    /**
     * In a make menu, pick Make-1 for the product whose name contains `match`
     * (or the first). Never opens the Make-X count dialog.
     */
    makeOne(match?: string): Promise<boolean>;
    /** The lines currently rendered in the chat modal, including the NPC's. */
    texts(): string[];
    /** Click Make-X for the product whose name contains `match` and type `count`; waits for the count dialog to open and close. */
    makeX(match: string, count: number): Promise<boolean>;
    /** A main-modal make panel (the fletching/smithing kind) is open. */
    isMainMakePanel(): boolean;
    /** Product names on the open main-modal make panel. */
    mainMakeProducts(): string[];
    /** On the main-modal panel, click `op` (default its first op) for the product whose name contains `match`; resolves when the modal changes. */
    makeFromPanel(match: string, op?: string): Promise<boolean>;
    /** On the main-modal panel, pick the largest Make op for the product whose name contains `match`. */
    makeFromPanelMax(match: string): Promise<boolean>;
};

export interface TradeItem {
    id: number;
    name: string | null;
    count: number;
}

/**
 * Player-to-player trade screen. Both players must "Trade with" each other,
 * then both accept the offer screen and the confirm screen.
 */
export const Trade: {
    onOfferScreen(): boolean;
    onConfirmScreen(): boolean;
    active(): boolean;
    partner(): string | null;
    myOffer(): TradeItem[];
    theirOffer(): TradeItem[];
    /** Send "Trade with" to a nearby player by display name. */
    request(playerName: string): Promise<boolean>;
    /**
     * Offer-All of `itemName` from the trade side-pack.
     * `pick` chooses among same-name slots (e.g. unnoted vs noted).
     */
    offerAll(
        itemName: string,
        pick?: (i: { count: number; id: number; slot: number }) => boolean
    ): Promise<boolean>;
    /** Offer `n` via Offer-X + count dialog. */
    offer(
        itemName: string,
        n: number,
        pick?: (i: { count: number; id: number; slot: number }) => boolean
    ): Promise<boolean>;
    /** Take everything back off your own side. */
    removeAll(): Promise<boolean>;
    /** Accept the current offer or confirm screen. */
    accept(): Promise<boolean>;
    decline(): Promise<void>;
};

// movement

/**
 * Options for a single web-walk.
 * @see docs/reference/api-movement.md
 */
export interface WalkOptions {
    /** Arrive within this many tiles of dest (default 2). */
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
    /** A* expansion budget override. */
    maxExpansions?: number;
    /** Path policy (tele toggles, distanceBeforeTeleport, deny lists, ...). */
    policy?: {
        useTeleports?: boolean;
        distanceBeforeTeleport?: number;
        allowTeleportIds?: readonly string[];
        useShips?: boolean;
        useShortcuts?: boolean;
    };
    /**
     * Include spell/jewellery tele edges in A*.
     * Default: Global `navTeleports` (off). Explicit true/false overrides;
     * `policy.useTeleports: false` forces off.
     */
    useTeleportCatalog?: boolean;
    /**
     * Optional known bank item counts for the bank planner
     * (tests / when bank is not open).
     */
    bankItemCounts?: Record<string, number>;
    /**
     * Areas to avoid, by known ID (e.g. 'white-wolf-mountain') or rectangle. Catalog zones also depend on live player state.
     * Idea credit: @lolwut.
     */
    avoidZones?: readonly (
        | string
        | { minX: number; maxX: number; minZ: number; maxZ: number; level?: number }
    )[];
}

/**
 * Options for walking with retries and recovery.
 * @see docs/reference/nav-walker.md#when-it-gets-stuck
 */
export interface WalkResilientOptions {
    /** Arrive when within this Chebyshev distance of dest. */
    radius: number;
    /** Maximum baked-walk attempts; retries forever by default. */
    attempts?: number;
    /** Per baked-walk budget (default 90s). */
    timeoutMs?: number;
    /** Client-scene-walk arrival radius when bridging a baked gap (default = radius+1). */
    sceneRadius?: number;
    /** Node budget for the larger baked-walk retry (default 1.2M). */
    maxBudget?: number;
    log?: (msg: string) => void;
    /** Forwarded to WalkExecutor on every baked repath. */
    useTeleportCatalog?: WalkOptions['useTeleportCatalog'];
    policy?: WalkOptions['policy'];
    bankItemCounts?: WalkOptions['bankItemCounts'];
    /** Areas to avoid on each repath, as in WalkOptions.avoidZones. Accepts known IDs or rectangles; catalog zones depend on live player state. */
    avoidZones?: WalkOptions['avoidZones'];
}

/**
 * World navigation using the collision pack and door/transport graph, with door opening and stuck recovery.
 * @see docs/reference/api-movement.md
 * @see docs/NAV.md
 */
/** Disable teleport planning for this walk, overriding Global navTeleports. */
export const NAV_PURE_WALK: {
    useTeleportCatalog: false;
    policy: { useTeleports: false };
};

/** Enable teleport planning for this walk, overriding Global navTeleports. */
export const NAV_WITH_TELES: {
    useTeleportCatalog: true;
    policy: { useTeleports: true };
};

export const Traversal: {
    /** Same as NAV_PURE_WALK. */
    pureWalk: typeof NAV_PURE_WALK;
    /** Same as NAV_WITH_TELES. */
    withTeles: typeof NAV_WITH_TELES;
    /** Walk using the collision pack and door/transport graph. Return false on timeout or no path; snap blocked destinations to a reachable tile. */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean>;
    /** Retry walkTo with repathing, a larger search budget and scene walking. Retries forever by default; Stop or a random event can interrupt it. */
    walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean>;
    /** Warm the nav worker + collision pack before the first walk. */
    preload(): void;
    /** Path tiles left in the active walk (overlay/progress display). */
    remaining(): number;
    /** Teleport planning is enabled by Global navTeleports; routes only use teleports the inventory can pay for. */
    teleportsEnabled(): boolean;
    /** Ask the active walk to re-plan on its next step instead of waiting for a stall. */
    requestRepath(reason?: string): void;
};

/**
 * Same-scene walking only. Prefer `Traversal` unless you specifically want a
 * single click within the loaded scene.
 * @see docs/reference/nav-pathfinding.md#following-a-path
 */
export const DirectNavigator: {
    /** One same-scene walk click toward the tile (clamped into the scene). */
    walk(dest: WorldTile): boolean | Promise<boolean>;
    /** Same-scene walk with stall re-clicking; prefer Traversal.walkTo. */
    walkTo(dest: WorldTile, radius?: number, timeoutMs?: number): Promise<boolean>;
};

// events

/**
 * One line of game chat.
 * @see docs/reference/api-events.md
 */
export interface ChatLine {
    type: number;
    username: string | null;
    text: string;
}

/**
 * Every event a bot can subscribe to, with its payload.
 * @see docs/reference/api-events.md
 */
export interface EventMap {
    tick: { tick: number };
    'chat.message': ChatLine;
    'skill.xp': { skill: number; name: string; xp: number; delta: number };
    'skill.level': { skill: number; name: string; level: number; previous: number };
    'inventory.changed': { slot: number; id: number; name: string | null; count: number; previousId: number; previousCount: number };
    'varp.changed': { index: number; value: number; previous: number };
}

/**
 * Global event bus. Inside a bot prefer `this.on()`, which unsubscribes on stop.
 * @see docs/reference/api-events.md
 */
export const events: {
    /** Subscribe; returns the unsubscriber. Inside a bot prefer this.on(). */
    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): () => void;
    off<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
};

// bot base classes

/** Run settings: manifest defaults, panel edits, then ?Script.key=... overrides. */
export interface SettingsBag {
    bool(key: string, fallback?: boolean): boolean;
    num(key: string, fallback?: number): number;
    str(key: string, fallback?: string): string;
    list(key: string, fallback?: string[]): string[];
    tile(key: string, fallback: Tile): Tile;
    raw(): Record<string, unknown>;
}

/** How the runner schedules the next `loop()` after one finishes. */
export type LoopCadence =
    | { kind: 'frame' }
    | { kind: 'server-tick'; ticks?: number }
    | { kind: 'time'; ms: number };

/**
 * Base class for every bot. Usually extended via `LoopingBot`, `TaskBot`, or
 * `TreeBot`.
 * @see docs/reference/api-bots.md
 */
export abstract class AbstractBot {
    /** Wall-clock ms between loop() iterations when loop() returns void. */
    loopDelay: number;
    /** When set, overrides the cadence derived from `loopDelay`. */
    loopCadence: LoopCadence | null;
    /** Resolved parameters for this run; read e.g. this.settings.bool('x'). */
    readonly settings: SettingsBag;
    onStart?(): void | Promise<void>;
    /** Runs after stop and after a crash; clean up here. */
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;
    /** Draw on the overlay canvas; called every client redraw while running. */
    onPaint?(ctx: CanvasRenderingContext2D): void;
    /** Return the tile recovery should walk back to. Implement this when the script has a working location. */
    recoveryAnchor?(): Tile | null;
    /** NPCs the bot fights intentionally; the random-event guard ignores them. */
    grindTargets(): string[];
    /** Random events the bot ignores, checked on each detection. Can depend on the current activity. */
    ignoredRandoms(): string[];
    log(msg: string): void;
    /** Subscribe until stop or crash. Callbacks run mid-frame: set flags or log, then do the work in loop(). Tasks can subscribe through the bot. */
    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
}

/**
 * Implement loop() to run work repeatedly.
 * @see docs/reference/api-bots.md#loopingbot
 */
export abstract class LoopingBot extends AbstractBot {
    /** Return a number to override loopDelay for the next iteration. */
    abstract loop(): number | void | Promise<number | void>;
}

/**
 * A TaskBot task: validate() decides when execute() runs.
 * @see docs/reference/api-bots.md#taskbot
 */
export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

// item acquisition

/**
 * Where an item can be obtained from.
 * @see docs/reference/api-items.md#item-acquisition
 */
export type ItemSource = { kind: 'shop'; npc: string; near: WorldTile } | { kind: 'ground'; at: WorldTile } | { kind: 'gather' } | { kind: 'make' };

/**
 * A quantity of an item, and where to get it.
 * @see docs/reference/api-items.md#item-acquisition
 */
export type ItemNeed = { name: string; count: number; source: ItemSource };

/** Held count of `name` across every matching backpack slot (case-insensitive). */
export function held(name: string): number;

/** True once every need's count is already met. */
export function hasAll(needs: ItemNeed[]): boolean;

/** Task that acquires the first unmet ItemNeed (shop trip / ground pickup). */
export class AcquireTask implements Task {
    constructor(bot: AbstractBot, needs: ItemNeed[]);
    validate(): boolean;
    execute(): Promise<void>;
}

/** Runs the first task whose validate() returns true, once per loop. */
export abstract class TaskBot extends LoopingBot {
    protected add(...tasks: Task[]): void;
    loop(): Promise<number | void>;
}

/**
 * A decision node in a `TreeBot`.
 * @see docs/reference/api-bots.md#treebot
 */
export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

/**
 * An action node in a `TreeBot`.
 * @see docs/reference/api-bots.md#treebot
 */
export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

/**
 * Either node kind in a behaviour tree.
 * @see docs/reference/api-bots.md#treebot
 */
export type TreeNode = BranchTask | LeafTask;

/** Walks branches by validate() until a leaf, executes it, once per loop. */
export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;
    loop(): Promise<number | void>;
}

// manifest

/**
 * Parameter types supported by the panel.
 * @see docs/reference/api-events.md#settings
 */
export type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

/**
 * One declared parameter: its type, default, and presentation.
 * @see docs/reference/api-events.md#settings
 */
export interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
    options?: string[];
    optionLabels?: Record<string, string>;
    group?: string;
    showIf?: { key: string; anyOf: string[] };
}

/** Parameter schema: shown as a form in the panel, overridable via
 *  ?ScriptName.key=value. Read at runtime with this.settings. */
export type SettingsSchema = Record<string, SettingDef>;

/**
 * Script name, description, category, tags and parameter schema.
 * @see docs/reference/api-bots.md#registering-a-bot
 */
export interface BotManifestInput {
    name: string;
    description?: string;
    version?: string;
    /** Library category, e.g. "Mining"; defaults to "Other". */
    category?: string;
    /** Free-form labels for search/filtering in the library (e.g. "f2p"). */
    tags?: string[];
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

/**
 * A validated manifest, as returned by `defineBot`.
 * @see docs/reference/api-bots.md#registering-a-bot
 */
export interface BotManifest extends BotManifestInput {
    __rs2b0tManifest: 1;
}

/** Default-export defineBot({...}) from your script's entry module. */
export function defineBot(manifest: BotManifestInput): BotManifest;

/** Imperative registration (the loader calls this for default exports). */
export function registerScript(manifest: BotManifestInput, origin?: string): void;

// world catalogs (data tables and pure helpers)
// @see docs/reference/api-catalogs.md

/** Bank requirement (skill or quest) for a known bank stand. */
export interface BankRequirement {
    skill?: { name: string; level: number };
    quest?: string;
}

/** A bank, its stand tile, and how to open it. */
export interface BankLocation {
    name: string;
    tile: Tile;
    requires?: BankRequirement;
    access?: BankObjectAccess;
}

/** Every known bank stand. */
export const BANK_LOCATIONS: BankLocation[];
/** Euclidean same-plane distance, unlike Tile.distanceTo's Chebyshev. */
export function bankDistance(from: WorldTile, bank: WorldTile): number;
export function nearestUsableBank(from: WorldTile, usable: (bank: BankLocation) => boolean): BankLocation | null;
export function bankUnlocked(bank: BankLocation): boolean;
export function nearestBank(from: WorldTile): BankLocation | null;

export interface ToolTier {
    name: string;
    level: number;
    attackLevel?: number;
}

export type ToolReq =
    | { kind: 'tiered'; skill: string; tiers: readonly ToolTier[]; label: string; equip?: boolean }
    | { kind: 'exact'; name: string; min?: number; restock?: number; equip?: boolean };

export const PICKAXES: readonly ToolTier[];
export const AXES: readonly ToolTier[];
export const TINDERBOX: string;
export const HAMMER: string;
export const KNIFE: string;
export const CHISEL: string;
export const NEEDLE: string;
export function pickaxeReq(equip?: boolean): ToolReq;
export function axeReq(equip?: boolean): ToolReq;
export function exactTool(name: string, opts?: { min?: number; restock?: number; equip?: boolean }): ToolReq;
export function tinderboxReq(): ToolReq;
export function toolAttackLevel(name: string): number;
export function canWieldTool(name: string, attackLevel: number): boolean;
export function bestFromTiers(level: number, tiers: readonly ToolTier[], available: (name: string) => boolean): string | null;
export function bestPickaxe(miningLevel: number, available: (name: string) => boolean): string | null;
export function bestAxe(woodcuttingLevel: number, available: (name: string) => boolean): string | null;
export function toolKeepNames(reqs: readonly ToolReq[]): string[];
export function hasToolReq(req: ToolReq, skillLevel: (skill: string) => number, count: (name: string) => number): boolean;
export function hasAllTools(reqs: readonly ToolReq[], skillLevel: (skill: string) => number, count: (name: string) => number): boolean;
export function missingToolLabels(reqs: readonly ToolReq[], skillLevel: (skill: string) => number, count: (name: string) => number): string[];
export function toolKitLabel(reqs: readonly ToolReq[], skillLevel: (skill: string) => number, count: (name: string) => number): string;
export interface ToolRestockStep { name: string; qty: number; equip: boolean }
export function toolRestockPlan(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): ToolRestockStep[];
export function bankHasBetterGatherTool(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): boolean;
export function toolsNeedingEquip(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number,
    worn: (name: string) => boolean
): string[];
export function bestHeldToolNames(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): string[];
export function surplusHeldToolNames(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): string[];

export const COINS: string;
export const BROKEN_PICKAXE: string;
export const BROKEN_AXE: string;
export type ToolAcquireMode = 'off' | 'on';
export function parseToolAcquireMode(raw: string | boolean | undefined | null): ToolAcquireMode;
export const TOOL_ACQUIRE_OPTIONS: readonly string[];
export const TOOL_ACQUIRE_SETTING: SettingDef;
export const FORGETFUL_BANK_ODDS: number;
export const FORGETFUL_BANK_SETTING: SettingDef;

export interface ToolVendor {
    keeper: string;
    stand: Tile;
    bankStand: Tile;
    hopFrom?: Tile;
    hopLoc?: string;
    hopAction?: string;
}
export interface ShopOffer { name: string; cost: number; vendor: ToolVendor }
export const BOB_VENDOR: ToolVendor;
export const NURMOF_VENDOR: ToolVendor;
export const GERRANT_VENDOR: ToolVendor;
export const HARRY_VENDOR: ToolVendor;
export const GERRANT_ONLY_FISHING: ReadonlySet<string>;
export const VARROCK_ANVIL_STAND: Tile;
export const VARROCK_ANVIL_BANK: Tile;
export const PICKAXE_SHOP_COSTS: Readonly<Record<string, number>>;
export const AXE_SHOP_COSTS: Readonly<Record<string, number>>;
export const FISHING_SHOP_COSTS: Readonly<Record<string, number>>;
export const AXE_SMITH_LEVEL: Readonly<Record<string, number>>;
export const AXE_BAR_FOR: Readonly<Record<string, string>>;

export type ToolAcquirePlan =
    | { kind: 'repair'; brokenName: string; label: 'pickaxe' | 'axe'; vendor: ToolVendor; prefer: string[] }
    | { kind: 'buy'; name: string; cost: number; qty: number; vendor: ToolVendor; equip: boolean; reason: string }
    | { kind: 'smith'; name: string; bar: string; smithLevel: number; vendorBank: Tile; anvilStand: Tile; equip: boolean; reason: string };

export interface AcquireWorld {
    skillLevel: (skill: string) => number;
    heldCount: (name: string) => number;
    invCount: (name: string) => number;
    bankCount: (name: string) => number;
    worn: (name: string) => boolean;
}

export function bestOwnedTier(level: number, tiers: readonly ToolTier[], count: (name: string) => number): string | null;
export function pickaxeShopOffers(): ShopOffer[];
export function axeShopOffers(): ShopOffer[];
export function bestAffordableShopTier(
    level: number,
    tiers: readonly ToolTier[],
    offers: readonly ShopOffer[],
    coins: number,
    owned: string | null
): ShopOffer | null;
export function bestSmithableAxe(
    woodcuttingLevel: number,
    smithingLevel: number,
    owned: string | null,
    barCount: (barName: string) => number,
    hasHammer: boolean
): { name: string; bar: string; smithLevel: number } | null;
export function planBrokenToolRepair(heldOrWorn: (name: string) => boolean): Extract<ToolAcquirePlan, { kind: 'repair' }> | null;
export function planPickaxeAcquire(w: AcquireWorld, opts: { upgrade: boolean }): ToolAcquirePlan | null;
export function planAxeAcquire(w: AcquireWorld, opts: { upgrade: boolean }): ToolAcquirePlan | null;
export interface FishingVendorNear { x: number; z: number }
export function fishingVendorFor(name: string, near?: FishingVendorNear | null): ToolVendor;
export function fishingShopCost(name: string): number | null;
export function isFishingBaitPiece(g: Pick<FishingGearPiece, 'name' | 'restock'>): boolean;
export function withBaitTarget(method: Pick<FishingMethod, 'gear'>, baitQty: number): { gear: FishingGearPiece[] };
export interface PlanFishingGearOpts { near?: FishingVendorNear | null; baitQty?: number }
export type FishingGearBuyPlan = Extract<ToolAcquirePlan, { kind: 'buy' }>;
export function planFishingGearBuys(method: Pick<FishingMethod, 'gear'>, w: AcquireWorld, opts?: PlanFishingGearOpts): FishingGearBuyPlan[];
export function planFishingGearAcquire(method: Pick<FishingMethod, 'gear'>, w: AcquireWorld, opts?: PlanFishingGearOpts): ToolAcquirePlan | null;
export function buyPlansCost(plans: readonly Pick<FishingGearBuyPlan, 'cost'>[]): number;
export function fishingGearShopCart(method: Pick<FishingMethod, 'gear'>, w: AcquireWorld, opts?: PlanFishingGearOpts): FishingGearBuyPlan[];
export function planGatherToolAcquire(reqs: readonly ToolReq[], w: AcquireWorld, opts: { upgrade: boolean }): ToolAcquirePlan | null;
export function coinsToWithdraw(need: number, invCoins: number): number;
export function canFundPlan(plan: ToolAcquirePlan, invCoins: number, bankCoins: number): boolean;
export function acquireKeepNames(plan: ToolAcquirePlan, extra?: readonly string[]): string[];
export function shopableMissingFishingGear(gear: readonly FishingGearPiece[], count: (name: string) => number): string[];

export interface PickpocketTarget { name: string; level: number }
export const PICKPOCKET_TARGETS: PickpocketTarget[];
export const PICKPOCKET_TARGET_NAMES: string[];
export const ARDOUGNE_PICKPOCKET_TARGETS: string[];

export interface GatheringLocation {
    name: string;
    spot: Tile;
    bankStand: Tile;
    verified: boolean;
    boothName?: string;
    boothOp?: string;
    obstacles?: string[];
    resources?: readonly string[];
    notes?: string;
}
export const DEFAULT_BOOTH_NAME: string;
export const DEFAULT_BOOTH_OP: string;
export const MAP_SQUARE: number;
export function sameMapSquare(a: WorldTile, b: WorldTile): boolean;
export function locationOptions(table: readonly GatheringLocation[]): string[];
export function boothFields(loc: GatheringLocation | null | undefined): { boothName: string; boothOp: string };
export function resolveGatheringLocation<T extends GatheringLocation>(
    setting: string,
    startTile: WorldTile,
    table: readonly T[]
): T | null;

export interface FishingLocation extends GatheringLocation {
    rangeStand?: Tile;
    rangeName?: string;
}
export const FISHING_LOCATIONS: FishingLocation[];
export const FISHING_LOCATION_OPTIONS: string[];
export function resolveFishingLocation(setting: string, startTile: WorldTile): FishingLocation | null;

export type MiningLocation = GatheringLocation & { recommendedCombat?: number };
export const MINING_LOCATIONS: MiningLocation[];
export const MINING_LOCATION_OPTIONS: string[];
export const MINING_LOCATION_OPTION_LABELS: Record<string, string>;
export function miningLocationLabel(loc: Pick<MiningLocation, 'name' | 'recommendedCombat'>): string;
export function resolveMiningLocation(setting: string, startTile: WorldTile): MiningLocation | null;

export type WoodcuttingLocation = GatheringLocation;
export const WOODCUTTING_LOCATIONS: WoodcuttingLocation[];
export const WOODCUTTING_LOCATION_OPTIONS: string[];
export function resolveWoodcuttingLocation(setting: string, startTile: WorldTile): WoodcuttingLocation | null;
export const ENT_NPC_IDS: Set<number>;
export const ENT_LIFE_TICKS: number;
export function isEntNpcId(id: number): boolean;
export function entNpcOnTile(
    npcs: readonly { id: number; tile: WorldTile }[],
    tile: WorldTile
): boolean;

export interface FishingGearPiece { name: string; min: number; restock: number }
export interface FishingMethod { name: string; op: string; pair: string; gear: FishingGearPiece[] }
export const WHIRLPOOL_IDS: Set<number>;
export const FISHING_METHODS: FishingMethod[];
export const FISHING_METHOD_OPTIONS: string[];
export const ALL_FISHING_GEAR_NAMES: string[];
export function resolveFishMethod(name: string): FishingMethod;
export function gearKeepNames(method: Pick<FishingMethod, 'gear'>): string[];
export function hasFishingGear(method: Pick<FishingMethod, 'gear'>, count: (name: string) => number): boolean;
export function missingFishingGear(method: Pick<FishingMethod, 'gear'>, count: (name: string) => number): FishingGearPiece[];
export function gearLabel(method: Pick<FishingMethod, 'gear'>): string;
export function fishingRestockPlan(
    method: Pick<FishingMethod, 'gear'>,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): { name: string; qty: number }[];
export function spotMatchesMethod(actions: readonly string[], method: Pick<FishingMethod, 'op' | 'pair'>): boolean;

export const ROCK_TYPES: Record<string, number[]>;
export const ROCK_OPTIONS: string[];
export const GAS_ROCK_IDS: Set<number>;
export const GAS_ROCK_TICKS: number;
export function resolveRockIds(names: string[]): Set<number>;

export interface WalkDestination { name: string; tile: Tile }
export const WALK_DESTINATIONS: WalkDestination[];
export const WALK_OPTIONS: string[];
export function resolveDestination(name: string): WalkDestination | null;

export interface CowLocation { name: string; anchor: Tile; usesAlKharidToll: boolean }
export const COW_LOCATIONS: CowLocation[];
export const COW_LOCATION_OPTIONS: string[];
export const AL_KHARID_BANK: Tile;
export const TOLL_COIN_TARGET: number;
export function isCowFieldLootTile(anchor: WorldTile, leashRadius: number, tile: WorldTile): boolean;
export function resolveCowLocation(setting: string, start: WorldTile): CowLocation | null;
export function nearestCowLocation(tile: WorldTile): CowLocation;
export function needsTollCoins(location: CowLocation | null, enabled: boolean): boolean;
export function shouldBootstrapTollCoins(location: CowLocation | null, start: WorldTile, coins: number, enabled: boolean): boolean;

export interface RuneRoute {
    rune: string;
    talisman: string;
    level: number;
    bank: string;
    ruins: Tile;
}
export const RUNES: Record<string, RuneRoute>;
export type RuneType = keyof typeof RUNES;
export const RUNE_OPTIONS: string[];
export const DEFAULT_RUNE: string;

/** Raw adapter access; prefer the typed APIs above. */
export const reader: Record<string, (...args: never[]) => unknown>;
