[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (S–Z)

Per-quest seed and stage commands, with what each recipe has proven.

## Sea Slug — stage-scoped harness

[`e2e/sea-slug-259-live.ts`](../../e2e/sea-slug-259-live.ts) drives the quest from a
clean account or from any point inside it. `--stage N` writes `%seaslugquest`
straight, 0 to 11, then relogs so the quest list recolours.

```sh
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 12 --minutes 40 --tick 200  # end to end
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 3 --minutes 15 --tick 200   # Caroline, Holgart, the Khazard paste
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 3 --until 6 --minutes 15 --tick 200   # the ladder, the crates, Kent
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 6 --until 8 --minutes 20 --tick 200   # Bailey's torch and the rub
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 8 --until 12 --minutes 20 --tick 200  # the panel, the crane, the reward
```

The bank holds coins and food alone. The swamp paste is bought at the Khazard
counter, and the torch, the damp sticks and the broken glass all have sources on the
platform.

Measured at `--tick 200`, no parks: **5 minutes** from a clean account to quest
complete. Per leg — stages 3 to 6 in 2 minutes, stage 6 to complete in 3.

Four details govern this harness:

- **`--stage` is the raw varp.** Every step of this quest is a `%seaslugquest` write
  and nothing else, so one `setvar` seeds any point in it. The relog is what makes the
  quest list agree with the varp.
- **Stages 7-10 are seeded with an unlit torch.** Bailey replaces a lost torch on
  stages 7-9 and has no line at all on stage 10, so a torchless seed there can neither
  climb the ladder nor ask for a replacement.
- **Stats are 70 rather than maxed.** Nothing on this quest fights — every sea slug
  and fisherman is `vislevel=hide` — and the only damage in it is the 4 for climbing
  the ladder without a lit torch.
- **It fails in the first minute if the loaded bundle has no Sea Slug in its queue.**
  The engine serves one `public/bot`, and a concurrent session that deploys while this
  harness boots hands the run their branch instead.

## Shield of Arrav

Two harnesses, because one account cannot finish the quest.

[`e2e/shield-of-arrav-232-live.ts`](../../e2e/shield-of-arrav-232-live.ts) drives one gang
side. Two varps, seeded one at a time — `~completequests` opens a gang-choice dialog
nothing answers and completes nothing:

```
--gang phoenix|blackarm   which side to run
--phoenix N --blackarm N  seed both varps, then relog
--until N                 target varp value
--want-half               assert a Broken shield lands in the pack instead
```

`--want-half` exists because the half-farming legs move no varp: the chest and the
cupboard hand over an object and nothing else changes. Asserting the varp there passes
before the leg has run.

It must **not** assert `journal === 'complete'` — a lone account can never redeem. At
`--gang blackarm --blackarm 2` it seeds a `phoenixkey2` into the bank and says so: only
Straven issues one, and joining Phoenix makes Katrine refuse you, so that stage is not
self-sufficient by construction.

[`e2e/shield-of-arrav-pair-232-live.ts`](../../e2e/shield-of-arrav-pair-232-live.ts) is the
only run that turns the journal green. One `browser.newContext()` per account, because
settings live in `sessionStorage` keyed `rs2b0t:set:<Script>:<key>` and a shared context
cross-contaminates the two bots. PASS wants all four: `phoenixgang = 10`,
`blackarmgang = 4`, and both journals green.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
