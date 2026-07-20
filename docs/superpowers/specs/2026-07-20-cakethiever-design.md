# CakeThiever + shared cake-stall driver — design

**Date:** 2026-07-20
**Status:** approved (brainstorm w/ user)

## Problem

The cake-stall stealing shared by ArdyThiever and ArdyFighter (`RestockCakes` in
each) is broken live: the bot wedges idle at the stall. The current
implementation predicts the Baker's line of sight (`ownerWatching`) and dances
between three stand tiles with `walkTo(radius 0)` exact-tile walks — the walker
loops on an exact-tile arrival it isn't achieving and steals nothing.

User priority: **a working, consistent bot over clever baker/guard handling**.
Steal-and-reset-nearby beats LOS prediction.

## Goals

1. A new standalone **CakeThiever** bot: thieve cakes at the East Ardougne
   Baker's stall, bank them at the south bank, repeat. Guard response
   (Fight/Flee) is a setting.
2. Its steal loop is the **base implementation** that fixes cake thieving —
   a shared driver.
3. Backport: ArdyThiever's and ArdyFighter's `RestockCakes` swap onto the
   shared driver; the stand-dance/LOS code is deleted.

## Engine facts (rs2b2t-content, verified)

- `steal_from_stall` checks **guards first, then the owner**: any of the
  stall's guard NPCs (Guard/Knight/Paladin/Hero) within 5 tiles of the player
  **with line of sight** at click time → `npc_say("Hey! Get your hands off
  there!")` + retaliate (combat). Baker within 5 w/ LOS → same message, **no
  combat**, theft refused.
- For **10 ticks after any combat** (`%lastcombat + 10 > map_clock`) every
  steal is refused: "You can't steal from the market stall during combat!".
- Success: cake/bread/chocolate-slice loot, stall loc swaps to its emptied
  variant for a player-count-scaled respawn (~8 ticks base).
- **Players never exclude tiles** — you can stand on any tile another player
  (or the Baker) occupies. "Tile occupied" is not a failure mode.

## Design

### Files

- `src/bot/scripts/CakeThiever.ts` — the bot (TaskBot; registered in
  `scripts/index.ts`).
- `src/bot/scripts/CakeStall.ts` — shared client-coupled steal driver used by
  CakeThiever, ArdyThiever, ArdyFighter.
- `src/bot/scripts/CakeStallLogic.ts` (+ `.test.ts`) — pure logic, no client
  imports (ArdyFighterLogic pattern): steal-outcome classification, refusal
  streak / reset decision, lockout arithmetic.

### The golden stand

`(2668,3312)` — north of the stall — is THE stand (user live experience:
market-side and behind-the-stall stands alert the guards/Baker far more).
The bot does its best to stand there:

- Not on the stand → one **bounded** walk onto it (~5 s). If the walk fails
  (pathing hiccup), steal from wherever we are — the Steal-from click
  server-walks the last step — and re-try the claim between steals.
- **Never** loop on exact-tile arrival. That is the old wedge.

### Steal loop (shared driver `stealCakes(opts)`)

Each iteration:

1. Abort checks (caller-injected): combat, death, pending random event, open
   dialog, fill-target reached, eat-gate. On any → return with a reason; the
   caller's task ladder owns the response.
2. Claim the stand (bounded, best-effort — above).
3. Stall stocked? If the emptied variant is up, condition-wait for restock
   (bounded 8 s, interrupt-aware) — existing pattern.
4. Click `Steal from`. Resolve by `delayUntil` on the first of:
   - **success** — carried-cake count increased;
   - **caught by guard** — combat flag went up;
   - **refusal** — "Hey! Get your hands off there!" chat seen, no combat
     (Baker);
   - **lockout** — "You can't steal from the market stall during combat!"
     chat;
   - 4 s timeout (treated as refusal-shaped no-op).
5. Outcome handling:
   - success → streak = 0, continue;
   - refusal/timeout → streak++; at **3 consecutive** → **reset**: walk to
     `RESET_TILE (2668,3320)` (~8 tiles north, off the market side), wait
     until the Baker is >5 tiles from the stand or ~10 s bound, walk back,
     streak = 0;
   - lockout → wait out `lockoutUntil` (combat-end tick + 10) instead of
     spamming clicks;
   - caught → return `'combat'` immediately.

No `ownerWatching`, no `lineClear`, no multi-stand picking anywhere in the new
path. **Outcomes over predictions.**

### CakeThiever bot

Settings: `guardResponse: Flee|Fight` (default Flee), `eatAtHp` (default 40),
`eatToHp` (default 90), `bankCommonJunk` (default true).

Task ladder (priority order):

1. `ContinueDialog`
2. `DeathRecovery` (anchor = the stand)
3. `Flee` **or** `FightBack` per setting — both reused from ArdyThiever's
   proven shapes (kite to the SW flee tile / kill the attacker; the
   post-combat 10-tick lockout is fed back to the driver)
4. `EatCake` — eat carried cakes below `eatAtHp` up to `eatToHp` (they're
   free; survival outranks yield)
5. `BankRun` — pack full → south bank booth
   `(2655,3286)` Use-quickly, deposit cakes + common junk, walk back
6. `StealCakes` — the driver, fill target = full pack
7. `ReturnToAnchor` — start-anywhere / displacement recovery
   (walkResilient long-haul + walkOpening arrival, ArdyThiever shape)

Paint: status, steals/hr, cakes banked, refusal resets, guard catches,
fled/fought counts, HP bar, pause/stop buttons.

Thieving 5 gate at start (clear message, stop).

### Backports

- **ArdyThiever**: `RestockCakes.execute` becomes a thin call into
  `stealCakes` (fill target `foodTarget`, abort on its existing gates). Delete
  `pickStand`, the `STALL_STAND*` constants, and — once unused —
  `ownerWatching`/`lineClear` from ArdyThieverLogic. Pickpocket logic
  untouched.
- **ArdyFighter**: same swap for its `RestockCakes` (fill target
  `foodTarget`); its guard-fighting stays its own concern. Its
  `stallTile`/`stallStand`/`stallOwner` settings collapse onto the baked
  constants (the stall layout was never really configurable — the second
  stall differs only in tiles, out of scope).

### Testing & verification

1. `CakeStallLogic.test.ts`: classifier (message/combat/delta → outcome),
   streak → reset decision, lockout window arithmetic.
2. Full suite + typecheck green.
3. **Live smoke of CakeThiever first** (the point is proving the base):
   steal → refusal → reset cycle observed; guard catch in Flee mode (kite +
   lockout + resume) and Fight mode (kill + lockout + resume); a full bank
   trip. Then backport and re-smoke each Ardy bot's restock path.

## Out of scope

- Other stalls (silk/gem/etc.) — the driver takes the stall/loot constants,
  so a future generalization is cheap, but only the Baker's stall ships.
- The second Ardougne Baker's stall (2655,3311).
- Any pickpocket/fight-target changes in the Ardy bots.
