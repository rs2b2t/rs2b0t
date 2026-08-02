// Type declarations for the rs2b0t script ABI (apiVersion 1). Mirrors the
// client's src/bot/api surface. interact()-style methods return
// boolean | Promise<boolean> (the promise form is ABI headroom; the direct
// driver resolves synchronously) — always await, and verify outcomes with
// Execution.delayUntil on game state.

/**
 * ABI version this shim is built for. The client refuses a bundle whose
 * version does not match the one it installs.
 * @see docs/ARCHITECTURE.md#the-abi-boundary
 */
export const apiVersion: number;

// ---- world primitives ----

/**
 * A world position. Anything positional accepts this shape.
 * @see docs/API.md#world-primitives
 */
export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

/**
 * A concrete world tile with distance and translation helpers.
 * @see docs/API.md#world-primitives
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
 * A region of the map — rectangular or circular — for containment tests and
 * random-tile picks.
 * @see docs/API.md#world-primitives
 */
export abstract class Area {
    static rectangular(a: WorldTile, b: WorldTile): Area;
    static circular(center: WorldTile, radius: number): Area;
    abstract contains(tile: WorldTile): boolean;
    abstract getRandomTile(): Tile;
}

// ---- execution (the only legal way to sleep) ----

/**
 * The only legal way to sleep. These waits are settled from the client's frame
 * callback, so bot time is game time and Stop can unwind them; a bare
 * `setTimeout` escapes the runtime and trips the watchdog.
 * @see docs/API.md#execution
 * @see docs/ARCHITECTURE.md#frame-gap-insurance
 */
export const Execution: {
    /** Resolve after at least `ms` wall-clock milliseconds. */
    delay(ms: number): Promise<void>;
    /** Resolve after `n` more server ticks (~600ms each). */
    delayTicks(n: number): Promise<void>;
    /**
     * Resolve true when cond() holds (checked once per client frame), false
     * after timeoutMs (default 6000). Awaiting anything other than
     * Execution.* escapes the runtime: Stop can't unwind it and the watchdog
     * warns.
     */
    delayUntil(cond: () => boolean, timeoutMs?: number): Promise<boolean>;
};

// ---- game state ----

export type MeleeCombatStyle = 'attack' | 'strength' | 'controlled' | 'defence';

export interface CombatStyleResolution {
    /** Style requested by the script. */
    requested: MeleeCombatStyle;
    /** Actual interface-labelled style selected (may be defensive fallback). */
    effective: MeleeCombatStyle;
    mode: number;
}

/**
 * Local player and world state — position, energy, combat, animation, ticks.
 * @see docs/API.md#game
 */
export const Game: {
    ingame(): boolean;
    /** Local player's world tile, or null before login/scene load. */
    tile(): WorldTile | null;
    energy(): number;
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
    /** Resolve from current interface labels; unavailable styles fall back to its last defensive button. */
    combatStyleResolution(style: MeleeCombatStyle): CombatStyleResolution | null;
    combatStyleMode(style: MeleeCombatStyle): number | null;
    hasCombatStyle(style: MeleeCombatStyle): boolean;
    setCombatStyle(style: MeleeCombatStyle): boolean;
    /** @deprecated Use setCombatMode for an exact numeric mode. */
    setCombatStyle(mode: number): boolean;
    /** Set an exact combat-tab varp mode, primarily for ranged styles. */
    setCombatMode(mode: number): boolean;
    /** Local player's display name, or null before login. */
    myName(): string | null;
    openSideTab(tab: number): Promise<boolean>;
    castOnNpc(spell: string, npc: Npc): Promise<boolean>;
    /**
     * Cast a standard spellbook teleport by destination name.
     * Resolves the loaded magic button by name without activating its side tab,
     * then falls back to its 2004 component ID. Success confirms dispatch, not arrival.
     */
    teleport(name: string): Promise<boolean>;
};

// ---- entities + queries ----

/**
 * Something with right-click actions that can be operated by name.
 * @see docs/API.md#entities--queries
 */
export interface Interactable {
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Something with a world position and a distance from the local player.
 * @see docs/API.md#entities--queries
 */
export interface Locatable {
    tile(): Tile;
    distance(): number;
}

/**
 * A non-player character in the loaded scene.
 * @see docs/API.md#entity-shapes
 */
export class Npc implements Interactable, Locatable {
    readonly name: string | null;
    readonly level: number;
    readonly index: number;
    readonly inCombat: boolean;
    readonly health: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    valid(): boolean;
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Another player in the loaded scene.
 * @see docs/API.md#entity-shapes
 */
export class Player implements Locatable {
    readonly name: string | null;
    readonly inCombat: boolean;
    tile(): Tile;
    distance(): number;
    actions(): string[];
}

/**
 * A scenery object — door, tree, rock, bank booth, altar.
 * @see docs/API.md#entity-shapes
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
 * @see docs/API.md#entity-shapes
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
 * The shape `EntityQuery` filters over.
 * @see docs/API.md#entityquery
 */
interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

/**
 * Chainable filter over scene entities. Filters compose, then a terminal
 * (`nearest`, `results`, `exists`, ...) evaluates against the current scene.
 * @see docs/API.md#entityquery
 */
export class EntityQuery<E extends QueryableEntity> {
    /** Case-insensitive exact name match against any of the given names. */
    name(...names: string[]): this;
    /** Entity offers this action (case-insensitive). */
    action(action: string): this;
    /** Within `dist` tiles of the local player. */
    within(dist: number): this;
    /** Within a rectangle (inclusive). */
    inside(area: { minX: number; maxX: number; minZ: number; maxZ: number }): this;
    where(pred: (e: E) => boolean): this;
    results(): E[];
    nearest(): E | null;
    first(): E | null;
    exists(): boolean;
    count(): number;
}

/**
 * NPC queries.
 * @see docs/API.md#entities--queries
 */
export const Npcs: {
    query(): EntityQuery<Npc>;
    all(): Npc[];
    nearest(count?: number): Npc[];
};
/**
 * Player queries.
 * @see docs/API.md#entities--queries
 */
export const Players: { query(): EntityQuery<Player> };
/**
 * Scenery queries. A loc query is empty for about a tick after a level change —
 * blank does not mean absent.
 * @see docs/API.md#entities--queries
 * @see docs/NAV.md#level-change-loc-lag
 */
export const Locs: { query(): EntityQuery<Loc> };
/**
 * Ground-item queries.
 * @see docs/API.md#entities--queries
 */
export const GroundItems: { query(): EntityQuery<GroundItem> };

// ---- hud ----

/**
 * One backpack slot.
 * @see docs/API.md#invitem
 */
export class InvItem {
    readonly name: string | null;
    readonly id: number;
    readonly slot: number;
    readonly count: number;
    actions(): string[];
    /** Held op by name, e.g. item.interact('Bury'). */
    interact(action: string): boolean | Promise<boolean>;
    /**
     * Use this item on another item, a scenery loc, or an npc — the "use X
     * with Y" behind every processing skill (knife→logs, bar→anvil, ess→altar).
     * Returns false if a loc target is off-scene.
     */
    useOn(target: InvItem | Loc | Npc): boolean | Promise<boolean>;
}

/**
 * The backpack.
 * @see docs/API.md#inventory--equipment
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
};

/**
 * Worn equipment.
 * @see docs/API.md#inventory--equipment
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
 * @see docs/API.md#skills
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
 * @see docs/API.md#bank
 */
export interface BankItemSnapshot {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    comId: number;
}

/** Bank booth / chest access descriptor (some banks need openFirst first). */
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
    amount: 'all' | '10' | '1' | 'any'
): string | null;

/**
 * The bank interface. `isOpen()` only says the component exists — its item list
 * fills a beat later, and again after a deposit, so verify before trusting a
 * count of zero.
 * @see docs/API.md#bank
 */
export const Bank: {
    isOpen(): boolean;
    /**
     * True once the bank item list has populated. `isOpen` alone is not enough —
     * the list fills a beat later (and again after deposit). Until then every
     * `count()` reads 0, which is indistinguishable from an empty bank.
     */
    loaded(): boolean;
    /** Toggle note/item withdraw mode (resets to Item when the bank opens). */
    setNoteMode(on: boolean): Promise<void>;
    items(): BankItemSnapshot[];
    /** Exact name match (case-insensitive). */
    count(name: string): number;
    /**
     * Withdraw by context-menu op label (default `'Withdraw-1'`).
     * Prefer `withdrawOp(item.ops, 'all'|'10'|'1'|'any')` for the real label.
     */
    withdraw(name: string, op?: string): boolean | Promise<boolean>;
    /** Withdraw-X + count dialog for an exact quantity. */
    withdrawX(name: string, count: number): Promise<boolean>;
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
};

// ---- high-level banking (prefer this over raw Bank.open*) ----

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

/** Random-event casket obj id — always treated as common bank loot. */
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
    /**
     * Preset bank stand tile. Used when no bank is already nearby (see
     * `preferNearby`). Distant stands are not forced when a booth is underfoot.
     */
    stand?: WorldTile | null;
    boothName?: string;
    boothOp?: string;
    /**
     * Openable obstacle names on the way to a preset stand (e.g. `['door','gate']`).
     * Empty / omitted = plain `Traversal.walkResilient` to the stand.
     */
    obstacles?: string[];
    /** Forced destination when no booth is in scene and `stand` is unset. */
    destination?: BankDestination;
    /**
     * Prefer a bank already underfoot / in the local scene over a distant preset
     * stand. Default true — starting next to Draynor must not web-walk to Edgeville
     * just because the camp table says Edgeville.
     */
    preferNearby?: boolean;
    /** Distance for nearby snap. Default {@link NEARBY_BANK_RADIUS}. */
    nearbyRadius?: number;
    log?: (msg: string) => void;
}

/** Snap radius for "I'm already at a bank" (booth underfoot / local stand). */
export const NEARBY_BANK_RADIUS: number;

export type BankOpenRoute = 'already-open' | 'scene-booth' | 'local-bank' | 'preset-stand' | 'nearest-fallback';

/**
 * Pure routing for {@link Banking.open} — unit-testable without the client.
 * Nearby scene booth or local known bank beats a distant camp/vendor stand.
 */
export function resolveBankOpenRoute(input: {
    bankOpen?: boolean;
    here: WorldTile | null;
    stand?: WorldTile | null;
    nearbyBoothDist: number | null;
    nearest: { name: string; tile: WorldTile; access?: BankObjectAccess } | null;
    preferNearby?: boolean;
    nearbyRadius?: number;
}): BankOpenRoute;

/**
 * High-level bank open + one-shot bank-and-deposit helpers.
 * Prefer `Banking.open` over hand-rolling walk + `Bank.openBooth` / `openNearest`.
 */
export const Banking: {
    /**
     * Open a bank for script work (deposit / withdraw / restock).
     * Default preferNearby: booth/local bank underfoot wins over a distant stand.
     *
     * Does **not** deposit or walk back — callers own the bank session.
     */
    open(opts?: OpenBankOpts): Promise<boolean>;
    /**
     * Open nearest (or forced) bank, deposit matching items, optional afterDeposit,
     * optional walk to `returnTo`.
     */
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
 * @see docs/API.md#registering-a-bot
 */
export const Shop: {
    isOpen(): boolean;
    /** Trade with `npcName` — walks nothing, the caller must already be near. */
    open(npcName: string): Promise<boolean>;
    /** The shop-side stock rows of the open shop. */
    stock(): { name: string; count: number; slot: number }[];
    /** Buy up to `n` of `name`; resolves the units actually bought. */
    buy(name: string, n: number): Promise<number>;
    /** Sell up to `n` of `name`; resolves the units actually sold. */
    sell(name: string, n: number): Promise<number>;
    close(): Promise<void>;
};

/**
 * A quest's journal colour.
 * @see docs/QUESTS.md#quest-state
 */
export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

/**
 * The quest tab. This is the authoritative source of quest progress — never
 * infer it from varps.
 * @see docs/QUESTS.md#quest-state
 */
export const Quests: {
    /** Every quest on the quest tab with its journal-colour status. */
    all(): { name: string; status: QuestStatus }[];
    status(name: string): QuestStatus;
    /** Quest points shown on the tab. */
    points(): number;
};

/**
 * Chat modals: dialogue pages, option lists, and make-x menus.
 * @see docs/API.md#chatdialog
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
    /** Offer exactly `n` via Offer-X + count dialog. */
    offer(
        itemName: string,
        n: number,
        pick?: (i: { count: number; id: number; slot: number }) => boolean
    ): Promise<boolean>;
    /** Accept the current offer or confirm screen. */
    accept(): Promise<boolean>;
    decline(): Promise<void>;
};

// ---- movement ----

/**
 * Options for a single web-walk.
 * @see docs/API.md#movement
 */
export interface WalkOptions {
    /** Arrive within this many tiles of dest (default 2). */
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
    /** A* expansion budget override. */
    maxExpansions?: number;
    /**
     * Force walker engine for this walk. Default: Global `navEngine`
     * (`classic` | `v2`). Classic preserves pre–nav-v2 routing.
     */
    navEngine?: 'classic' | 'v2';
    /** nav-v2 only: path policy (tele toggles, distanceBeforeTeleport, …). */
    policy?: {
        useTeleports?: boolean;
        distanceBeforeTeleport?: number;
        allowTeleportIds?: readonly string[];
        useShips?: boolean;
        useShortcuts?: boolean;
    };
    /**
     * nav-v2 only: include spell/jewellery tele edges in A*.
     * When navEngine is v2, defaults to true unless set false or policy.useTeleports is false.
     */
    useTeleportCatalog?: boolean;
    /**
     * nav-v2 only: optional known bank item counts for the bank planner
     * (tests / when bank is not open).
     */
    bankItemCounts?: Record<string, number>;
}

/**
 * Options for a walk behind the escalation ladder.
 * @see docs/NAV.md#when-it-gets-stuck
 */
export interface WalkResilientOptions {
    /** Arrive when within this Chebyshev distance of dest. */
    radius: number;
    /** Bound the escalation to this many baked-walk passes; default = retry forever. */
    attempts?: number;
    /** Per baked-walk budget (default 90s). */
    timeoutMs?: number;
    /** Client-scene-walk arrival radius when bridging a baked gap (default = radius+1). */
    sceneRadius?: number;
    /** Big-budget baked retry's node budget (default 1.2M). */
    maxBudget?: number;
    log?: (msg: string) => void;
    /** Forwarded to WalkExecutor (classic | v2). Default: Global `navEngine`. */
    navEngine?: 'classic' | 'v2';
}

/**
 * World-scale movement: A* over the baked collision pack plus the door and
 * transport graph, opening doors and recovering from stuck.
 * @see docs/API.md#movement
 * @see docs/NAV.md
 */
export const Traversal: {
    /**
     * Web-walk across the world (A* over the baked collision pack + door/
     * transport graph; opens doors, recovers from stuck). Resolves false on
     * timeout/no-path. Unwalkable destinations snap to the nearest reachable
     * tile.
     */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean>;
    /**
     * walkTo behind an escalation ladder (re-path, big-budget retry, scene-walk
     * bridging) that by default never gives up — only a random event or Stop
     * ends it early. Prefer this for unattended walks.
     */
    walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean>;
    /** Warm the nav worker + collision pack before the first walk. */
    preload(): void;
    /** Path tiles left in the active walk (overlay/progress display). */
    remaining(): number;
};

/**
 * Same-scene walking only. Prefer `Traversal` unless you specifically want a
 * single click within the loaded scene.
 * @see docs/NAV.md#following-a-path
 */
export const DirectNavigator: {
    /** One same-scene walk click toward the tile (clamped into the scene). */
    walk(dest: WorldTile): boolean | Promise<boolean>;
    /** Same-scene walk with stall re-clicking; prefer Traversal.walkTo. */
    walkTo(dest: WorldTile, radius?: number, timeoutMs?: number): Promise<boolean>;
};

// ---- events ----

/**
 * One line of game chat.
 * @see docs/API.md#events
 */
export interface ChatLine {
    type: number;
    username: string | null;
    text: string;
}

/**
 * Every event a bot can subscribe to, with its payload.
 * @see docs/API.md#events
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
 * @see docs/API.md#events
 */
export const events: {
    /** Subscribe; returns the unsubscriber. Inside a bot prefer this.on(). */
    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): () => void;
    off<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
};

// ---- bot base classes ----

/** Typed accessor for the run's parameters (from the manifest settingsSchema,
 *  overlaid with panel edits and ?Script.key=… URL overrides). */
export interface SettingsBag {
    bool(key: string, fallback?: boolean): boolean;
    num(key: string, fallback?: number): number;
    str(key: string, fallback?: string): string;
    list(key: string, fallback?: string[]): string[];
    tile(key: string, fallback: Tile): Tile;
    raw(): Record<string, unknown>;
}

/**
 * Base class for every bot. Usually extended via `LoopingBot`, `TaskBot`, or
 * `TreeBot` rather than directly.
 * @see docs/API.md#bot-base-classes
 */
export abstract class AbstractBot {
    /** Wall-clock ms between loop() iterations when loop() returns void. */
    loopDelay: number;
    /** Resolved parameters for this run; read e.g. this.settings.bool('x'). */
    readonly settings: SettingsBag;
    onStart?(): void | Promise<void>;
    /** Runs after stop AND crash — clean up here. */
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;
    /** Draw on the overlay canvas; called every client redraw while running. */
    onPaint?(ctx: CanvasRenderingContext2D): void;
    /**
     * Where recovery flows (watchdog, guarded restarts) should walk the bot
     * back to. Scripts with a working anchor implement this.
     */
    recoveryAnchor?(): Tile | null;
    /**
     * NPC names this bot legitimately fights — the runtime event guard never
     * treats them as hostile random events. Override in combat scripts.
     */
    grindTargets(): string[];
    log(msg: string): void;
    /**
     * Subscribe to a game event for this run (auto-removed on stop/crash).
     * Callbacks fire mid-frame — set flags, log; do real work in loop().
     */
    protected on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
}

/**
 * The common shape: implement `loop()` and it is called repeatedly.
 * @see docs/API.md#loopingbot
 */
export abstract class LoopingBot extends AbstractBot {
    /** Return a number to override loopDelay for the next iteration. */
    abstract loop(): number | void | Promise<number | void>;
}

/**
 * A unit of work for `TaskBot`: a guard and the action it guards.
 * @see docs/API.md#taskbot
 */
export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

// ---- item acquisition ----

/**
 * Where an item can be obtained from.
 * @see docs/API.md#item-acquisition
 */
export type ItemSource = { kind: 'shop'; npc: string; near: WorldTile } | { kind: 'ground'; at: WorldTile } | { kind: 'gather' } | { kind: 'make' };

/**
 * A quantity of an item, and where to get it.
 * @see docs/API.md#item-acquisition
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
    /** Dropdown choices when type is 'string' (or multi-select for 'string[]'). */
    options?: string[];
    /** Panel group heading for related settings. */
    group?: string;
    execute(): Promise<void>;
}

/** Runs the first task whose validate() returns true, once per loop. */
export abstract class TaskBot extends LoopingBot {
    protected add(...tasks: Task[]): void;
    loop(): Promise<number | void>;
}

/**
 * A decision node in a `TreeBot`.
 * @see docs/API.md#treebot
 */
export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

/**
 * An action node in a `TreeBot`.
 * @see docs/API.md#treebot
 */
export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

/**
 * Either node kind in a behaviour tree.
 * @see docs/API.md#treebot
 */
export type TreeNode = BranchTask | LeafTask;

/** Walks branches by validate() until a leaf, executes it, once per loop. */
export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;
    loop(): Promise<number | void>;
}

// ---- manifest ----

/**
 * The parameter types the panel can render.
 * @see docs/API.md#settings
 */
export type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

/**
 * One declared parameter: its type, default, and presentation.
 * @see docs/API.md#settings
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
 * What a script declares about itself: name, description, category, tags, and
 * its parameter schema.
 * @see docs/API.md#registering-a-bot
 */
export interface BotManifestInput {
    name: string;
    description?: string;
    version?: string;
    /** Skill/group the script belongs to (e.g. "Mining"). Becomes a filter
     *  chip in the script library; grouped under "Other" when omitted. */
    category?: string;
    /** Free-form labels for search/filtering in the library (e.g. "f2p"). */
    tags?: string[];
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

/**
 * A validated manifest, as returned by `defineBot`.
 * @see docs/API.md#registering-a-bot
 */
export interface BotManifest extends BotManifestInput {
    __rs2b0tManifest: 1;
}

/** Default-export defineBot({...}) from your script's entry module. */
export function defineBot(manifest: BotManifestInput): BotManifest;

/** Imperative registration (the loader calls this for default exports). */
export function registerScript(manifest: BotManifestInput, origin?: string): void;

// ---- world catalogs (data tables + pure helpers) ----
// @see docs/API.md#world-catalogs

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
/** Euclidean same-plane distance (not Chebyshev). */
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

export type MiningLocation = GatheringLocation;
export const MINING_LOCATIONS: MiningLocation[];
export const MINING_LOCATION_OPTIONS: string[];
export function resolveMiningLocation(setting: string, startTile: WorldTile): MiningLocation | null;

export type WoodcuttingLocation = GatheringLocation;
export const WOODCUTTING_LOCATIONS: WoodcuttingLocation[];
export const WOODCUTTING_LOCATION_OPTIONS: string[];
export function resolveWoodcuttingLocation(setting: string, startTile: WorldTile): WoodcuttingLocation | null;

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

/** Low-level adapter reads — escape hatch; prefer the typed surface above. */
export const reader: Record<string, (...args: never[]) => unknown>;
