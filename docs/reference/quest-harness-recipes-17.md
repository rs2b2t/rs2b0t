[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Big)

Per-quest seed and stage commands, with what each recipe has proven.

## Big Chompy Bird Hunting — stage-scoped harness

[`e2e/chompy-bird-235-live.ts`](../../e2e/chompy-bird-235-live.ts) takes `--stage N`
(`%chompybird`, 0 to 60 in fives) and relogs, since `update_questlist` only recolours the
journal at login. It is members-only, so it needs the :8890 world.

The bank holds coins, food and a melee kit. The axe, the feathers, the knife, the chisel,
the bellows, the arrows, the bait and all six seasonings have sources in the world, and
seeding one hides whether the bot finds it.

| Recipe | What it proves | Status |
|---|---|---|
| `--stage 5 --until 15` | The arrow chain end to end: axe, kit, feathers, five achey trees, four wolves, twelve arrows, the hand-over | **PASS** (13min) |
| `--stage 25 --until 40` | The chest, the bellows, the toads, the bait, and Rantz missing his shot | **PASS** (2min, reached 45) |
| `--stage 45 --until 65 --stocked` | Buying the replacement bow, the hunt, the pluck, the children, all six seasonings, the roast and the hand-over | **PASS** (10min, QP 0→2) |
| `--stage 0 --until 65` | Start to finish from a clean account, 53 steps and three retried ones | **PASS** (13min, QP 0→2) |

Three details govern this harness:

- **Stats are 70 rather than maxed.** The wolves that carry the arrow tips are level 64
  and the chompy dies to one ogre arrow at 70 ranged, so nothing here needs more.
- **A mid-quest start banks a knife and a chisel.** Bugs sells the pair at
  `^chompybird_started` alone, so a run seeded past it has no other source.
- **`--stocked` banks an axe and five hundred feathers.** Both are ordinary bank clutter,
  and banking them skips the Lumbridge and Port Sarim legs a from-scratch run walks.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
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
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Quest pitfalls: Big Chompy Bird Hunting](../decisions/quest-pitfalls-32.md)
- [Seeding test accounts](seeding-test-accounts.md)
