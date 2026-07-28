# rs2b0t manual

How the client works, how to run it, and how to write bots for it.

## Start here

| If you want to… | Read |
|---|---|
| Write a bot | [Scripting API](API.md), then [`templates/script-template/`](../templates/script-template/) |
| See what already exists | [Bundled scripts](SCRIPTS.md) |
| Run it locally | [Running locally](RUNNING.md) |
| Change the client itself | [Architecture](ARCHITECTURE.md), then [Testing](TESTING.md) |
| Maintain the deployment | [Dev and deploy](DEV.md) |

## Pages

| Page | Covers |
|---|---|
| [Running locally](RUNNING.md) | prerequisites, getting an engine, deploying the client, tests, lint, smokes |
| [Architecture](ARCHITECTURE.md) | the layers, the fences, the ABI boundary, how a call becomes a packet |
| [Scripting API](API.md) | the complete `@rs2b0t/api` surface, with examples |
| [World-walking](NAV.md) | the collision pack, pathfinding, doors, transports, arrival |
| [Quests](QUESTS.md) | the quest engine, quest modules, exec primitives, provisioning |
| [Clue scrolls](CLUES.md) | the clue database, step kinds, tool acquisition, tracing |
| [MultiBox](MULTIBOX.md) | the wall: slots, profiles, login coordination, telemetry |
| [Bundled scripts](SCRIPTS.md) | catalog of the shipped bots and their settings (generated) |
| [Testing](TESTING.md) | unit tests, the live-harness ABI, the end-to-end smoke |
| [Dev and deploy](DEV.md) | build targets, the three run modes, the hosting pipeline |

---

`docs/superpowers/` holds design specs and implementation plans. Those are historical
records of decisions, not part of this manual.
