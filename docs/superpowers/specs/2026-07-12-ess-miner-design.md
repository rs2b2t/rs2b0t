# EssMiner (Varrock East ↔ Aubury ↔ Rune Essence mine) — Design

**Goal:** An AFK rune-essence mining bot: start anywhere → Varrock East bank →
Aubury's Teleport → mine "Rune Essence" until the pack is full → exit Portal →
bank the essence → repeat. One setting: which pickaxe to use (default: best
available, engine-identical resolution).

**Category:** Mining. Registered `EssMiner`.

## Mechanic (verified in content)

`skill_runecraft/scripts/essence_mine.rs2`, `areas/area_varrock/scripts/aubury.rs2`,
`skill_mining/{configs,scripts}`:

- **Aubury** (npc `aubury`, (3253,3402), inside the rune shop) has **`op4=Teleport`**
  → `@teleport_to_essence_mine(^essence_mine_to_aubury)` directly — no dialogue
  driving needed. (The Talk-to multi3 has the same option; unused by the bot.)
- **Quest gate:** the teleport refuses unless `%runemysteries >=
  ^runemysteries_complete` (**6**) with the message "You need to have completed
  the Rune Mysteries Quest to use this feature." Quest varps never transmit —
  the bot checks `Quests.status('Rune Mysteries') === 'complete'` (journal
  colour; recomputed on login).
- **Teleport in:** ~4 tick cast, then `p_telejump` to one of **22 random spots**
  (enum `essence_mine_teleports`) in **mapsquare 45_75** (x 2880–2943, z
  4800–4863, level 0), ±1 tile line-of-sight fuzz.
- **The mine:** four **"Rune Essence"** crystals (loc `blankrunestone`, 5×5,
  `op1=Mine`) at **(2891,4847), (2893,4812), (2925,4848), (2927,4814)**; four
  **"Portal"** exits (loc `blankrunestone_exit_portal`, `op1=Use`) at
  **(2885,4850), (2889,4813), (2932,4854), (2933,4815)** — one near each
  crystal (decoded from packed `l45_75`).
- **Mining:** `mine.dbrow [rune_essence_table]`: level **1**, 5 xp,
  `successchance 256,256` (always succeeds), product obj `blankrune` = item
  **"Rune essence"** (non-stacking). The rock never depletes; one Mine click
  auto-repeats until the inventory is full (mining.rs2 repeat block — verify
  live in the smoke).
- **Portal out:** telejump to `%exit_essence_mine_coord` = whoever teleported
  you in — `^essence_mine_to_aubury` = **(3253,3401)**, Aubury's shop, ±2 fuzz.
- **Pickaxe rule** (`pickaxe_checker.rs2`): usable = **worn right-hand OR in
  inventory**, best-first **Rune 41 > Adamant 31 > Mithril 21 > Steel 6 >
  Iron 1 > Bronze 1** vs the Mining stat. No usable pick → blocking mesbox
  ("You need a Pickaxe to mine this rock...").
- **Varrock East bank:** booths (`bankbooth`, op "Use-quickly") at
  **(3252,3419), (3253,3419), (3254,3419), (3256,3419)** (decoded from
  `l50_53`); bank stand **(3253,3418)**, 16 tiles due north of Aubury with the
  shop door between.

## Architecture

A `TaskBot` (CookBot/FlaxSpinner shape) + a pure, client-free
**`EssMinerLogic.ts`** (ArdyThieverLogic pattern). State = mapsquare + pack:

| Task (priority order) | Runs when | Behaviour |
|---|---|---|
| ContinueDialog | dialog open | continue (also absorbs the teleport cast chatter) |
| MineEss | in mine (45_75), pack not full | nearest "Rune Essence" `interact('Mine')` **once**; wait for ess count to grow/pack full; re-click if the count stalls ~20 s; yield to EventSignal/dialog |
| UsePortal | in mine, pack full | nearest "Portal" `interact('Use')` → await outside (≤15 s), retry |
| BankEss | outside, carrying "Rune essence" | walk to (3253,3418) (`walkResilient` when far — start-anywhere — then `walkOpening`), `Bank.openBooth('Bank booth', 'Use-quickly')`, `depositAllMatching(depositMatcher(ess, bankCommonJunk))` — the pickaxe never matches either, so it stays (worn or carried) |
| GetPick | outside, no usable pick held (per setting) | bank trip; resolve against `Bank.items()`; withdraw 1 (op read off the item); **stop** with a clear message if unresolvable |
| TeleportIn | outside, pick held, no ess carried | walk to Aubury via `walkOpening` (shop door), `Npcs.query().name('Aubury').action('Teleport')` → `interact('Teleport')` → await mapsquare 45_75 (≤15 s), retry ×3; a blocking quest-gate mesbox → stop |

Inside the mine the bot NEVER web-walks — `Loc.interact()` is an OPLOC and the
**server** walks us to the crystal/portal from any of the 22 landing spots
(same mechanic as the banking OPLOC-first fix and FlaxSpinner's ladder).
`inEssMine(x, z)` = `x >> 6 === 45 && z >> 6 === 75` (pure helper).

## Settings (one param)

| Key | Default | Notes |
|---|---|---|
| `pickaxe` | `Best available` | dropdown: `Best available` / `Rune` / `Adamant` / `Mithril` / `Steel` / `Iron` / `Bronze` |

**Pick resolution** (pure `resolvePick(selection, miningLevel, worn, inv, bank)`
in EssMinerLogic, engine-mirrored):

- `Best available`: walk the tier list best→worst; first tier with
  `miningLevel >= req` that exists worn/inv → use held; else first such tier
  in the bank → withdraw; else **stop** ("no usable pickaxe — need one of ...").
- Specific tier: `miningLevel < req` → **stop** ("Mining N required for X
  pickaxe"); held → use; in bank → withdraw; nowhere → **stop** ("no X pickaxe
  in inventory, equipment, or bank"). No silent fallback — the user chose.
- **No auto-equip** (user-approved): a carried pick costs one slot → 27
  ess/trip; worn pick → 28.

## Gates & stops (at `onStart`)

- `Quests.status('Rune Mysteries') !== 'complete'` → log "EssMiner needs Rune
  Mysteries completed for Aubury's teleport — run the RuneMysteries bot first"
  and stop.
- Pick resolution stop-cases above (checked at start and re-checked whenever
  GetPick runs, e.g. after a lost-pickaxe event consumed the spare).
- The runtime random-event supervisor (maze, genie, smoking rock,
  **lost-pickaxe recovery**) stays active as with every bot; `grindTargets()`
  n/a (no combat).

## Overlay & logs (smoke-asserted shapes)

Overlay: status, `trips N  ess banked M`, pack count. Logs: `teleporting to the
essence mine`, `mining rune essence`, `taking the portal back`,
`banked <n> rune essence (trip <t>)`, and each stop-case message.

## Testing

- **Unit** (`test/scripts/essminer-logic.test.ts`): `PICK_TIERS` order+levels
  (41/31/21/6/1/1); `resolvePick` across the matrix — best-available picks
  worn over inv over bank, skips too-high tiers by level, specific-tier
  held/bank/stop cases, level-gate stop; `inEssMine` boundary (2880/4800 in,
  2879/4799 out).
- **Live smoke** (`tools/essminer-test.ts`, kite-test harness shape): seed
  `::~bankitem rune_pickaxe 1` + `::setvar runemysteries 6` **before**
  `::~maxme` (maxme swallows the next typed cheat) + **relog** (journal colour
  recomputes on login), `::tele 0,50,53,53,26` (bank stand), run `EssMiner`.
  Assert a **double cycle**: mine region entered (tile in 45_75) → pack fills
  (Rune essence count 27) → back outside → bank deposit observed (log `banked
  27`) → pickaxe still held → second teleport observed. Fail-paths screenshot.
- Add the smoke to `run-all-smokes` (default 360 s timeout should fit — one
  cycle is ~2-3 min; use `LONG` 600 if the double cycle proves tight).

## Risks / non-goals

- **Auto-repeat assumption:** if this engine build does NOT auto-mine until
  full, MineEss's stall-reclick (~20 s) still completes the pack — just
  slower; the smoke will show which behavior is live.
- **Landing-spot pathing:** OPLOC server-walk covers all 22 spots → nearest
  crystal (portals sit beside crystals); no baked nav data exists or is needed
  inside 45_75.
- **Non-goals:** Sedridor/Wizards' Tower route (Aubury only), auto-equipping
  the pick, auto-running Rune Mysteries (the bot just points at it), members
  teleporters (Brimstail), Abyss.
