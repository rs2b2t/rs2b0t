[Manual](../README.md) › [Scripting API](../API.md) › Bots

# Bots

## Bot base classes

All bots extend `AbstractBot` (usually via `LoopingBot`, `TaskBot`, or
`TreeBot`).

### Lifecycle hooks

```ts
abstract class AbstractBot {
    loopDelay: number;                 // legacy pacing; 600 = one server tick (see loopCadence)
    loopCadence: LoopCadence | null;   // optional explicit frame | server-tick | time
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
- `onPaint` draws the overlay HUD; its widgets are in [Paint](api-paint.md).
- Event callbacks (`this.on`) fire mid-frame: set flags or `log`, and keep the work in `loop()`.

### LoopingBot

The common case: implement `loop()`. Return a number to override pacing for the
next iteration (`0` = next frame, `600` = next server tick, other = wall-clock ms).
Set `loopCadence` on the bot for an explicit `{ kind: 'frame' | 'server-tick' | 'time' }`
policy (see #427).

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

## See also

- [Scripting API index](../API.md)
