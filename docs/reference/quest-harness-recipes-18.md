[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Fre)

## The Fremennik Trials — stage-scoped harness

[`e2e/fremennik-trials-266-live.ts`](../../e2e/fremennik-trials-266-live.ts). Members
content, so `:8890` only.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | trials already won, 0 to 7, then relog so the quest list recolours |
| `--until N` | 8 | stop at this vote count; 8 waits for the journal to go green |
| `--tick N` | 200 | server tick in ms |
| `--minutes N` | 180 | wall-clock budget |
| `--stats N` | 70 | every skill, which clears Woodcutting 40, Crafting 40 and Fletching 25 |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--shark-shop` | off | bank no shark and set Priest in Peril complete, so the Canifis buy runs |
| `--no-deploy` | off | skip the build and copy |

```sh
HEADED=1 bun e2e/fremennik-trials-266-live.ts --stage 0 --until 1 --minutes 45   # the drinking contest
HEADED=1 bun e2e/fremennik-trials-266-live.ts --stage 0 --until 8 --minutes 180  # end to end
```

`--stage` is a trial count, not a varp. `%viking` is one plus the vote total and each
trial keeps its own bit range in `%viking_bits`, so seeding the votes alone describes a
state the quest cannot reach — the journal shows three votes while every trial reads
not-started, and the bot walks back into work it has already been paid for. The harness
writes both, in the module's own order: reveller, bard, hunter, navigator, merchant,
seer, warrior.

The bank seed is coins, food, a rune melee kit and **one raw shark**. Everything else
the quest needs has a source the bot walks to — the axe and knife spawn inside Rellekka,
the tinderbox is Arhein's in Catherby, the beer is the Forester's Arms, the keg is Peter
Potter's, and the stew vegetables grow at the town gate. The shark is the exception:
Rufus in Canifis is the only shop in the game that restocks one, and his door is
Morytania's, so `--shark-shop` sets Priest in Peril complete before it takes the seed
away.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (G)](quest-harness-recipes-11.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Her)](quest-harness-recipes-19.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M)](quest-harness-recipes-6.md)
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Quest pitfalls: The Fremennik Trials](../decisions/quest-pitfalls-33.md)
- [Seeding test accounts](seeding-test-accounts.md)
