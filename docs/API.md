[Manual](README.md) › Scripting API

# rs2b0t Scripting API

Bots are written in TypeScript against **`@rs2b0t/api`** — a stable, versioned
surface (`apiVersion 1`) over the game client. This is the complete reference.

- Every bot is a subclass of a [base class](#bot-base-classes) registered with
  [`defineBot`](#registering-a-bot).
- Scripts run *inside* the client. `interact()`-style methods drive real input;
  **verify outcomes against game state** with
  [`Execution.delayUntil`](#execution) rather than assuming an action landed.
- `interact()` returns `boolean | Promise<boolean>` (the promise form is ABI
  headroom; the direct driver resolves synchronously). Always `await` it.

## Contents

- [Getting started](#getting-started)
- [Bot base classes](#bot-base-classes) · [lifecycle](#lifecycle-hooks) ·
  [LoopingBot](#loopingbot) · [TaskBot](#taskbot) · [TreeBot](#treebot)
- [Execution](#execution) — the only legal way to sleep
- [Game](#game) — world state
- [Entities & queries](#entities--queries)
- [Inventory & Equipment](#inventory--equipment) · [Bank](#bank) · [Banking](#banking) · [Skills](#skills) · [Prayer](#prayer) · [ChatDialog](#chatdialog) · [Shop](#shop) · [Trade](#trade) · [Quests](#quests)
- [Movement](#movement)
- [Events](#events)
- [Settings](#settings)
- [World primitives](#world-primitives) — Tile, Area
- [World catalogs](#world-catalogs) — banks, tools, locations, routes
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
Game.runEnabled(): boolean
Game.weight(): number
Game.inCombat(): boolean        // health bar showing
Game.animating(): boolean
Game.tick(): number             // server ticks since client boot
Game.combatMode(): number       // current raw com_mode varp
Game.combatStyleMode(style: 'attack' | 'strength' | 'controlled' | 'defence'): number | null
Game.hasCombatStyle(style): boolean
Game.setCombatStyle(style): boolean
Game.setCombatMode(mode: number): boolean // exact numeric mode (for ranged styles)
Game.myName(): string | null
Game.cameraYaw(): number
Game.cameraPitch(): number
Game.setCameraYaw(yaw: number): boolean
Game.openSideTab(tab: number): Promise<boolean>
Game.castOnNpc(spell: string, npc: Npc): Promise<boolean>
Game.teleport(name: string): Promise<boolean>
```

### Camera (client-only)

Orbit camera read/write is **client-side only** — nothing is sent to the game
server except the client's own camera-report packets, which are already
rate-limited (`sendCameraDelay = 20` ticks between reports).

| Method | Returns | Notes |
|---|---|---|
| `cameraYaw()` | `0–2047` | Client orbit yaw units (**not** degrees). |
| `cameraPitch()` | number | Client pitch units. |
| `setCameraYaw(yaw)` | `boolean` | Local mutation / dispatch availability. **Does not** wait for the view to settle; a `true` result only means the client accepted the write. |

For automatic path-facing during walks, prefer Global **`navCameraFollow`**
(default `false`) rather than driving yaw from scripts every tick — see
[World-walking → Path camera](NAV.md#path-camera).

```ts
// One-shot face east (client units: east ≈ 1536)
if (Game.setCameraYaw(1536)) {
    await Execution.delay(200); // optional settle; API does not wait
}
```

Melee styles are resolved from the Accurate, Aggressive, Controlled, or
Defensive labels on the equipped weapon's combat interface. This handles
duplicate and unusual layouts without guessing from the weapon name, button
count, or ordinal order. If a requested style is unavailable, the last defensive
button is selected (including controlled on a three-mode weapon).

`Game.teleport()` accepts Varrock, Lumbridge, Falador, Camelot, Ardougne,
Watchtower, or Trollheim. Names are case-insensitive and may include `Cast` and
the `teleport` suffix. An unknown name returns `false` without opening a tab or
clicking a component.

Spell casting does not require magic side tab 6 to be active. The client keeps
the loaded magic root addressable while another side tab is displayed, so both
`Game.castOnNpc()` and `Game.teleport()` resolve and dispatch directly against
that root without changing the player's current tab. There is no separate tab or
root-availability gate: targeted casts return `false` naturally when their spell
component cannot be resolved, while teleports can still use their static fallback
component when live interface lookup is unavailable.

For a recognised teleport, the current interface button is resolved by its
displayed name. If that live lookup fails, the matching 2004 component ID is
used as a compatibility fallback. A `true` result only means the component click
was dispatched; it does not prove the server accepted the cast. Scripts should
wait for the expected tile or plane change to confirm arrival.

```ts
if (await Game.teleport('Camelot')) {
    await Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile?.x === 2757 && tile.z === 3478;
    }, 8000);
}
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
Inventory.count(name: string): number   // total qty across stacks/slots
Inventory.countById(id: number): number // exact object ID across stacks/slots
Inventory.used(): number                // occupied slots
Inventory.free(): number                // unoccupied slots (0 if normal pack UI is unavailable)
Inventory.isFull(): boolean

Equipment.items(): InvItem[]
Equipment.contains(name: string): boolean
Equipment.equip(name: string): Promise<boolean>    // Wield/Wear/Equip from pack
Equipment.unequip(name: string): Promise<boolean>  // Remove into pack
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

While the bank is open, these queries read the bank's side-backpack component.
Once populated, its counts and capacity remain authoritative even though the
normal inventory tab is hidden. The side snapshot can populate one tick after
the main bank component;
`Bank.withdrawX*` waits for that handoff before recording its baseline. Side-view
`InvItem` actions are the visible `Deposit-*` component buttons, and `useOn`
returns false until the bank is closed.

`useOn` is "use X with Y" behind every processing skill — knife→logs,
raw fish→range, ess→altar. Returns false if a loc target is off-scene.

```ts
const raw = Inventory.first('Raw shrimps');
const range = Locs.query().name('Range').within(3).nearest();
if (raw && range) await raw.useOn(range);
```

## Bank

Low-level bank UI. Prefer [`Banking.open`](#banking) to walk to and open a bank;
use `Bank.*` once the interface is open.

```ts
Bank.isOpen(): boolean
Bank.loaded(): boolean                    // item list populated (wait after open/deposit)
Bank.setNoteMode(on: boolean): Promise<void>
Bank.items(): BankItemSnapshot[]          // { slot, id, name, count, ops, comId }
Bank.count(name: string): number          // exact name, case-insensitive
Bank.countById(id: number): number        // when two objects share a display name
Bank.withdraw(name: string, op?: string): boolean | Promise<boolean>
Bank.withdrawById(id: number, op?: string): boolean | Promise<boolean>
Bank.withdrawX(name: string, count: number): Promise<boolean>   // Withdraw-X + dialog
Bank.withdrawXById(id: number, count: number): Promise<boolean>
Bank.deposit(name: string, op?: string): boolean | Promise<boolean>
Bank.depositInventory(): Promise<void>
Bank.depositAllMatching(match: (name, id) => boolean, log?): Promise<void>
Bank.close(timeoutMs?: number): Promise<boolean> // waits for main + side modal halves
Bank.openBooth(stand, boothName, op, log?): Promise<boolean>
Bank.openNearest(boothName, op, log?): Promise<boolean>
Bank.openNearestAccess(access, log?): Promise<boolean>

// Pick a real withdraw label from item.ops ("Withdraw-All" vs "Withdraw All")
withdrawOp(ops, amount: 'all' | '10' | '1' | 'any'): string | null
```

**Gotchas**

- `isOpen` only means the bank component exists. After open (and after every
  deposit) wait for `Bank.loaded()` before trusting `count()` / `items()` —
  until then counts read as 0.
- `withdraw`/`deposit`/`count` match names **exactly** (case-insensitive).
  `op` is the context-menu label; use `withdrawOp(item.ops, 'all')` rather than
  hard-coding `'Withdraw-All'`.
- Prefer `countById` / `withdrawById` / `withdrawXById` when two objects share a
  display name.
- Do **not** hand-roll walk + booth click in new scripts — use `Banking.open`.

```ts
if (!(await Banking.open({ stand: bankTile }))) return;
await Execution.delayUntil(() => Bank.loaded(), 3000);
await Bank.depositAllMatching(depositAllExcept(['Harpoon', 'Fishing bait']));
const bait = Bank.items().find(i => i.name === 'Fishing bait');
const op = bait ? withdrawOp(bait.ops, 'all') : null;
if (op) await Bank.withdraw('Fishing bait', op);
// or exact qty:
await Bank.withdrawX('Feather', 100);
// or by id when names collide:
// await Bank.withdrawById(someId, op);
```

## Banking

High-level open / deposit helpers. **This is what scripts should call.**

```ts
Banking.open(opts?: {
    stand?: WorldTile | null;     // preset stand when no bank is already nearby
    boothName?: string;           // default 'Bank booth'
    boothOp?: string;             // default 'Use-quickly'
    obstacles?: string[];         // doors/gates on the way to stand (e.g. ['door','gate'])
    destination?: BankDestination;// force a bank when no booth in scene
    preferNearby?: boolean;       // default true — local booth beats distant stand
    nearbyRadius?: number;        // default NEARBY_BANK_RADIUS (14)
    log?: (msg: string) => void;
}): Promise<boolean>
// Does NOT deposit or walk back — caller owns the session.

NEARBY_BANK_RADIUS                // snap radius for "bank underfoot"
resolveBankOpenRoute(input)       // pure router (unit-tested)

Banking.bankNearest(opts: {
    deposit: (name: string) => boolean;
    commonJunk?: boolean;         // also bank gems/fruit/beer/kebabs/caskets (default true)
    destination?: BankDestination;
    returnTo?: WorldTile;
    boothName?: string;
    boothOp?: string;
    afterDeposit?: () => void | Promise<void>;
    log?: (msg: string) => void;
}): Promise<boolean>
```

**Open rules** (default `preferNearby: true`)

| Situation | Behaviour |
|---|---|
| usable booth within `nearbyRadius` | open it — **ignore** distant preset stand |
| nearest known bank within radius, stand far | walk that local bank |
| `stand` set, `obstacles` non-empty | walk opening doors/gates → `openBooth` |
| `stand` set, no obstacles | `walkResilient` → `openBooth` |
| no `stand`, booth in scene | `openNearestAccess` |
| no `stand`, no booth | web-walk nearest known bank, then open |

**Deposit helpers** (pass into `Bank.depositAllMatching` or `bankNearest.deposit`):

```ts
depositAllExcept(keep: Iterable<string>): (name: string) => boolean
// keep tools/bait; bank everything else

depositMatcher(own: (name) => boolean, includeCommon: boolean): (name, id?) => boolean
matchesCommonBankLoot(name: string, id?: number): boolean
COMMON_BANK_LOOT: string[]            // 'uncut', gem names, 'strange fruit', …
RANDOM_EVENT_CASKET_ID: number        // always treated as common loot
```

> **Default to `depositAllExcept`.** Reach for an allow-list (`depositMatcher`, or
> matching your own product by name) only when you can name every item the pack is
> allowed to accumulate — and you usually can't. Random events, gem-table rolls, drops
> and quest leavings all arrive unannounced, and anything the deposit misses **squats a
> slot on every future trip**. That is a slow leak, not a crash: the bot keeps working
> while each load quietly shrinks, so nothing fails and no test notices.
>
> Deny-listing inverts the failure. An unexpected item gets banked (harmless) instead of
> hoarded (compounding). Keep the list to what the script genuinely needs to hold — and
> keep the *specific* item, not the category: `CoalTrucks` keeps the one pickaxe
> `bestPickaxe` selected, so a spare or an unusable tier is banked rather than squatting
> a coal slot forever.

**Periodic bank settings** (combat/loot scripts):

```ts
PERIODIC_BANK_SETTINGS   // bankStrategy / bankEveryItems / bankEveryMinutes / bankCommonJunk
parseBankStrategy(label: string): 'off' | 'items' | 'time' | 'either'
shouldBankNow(strategy, { lootCount, minutesSinceLastBank, itemsThreshold, minutesThreshold }): boolean
```

```ts
// Preset location with a door between spots and bank
await Banking.open({
    stand: loc.bankStand,
    boothName: loc.boothName,
    boothOp: loc.boothOp,
    obstacles: loc.obstacles ?? [],
    log: m => this.log(m),
});
await Bank.depositAllMatching(depositAllExcept(['Small fishing net']));

// No preset — web-walk nearest bank, dump loot, walk back
await Banking.bankNearest({
    deposit: depositAllExcept(['Lobster pot']),
    returnTo: this.anchor,
    log: m => this.log(m),
});
```

## Skills

```ts
Skills.index(name: string): number      // lowercase name → index, -1 if unknown
Skills.level(name: string): number      // base (unboosted)
Skills.effective(name: string): number  // current (boosted/drained)
Skills.xp(name: string): number
Skills.hpFraction(): number             // effective/base hitpoints (1 while unreadable)
```

## Prayer

Prayer points and the protection prayers. Prayer buttons live in the tab-bound
prayer overlay, and the engine treats any tab root as visible, so a prayer can be
toggled without switching to the prayer tab first.

```ts
Prayer.points(): number                 // current, drains while a prayer is on
Prayer.max(): number                    // base prayer level
Prayer.full(): boolean
Prayer.known(name: string): boolean     // e.g. 'Protect from Magic'
Prayer.available(name: string): boolean // level met and points remain
Prayer.active(name: string): boolean
Prayer.set(name: string, on: boolean): Promise<boolean>
Prayer.clear(): Promise<void>           // turn off everything that is draining
```

[`nearestAltar`](../src/bot/api/Altars.ts) finds somewhere to restore them.
[Clue trails](CLUES.md#prayer-between-trails) use both to fight hard-clue dig
guardians under Protect from Magic.

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

## Shop

```ts
Shop.isOpen(): boolean
Shop.open(npcName: string): Promise<boolean>   // must already be near the NPC
Shop.stock(): { name; count; slot }[]
Shop.buy(name: string, n: number): Promise<number>   // units actually bought
Shop.sell(name: string, n: number): Promise<number>
Shop.close(): Promise<void>
```

## Trade

Player-to-player trade. Both sides must "Trade with" each other, then accept
offer + confirm. Any movement or combat closes the modal — own the loop with a
dedicated task while `Trade.active()`.

```ts
Trade.active(): boolean
Trade.onOfferScreen(): boolean
Trade.onConfirmScreen(): boolean
Trade.partner(): string | null
Trade.myOffer(): TradeItem[]            // { id, name, count }
Trade.theirOffer(): TradeItem[]
Trade.request(playerName: string): Promise<boolean>
Trade.offerAll(itemName, pick?): Promise<boolean>
Trade.offer(itemName, n, pick?): Promise<boolean>   // Offer-X exact qty
Trade.accept(): Promise<boolean>
Trade.decline(): Promise<void>
```

### Partner trade policy (`api/mule/PartnerTrade`)

Pure helpers shared by GatheringBot mule modes, FlaxRunner, and NatureCrafter:

```ts
parsePartnerList(raw: string): string[]
isConfiguredPartner(name, partners): boolean
decideReceiverOfferScreen({ partnerHeader, partners, myOfferSlots, theirProductCount })
decideGiverOfferScreen(myOfferSlots): 'offer' | 'accept' | 'wait'
parseMuleMode(raw): 'off' | 'gatherer' | 'mule' | 'cooker' | 'supplier'
muleGathererHandoffActive / muleReceiverActive / muleCookerActive / muleSupplierActive
```

GatheringBot `muleMode` + `mulePartner`:

| Mode | Role |
| --- | --- |
| Gatherer | Full haul → trade at camp meet (no bank) |
| Mule | Accept → **bank** (demo for ore/logs; replace with a processor script) |
| Cooker | Accept **raw fish** → cook at camp range → bank cooked (`burntPolicy`) |
| Supplier | Withdraw raw from bank when N ready → trade at meet (pairs with Cooker) |

### Cooking ranges (`api/CookingRanges`)

Map-pack catalog of `debugname=range` ovens + curated surfaces for fishing camps:

```ts
COOKING_RANGE_LOCS          // all Range SW tiles from Server maps
nearestCookingRange(origin, maxCheb?)
cookSurfaceForFishCamp(name, role?) // role: 'pier' | 'bank'
resolveFishCampCookSurface(name, spot, maxCheb?, role?)
FISH_CAMP_COOK_PLANS        // pier + optional bank surface per camp
```

**Pier vs bank role:** cook-then-bank uses the pier surface (short walk with raw);
bank-raw-then-cook prefers a surface near the bank when one is curated (e.g. Seers
village range).

**Two-step path:** a surface may set `approach` then `stand`. FishCook walks
`approach` first (e.g. exterior of Sinclair Large door), then `stand` next to the
Range — so pathfinding enters the building before aiming at the interior oven.

### Entity query helpers

```ts
Locs.query().name('…').withinOf(tile, radius).nearest()
Locs.query().… .nearestPreferLocal(preferRadius)  // local cluster first
```

See also `api/TargetPick` (`pickNearestPreferLocal`) and `api/GatherCamp` (membership disks).

## Quests

```ts
Quests.all(): { name: string; status: QuestStatus }[]
Quests.status(name: string): QuestStatus   // 'notStarted' | 'inProgress' | 'complete' | 'unknown'
Quests.journal(name: string): Promise<string[]>  // opens the quest log modal
Quests.points(): number                    // transmitted varp qp (101)
```

**What these actually read.** Full rationale: [Quest state](QUESTS.md#quest-state).

| Call | Source | Cost |
|---|---|---|
| `status` / `all` | Quest-tab **text colour** (`IF_SETCOLOUR`: red / yellow / green) | free — no modal |
| `points` | `reader.varp(101)` (`qp`, `transmit=yes`) | free |
| `journal` | Clicks the quest name, waits for main modal, reads scroll text | **opens the log** |

Mid-quest stage integers and bitfields live in Content as `scope=perm` varps
**without** `transmit=yes` (e.g. `cookquest`, `elemental_workshop_bits`). They
never arrive in `client.var[]`, so `reader.varp` stays `0` and must not be used
as progress. Yellow colour only means “in progress” — it does not encode which
stage. Prefer inventory / game messages / scene oracles; open `journal` only when
stage text is the sole discriminator. A future bit-level API needs Content to
set `transmit=yes` on those varps first — it is not a missing client field.

---

## Movement

How this works underneath — the collision pack, doors, transports, and arrival
semantics — is [World-walking](NAV.md).

```ts
Traversal.walkTo(dest: WorldTile, opts?: {
    radius?: number;    // arrive within N tiles (default 2)
    timeoutMs?: number;
    log?: (msg: string) => void;
    maxExpansions?: number;
    // Feature gate on the *single* walker stack (not two engines). Global `navEngine`
    // unless overridden. classic (default) = shared graph/exec, no tele inject / bank plan.
    // v2 = same stack + teleport catalog inject + path-scoped bank for runes/tolls.
    // See docs/NAV.md § One walker, two modes.
    navEngine?: 'classic' | 'v2';
    // v2 only: spell/jewellery tele edges (default true when navEngine is v2).
    useTeleportCatalog?: boolean;
    // v2 only: tele policy (useTeleports, distanceBeforeTeleport, allowTeleportIds, …).
    policy?: { useTeleports?: boolean; distanceBeforeTeleport?: number; allowTeleportIds?: string[] };
    // Optional: ban map rects from A* (ids or ad-hoc). See docs/NAV.md#danger-zones
    avoidZones?: readonly (string | { minX: number; maxX: number; minZ: number; maxZ: number; level?: number })[];
}): Promise<boolean>

// Prefer for unattended walks — escalates re-path / big-budget / scene bridge
// and by default never gives up (only random-event or Stop ends it early).
Traversal.walkResilient(dest: WorldTile, opts: {
    radius: number;
    attempts?: number;
    timeoutMs?: number;
    sceneRadius?: number;
    maxBudget?: number;
    log?: (msg: string) => void;
    navEngine?: 'classic' | 'v2'; // forwarded on every baked repath
    avoidZones?: WalkOptions['avoidZones']; // forwarded on every baked repath
}): Promise<boolean>

Traversal.preload(): void      // warm the nav worker before the first walk
Traversal.remaining(): number  // path tiles left in the active walk
```

`Traversal.walkTo` web-walks the whole world (A\* over the collision pack + door/
transport graph, opens doors, recovers from stuck). Resolves `false` on
timeout/no-path; unwalkable destinations snap to the nearest reachable tile.
There is **one** walker stack: live **WorldState** (skills, quests, inventory, members)
gates skill doors, tolls, and quest transports for both modes. **v2** only adds spell/
jewellery tele inject and path-scoped bank for runes/tolls. See
[One walker, two modes](NAV.md#one-walker-two-modes-classic--v2) and
[`docs/nav-v2/`](nav-v2/README.md).

**Essence mine (session multiloc):** multi-entry, **same-origin exit only**. Exit
portals share one loc type but telejump to the wizard you entered with
(`%exit_essence_mine_coord`). That varp is **not** sent to the client — the bot
tracks return on `EssenceSession` when an entry hop succeeds, and PathFinder
carries the same return in the A\* key so nav **never routes a surface path
through the mine** as a free teleport between wizards. Scripts that enter via
NPC without the walker should call `__rs2b0t.EssenceSession.noteEntryFromNpc('Aubury')`
(or `noteEntry('aubury')`) after a successful teleport.

**Loc placement (`locRef`):** transport/door edges refer to scenery by placement
(tile + optional loc id / open id). Helpers in `nav/v2/locRef.ts` match live locs
and probe validity (including already-open barriers).

`walkResilient` wraps the same pathfinder in an escalation ladder — **use it for
script bank runs and long unattended walks**. Pass `avoidZones: ['white-wolf-mountain']`
(or ad-hoc rects) so low-level accounts skip wolf-heavy corridors; off by default.
See [Danger zones](NAV.md#danger-zones-optional-avoid) for catalog + pack verification.

For same-scene clicks, `DirectNavigator.walk(dest)` / `walkTo(dest, radius?,
timeoutMs?)` are available, but prefer `Traversal.walkTo` / `walkResilient`.

```ts
if (!await Traversal.walkResilient({ x: 2662, z: 3305, level: 0 }, { radius: 0 })) {
    this.log('could not reach the stall');
}

// Skip White Wolf Mountain on a long unattended walk
await Traversal.walkResilient(catherby, {
    radius: 2,
    avoidZones: ['white-wolf-mountain'],
});
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
interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
    options?: string[];   // persisted dropdown/multi-select values
    optionLabels?: Record<string, string>; // optional user-facing label by option value
    group?: string;       // panel group heading
}
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
        rock:  { type: 'string', default: 'Copper rocks', label: 'Rock', options: ['Copper rocks', 'Tin rocks'] },
        power: { type: 'boolean', default: false, label: 'Power mine (drop ore)' },
        // or spread PERIODIC_BANK_SETTINGS into combat scripts
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

## World catalogs

Reusable data tables and pure helpers for out-of-tree scripts. These are the same
catalogs the bundled Fisher / Miner / Woodcutter / Thiever / WalkTo bots use —
import them from `@rs2b0t/api` rather than hard-coding tiles.

### Bank locations

Known bank stands and openers. Prefer [`Banking.open`](#banking) for the walk +
open; use this catalog when you need the nearest stand or a named bank tile.

```ts
interface BankLocation {
    name: string;
    tile: Tile;
    requires?: { skill?: { name: string; level: number }; quest?: string };
    access?: BankObjectAccess;   // chest / open-first banks
}

BANK_LOCATIONS: BankLocation[]
bankDistance(from, bank): number          // Euclidean, same plane
nearestBank(from): BankLocation | null    // unlocked for this account
nearestUsableBank(from, usable): BankLocation | null
bankUnlocked(bank): boolean               // quest/skill gates
```

```ts
import { BANK_LOCATIONS, nearestBank, Banking } from '@rs2b0t/api';

const bank = nearestBank(Game.tile()!);
if (bank) await Banking.open({ stand: bank.tile });
```

### Tools

Axe / pickaxe tiers and kit math for gathering scripts.

```ts
type ToolReq =
  | { kind: 'tiered'; skill; tiers: ToolTier[]; label; equip? }
  | { kind: 'exact'; name; min?; restock?; equip? };

PICKAXES / AXES: readonly ToolTier[]   // best-first (rune → bronze)
TINDERBOX / HAMMER / KNIFE / CHISEL / NEEDLE

pickaxeReq(equip?) / axeReq(equip?) / exactTool(name, opts?) / tinderboxReq()
bestPickaxe(level, available) / bestAxe(level, available)
bestFromTiers(level, tiers, available)
toolRestockPlan(reqs, skillLevel, invCount, bankCount)
hasAllTools / missingToolLabels / toolKeepNames / toolKitLabel
toolsNeedingEquip / bestHeldToolNames / surplusHeldToolNames
bankHasBetterGatherTool / canWieldTool / toolAttackLevel
```

### Tool acquire (planning)

Pure planners for buy / repair / smith routes. **Plans only** — scripts still
execute the walk, bank, and shop steps (see GatheringBot).

```ts
type ToolAcquireMode = 'off' | 'on'
parseToolAcquireMode(raw)
TOOL_ACQUIRE_SETTING / FORGETFUL_BANK_SETTING   // settingsSchema fragments
BOB_VENDOR / NURMOF_VENDOR / GERRANT_VENDOR / HARRY_VENDOR
PICKAXE_SHOP_COSTS / AXE_SHOP_COSTS / FISHING_SHOP_COSTS
AXE_SMITH_LEVEL / AXE_BAR_FOR / VARROCK_ANVIL_STAND

type ToolAcquirePlan =
  | { kind: 'repair'; brokenName; label; vendor; prefer }
  | { kind: 'buy'; name; cost; qty; vendor; equip; reason }
  | { kind: 'smith'; name; bar; smithLevel; vendorBank; anvilStand; equip; reason }

planGatherToolAcquire(reqs, world, { upgrade })
planPickaxeAcquire / planAxeAcquire / planBrokenToolRepair
planFishingGearBuys / fishingGearShopCart / planFishingGearAcquire
canFundPlan / coinsToWithdraw / acquireKeepNames
```

`AcquireWorld` is a pure snapshot interface (`skillLevel`, `heldCount`,
`invCount`, `bankCount`, `worn`) — no client calls inside the planner.

### Gathering locations

Shared camp model for Fisher / Miner / Woodcutter.

```ts
interface GatheringLocation {
    name; spot: Tile; bankStand: Tile; verified: boolean;
    boothName?; boothOp?; obstacles?; resources?; notes?;
}

// resolution: "None" → null; named → match; "Auto" → nearest camp in the same
// 64×64 map square as startTile (else freeform null)
resolveGatheringLocation(setting, startTile, table)
locationOptions(table)            // ['Auto', …names, 'None']
boothFields(loc) / sameMapSquare / MAP_SQUARE / DEFAULT_BOOTH_*

FISHING_LOCATIONS / resolveFishingLocation / FISHING_LOCATION_OPTIONS
MINING_LOCATIONS / resolveMiningLocation / MINING_LOCATION_OPTIONS
WOODCUTTING_LOCATIONS / resolveWoodcuttingLocation / WOODCUTTING_LOCATION_OPTIONS
```

### Fishing methods & mining rocks

```ts
FISHING_METHODS / resolveFishMethod / FISHING_METHOD_OPTIONS
gearKeepNames / hasFishingGear / missingFishingGear / fishingRestockPlan
spotMatchesMethod(actions, method) / WHIRLPOOL_IDS

ROCK_TYPES: Record<oreName, locIds[]>
ROCK_OPTIONS / resolveRockIds(names)
GAS_ROCK_IDS / GAS_ROCK_TICKS / BROKEN_PICKAXE
```

### Walk destinations

City / bank presets used by WalkTo and the map picker.

```ts
WALK_DESTINATIONS / WALK_OPTIONS / resolveDestination(name)
```

### Pickpocket targets

```ts
PICKPOCKET_TARGETS: { name; level }[]
PICKPOCKET_TARGET_NAMES
ARDOUGNE_PICKPOCKET_TARGETS   // Guard / Knight / Paladin / Hero
```

### Cow locations & rune craft routes

```ts
COW_LOCATIONS / resolveCowLocation / nearestCowLocation / COW_LOCATION_OPTIONS
needsTollCoins / shouldBootstrapTollCoins / AL_KHARID_BANK / TOLL_COIN_TARGET

RUNES: Record<string, RuneRoute>   // rune, talisman, level, bank name, ruins tile
RUNE_OPTIONS / DEFAULT_RUNE
```

```ts
import {
    resolveMiningLocation,
    pickaxeReq,
    planGatherToolAcquire,
    PICKPOCKET_TARGET_NAMES,
} from '@rs2b0t/api';
```

---

## Item acquisition

Higher-level helpers for "make sure I have these items":

```ts
type ItemNeed = { name: string; count: number; source: ItemSource };

held(name: string): number          // count of an item across backpack slots (worn gear NOT included)
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

---

## See also

- [Manual index](README.md)
- [Running locally](RUNNING.md) — getting a client up to run these against
- [World-walking](NAV.md) — what `Traversal.walkTo` does underneath
- [Bundled scripts](SCRIPTS.md) — 36 worked examples
- [`templates/script-template/`](../templates/script-template/) — an out-of-tree starter
