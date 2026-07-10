# rs2b0t Scripting API

Bots are written in TypeScript against **`@rs2b0t/api`** — a stable, versioned
surface (`apiVersion 1`) over the game client. This is the complete reference.

- Every bot is a subclass of a [base class](#bot-base-classes) registered with
  [`defineBot`](#registering-a-bot).
- Scripts run *inside* the client. `interact()`-style methods drive real input;
  **verify outcomes against game state** with
  [`Execution.delayUntil`](#execution) rather than assuming an action landed.
- `interact()` returns `boolean | Promise<boolean>`: direct input resolves
  synchronously; synthetic input returns a promise for the whole gesture. Always
  `await` it.

## Contents

- [Getting started](#getting-started)
- [Bot base classes](#bot-base-classes) · [lifecycle](#lifecycle-hooks) ·
  [LoopingBot](#loopingbot) · [TaskBot](#taskbot) · [TreeBot](#treebot)
- [Execution](#execution) — the only legal way to sleep
- [Game](#game) — world state
- [Entities & queries](#entities--queries)
- [Inventory & Equipment](#inventory--equipment) · [Bank](#bank) · [Skills](#skills) · [ChatDialog](#chatdialog)
- [Movement](#movement)
- [Events](#events)
- [Settings](#settings)
- [World primitives](#world-primitives) — Tile, Area
- [Item acquisition](#item-acquisition)
- [Registering a bot](#registering-a-bot)
- [Full example](#full-example)

---

## Getting started

Copy [`templates/script-template/`](../templates/script-template/) or author
in-tree under `src/bot/scripts/`. A script's entry module default-exports
`defineBot({...})`:

```ts
import { defineBot, Execution, Game, LoopingBot } from '@rs2b0t/api';

class MyBot extends LoopingBot {
    override async onStart() {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log('hello');
    }
    async loop() {
        // one iteration of work
        await Execution.delayTicks(1);
    }
}

export default defineBot({ name: 'MyBot', create: () => new MyBot() });
```

Load an out-of-tree build via the panel's **Load URL**, or register in-tree
scripts from `src/bot/scripts/index.ts`.

---

## Bot base classes

All bots extend `AbstractBot` (usually via `LoopingBot`, `TaskBot`, or
`TreeBot`).

### Lifecycle hooks

```ts
abstract class AbstractBot {
    loopDelay: number;                 // wall-clock ms between loop() iterations
    inputMode: 'direct' | 'synthetic'; // default 'direct'
    readonly settings: SettingsBag;    // resolved run parameters

    onStart?(): void | Promise<void>;  // before the first loop
    onStop?(): void;                   // after stop AND after a crash — clean up here
    onPause?(): void;
    onResume?(): void;
    onPaint?(ctx: CanvasRenderingContext2D): void; // overlay HUD, every redraw

    log(msg: string): void;
    protected on<K>(event, cb): void;  // event subscription, auto-removed on stop
}
```

- `onStop` runs on **both** a clean stop and a crash — release resources here.
- Event callbacks (`this.on`) fire mid-frame: set flags / `log`, do real work in
  `loop()`.

### LoopingBot

The common case: implement `loop()`. Return a number to override `loopDelay` for
the next iteration.

```ts
abstract class LoopingBot extends AbstractBot {
    abstract loop(): number | void | Promise<number | void>;
}
```

### TaskBot

A priority list of tasks. Each loop, the **first** task whose `validate()`
returns true has its `execute()` run.

```ts
interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}
abstract class TaskBot extends LoopingBot {
    protected add(...tasks: Task[]): void; // usually in onStart, highest priority first
}
```

```ts
class Fighter extends TaskBot {
    override onStart() {
        this.add(
            { validate: () => Game.energy() < 20, execute: async () => { /* rest */ } },
            { validate: () => !Game.inCombat(),    execute: async () => { /* attack */ } },
        );
    }
}
```

### TreeBot

A behaviour tree. Walk `BranchTask.validate()` from `root()` until a `LeafTask`,
then run it — once per loop.

```ts
abstract class BranchTask { validate(): boolean; success(): TreeNode; failure(): TreeNode; }
abstract class LeafTask   { execute(): void | Promise<void>; }
type TreeNode = BranchTask | LeafTask;
abstract class TreeBot extends LoopingBot { abstract root(): TreeNode; }
```

---

## Execution

The **only** legal way to sleep. Awaiting anything else escapes the runtime —
Stop can't unwind it and the watchdog warns.

```ts
Execution.delay(ms: number): Promise<void>          // wall-clock
Execution.delayTicks(n: number): Promise<void>      // n server ticks (~600ms each)
Execution.delayUntil(cond: () => boolean, timeoutMs = 6000): Promise<boolean>
```

`delayUntil` resolves `true` when `cond()` holds (checked once per frame),
`false` on timeout. Use it to confirm an action landed:

```ts
const before = Inventory.used();
await item.interact('Bury');
const ok = await Execution.delayUntil(() => Inventory.used() < before, 3000);
```

---

## Game

```ts
Game.ingame(): boolean
Game.tile(): WorldTile | null   // local player tile, null before login/scene load
Game.energy(): number           // run energy
Game.weight(): number
Game.inCombat(): boolean        // health bar showing
Game.tick(): number             // server ticks since client boot
```

---

## Entities & queries

Four world entity types, each queried through a fluent `EntityQuery`:

```ts
Npcs.query(): EntityQuery<Npc>
Players.query(): EntityQuery<Player>
Locs.query(): EntityQuery<Loc>          // scenery (doors, trees, rocks, stalls…)
GroundItems.query(): EntityQuery<GroundItem>
Npcs.all(): Npc[]
Npcs.nearest(count?: number): Npc[]
```

### EntityQuery

Chainable filters; terminal methods return results.

```ts
query()
  .name(...names: string[])   // case-insensitive exact match against any name
  .action(action: string)     // offers this action (case-insensitive)
  .within(dist: number)       // within dist tiles of the local player
  .inside({ minX, maxX, minZ, maxZ })
  .where(pred: (e) => boolean)
  // terminals:
  .results(): E[]
  .nearest(): E | null
  .first(): E | null
  .exists(): boolean
  .count(): number
```

```ts
const guard = Npcs.query().name('Guard').action('Pickpocket').within(3).nearest();
const oak = Locs.query().name('Oak').within(6).nearest();
const coins = GroundItems.query().name('Coins').within(12).nearest();
```

### Entity shapes

All entities are `Locatable` (`tile(): Tile`, `distance(): number`); most are
`Interactable` (`actions(): string[]`, `interact(action): boolean | Promise<boolean>`).

```ts
class Npc  { name; level; index; inCombat; health; valid(); /* + Locatable + Interactable */ }
class Loc  { name; id; /* + Locatable + Interactable */ }
class GroundItem { name; id; count; /* + Locatable + Interactable */ }
class Player { name; inCombat; /* + Locatable, actions() */ }
```

> **Note:** `interact()` sends the action in place — it does **not** walk the
> player to a distant target. Walk first (see [Movement](#movement)); the client
> paths within the loaded scene.

---

## Inventory & Equipment

```ts
Inventory.items(): InvItem[]
Inventory.first(name: string): InvItem | null
Inventory.contains(name: string): boolean
Inventory.used(): number            // occupied slots
Inventory.isFull(): boolean

Equipment.items(): InvItem[]
Equipment.contains(name: string): boolean
```

### InvItem

```ts
class InvItem {
    name; id; slot; count;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;   // held op, e.g. 'Bury', 'Eat'
    useOn(target: InvItem | Loc | Npc): boolean | Promise<boolean>;
}
```

`useOn` is "use X with Y" behind every processing skill — knife→logs,
raw fish→range, ess→altar. Returns false if a loc target is off-scene.

```ts
const raw = Inventory.first('Raw shrimps');
const range = Locs.query().name('Range').within(3).nearest();
if (raw && range) await raw.useOn(range);
```

## Bank

```ts
Bank.isOpen(): boolean
Bank.items(): BankItemSnapshot[]              // { slot, id, name, count, ops, comId }
Bank.count(name: string): number
Bank.withdraw(name: string, op?: string): boolean | Promise<boolean>
Bank.deposit(name: string, op?: string): boolean | Promise<boolean>
Bank.depositInventory(): Promise<void>
```

`withdraw`/`deposit`/`count` match names **exactly**. `op` is the context menu
label (e.g. `'Withdraw-10'`, `'Withdraw-All'`); read the real ops off
`Bank.items()[i].ops` when unsure. Open a bank by interacting with a booth/banker
loc first.

## Skills

```ts
Skills.index(name: string): number      // lowercase name → index, -1 if unknown
Skills.level(name: string): number      // base (unboosted)
Skills.effective(name: string): number  // current (boosted/drained)
Skills.xp(name: string): number
```

## ChatDialog

Drives NPC dialogs and skill "make" menus.

```ts
ChatDialog.isOpen(): boolean
ChatDialog.canContinue(): boolean          // "Click here to continue" up
ChatDialog.continue(): Promise<boolean>
ChatDialog.options(): string[]             // selectable option lines
ChatDialog.chooseOption(match?: string): Promise<boolean>  // contains match, or first
ChatDialog.isMakeMenu(): boolean           // "What would you like to make?"
ChatDialog.makeProducts(): string[]
ChatDialog.make(match?: string): Promise<boolean>  // contains match at the largest fixed qty
```

---

## Movement

```ts
Traversal.walkTo(dest: WorldTile, opts?: {
    radius?: number;    // arrive within N tiles (default 2)
    timeoutMs?: number;
    log?: (msg: string) => void;
}): Promise<boolean>
Traversal.preload(): void      // warm the nav worker before the first walk
Traversal.remaining(): number  // path tiles left in the active walk
```

`Traversal.walkTo` web-walks the whole world (A\* over the collision pack + door/
transport graph, opens doors, recovers from stuck). Resolves `false` on
timeout/no-path; unwalkable destinations snap to the nearest reachable tile.

For same-scene clicks, `DirectNavigator.walk(dest)` / `walkTo(dest, radius?,
timeoutMs?)` are available, but prefer `Traversal.walkTo`.

```ts
if (!await Traversal.walkTo({ x: 2662, z: 3305, level: 0 }, { radius: 0 })) {
    this.log('could not reach the stall');
}
```

---

## Events

Subscribe with `this.on(...)` inside a bot (auto-removed on stop/crash) or the
standalone `events.on(...)`. Callbacks fire mid-frame — set flags, do work in
`loop()`.

```ts
interface EventMap {
    tick: { tick: number };
    'chat.message': { type: number; username: string | null; text: string };
    'skill.xp': { skill: number; name: string; xp: number; delta: number };
    'skill.level': { skill: number; name: string; level: number; previous: number };
    'inventory.changed': { slot: number; id: number; name: string | null; count: number; previousId: number; previousCount: number };
    'varp.changed': { index: number; value: number; previous: number };
}
```

```ts
this.on('skill.xp', e => { if (e.name === 'prayer') this.xp += e.delta; });
```

---

## Settings

Declare a `settingsSchema` on the manifest; it renders as a form in the panel and
is overridable per-run via `?ScriptName.key=value` in the URL. Read values at
runtime through `this.settings`.

```ts
type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';
interface SettingDef { type: SettingType; default: unknown; label?; min?; max?; help?; }
type SettingsSchema = Record<string, SettingDef>;

interface SettingsBag {
    bool(key, fallback?): boolean;
    num(key, fallback?): number;
    str(key, fallback?): string;
    list(key, fallback?): string[];
    tile(key, fallback: Tile): Tile;
    raw(): Record<string, unknown>;
}
```

```ts
export default defineBot({
    name: 'Miner',
    settingsSchema: {
        rock:  { type: 'string', default: 'Copper rocks', label: 'Rock' },
        world: { type: 'boolean', default: true, label: 'World-hop when crowded' },
    },
    create: () => new Miner(),
});
// in the bot:  const rock = this.settings.str('rock', 'Copper rocks');
```

---

## World primitives

```ts
interface WorldTile { x: number; z: number; level: number; }

class Tile implements WorldTile {
    constructor(x: number, z: number, level?: number);
    static from(tile: WorldTile): Tile;
    distanceTo(other: WorldTile): number;   // Chebyshev (game movement metric)
    translate(dx: number, dz: number): Tile;
    equals(other: WorldTile): boolean;
}

abstract class Area {
    static rectangular(a: WorldTile, b: WorldTile): Area;
    static circular(center: WorldTile, radius: number): Area;
    contains(tile: WorldTile): boolean;
    getRandomTile(): Tile;
}
```

---

## Item acquisition

Higher-level helpers for "make sure I have these items":

```ts
type ItemNeed = { name: string; count: number; source: ItemSource };

held(name: string): number          // count of an item across inventory + equipment
hasAll(needs: ItemNeed[]): boolean  // every need satisfied by current holdings
class AcquireTask implements Task { constructor(bot, needs: ItemNeed[]); } // obtains items
```

`AcquireTask` plugs into a `TaskBot` to gather/shop/withdraw a set of item needs.
See `src/bot/api/ItemAcquisition.ts` and the bots that use it for usage.

---

## Registering a bot

```ts
interface BotManifestInput {
    name: string;
    description?: string;
    version?: string;
    category?: string;      // filter chip in the library (e.g. "Mining")
    tags?: string[];        // free-form search labels
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

function defineBot(manifest: BotManifestInput): BotManifest;   // default-export this
function registerScript(manifest: BotManifestInput, origin?: string): void; // imperative
```

Default-export `defineBot({...})` from your entry module. The URL loader calls
`registerScript` for you; in-tree scripts are registered from
`src/bot/scripts/index.ts`.

---

## Full example

The out-of-tree template ([`templates/script-template/src/ExampleBot.ts`](../templates/script-template/src/ExampleBot.ts)):
loots and buries bones, tracks prayer xp via events, and draws a HUD.

```ts
import { defineBot, Execution, Game, GroundItems, Inventory, LoopingBot } from '@rs2b0t/api';

class BoneBurier extends LoopingBot {
    private buried = 0;
    private xpGained = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log('BoneBurier started');
        this.on('skill.xp', e => { if (e.name === 'prayer') this.xpGained += e.delta; });
        // an emptied slot reports id -1 with the previous item id — a completed burial
        this.on('inventory.changed', e => {
            if (e.id === -1 && e.previousId !== -1) {
                this.buried++;
                this.log(`buried bones (#${this.buried})`);
            }
        });
    }

    async loop(): Promise<void> {
        const bones = Inventory.first('Bones');
        if (bones) {
            const before = Inventory.used();
            await bones.interact('Bury');
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
            return;
        }
        const ground = GroundItems.query().name('Bones').within(10).nearest();
        if (ground && !Inventory.isFull()) {
            const before = Inventory.used();
            await ground.interact('Take');
            await Execution.delayUntil(() => Inventory.used() > before, 5000);
            return;
        }
        await Execution.delayTicks(2);
    }

    override onStop(): void {
        this.log(`stopped — ${this.buried} buried, +${this.xpGained} prayer xp`);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        ctx.font = '12px monospace';
        ctx.fillStyle = '#ffb15b';
        ctx.fillText(`BoneBurier  buried ${this.buried}`, 12, 22);
    }
}

export default defineBot({
    name: 'BoneBurier',
    version: '0.1.0',
    description: 'External example: loots and buries nearby bones',
    create: () => new BoneBurier(),
});
```
