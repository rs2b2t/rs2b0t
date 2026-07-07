// Type declarations for the LCBuddy2 script ABI (apiVersion 1). Mirrors the
// client's src/bot/api surface. interact()-style methods return
// boolean | Promise<boolean>: DIRECT input resolves synchronously, SYNTHETIC
// returns a promise for the whole mouse gesture — either way, verify
// outcomes with Execution.delayUntil on game state.

export const apiVersion: number;

// ---- world primitives ----

export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

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

export abstract class Area {
    static rectangular(a: WorldTile, b: WorldTile): Area;
    static circular(center: WorldTile, radius: number): Area;
    abstract contains(tile: WorldTile): boolean;
    abstract getRandomTile(): Tile;
}

// ---- execution (the only legal way to sleep) ----

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

export const Game: {
    ingame(): boolean;
    /** Local player's world tile, or null before login/scene load. */
    tile(): WorldTile | null;
    energy(): number;
    weight(): number;
    /** Local player in combat (health bar showing). */
    inCombat(): boolean;
    /** Server ticks observed since the client booted. */
    tick(): number;
};

// ---- entities + queries ----

export interface Interactable {
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

export interface Locatable {
    tile(): Tile;
    distance(): number;
}

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

export class Player implements Locatable {
    readonly name: string | null;
    readonly inCombat: boolean;
    tile(): Tile;
    distance(): number;
    actions(): string[];
}

export class Loc implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

export class GroundItem implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    readonly count: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

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

export const Npcs: {
    query(): EntityQuery<Npc>;
    all(): Npc[];
    nearest(count?: number): Npc[];
};
export const Players: { query(): EntityQuery<Player> };
export const Locs: { query(): EntityQuery<Loc> };
export const GroundItems: { query(): EntityQuery<GroundItem> };

// ---- hud ----

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

export const Inventory: {
    items(): InvItem[];
    first(name: string): InvItem | null;
    contains(name: string): boolean;
    /** Occupied slots. */
    used(): number;
    isFull(): boolean;
};

export const Equipment: {
    items(): InvItem[];
    contains(name: string): boolean;
};

export const Skills: {
    /** Skill index by lowercase name ('woodcutting', ...), -1 if unknown. */
    index(name: string): number;
    /** Base (unboosted) level. */
    level(name: string): number;
    /** Current (boosted/drained) level. */
    effective(name: string): number;
    xp(name: string): number;
};

export interface BankItemSnapshot {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    comId: number;
}

export const Bank: {
    isOpen(): boolean;
    items(): BankItemSnapshot[];
    count(name: string): number;
    withdraw(name: string, op?: string): boolean | Promise<boolean>;
    deposit(name: string, op?: string): boolean | Promise<boolean>;
    depositInventory(): Promise<void>;
};

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
};

// ---- movement ----

export interface WalkOptions {
    /** Arrive within this many tiles of dest (default 2). */
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
}

export const Traversal: {
    /**
     * Web-walk across the world (A* over the baked collision pack + door/
     * transport graph; opens doors, recovers from stuck). Resolves false on
     * timeout/no-path. Unwalkable destinations snap to the nearest reachable
     * tile.
     */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean>;
    /** Warm the nav worker + collision pack before the first walk. */
    preload(): void;
    /** Path tiles left in the active walk (overlay/progress display). */
    remaining(): number;
};

export const DirectNavigator: {
    /** One same-scene walk click toward the tile (clamped into the scene). */
    walk(dest: WorldTile): boolean | Promise<boolean>;
    /** Same-scene walk with stall re-clicking; prefer Traversal.walkTo. */
    walkTo(dest: WorldTile, radius?: number, timeoutMs?: number): Promise<boolean>;
};

// ---- events ----

export interface ChatLine {
    type: number;
    username: string | null;
    text: string;
}

export interface EventMap {
    tick: { tick: number };
    'chat.message': ChatLine;
    'skill.xp': { skill: number; name: string; xp: number; delta: number };
    'skill.level': { skill: number; name: string; level: number; previous: number };
    'inventory.changed': { slot: number; id: number; name: string | null; count: number; previousId: number; previousCount: number };
    'varp.changed': { index: number; value: number; previous: number };
}

export const events: {
    /** Subscribe; returns the unsubscriber. Inside a bot prefer this.on(). */
    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): () => void;
    off<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
};

// ---- bot base classes ----

export type InputMode = 'direct' | 'synthetic';

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

export abstract class AbstractBot {
    /** Wall-clock ms between loop() iterations when loop() returns void. */
    loopDelay: number;
    /** Input mode for this run: 'direct' (default) or 'synthetic'. */
    inputMode: InputMode;
    /** Resolved parameters for this run; read e.g. this.settings.bool('x'). */
    readonly settings: SettingsBag;
    onStart?(): void | Promise<void>;
    /** Runs after stop AND crash — clean up here. */
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;
    /** Draw on the overlay canvas; called every client redraw while running. */
    onPaint?(ctx: CanvasRenderingContext2D): void;
    log(msg: string): void;
    /**
     * Subscribe to a game event for this run (auto-removed on stop/crash).
     * Callbacks fire mid-frame — set flags, log; do real work in loop().
     */
    protected on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
}

export abstract class LoopingBot extends AbstractBot {
    /** Return a number to override loopDelay for the next iteration. */
    abstract loop(): number | void | Promise<number | void>;
}

export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

/** Runs the first task whose validate() returns true, once per loop. */
export abstract class TaskBot extends LoopingBot {
    protected add(...tasks: Task[]): void;
    loop(): Promise<number | void>;
}

export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

export type TreeNode = BranchTask | LeafTask;

/** Walks branches by validate() until a leaf, executes it, once per loop. */
export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;
    loop(): Promise<number | void>;
}

// ---- manifest ----

export type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

export interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
}

/** Parameter schema: shown as a form in the panel, overridable via
 *  ?ScriptName.key=value. Read at runtime with this.settings. */
export type SettingsSchema = Record<string, SettingDef>;

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

export interface BotManifest extends BotManifestInput {
    __lcbuddyManifest: 1;
}

/** Default-export defineBot({...}) from your script's entry module. */
export function defineBot(manifest: BotManifestInput): BotManifest;

/** Imperative registration (the loader calls this for default exports). */
export function registerScript(manifest: BotManifestInput, origin?: string): void;

/** Low-level adapter reads — escape hatch; prefer the typed surface above. */
export const reader: Record<string, (...args: never[]) => unknown>;
