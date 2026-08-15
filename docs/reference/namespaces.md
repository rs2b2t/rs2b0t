[Manual](../README.md) › [Architecture](../ARCHITECTURE.md) › Namespaces

# Namespaces

`src/bot/` follows OSBot's [`org.osbot.rs07`](https://osbot.org/api/) package split.

| Directory | Holds | OSBot counterpart |
|---|---|---|
| `adapter/` | `ClientAdapter` — the only place that names client internals | — |
| `api/` | one directory per game-facing noun | `api` |
| `api/ai/` | quests and clues: activities with requirements and outcomes | `api.ai.activity`, `api.ai.domain` |
| `api/model/` | `Npc`, `Player`, `Loc`, `GroundItem`, `Interactable` | `api.model` |
| `api/map/` | walk destinations, teleports, region predicates | `api.map` |
| `api/ui/` | the *game* interface: widgets, dialogue, quest log | `api.ui` |
| `data/` | inert catalogs | `api.def`, `api.map.constants` |
| `event/webwalk/` | the pathfinder, walker and transport graph | `event.webwalk` |
| `geometry/` | `Tile`, `Area`, distance | `api.map` |
| `input/` | the one input driver | `input` |
| `multibox/` | many clients in one tab | — |
| `paint/` | canvas overlays | `canvas.paint` |
| `panel/` | the bot's own control UI | — |
| `runtime/` | script lifecycle, ABI, settings, random-event solvers | `script` |
| `scripts/` | one directory per contribution | — |

## Membership rules

| Directory | A module belongs there iff |
|---|---|
| `api/` | it is a facade over one game interface, one entity collection, or one reusable script behaviour |
| `data/` | it is a table, or a pure resolver over one |
| `scripts/` | one author ships it as part of one contribution |

`api/` excludes catalogs and sole-consumer helpers. One directory per noun, sized
to that noun; single-file directories are expected.

A `scripts/` directory is one contribution, which may register several scripts
over shared code. A contribution never imports a sibling — code two of them need
belongs in the layer that describes it, not in whichever needed it first. See
[import fences](import-fences.md).

## Departures from OSBot

| Here | OSBot | Why |
|---|---|---|
| `runtime/` | `script` | a singular `script` folder beside `scripts/` reads the same at a glance; OSBot avoids the clash because user scripts live outside its tree |
| `panel/` | — | OSBot's `api.ui` is the game interface. The bot's own control UI has no counterpart, and naming it `ui/` collided with `api/ui/` |
| `data/`, `geometry/` top-level | `api.def`, `api.map` | ESLint cannot re-include a path under an excluded parent, so either one under `api/` voids the data-inert fence |

## See also

- [Architecture](../decisions/architecture.md)
- [Import fences](import-fences.md)
