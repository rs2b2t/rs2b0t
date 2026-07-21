# rs2b0t

A scriptable, direct-input bot client for **[rs2b2t](https://rs2b2t.com)** — a
2004scape (Lost City) anarchy server. rs2b0t renders the real game client in the
browser and drives it through a typed scripting API, so bots see and act on
exactly what a player would.

A single-instance build is hosted at **https://w1.rs2b2t.com/rs2b0t** — open it,
log in with an rs2b2t account, pick a script, and run.

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

- **[Writing scripts — API reference](docs/API.md)** — the full `@rs2b0t/api`
  surface with examples.
- **[Development & run modes](docs/DEV.md)** — build targets, running against a
  local engine or live, and the hosting pipeline.

## Quick start (local development)

Requires [Bun](https://bun.sh) and a local rs2b2t engine.

```bash
bun install
bun run build:bot         # build the bot client bundle
sh tools/deploy-local.sh  # deploy the client into a local engine's public/
```

Then open the local engine's `/bot.html`, log in, and pick a script from the
library. See **[docs/DEV.md](docs/DEV.md)** for the three run modes (local,
against-live via proxy, and the hosted prod build).

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

`src/bot/scripts/` ships example bots across combat (ChickenKiller, RockCrab,
MossGiant, GreenDragon, ArdyFighter, AutoFighter), thieving (ArdyThiever,
ArdyCakes, stall/pickpocket), skilling (gathering presets for mining, fishing,
woodcutting; cooking, smelting, smithing, bank-standing fletching, flax,
rune-essence mining, agility), shop running, clue solving (easy + medium
trails), and quests (the AIOQuester quest engine + QuestDashboard, tutorial),
plus navigation and banking utilities. They double as worked examples of the
API.

## Project structure

```
src/
  bot/
    api/          the scripting API surface (Game, entities, hud, movement, ...)
    runtime/      the ABI, script runner/registry, settings
    scripts/      bundled example bots
    nav/          world-walking (collision pack, door/transport graph, A*)
    ui/           the in-client panel + overlay
  client/         the 2004scape browser client
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
