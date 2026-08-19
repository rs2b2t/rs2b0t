[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Sheep–Shield)

Per-quest seed and stage commands, with what each recipe has proven.

## Sheep Herder — stage-scoped harness

[`e2e/sheep-herder-260-live.ts`](../../e2e/sheep-herder-260-live.ts) drives the quest
from a clean account or from any point inside it. `--stage N` sets `%sheepherderquest`,
`--done N` sets the per-sheep bitfield `%sheepherdervar`, and both relog.

```sh
HEADED=1 bun e2e/sheep-herder-260-live.ts --stage 0 --until 4 --minutes 90 --tick 300  # end to end
HEADED=1 bun e2e/sheep-herder-260-live.ts --stage 2 --until 1 --minutes 30 --tick 300  # the first sheep
HEADED=1 bun e2e/sheep-herder-260-live.ts --stage 2 --done 3 --until 4 --minutes 30    # the last sheep and the reward
```

Measured at `--tick 300`, no parks: **11 and 20 minutes** for two clean-account runs, and
5 minutes for `--done 3`. The spread is the sheep rather than the bot — each one walks
back toward its own spawn between prods, so a leg that costs 37 pushes on one run costs
255 on another.

Four details govern this harness:

- **`--done` seeds the bitfield, not the quest varp.** Each sheep owns a three-bit field
  in `%sheepherdervar` at bits 1, 4, 7 and 10, and 6 means incinerated. The journal reads
  its per-sheep lines out of those bits, so a `--stage 2` seed with the field at zero
  describes an account that has bought the suit and done nothing else.
- **`--stage 2` hands over the suit and the feed.** Both are untradeable and neither is
  banked, so a seed that skips Doctor Orbon has to give what he would have sold.
- **The bank holds coins and food and nothing else.** The prod lies on the barn floor
  inside the enclosure, the feed comes from Halgrive and the suit from Orbon; seeding any
  of them hides whether the bot can source it.
- **`--stats 70` is the default and the quest needs none of it.** There is no combat here
  at all — the levels are for the walk through Ardougne rather than the quest.

It is members-only, so it needs the `:8890` world; the `:8888` sim answers neither
`givebank` nor `~bankitem` either.

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
