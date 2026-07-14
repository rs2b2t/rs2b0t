# ClueSolver (RockCrab easy treasure-trail solver) — Design

**Goal:** When RockCrab loots an easy clue scroll, drop everything, solve the
full 2–4 step easy trail (search / dig / talk, anywhere on the map including
upper floors), collect the reward, and resume crabbing. Reusable clue-solver
module + a foundational nav fix so the world walker can reach upstairs answers.

**Category:** Combat add-on. No new registered bot — a `SolveClue` task inside
`RockCrab`, backed by a reusable `src/bot/clues/` module.

## Mechanic (verified in content/engine)

Content: `~/code/rs2b2t-content/scripts/minigames/game_trail/`. Two dedicated
surveys + the live guide (2004.losthq.rs easy guide) agree.

- **Drop:** rock crabs call `~trail_easycluedrop(128, ...)` on death — 1/128,
  **members-world only**, and only if the player holds no clue/casket already
  (`trail_clue_drop.rs2`). RockCrab's default loot list already includes
  `clue scroll` + `casket`, so the pickup pipeline is unchanged.
- **Trail length is 2–4 random steps** (`^trail_easy_maxsteps = 4`;
  `trail_clue_easy_complete` = progress ≥ 4, or ≥ 2 with a coin-flip). Each
  solved step **consumes the scroll and hands back a new random easy clue**
  (`progress_clue_easy` → `trail_clue_easy_getrandom`), until completion pays
  out. So the solver is **reactive**: identify the held clue → solve its step
  → a new clue (or casket, or the reward) appears → repeat.
- **66 easy clues, each a distinct obj id** (2677–3519) all named
  "Clue scroll". Identification is by **item id**, not text — obj params are
  NOT client-readable (`ObjType` decode stops before param opcodes), so text
  reading is neither needed nor possible; the answer comes from a baked table
  keyed by id.
- **Three step types** (no emote/anagram/sextant in easy — those are
  medium/hard):
  - **Search-loc (46):** obj `trail_coord` = the loc's tile; walk there,
    interact the crate/chest/drawer's op1 (generic handlers gate on
    `oc_param(clue, trail_coord) = loc_coord`). No items.
  - **Dig (6):** obj `trail_coord` + `trail_casket`; stand within **1 tile**,
    `Spade.interact('Dig')` → a **casket** appears in inventory; opening the
    casket (`[opheld1,_trail_casket_easy]`) advances the trail. Needs a spade.
  - **Talk (14):** obj has no coord; the target NPC lives in per-NPC scripts
    (`[opnpc1,<npc>]` checks the specific clue id). Mapping harvested from
    ~15 handler scripts (table below). No items.
  - One special: **vague003** is a search-loc whose coord is code-set in
    `drawers.rs2` (shared drawer with a medium clue) — hand-cased.
- **Reward:** on completion `~trail_clue_easy_reward` rolls 2–4 times
  (normal table ~28 entries: coins/runes/black gear/etc.; ~1/84 rare table)
  and `~trail_complete` transmits the loot **into inventory** via the
  `trail_reward` interface. Terminal state = no clue/casket held.
- **No wilderness / no dangerous easy clues** — all answers in safe towns
  (verified by decoding all 51 coords against the Wilderness bounds).

### Talk clue → NPC table (from handler scripts, baked by the generator)

`simple005→Hans`, `simple007→Zeke`, `simple008→Tanner`,
`simple010→Blue Moon Inn bartender`, `simple017→Squire (White Knights)`,
`simple020→Rusty Anchor bartender`, `simple021→Ned`, `simple022→Doric`,
`simple023→Gaius`, `simple025→Arhein`, `simple026→Sir Kay`,
`vague012→Captain Tobias (sailor)`, `vague028→Louisa`,
`vague029→Duel Arena spectator`.

### Upstairs answers (16) — why the nav fix is a prerequisite

13 clues answer on level 1, 2 on level 2 (Camelot tower `simple027`, Draynor
Manor `vague018`), plus `vague003` (L1). Examples: `simple001` Duke's bedroom
chest (3209,3218,**1**); `simple011` Varrock East bank drawers (3250,3420,**1**);
`vague024` Seers flax-house upstairs (2716,3472,**1**). Today `walkResilient`
to any of these returns `unreachable` (see Nav fix).

## The nav fix (foundational — benefits every bot)

**The walker's climb mechanic already works; the gap is data.** Node ids
encode level (`(level<<28)|...`), grid steps never change level, and the only
cross-level links are hand-added transport edges — currently just Lumbridge's
8 staircase entries in `transports.json`. `handleTransport` already handles a
`toLevel` edge (interact the stair loc, wait for `worldTile().level ===
toLevel`), `isArrived` already gates on level, and `PathFinder` already routes
through transport edges. RuneMysteries proves it end-to-end: it reaches the
Duke on Lumbridge L1 with a plain `walkResilient`, no scripted hop.

Stairs are **not** auto-derived (unlike doors via `derive-doors.ts`). So the
fix is a new generator that bakes stair/ladder hops into the transport graph:

- **`tools/nav/derive-stairs.ts`** parses
  `~/code/rs2b2t-content/scripts/ladders+stairs/scripts/stairs.rs2` — a giant
  `switch_coord(loc_coord) → p_telejump(dest)` (~264 cases across 30 loc
  types) — emitting a `TransportEdge` per case (`from` = the stair loc's
  ground tile, `to` = the `p_telejump` landing coord **with its level**,
  `locName`/`action` from the loc config, `toLevel` set). Reverse cases in
  the same file produce the down edges; the down-hop's destination is the
  up-hop's approach tile (the Lumbridge entries already use this trick).
- **Generic ladders:** `Ladder`/`laddertop` locs (default `ladders.rs2`
  climb ±1 level in place) get a generic ±1-level edge rule from the baked
  loc data — covers house/flax-house ladders with no per-loc table.
- **Output:** a **generated, committed** `src/bot/nav/data/stairEdges.ts`
  (separate from hand-maintained `transports.json` so the door/wizard
  hand-entries are never clobbered); `PathFinder.addEdges` consumes both.
  `--check` drift gate, like `shopdb`.
- **Stragglers:** Al Kharid Palace (`simple004`) and Catherby house
  (`vague023`) are not in `stairs.rs2` — a targeted live probe finds their
  stair tiles; if found, hand-add to a small curated supplement file; if not,
  those two clues degrade to the abandon rule (logged), no wedge.

**Verification hook:** the offline nav-coverage gate (`tools/nav/coverage.ts`)
gains the 16 upstairs clue answer tiles as `NAV_TARGETS` — proving the baked
stair edges make each reachable. This is the stair generator's regression net
and runs offline with no engine.

## Architecture

Layered like ShopRunner (generated data + pure core + thin shell) reusing the
quest-executor primitives:

1. **`tools/clues/gen-cluedb.ts` → `src/bot/clues/data/cluedb.ts`** (generated,
   committed, `--check` drift gate). Parses `trail_easy.{enum,obj}` for the 51
   dig+search rows; greps the ~15 handler scripts for the 14 talk rows +
   vague003. Row: `{ obj, id, type: 'search'|'dig'|'talk', coord?, casketObj?,
   npc? }`.
2. **`src/bot/clues/types.ts` + `ClueLogic.ts`** (pure, client-free,
   unit-tested): `identifyStep(heldIds, db)` → the step to perform now
   (a held **casket** id → an `open-casket` step; a held **clue** id → its
   table row; nothing relevant → `null`). Deterministic, no `Date.now()`.
3. **`src/bot/clues/ClueExecutor.ts`** (thin, client-bound): `solveStep(step)`
   composing existing primitives — `Traversal.walkResilient(coord, {radius})`
   (now cross-level-capable), then per type: search =
   `Locs.query()…nearest().interact(op)`; dig = walk radius 1 +
   `Inventory.first('Spade').interact('Dig')`; talk = `gotoNpc` + `talkThrough`
   (reused verbatim from `quests/exec/primitives.ts`); open-casket =
   `Inventory.first(casketName).interact('Open')`; then `ChatDialog.continue`
   through objbox/reward. Returns solved / abandon-this-step.
4. **`RockCrab` `SolveClue` task** — inserted high in the task list (after
   survival: DeathRecovery/Eat, before Fight/Aggro). `validate()` = members
   world ∧ holds a clue or casket ∧ `solveClues` setting on. `execute()`:
   **(a) bank first** — `walkResilient(Seers)`, deposit all non-essentials
   (gems/keys/junk), withdraw food + a spade; **(b) solve loop** — until no
   clue/casket held: `identifyStep` → `solveStep`; **(c) return** —
   `walkResilient(FIELD)`, normal loop resumes crabbing.

## Settings (RockCrab additions)

| Key | Default | Notes |
|---|---|---|
| `solveClues` | `true` | master toggle for the whole feature |
| `spade` | `Spade` | item withdrawn on the pre-solve bank trip for dig steps |

(Food withdrawal reuses the existing `food`/`foodWithdraw` settings.)

## Behaviour details & error handling

- **Interrupt = immediate** (user choice): the moment a clue is held and the
  bot is healthy/not mid-swing, `SolveClue` preempts Fight/Aggro. Survival
  tasks (DeathRecovery/Eat) still outrank it.
- **Bank-first** (user choice): every solve run begins at Seers — deposit
  loot, withdraw food + spade — so the pack has room for the trail and reward,
  and a spade is always present for dig steps.
- **Abandon rule** (user choice): each step gets bounded attempts
  (walk + interact + verify); on failure (unreachable straggler, no spade,
  nav give-up) log `[clue] abandoning <id>: <reason>`, leave the clue, return
  to FIELD. Never wedge. Easy steps are simple, so this is rare.
- **One clue at a time** is engine-enforced globally (inv+bank) and naturally
  satisfied by solve-immediately.
- **Members gate:** `SolveClue.validate()` requires a members world; on a
  free world it never fires (clues never drop there anyway).
- **Random events / death mid-solve:** the runtime supervisor and RockCrab's
  DeathRecovery stay active; `solveStep` yields on `EventSignal.pending()`
  like the quest primitives, and the solve loop re-derives from held items
  after any interruption (idempotent — re-identify and continue).

## Overlay & logs

Overlay gains one line: `clue: <status>` (idle / banking / solving <id> /
returning). Logs: `[clue] solving <obj> (<type>) at (x,z,L)`,
`[clue] step done — next <obj>`, `[clue] trail complete — reward collected`,
`[clue] abandoning <id>: <reason>`, and the nav gen/gate messages.

## Testing

- **Unit** (`test/clues/*`, `test/tools/*`): cluedb generator fixtures →
  exact rows (search coord, dig coord+casket, talk NPC, vague003 special);
  `identifyStep` (casket-beats-clue precedence, unknown id → null,
  clue → row); stair generator fixtures (`switch_coord`/`p_telejump` parse →
  edge with correct from/to/toLevel; generic ladder rule).
- **Nav coverage:** the 16 upstairs answer tiles added to `NAV_TARGETS`; the
  offline gate must show them `ok` after the stair edges are baked (fails
  before, passes after — the stair generator's regression net).
- **Drift gates:** both generators' `--check` wired into the test run.
- **Live smoke** (`tools/cluesolve-test.ts`, local engine): cheat a clue with
  `::~item <clue> 1`, run RockCrab. Assert two cases end-to-end: a
  **ground-floor talk** (`simple021`→Ned, deterministic, fast) and an
  **upstairs search** (`simple011`→Varrock East bank drawers L1) — proving the
  bank-first leg, the solve loop, a real stair climb, and the return to FIELD.
  Multi-step trails are RNG, so the smoke asserts the *first step* solves +
  the loop advances (a new clue/casket appears or the reward fires), not a
  fixed trail length. Add to `run-all-smokes` (LONG).
- Live verification on rs2b2t (members) after merge, per repo habit.

## Risks / non-goals

- **Stair-data build specificity:** baked coords are for this content build;
  regenerate (`--check` catches drift) if content updates.
- **Stragglers (Al Kharid Palace, Catherby):** if the probe can't place their
  stairs, those 2 clues abandon-and-resume (logged) — acceptable v1 gap.
- **Cross-map travel time:** a trail can drag the bot Rellekka→Lumbridge→
  Ardougne; accepted (user: "go anywhere"). The resilient walker handles it;
  the abandon rule bounds pathological cases.
- **Non-goals:** medium/hard trails (emote/anagram/sextant/puzzle — different
  tiers, not in scope); farming clues faster than 1/128; solving on non-crab
  bots (the module is reusable but only RockCrab wires it in v1); dungeon
  clue `vague009` (underground +6400, not an upstairs building — abandon).
