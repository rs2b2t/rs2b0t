# Prince Ali Rescue + Waterfall Quest — Design

Date: 2026-07-16
Status: approved (brainstorm complete)

## Goal

Two new AIOQuester defs — Prince Ali Rescue (f2p, 3 QP) and Waterfall Quest
(members) — plus the two engine capabilities they need: a shop **buy** step and
quest-agnostic **death recovery**. One project, capabilities-first build order.

## Decisions (user-approved)

- **Survival model: full death recovery.** On death the engine recovers and the
  quest resumes; no death-proofing stat floors, no per-quest death code.
- **Coins: bank gold, park if broke.** Buy steps draw coins from the bank; an
  account that cannot cover a shopping list parks the quest with a visible
  `need ~N gp` reason. Smokes prep gold via account cheat (the established
  mining-15/attack-40 convention).
- **Structure: one project, capabilities first.** Wave 1 engine (buy + death
  recovery), wave 2 Prince Ali (exercises buy), wave 3 Waterfall (exercises
  death recovery).
- **Research: `.rs2` + maps only.** Classic-RS memories and guides are known
  traps on this content (cadava bush, Urhney's shack); every anchor, recipe,
  dialogue string, and shop stock is re-derived from the content sources and
  probe-verified where cheap.

## Engine capabilities (wave 1)

### Buy step

- New `QuestStep` kind: `{ kind: 'buy'; item: string; qty: number;
  shop: { npc: string; anchor: Tile }; estGp: number }`.
- Slots into the EXISTING gather mechanism — gather fns may return buy steps;
  provisioning is structurally unchanged.
- Executor is self-contained: pack coins < estGp → standard bank leg withdraws
  coins first; then walk the shop anchor, Trade the shopkeeper, buy via the
  proven Shop API (ShopRunner precedent), close.
- `QuestSnapshot` gains `bankCoins: number` (engine's last-seen bank count) so
  a PURE gather fn can detect broke (pack + bankCoins < estGp) and return
  `wait: 'need ~N gp for <item>'` — the wait-park liveness machinery turns
  that into a parked quest with the exact reason on the Queue tab. Composes
  with the existing mechanism; no second parking path.

### Death recovery

- Engine-level and quest-agnostic. Detect death via the respawn signature
  (lift the proven WildyAgility detection), then: log, clear the running
  quest's `provisioned` + `deposited` flags, reset the watchdog. That is the
  whole recovery — progress re-derives from journal + inventory every loop, so
  the next pass re-runs bank-first provisioning (spares come back out of the
  bank), gathers re-acquire what is not banked, and decide() resumes from
  wherever the journal actually is.
- Def-side contract: every carried intermediate must be re-obtainable (both
  quests guarantee this), and consumables declare headroom quantities so
  spares stay banked for the next attempt.
- Death is "involuntary deposit-everything plus a teleport" — no checkpoint
  files, no mid-quest state.

## Quest defs

### Prince Ali Rescue (wave 2, f2p, 3 QP, no combat)

- A wide gather web, all through existing step kinds + buy: wool (reuse sheep
  shear helpers), redberries/ashes/bucket-of-water (spawns + fountain useOn),
  flour (reuse the windmill custom), Ned's wig / Aggie's paste / Osman's key
  (talk + custom crafting steps with a clay imprint + bronze bar), pink skirt +
  3 beers + soft clay/bronze bar (buy steps).
- Back half: talk chain + ONE bespoke custom (the jailbreak: talk Keli → rope
  her → disguise the prince → clear the guard).
- Stage visibility: held intermediates disambiguate most stages; the R&J probe
  rotation covers the rest.

### Waterfall Quest (wave 3, members)

- Customs for the scripted rides (Almera's boat, the barrel — ladder-hop-style
  scripted teleports), the Glarial's-pebble leg (Golrie, Tree Gnome Village
  dungeon), the tomb leg (the unequip-everything gate: Equipment.unequip loop;
  research pins whether the gate also checks the pack), the falls rope entry,
  and the rune-stands + chalice finish.
- Food provisioned with headroom; death recovery is the safety net for the
  level-86+ giants. The def documents combat/HP expectations in comments
  (smoke preps stats + gold per convention).
- **Research risk #1:** the gnome-village maze gates may be pack-sealed
  (Juliet's-mansion class) — probe offline with the existing tooling before
  the def is written; curate edges as needed.
- **Research risk #2:** exact rune types/counts and stand mechanics for the
  final chamber — from quest_waterfall .rs2 only.

## Testing & rollout

1. Unit: per-def pure decide() suites; depositPlan-style tests for any new
   pure engine logic (coins math).
2. Live, in order: buy step exercised inside the Prince Ali smoke (no
   synthetic shop test); Waterfall smoke with prepped stats/gold; a
   **deliberate-death run** (weak stats, low food) verifying die →
   re-provision → resume → complete-or-honest-park.
3. Acceptance: `prince,waterfall` queued on one prepped account, both journals
   complete, clean stop.

## Out of scope

Earning coins in-quest (money-making fallback), death-proofing stat floors,
graves/item-reclaim mechanics beyond the re-obtain contract, other quests.
