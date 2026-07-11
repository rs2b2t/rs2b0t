# SmelterBot — Al Kharid smelter — design

**Date:** 2026-07-10
**Status:** approved (design), pending spec review
**Category:** Smithing

## Goal

A settings-driven **smelting** bot that runs the classic Al Kharid
bank↔furnace loop: withdraw a pack of ore, smelt it into bars at the Furnace,
bank the bars, repeat. Supports **all eight bars**, including the coal-ratio
ones (steel/mithril/adamant/rune).

## Why this shape

Smelting is mechanically identical to CookBot's cook-and-bank loop, so
SmelterBot is a near-clone of `src/bot/scripts/CookBot.ts`.

The key content fact (verified in `rs2b2t-content/scripts/skill_smithing/scripts/smelting/smelting.rs2`):
**using the primary ore on the "Furnace" loc smelts exactly one bar and the
server consumes the whole recipe.** The `oplocu` handler routes a single ore
through `smelt_ore_single` → `smelt_ore_weakqueue($bar, 1, …)`, and the
`smelting_ore` queue does `inv_del(primary, bar_count)` **and**
`inv_del(secondary, secondary_count)` (the coal). So we never touch the custom
`if_openchat(smelting)` bar-selection interface — we just `useOn` the ore, one
bar at a time, exactly like CookBot cooks one fish at a time.

Bar type is disambiguated purely by pack contents: `smelt_ore_single` smelts
iron→steel only when coal (≥2) and smithing≥30 are present, else iron→iron.
Our withdraw plan controls exactly what's in the pack, so it fully determines
the bar produced. **The item we `useOn` the furnace is always the primary
(non-coal) ore.**

## New files

- `src/bot/scripts/SmelterBot.ts` — `TaskBot`, registered `'SmelterBot'`,
  category **Smithing**.
- `src/bot/scripts/SmelterBotLogic.ts` — pure, client-free: the recipe table +
  withdraw math + ore-counting helpers (mirrors `CookBotLogic.ts`).
- `test/bot/scripts/SmelterBotLogic.test.ts` — unit tests for the recipe/withdraw
  math (path mirrors the existing `CookBotLogic` test location).
- `tools/smelter-test.ts` — headless live smoke.

Registration follows the existing pattern in `src/bot/scripts/index.ts`.

## Recipe table (`SmelterBotLogic.ts`)

Each bar maps to a recipe: the primary ore, coal count, minimum smithing level,
and the display substrings used to resolve exact bank names. `setsPerTrip` =
`floor(28 / (1 + coalPer))`; the withdraw plan pulls `sets` primary ore +
`sets × coalPer` coal.

| Bar | Primary ore | Coal/bar | Sets/trip | Withdraw per trip |
|---|---|---|---|---|
| Bronze | Copper ore (+ Tin ore 1:1) | 0 | 14 | 14 copper + 14 tin |
| Iron | Iron ore | 0 | 28 | 28 iron |
| Silver | Silver ore | 0 | 28 | 28 silver |
| Steel | Iron ore | 2 | 9 | 9 iron + 18 coal |
| Gold | Gold ore | 0 | 28 | 28 gold |
| Mithril | Mithril ore | 4 | 5 | 5 mithril + 20 coal |
| Adamant | Adamantite ore | 6 | 4 | 4 adamant + 24 coal |
| Rune | Runite ore | 8 | 3 | 3 runite + 24 coal |

**Bronze is special:** two 1:1 primary ores (copper + tin), no coal. Modelled
as a recipe with a `secondary` primary-ratio ore rather than coal. The generic
representation is: a list of `{ ore, perBar }` ingredients; `setsPerTrip =
floor(28 / sum(perBar))`. The item we `useOn` the furnace is the **first**
ingredient (copper for bronze, iron for steel).

Ore/bar names are matched by substring against `Bank.items()` / `Inventory.items()`
exactly as CookBot resolves its fish name (labels/ops read off the real item —
never hardcoded — because a wrong `Withdraw All` label silently withdraws
nothing).

Pure functions to unit-test:
- `RECIPES` table (bar → ingredients, level).
- `setsPerTrip(recipe)` and `withdrawPlan(recipe)` → `[{ ore, count }]`.
- `primaryOre(recipe)` — the ingredient to `useOn` the furnace.
- `countPrimary(items, recipe)` / `lastPrimaryIndex(items, recipe)` — mirror
  `countRaw`/`lastRawIndex`.

## Settings

| Key | Type | Default | Notes |
|---|---|---|---|
| `bar` | string (dropdown) | **Bronze** | options = the 8 bar names |
| `bankStand` | tile | `3269, 3167` | Al Kharid bank |
| `furnaceStand` | tile | `3276, 3186` | east of the furnace (`forceapproach=east`) |
| `furnaceName` | string | `Furnace` | loc name |
| `obstacle` | string | `door, gate` | bank-building door on the route |
| `leashRadius` | number | 8 | furnace search radius |

`bar` uses `type: 'string'` + `options` (the same dropdown mechanism as the
Global `lampSkill` setting).

## Tasks (priority order, `TaskBot`)

1. **ContinueDialog** — dismiss "Click to continue" (level-ups, and the
   "too impure" mesbox on an iron-smelt fail).
2. **BankTrip** — validate: primary-ore count `== 0`. Walk to `bankStand`
   (`walkOpening` opening the bank door), open the booth, deposit everything,
   then withdraw the ore mix per `withdrawPlan`. Reads the real `Withdraw All`
   op off each ore's own `ops`, resolving the exact bank name by substring.
   **Out-of-ore → stop:** if any ingredient the plan needs is absent (or the
   bank can't supply a full set), log which ore ran out and call
   `ScriptRunner.stop()` (as `StallGuard` does) — a clean stop, no idle spin.
3. **SmeltTrip** — validate: primary-ore count `> 0`. Walk to `furnaceStand`,
   then `useOn` the **last primary ore** on the nearest `Furnace` loc within
   `leashRadius`, one bar at a time, until the primary ore is exhausted. Waits
   each iteration for the primary count to drop (bar smelted, or iron-fail
   consumed the ore) or a dialog to appear.

Progress is tracked by watching the **primary-ore count decrease** — this is
correct even for iron's 50% failure (the ore is `inv_del`'d before the fail
roll, so the count drops either way).

## onPaint HUD

Status line + bars smelted + trips + primary-ore remaining + tick, matching
CookBot's overlay.

## Testing

**Unit** (`bun test`): the recipe/withdraw math — `setsPerTrip`,
`withdrawPlan` totals ≤ 28 per bar, `primaryOre`, and the count/last-index
helpers over synthetic inventories (incl. bronze's two primary ores and steel's
iron+coal mix).

**Live (headless)** — `tools/smelter-test.ts`, following the repo's proven flow
(`rs2b0t.runner.start(registry.get('SmelterBot'))`, read `runner.ctx.log`):
1. Seed ore into the bank via the `::~bankitem` cheat
   (`::~bankitem copper_ore 5000`, `::~bankitem tin_ore 5000`, and the coal/steel
   set), tele to Al Kharid, run.
2. Assert a full **bronze** cycle: withdraw 14+14 → bars appear → rebank → refill.
3. Assert a **steel** cycle (exercises the coal ratio) and a single-ore
   (**gold**) cycle.
4. Assert the **out-of-ore stop**: empty the tin, confirm the bot logs the
   shortage and the runner stops.

## Non-goals (YAGNI)

- The custom `smelting` bar-selection interface / make-X batch smelting (the
  one-bar-per-`useOn` path is uniform and robust for all bars).
- Ring of forging, goldsmith gauntlets, cannonballs, gold-bar jewelry crafting.
- Mining the ore (this is bank-fed only).
- Web-walking to Al Kharid from elsewhere (start it at the bank, like CookBot).
