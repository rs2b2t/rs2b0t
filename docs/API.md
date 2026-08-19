[Manual](README.md) › Scripting API

# Scripting API

`@rs2b0t/api` is the surface external scripts compile against. It reads the ABI the
client installs at `globalThis.__rs2b0t` and throws if the versions do not match.

## Pages

| Page | Covers |
|---|---|
| [Write a bot](how-to/write-a-bot.md) | getting started, and a full worked example |
| [Bots](reference/api-bots.md) | `LoopingBot`, `TaskBot`, `TreeBot`, `Execution`, `defineBot` |
| [Paint](reference/api-paint.md) | the overlay HUD: tabs, scrolling lists, wrapping, docking |
| [Game](reference/api-game.md) | `Game`, camera, world primitives |
| [Entities](reference/api-entities.md) | queries, entity shapes |
| [Items](reference/api-items.md) | inventory, equipment, bank, acquisition |
| [Banking helpers](reference/api-banking.md) | deposit rules, keep lists, bank trips |
| [Skills](reference/api-skills.md) | `Skills`, `Prayer` |
| [Dialogue and trade](reference/api-dialogue.md) | `ChatDialog`, `Shop`, `Trade` |
| [Movement](reference/api-movement.md) | walking, nav teleports |
| [Quests](reference/api-quests.md) | the quest surface |
| [Events and settings](reference/api-events.md) | the event bus, script settings |
| World catalogs [1](reference/api-catalogs.md), [2](reference/api-catalogs-2.md) | banks, spells, drops, shops, clues |
