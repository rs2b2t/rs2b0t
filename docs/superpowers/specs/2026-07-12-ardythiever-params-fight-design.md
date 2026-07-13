# ArdyThiever: baked market layout + fight/flee guard response — Design

**Goal:** Two changes to `ArdyThiever` (`src/bot/scripts/ArdyThiever.ts`):

1. **Strip unnecessary params.** The bot knows the East Ardougne market layout
   itself — every tile/name param becomes a constant, and the thieving anchor
   derives from the chosen pickpocket target. Starting location must not
   matter: start it anywhere and it travels to the market.
2. **Fight/flee dropdown.** New `guardResponse` setting. `Flee` keeps today's
   kite across the map; `Fight` makes high-level accounts kill the guard that
   caught them at the cake stall and get back to work.

**Scope:** ArdyThiever only. ArdyFighter, ThievingBot, and the shared
banking/walking APIs are untouched.

## Settings panel (19 → 9 + shared bank block)

Kept (per user decision: keep the tuning knobs, remove location/name params):

| Key | Default | Notes |
|---|---|---|
| `thieveTarget` | `Guard` | unchanged strict dropdown (Guard / Knight of Ardougne / Paladin / Hero) |
| `guardResponse` | `Flee` | **NEW** dropdown `['Flee', 'Fight']` — default preserves current behavior |
| `eatAtHp` | 40 | unchanged |
| `eatToHp` | 90 | unchanged |
| `panicHp` | 25 | unchanged |
| `restUntilHp` | 60 | unchanged |
| `foodTarget` | 22 | unchanged |
| `restockAtFood` | 3 | unchanged |
| `bankAtLootSlots` | 12 | unchanged |
| `...PERIODIC_BANK_SETTINGS` | — | shared block, unchanged |

Removed → hardcoded constants: `anchor`, `leashRadius`, `stallTile`,
`stallStand`, `stallName`, `bankStand`, `stallFleeTile`, `obstacle`, `food`,
`loot`. Settings resolution is schema-driven, so stale saved values for removed
keys are silently ignored — no migration needed.

## Baked market layout (grounded in engine data)

NPC spawns decoded from the engine's packed server maps
(`data/pack/.cache/maps-server.zip`, files `n40_51`/`n41_51`; format
`[g2 packedCoord][g1 count][g2 npcId]*`, coord = level 2b | x 6b | z 6b):

- **Guard ×7** in the market: (2651,3307), trio (2659–2661,3309), (2663,3301),
  (2665,3300), (2664,3318)
- **Knight of Ardougne ×4**: (2652,3318), (2653,3300), (2669,3298), (2671,3313)
- **Paladin ×2 in the market**: (2653,3315), (2657,3307) — plus the castle
  cluster in mapsquare 40_51 (~20 spawns, many on level 1); the market pair is
  the right fit for a bot that feeds from the cake stall
- **Hero ×3**: (2647,3306), (2667,3316), and one far SW at (2630,3288)

Per-target spots (anchor derives from `thieveTarget`; nothing to place):

| Target | Anchor | Leash | Coverage |
|---|---|---|---|
| Guard | (2661,3306) | 12 | all 7 guard spawns |
| Knight of Ardougne | (2661,3306) | 12 | all 4 knight spawns |
| Paladin | (2655,3311) | 12 | both market paladins |
| Hero | (2657,3311) | 14 | the two market-side heroes; the SW one is out of scope |

Fixed layout constants (today's defaults, promoted): stall (2667,3310), stall
stand (2668,3312), stall name `Baker's stall`, bank stand (2655,3286), kite
tile (2655,3298), obstacles `door, gate`, food `cake, bread, chocolate slice`.

**Loot constant** (replaces the `loot` param), grounded in
`pickpocket.dbrow` + `guard.rs2` drops: `coins, chaos rune, death rune,
blood rune, nature rune, jug of wine, fire orb, gold ore, clue scroll,
body talisman, steel arrow, iron ore`. Covers pickpocket loot for all four
targets (Guard 30gp; Knight 50gp; Paladin 80gp + 2 chaos; Hero 200–300gp +
death/blood runes, wine, fire orb, diamond, gold ore) plus guard drops for
fight mode. Gems (the Hero's diamond) already bank via the shared
common-junk list.

## Start-anywhere

- `onStart` no longer reads an anchor; it resolves the target's spot from the
  table and logs it.
- `ReturnToAnchor` (validate: > leash+6 from anchor) handles travel: when far
  out (> 30 tiles) it first runs `Traversal.walkResilient` to the anchor
  (ArdyFighter's proven start-anywhere walk), then finishes with the existing
  `walkOpening` leg so the market approach cannot snag on a shut door/gate.
  Within 30 tiles it uses `walkOpening` directly, as today.
- **NEW level gate at start**, mirroring the existing Thieving-5 stall check:
  stop with a clear log if `Skills.level('thieving')` is below the target's
  pickpocket requirement (`PICKPOCKET_TARGETS`: Guard 40, Knight 55, Paladin
  70, Hero 80). No more silently spamming failed pickpockets.

## Fight mode (verified in content)

`skill_thieving/scripts/stalls/stealing.rs2` + `stealing.dbrow`:

- The Baker's stall's LOS-blocker list is **only `ardougne_guard`** — a caught
  stall steal normally means one level-20 Guard (22 hp) attacking.
- The Baker's owner-catch (`stall_owner_alert_guards`, "Guards guards!")
  additionally retaliates **every** `ardougne_guard | knight_of_ardougne |
  knight_of_ardougne2 | paladin | hero` within 5 tiles of the Baker with LOS —
  so multiple attackers, and tougher ones than a Guard, are possible.

`onStart` registers **either** `Flee` (unchanged, current priority slot right
after DeathRecovery) **or** the new `FightBack` task, per `guardResponse`.

**FightBack:**

- Priority: **below** `EatFood`/`PanicRetreat` (eating outranks fighting
  mid-combat — same reason ArdyFighter's Fight sits low), above
  PeriodicBank/BankRun/RestockCakes/Pickpocket. Task order in fight mode:
  ContinueDialog, DeathRecovery, LootDrops, EatFood, PanicRetreat, FightBack,
  PeriodicBank, BankRun, RestockCakes, Pickpocket, ReturnToAnchor.
- Validate: `bot.inRealCombat()` — the pickpocket-stun suppression
  (`STUN_COMBAT_TICKS`) is unchanged and still load-bearing: a failed
  pickpocket must not start a fight.
- Find the attacker: nearest NPC named `Guard` / `Knight of Ardougne` /
  `Paladin` / `Hero` with an `Attack` op and `inCombat`, within 5 tiles of the
  player. None found → wait 2 ticks and return (revalidate; combat may clear).
- Engage: explicit `interact('Attack')` (robust even with auto-retaliate off),
  then ride the fight (ArdyFighter's shape): 90 s deadline; bail on
  death/dialog/EventSignal; return when `shouldEat`/panic gates trip (EatFood
  and PanicRetreat outrank next loop, then FightBack revalidates); track the
  target by npc index; `health === 0 && snap.totalHealth > 0` → wait for
  despawn (≤10 s) → count the kill and log it; if both we and the target leave
  combat, return — revalidation picks up any second attacker.
- After the kill: the engine blocks stall theft for 10 ticks post-combat
  (`%lastcombat + 10 > map_clock`); RestockCakes' existing retry loop absorbs
  that without changes.
- Overlay: kills join the painted stats (`fought N` next to `fled N`).
- Safety net unchanged in both modes: the eat/panic ladder still runs, so a
  fight going badly (no food, HP < panic) ends in PanicRetreat's bank run —
  fight mode never disables it. DeathRecovery is unchanged.

## Testing

- **Unit** (new `test/scripts/ardythiever-logic.test.ts`, pure helpers in a
  small `ArdyThieverLogic.ts`): per-target spot table resolves for every
  `ARDOUGNE_PICKPOCKET_TARGETS` entry (anchor/leash/level), level-gate
  predicate, and the attacker-selection predicate (pure over
  `{name, inCombat, ops, distance}` snapshots).
- **Existing smokes unchanged**: `tools/ardythiever-test.ts` (defaults) and
  `tools/ardythiever-kite-test.ts` (flee is still the default) must both still
  pass — neither passes settings.
- **New smoke** `tools/ardythiever-fight-test.ts`, kite-test shape: maxme'd
  account, page URL `bot.html?ArdyThiever.guardResponse=Fight` (URL-first
  settings resolution, the `global-settings-test` pattern), tele to the stall
  stand, run the bot, wait for a patrolling guard to catch the theft. Assert:
  fight log observed, a kill observed, the bot **never** reached the kite tile
  (closest distance to (2655,3298) stays > 3), and thieving resumes after the
  kill (a later restock/pickpocket log).

## Risks / accepted trade-offs

- **Hero coverage**: only 2 of 3 hero spawns sit near the market; if neither
  wanderer is in leash the bot idles until one arrives (same as today with a
  hand-placed anchor).
- **Owner-alerted Knight/Paladin/Hero in fight mode**: tougher than a Guard;
  the eat/panic ladder is the answer, same as ArdyFighter's stance.
- **No combat-style management**: kills are incidental XP; adding a style
  param would cut against the param-removal goal. Whatever `com_mode` the
  account has is used.
