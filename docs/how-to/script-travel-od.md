[Manual](../README.md) › [World-walking](../NAV.md) › Script travel OD

# Script travel OD


**Live harness:** `e2e/nav-script-travel-live.ts`  
**Corpus builder:** `tools/nav/script-travel-corpus.ts`

Legs are **built in-process** at harness start via `buildTravelRoutes()` (not
loaded from a baked product path graph). Optional JSON dump is for inspection
only (`tools/nav/script-travel.generated.json`, gitignored).

#### Regenerate / inspect corpus

```bash
# Counts per SEGMENT (and total)
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --stats

# Sample first 40 leg ids + notes
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --list
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --segment=clues --list

# Write tools/nav/script-travel.generated.json (optional; harness does not require it)
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --write
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --segment=fishing --write
```

Requires `out/collision.lcnav.gz` for **walkable endpoint snap** (see below). Without
the pack, routes still build but anchors may land on solid locs.

#### How each SEGMENT chooses paths

| `SEGMENT=` | Sources | How directed legs are formed |
|---|---|---|
| **clues** | `CLUE_DB` coords (rows with `coord`), `TALK_ANCHORS`, `KILL_ANCHORS`, `NAV_TARGETS` where `bot === ClueSolver` (non-island) | Cap to **80** evenly sampled points → **ordered chain** (each → next + reverse) + **k=3 nearest-neighbor** mesh (one-way nn edges). Ids: `clues-chain-*`, `clues-nn-*`. |
| **fishing** / **mining** / **woodcutting** | `FISHING_LOCATIONS` / `MINING_LOCATIONS` / `WOODCUTTING_LOCATIONS` | Per camp: **spot ↔ bank** (and spot → range / range → bank if `rangeStand`). **Cross-camp:** consecutive table rows only (not full mesh). |
| **firemaking** | `FIRE_SPOTS` bank pins | Full directed mesh bank_i → bank_j (i ≠ j). |
| **cooking** | `FISH_CAMP_COOK_PLANS` pier/bank stands; sample of `COOKING_RANGE_LOCS` | Pier ↔ bank per camp; chain every 8th range loc (max 24 samples). |
| **gathering-all** | All of the above gathering flags + residual `NAV_TARGETS` (not ClueSolver / AIOQuester / island) | Filter: `r.gathering \|\| segment === gathering-all`. Residual nav targets: consecutive chain only. |
| **quests** | Every `new Tile(x, z[, level])` in `src/bot/api/ai/quests/defs/**/areas.ts` (and single-file quests with ≥2 tiles) | **Consecutive pairs in source order** within each file, plus reverse. Not full quest mesh; not full quest state (transport varps only when `SEED_QUESTS` / `SEGMENT=quests`). Ids: `quest-<name>-i-j`. |
| **all** | Union of every segment | No filter. |

Shared rules on every leg (`add`):

- Drop same-tile from/to, tutorial-island-ish pins, level delta **> 2**.
- **Dedupe** directed `from→to` keys (first wins).
- **Walkable snap:** both ends run through `PathFinder.snapWalkable` (radius 3) so
  search furniture / dig spots / rocks are not used as tele origins. Live
  `teleArrive` also re-teles onto a walkable stand if scene flags say the anchor
  is solid.

This is **endpoint OD stress**, not “replay the product’s planned clue trail.”
Product chooses paths via `Traversal.walkTo` / pathfinder on each leg after the
harness cheat-teles to `from`.

#### Live env (operator)

```sh
# Pure walk (no tele policy, runes only — no jewellery kit)
HEADED=0 SEGMENT=clues LIMIT=40 BUDGET_S=120 USE_TELEPORTS=0 bun e2e/nav-script-travel-live.ts

# Tele + charged jewellery seed/top-up
HEADED=0 SEGMENT=gathering-all LIMIT=0 BUDGET_S=240 USE_TELEPORTS=1 bun e2e/nav-script-travel-live.ts

HEADED=1 SEGMENT=fishing LIMIT=0 bun e2e/nav-script-travel-live.ts
HEADED=1 SEGMENT=quests LIMIT=50 OFFSET=0 bun e2e/nav-script-travel-live.ts
```

| Env | Role |
|---|---|
| `SEGMENT` | Filter above (default `all`) |
| `LIMIT` | Max legs after `OFFSET` (`0` = all; default **25** for safety) |
| `OFFSET` | Skip first N legs (chunk long segments) |
| `USE_TELEPORTS` | `0` = pure walk; default on = tele policy + kit seed |
| `BUDGET_S` | Per-leg walk timeout seconds (default 240) |
| `SEED_QUESTS` | Force transport-quest varp seed (also on when `SEGMENT=quests`) |
| `PATH_PAINT` | Path paint defaults on; set `0` to disable |
| `STUCK_ABORT` | Default **on** — per-leg early stop when wall time ≫ path-cost estimate **and** no tile move (door thrash / pathfind loop). Not a suite kill. `STUCK_ABORT=0` to disable. |
| `STUCK_FACTOR` | Multiplier on est wall time (default **2.5**) |
| `STUCK_MIN_S` | Min elapsed before stuck kill (default **20**) |
| `STUCK_NOMOVE_S` | Min seconds without tile change (default **12**) |
| `HARNESS_SUITE_ABORT` | Default **on** — stop the full suite only on harness death (`is still running`, seed fail, tele fail). Product OD fails continue. |
| `HP_REFILL_AT` | Effective HP ≤ this → `setstat hitpoints 99` (default **40**; `0` = off). Not invuln. |
| `SUSTAIN_EVERY_S` | Energy + HP check period mid-walk (default **5**; floor 2). Keeps multi-suite fleets light. |
| `ENERGY_REFILL_AT` | Run energy % threshold mid-walk (default **25**). Same sustain cadence. |
| `WALK_POLL_MS` / `WALK_POLL_S` | Outer mid-walk poll for done/tile/stuck (default **2000** ms). Floor 500. |

**Pacing defaults** (shared `e2e/lib/navLiveHarness.ts` — prefer these over ad-hoc tight loops):

| Constant | Default | Use |
|---|---|---|
| `DEFAULT_WALK_POLL_MS` | 2000 | Outer walk loop |
| `DEFAULT_SUSTAIN_EVERY_S` | 5 | Energy + HP |
| `DEFAULT_SETTLE_MS` | 400 | After cheats |
| `DEFAULT_ARRIVAL_POLL_MS` | 400 | Tele / inv seed wait |
| `DEFAULT_STOP_POLL_MS` | 500 | Runner stop wait |

**377-style helpers** (same module): `waitSceneReady`, `giveItems`, `setStats`, `fillRunEnergy`, `ensureInvItem`, `maybeSustain` — condition → seed/restore without inventing new poll storms.

Path-cost estimate (optimistic): `estSec ≈ (cost / 2) × (tickMs / 1000)` with live
`tickMs=300`. Stuck abort requires **no movement** so long multi-ship ODs that
still advance are not cut short.

Startup line logs `tele=… kitSeeded=… pureWalk=… stuckAbort=… suiteAbort=…`.
Success proof only when every planned leg passes; any FAIL or suite abort →
failure screenshot + exit 1. Partial runs set `suiteAbortReason` + `planned` in
the JSON proof.

`mainlandAccount` uses clean IF_BUTTON logout (com 2458) after tutorial varps so
relogin is ~seconds, not a minute-long unclean hold.

Fresh accounts leave `*.sav` on an always-on local engine. Clean with
`bash tools/cleanup-test-accounts.sh` (dry-run default; see [TESTING.md](../how-to/write-a-harness.md)).
Stagger concurrent suite boots so logins do not share one title-loop race.

**Live HARD:** `e2e/nav-script-routes-live.ts` with `HARD=1` reads
`tools/nav/script-routes.hardest.json`. Seeds runes + charged jewellery at start so
long OD legs may Rub naturally (no fake end-of-run jewellery allowlist). Fresh
checkouts without the pack or generated JSON will not exercise collision-backed
corpus coverage; unit tests that need the pack use `test.skipIf` rather than silent
pass.

## See also

- [Route corpus](run-route-corpus.md)
