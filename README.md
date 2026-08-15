# rs2b0t — a scriptable bot client for 2004scape / Lost City servers

rs2b0t is a TypeScript botting client for 2004-era RuneScape private servers. It renders
the game client in the browser and drives it through a typed scripting API. Bots
call the client's own `doAction` and `tryMove` instead of synthesising input or reading
the screen, so a bot's packets match a human click byte for byte.

| | |
|---|---|
| Revision | 274 (~2004 era client and content) |
| Supported target | [rs2b2t](https://rs2b2t.com), a 2004scape anarchy fork |
| Local dev engine | [LostCityRS](https://github.com/LostCityRS) Engine-TS + Content, branch 274 |
| Unsupported targets | the pure Lost City and 2004scape projects |
| Hosted client | https://w1.rs2b2t.com/rs2b0t |
| Hosted MultiBox wall | https://w1.rs2b2t.com/rs2b0t/wall |
| Project site | [2004bot.com](https://2004bot.com) |
| Manual | [docs/README.md](docs/README.md) |
| License | [MIT](LICENSE) |

Log in with an rs2b2t account, pick a script, run. Keep the tab visible — a backgrounded
tab is throttled by the browser, which starves every bot in it.

## What it does

| | |
|---|---|
| Typed scripting API | `@rs2b0t/api`: game state, entity queries, inventory, bank, shop, skills, dialogue, world-walking, events |
| Bot base classes | `LoopingBot`, priority `TaskBot`, `TreeBot` behaviour tree |
| World-walking | A\* over a baked collision pack plus a door and transport graph, with stuck recovery, teleports and multi-level routing |
| Quests | pure `decide(snapshot) → step` modules |
| Clues | easy, medium and hard trails, including puzzle boxes and dig guardians |
| Unmodified client | bots drive the client's own `doAction` and `tryMove`, so packets match a human click byte for byte |
| Outcome checking | every action is verified against game state before the bot proceeds |
| In-client panel | script library, per-script parameters, live logs, `onPaint` HUD overlay |
| Out-of-tree scripts | compile against `@rs2b0t/api` in your own repo and load by URL |

## Documentation

| If you want to | Read |
|---|---|
| Write a bot | [Scripting API](docs/API.md), then [`docs/script-template/`](docs/script-template/) |
| See what already exists | [Bundled scripts](docs/SCRIPTS.md) — 52 bots, generated from the registry |
| Run it locally | [Running locally](docs/RUNNING.md) |
| Change the client itself | [Architecture](docs/ARCHITECTURE.md), then [Testing](docs/TESTING.md) |
| Maintain the deployment | [Dev and deploy](docs/DEV.md) |

## Quick start

Requires [Bun](https://bun.sh), Node 24+, and a local game engine to deploy into.

1. `bun install`
2. `./tools/deploy-local-key.sh /path/to/engine`
3. Open that engine's `/bot.html`, log in, pick a script.

Step 2 derives the engine's RSA modulus and exponent from `data/config/private.pem` and
passes them to the build. Skipping it ends in login code 6, because a fresh upstream
engine's key differs from the hosted build's.

[docs/RUNNING.md](docs/RUNNING.md) covers the path from a cold clone.

## Writing a bot

```ts
import { defineBot, Execution, Game, LoopingBot } from '@rs2b0t/api';

class MyBot extends LoopingBot {
    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
    }

    async loop(): Promise<void> {
        // one pass; await an Execution wait, never setTimeout
    }
}

export default defineBot({ name: 'MyBot', description: '…', create: () => new MyBot() });
```

Copy [`docs/script-template/`](docs/script-template/) to start an out-of-tree
bot. The same example ships in-tree as
[`src/bot/scripts/BoneBurier/BoneBurier.ts`](src/bot/scripts/BoneBurier/BoneBurier.ts).

## How it connects

The bundle bakes a server target. `local` and `prod` talk same-origin to whatever origin
served the page; `live` targets the world host through a local reverse proxy. See
[build targets](docs/reference/build-targets.md).

## Questions

| | |
|---|---|
| Does it work with Lost City or 2004scape? | It builds against that engine family for local development, and the collision pack is generated from whatever engine you deploy into. Only rs2b2t is tested and supported. |
| Does it move the mouse or read pixels? | Bots call the client's own action dispatch and read state through a typed adapter. |
| Do I have to fork the repo to write a bot? | No. Compile against `@rs2b0t/api` and load the bundle by URL. |
| Which RuneScape revision is this? | 274. |
