# BankFletcher arrow fletching (attach mode) — design

**Date:** 2026-07-21
**Status:** approved
**Prune:** delete this spec once the feature is live-verified and merged (living-docs rule).

## Goal

BankFletcher fletches arrows: attach Feathers to Arrow shafts (headless
arrows) and `<Metal>` arrowheads to Headless arrows (finished arrows), as a
new product mode inside the existing bank-standing cycle.

## Ground truth (content scripts — the engine's own behavior)

From `rs2b2t-content/scripts/skill_fletching/scripts/arrows.rs2` +
`configs/arrows/arrows.dbrow`:

- One `opheldu` use (item on item) attaches `min(inputA, inputB, 15)`
  INSTANTLY — no make-menu, no count dialog. Repeat clicks to continue.
- Headless arrows: Feather + Arrow shaft, level 1, 1 xp each.
- Tiers (`fletching_table`): bronze L1 / iron L15 / steel L30 / mithril L45 /
  adamant L60 / rune L75; product `<metal>_arrow` ×15 per set.
- Below the tier level the engine mesboxes a refusal (no consumption).
- `map_members = false` worlds refuse arrow fletching entirely. Both the
  local dev world and prod are `members: true` (verified in
  `rs2b2t-engine/data/config/world.json` and `rs2b2t/ops/box/hydrate-env.sh`)
  — no in-bot handling; on an F2P world nothing progresses and the existing
  no-progress stop applies.

## Design

**Product options** (user decision: per-tier, one attach step per run):
existing `Arrow shafts | Short bow | Long bow` plus `Headless arrows`,
`Bronze arrows`, `Iron arrows`, `Steel arrows`, `Mithril arrows`,
`Adamant arrows`, `Rune arrows`.

**Mode resolution:** an attach product implies its inputs — no tool, and the
`material`/`knife` settings are ignored (help text says so):
- `Headless arrows` → Feather + Arrow shaft
- `<Metal> arrows` → `<Metal> arrowheads` + Headless arrow

**Cycle (attach mode):** at the bank stand — deposit-all; withdraw BOTH
inputs via their real Withdraw-All ops (all stackable → two slots); then the
click-loop: use A on B, wait for the product count to rise (or an input to
hit zero), click again. When either input is exhausted → deposit-all,
re-withdraw, repeat. Bank dry of an input → clean stop with the standard
"bank dry" message. `ContinueDialog` (already in the task set) clears
level-up interruptions.

**Level gate:** at start, refuse products above `Skills.level('fletching')`
using a mirrored tier table (same shape as ArdyFighter's stat gate).

**Pure logic (`BankFletcherLogic.ts`):** `ATTACH_PRODUCTS` table
(option → { inputs: [a, b], product, level }) + `attachPlanFor(product)`
resolver + `isAttachProduct(product)`. `matchProduct` (knife mode) is
untouched. Unit-tested plain (no client imports), house-style.

**Smoke (`tools/bankfletcher-test.ts`):** after the existing knife phase —
seed `::give feather 60` + `::give arrow_shaft 60`, switch product to
`Headless arrows` (settings key write, same idiom as other smokes), run a
full cycle, assert headless count grew and a deposit happened; then seed
`bronze_arrowheads` and run a `Bronze arrows` phase off the produced
headless. Both phases fit the existing 360s budget (attaches are instant).

## Out of scope

Auto-chaining shafts→headless→tipped in one run (run twice with different
products); auto-best tier selection; ogre arrows/bolts/darts.

## Error handling

- Withdraw of a missing input → clean stop (existing dry-bank idiom).
- No product-count rise after a use click (dialog swallowed the action, full
  pack of something else, F2P refusal) → re-click after the standard
  delayUntil timeout; the existing no-progress watchdog is the backstop.
- Full pack for the first 15 products: the engine refuses with a message
  (space guard); deposit-all at cycle start prevents this state.

## Testing

Unit: tier table integrity, `attachPlanFor` resolution (all 7 products +
unknown → null), keyword matcher untouched for knife products.
Live: extended `bankfletcher-test` smoke (headless + bronze phases) in the
fleet; xp/log lines are the engine-truth evidence.
