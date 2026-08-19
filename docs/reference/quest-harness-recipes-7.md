[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Sea–Shades)

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

## Shades of Mort'ton — stage-scoped harness

[`e2e/mortton-255-live.ts`](../../e2e/mortton-255-live.ts), members-only, so `:8890`:

```sh
HEADED=1 bun e2e/mortton-255-live.ts --stage 0 --until 85 --minutes 120 --tick 200            # end to end
HEADED=1 bun e2e/mortton-255-live.ts --stage 5 --until 47 --minutes 45 --tick 200 --stocked   # serum, five shades, the handover
HEADED=1 bun e2e/mortton-255-live.ts --stage 47 --until 65 --minutes 60 --tick 200 --stocked  # the temple and the flame
HEADED=1 bun e2e/mortton-255-live.ts --stage 60 --until 85 --minutes 45 --tick 200 --stocked  # the flame and the cremation
```

Every mid-quest leg wants `--stocked`: the coins, food, tinderbox, ashes, spare
log and melee kit are all assembled around Varrock, and a leg that only means to
test Mort'ton otherwise spends its budget walking there and back. Leave it off
for anything claiming the quest works from nothing.

Five things it does that the Nature Spirit shape does not:

- **Levels, not `~maxme`.** `--levels 70` (the default) walks every skill up with
  `~addxp`, because the temple's build rolls and its resource bands are all
  `stat_random(crafting, …)` — a maxed account rebuilds it on numbers the module
  is not claiming. `~addxp` takes **plain xp**, not the engine's internal tenths,
  even though the `stat_advance` it wraps takes tenths.
- **Sets three prerequisites.** Priest in Peril walls Morytania off, and the
  Mort Myre gate guard refuses while `%druidspirit` is 0, so `prieststart`,
  `priestperil` and `druidspirit` all go in and the run relogs.
- **Gives remains from `--stage 40` on.** Five at 40, because Razmire wants five
  in one pack before he takes any; two from 45, because he has taken his and
  Ulsquire his, and only the pyre and its retry are left to feed.
- **Prints the three flamtaer meters on every poll** (`temple=repaired%/pool%/sanctity%`).
  They are the only transmitted varps this quest has — `%morttonquest` is not one —
  and they are what the temple leg reads.
- **`--stocked` gives a mid-quest start the approach pack.** Coins, food, a
  tinderbox, two ashes, the pyre log and the melee kit, which is what the Varrock
  leg of a stage-0 run assembles.

The bank holds coins, food and a melee kit. Everything else has a source in the
world: the diary and the two tarromin are in Herbi Flax's house, the empty vials
are ground spawns beside them, the water is the Mort'ton sink, the logs are the
two spawns beside the Varrock east bank, the tinderbox is the Varrock general
store, and every building material is Razmire's.

Measured end to end at `--tick 200`: **9 minutes, 38 steps, no parks** — walking,
with no teleports, from a clean account. Two steps failed and recovered on their
own: the swamp crossing outran its 90-second walk budget once (and paid two
lobsters to the ghasts), and the first strike at the altar spent its budget
climbing sanctity from a cold start.

The temple is world state, and its walls hold for 9000 ticks — so a leg run soon
after another leg finds it already rebuilt, and one run later finds the shades
have knocked it back down. Both are states the module has to handle, and both
turn up on their own if the legs are run back to back.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Fre)](quest-harness-recipes-18.md)
- [Quest harness recipes (G)](quest-harness-recipes-11.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Her)](quest-harness-recipes-19.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M)](quest-harness-recipes-6.md)
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
