[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (P–R)

Per-quest seed and stage commands, with what each recipe has proven.

## Pirate's Treasure — stage-scoped harness

[`e2e/piratestreasure-231-live.ts`](../../e2e/piratestreasure-231-live.ts) drives the
quest from a clean account or from any point inside it.

```sh
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 0 --until 4 --tick 300 --minutes 120   # end to end
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 0 --crate-rum 0 --until 2 # the smuggle
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 2 --crate-rum 2 --until 2 # the back room
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 2 --until 4                            # chest, note, dig
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 3 --until 4                            # the dig alone
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 2 --crate-rum 0 --until 2 # lost rum
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 3 --crate-rum 1 --until 2 # re-smuggle
```

Measured at `--tick 300`, no parks: **8 minutes** from a clean account to quest
complete. Per leg — stage 0 to the start 1 min, the smuggle 5 min, chest to dig 4 min,
the dig alone 2 min, and each recovery path — `--employed 3 --crate-rum 1` and
`--employed 2 --crate-rum 0` — 6 min.

Three details govern this harness:

- **`--stage` alone reaches a third of the quest.** The smuggle lives in
  `%hunt_store_employed`, `%crate_rum` and `%crate_bananas` as well as `%hunt`, and a
  bare `setvar hunt 1` describes only the state before the rum is bought. Each flag is
  set and read back, because a `setvar` against a name the engine does not know is
  dropped silently.
- **Every seed relogs.** `update_questlist` recolours the journal at login only, and the
  module reads the tab rather than the varp.
- **The bank holds coins and food and nothing else.** The rum, the white apron and the
  spade all have sources in the world; seeding one hides whether the bot can find it.

It runs on `:8890` even though the quest is free-to-play: bank seeding needs `givebank`
or `~bankitem`, and the `:8888` sim answers neither.

**`--no-deploy` is only safe when nothing else is deploying.** The engine serves one
`public/bot/` bundle to every client, so a run that skips its own deploy loads whatever
the last writer left there. A parallel run here came up executing Rune Mysteries with
Plague City in its queue and no Pirate's Treasure at all — another branch's bundle,
landed between the deploy and the page load. The queue line names the build, so read it
before trusting a `--no-deploy` result.

`--employed 3 --crate-rum 1` is the one state a fresh account cannot reach on its own.
It is the re-smuggle, and the only run that exercises the `store-job` disambiguation —
see [Quest pitfalls](../decisions/quest-pitfalls-3.md).

## Plague City — stage-scoped harness

[`e2e/plague-city-243-live.ts`](../../e2e/plague-city-243-live.ts) drives the quest
from a clean account, or one stage of it. `--stage N` sets `%elenaquest`, hands over
the items that stage assumes were already given, and relogs.

```sh
HEADED=1 bun e2e/plague-city-243-live.ts --stage 0 --until 29 --minutes 120  # end to end
HEADED=1 bun e2e/plague-city-243-live.ts --stage 3 --until 8 --minutes 30    # water and the dig
HEADED=1 bun e2e/plague-city-243-live.ts --stage 10 --until 23 --minutes 40  # West Ardougne chain
HEADED=1 bun e2e/plague-city-243-live.ts --stage 26 --until 29 --minutes 40  # cure, warrant, rescue
```

Measured at the default `--tick 300`, no parks:

| Stages | Minutes | Covers |
|---|---|---|
| 0 → 3 | 4 | Edmond, the McGrubor's berries, Alrena |
| 7 → 10 | 3 | spade, garden dig, rope, the grill |
| 20 → 23 | 2 | the Rehnisons and Milli |
| 23 → 27 | 13 | clearance, the clerk, Bravek, the cure loop |
| 27 → 29 | 2 | the plague house, Elena, Edmond, the scroll |
| 0 → 29 | 23 | a clean account to `QUEST COMPLETE!` |

The cure block is the long one — a cow, the snape grass beach, Taverley and Port Sarim.

The bank holds coins and food and nothing else. The spade and the picture sit on
Edmond's floor, the buckets and berries are ground spawns, the rope comes from
Aemad and the cure ingredients from Wydin, Jatix, a cow and the snape grass spawns
south of the Crafting Guild — seeding any of them hides whether the bot can find it.

The garden leg is the one place a seeded bank changes the shape of a run: the soil
takes four pours, the only bucket spawn in reach is the single one at (2616,3255),
and `--stage 3` on an unseeded bank spends three respawn waits on it before the
fountain trip. Bank four buckets to time the fill and pour legs alone.

Five details govern this harness:

- **It is members-only (`map_members`), so it needs the :8890 world.** The :8888
  sim also answers neither `givebank` nor `~bankitem`, so a run there starts with
  an empty bank and parks on the coin float.
- **Stages 20/21 and 24/25 render the same journal text.** The module reads the
  Book and the clerk's own answer to tell them apart, so a `--stage 21` seed that
  leaves a Book in the pack tests the wrong branch.
- **Stage 9 starts in the sewer.** `%elenaquest 9` means the rope is already tied,
  which only makes sense below ground, so that stage teleports to the mud pile.
- **One engine serves every worktree.** A second harness deploying its own bundle
  replaces this one mid-run, and the AIOQuester queue line is where it shows; the
  harness reads that line and fails fast rather than running the wrong quest list.
- **Stage 27 needs a mourner outside the plague house.** The door's op returns in
  silence when none is within 14 tiles, so a `--stage 27` leg that lands on an empty
  street logs the wait rather than the crossing.

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
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
