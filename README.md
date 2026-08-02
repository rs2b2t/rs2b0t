# rs2b0t

A scriptable, direct-input bot client for **[rs2b2t](https://rs2b2t.com)** (era
~2004 anarchy). rs2b0t renders the real game client in the browser and drives it
through a typed scripting API, so bots see and act on exactly what a player would.

**Target:** **rs2b2t only.** This project is **not** an official or supported client
for the pure Lost City or 2004scape projects, and it is not maintained for those
targets.

Project site: **[2004bot.com](https://2004bot.com)** — overview, screenshots, and
rendered [API](https://2004bot.com/docs/api) / [dev](https://2004bot.com/docs/dev) docs.

A single-instance build is hosted at **https://w1.rs2b2t.com/rs2b0t** — open it,
log in with an rs2b2t account, pick a script, and run. To run several accounts in
one tab, use the MultiBox wall at **https://w1.rs2b2t.com/rs2b0t/wall** (keep the
tab visible; a backgrounded tab is throttled by the browser).

## Highlights

- **Typed scripting API** (`@rs2b0t/api`) — write bots in TypeScript against a
  stable, versioned surface: game state, entity queries, inventory/bank/shop,
  skills, dialogs, world-walking, and events.
- **Bot base classes** for the common shapes — a simple `loop()`, a
  priority `TaskBot`, or a `TreeBot` behaviour tree.
- **World-walking** — A\* pathfinding over a baked collision pack + a door and
  transport graph, with stuck-recovery.
- **Real client, no forged packets** — bots drive the real client's own action
  dispatch (`doAction`/`tryMove`), so interaction packets are byte-identical to a
  human click; there's no synthetic mouse input, and outcomes are verified
  against game state.
- **In-client panel** — a script library, per-script parameters, live logs, and
  an overlay for `onPaint` HUDs.
- **Out-of-tree scripts** — author a bot in its own repo against `@rs2b0t/api`
  and load it by URL, no fork required.

## Documentation

**[The manual](docs/README.md)** is the entry point. The pages you probably want:

- **[Running locally](docs/RUNNING.md)** — getting an engine, deploying the client,
  tests, lint, smoke harnesses.
- **[Writing scripts — API reference](docs/API.md)** — the full `@rs2b0t/api`
  surface with examples.
- **[Development & run modes](docs/DEV.md)** — build targets, running against a
  local engine or live, and the hosting pipeline.

## Quick start (local development)

Requires [Bun](https://bun.sh), Node 24+, and a compatible local game engine to
deploy into (for development — production use is against **rs2b2t**).

```bash
bun install
ENGINE_DIR=/path/to/engine sh tools/deploy-local.sh
```

Then open that engine's `/bot.html`, log in, and pick a script from the library.

**[docs/RUNNING.md](docs/RUNNING.md)** walks the whole path from a cold clone —
including getting an engine, the login-key mismatch that otherwise ends in login
code 6, and how to run the tests.

## Writing a bot

Bots subclass a base class and are registered with `defineBot`. A minimal
looping bot:

```ts
import { defineBot, Execution, Game, GroundItems, Inventory, LoopingBot } from '@rs2b0t/api';

class BoneBurier extends LoopingBot {
    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
        this.log('started');
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
            await ground.interact('Take');
        }
        await Execution.delayTicks(2);
    }
}

export default defineBot({
    name: 'BoneBurier',
    description: 'Loots and buries nearby bones',
    create: () => new BoneBurier()
});
```

A ready-to-copy starter lives in [`templates/script-template/`](templates/script-template/).
See the **[API reference](docs/API.md)** for the complete surface.

## Bundled scripts

`src/bot/scripts/` ships 38 bots across combat, thieving, skilling, shop running,
clue solving, and quests, plus navigation and banking utilities. They double as
worked examples of the API.

**[docs/SCRIPTS.md](docs/SCRIPTS.md)** is the full catalog with every script's
settings — it is generated from the registry, so it cannot drift.

## Project structure

```
src/
  bot/
    api/          the scripting API surface (Game, entities, hud, movement, ...)
    runtime/      the ABI, script runner/registry, settings
    scripts/      bundled example bots
    nav/          world-walking (collision pack, door/transport graph, A*)
    ui/           the in-client panel + overlay
  client/         the era browser client
  config/         build-time server target (local | live | prod)
packages/
  rs2b0t-api/     the @rs2b0t/api shim external scripts compile against
templates/
  script-template/ starter for an out-of-tree bot
tools/            build/deploy scripts + headless test harnesses
docs/             API.md, DEV.md
```

## How it connects

The client resolves its game server from the build target
(`src/config/target.ts`): `local` and `prod` talk **same-origin** to whatever
origin served the page; `live` targets the world host directly (used with a
local reverse proxy for development). The hosted `prod` build is baked into the
engine image and served same-origin from the game server — no proxy.

## License

[MIT](LICENSE).
