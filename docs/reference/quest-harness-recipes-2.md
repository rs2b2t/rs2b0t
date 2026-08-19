[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (F)

## Family Crest — stage-scoped harness

Family Crest is eleven server stages across four kingdoms, so it has its own
harness rather than a `e2e/aio-quest-test.ts` invocation:
[`e2e/family-crest-210-live.ts`](../../e2e/family-crest-210-live.ts). It seeds a
fixed bank, jumps `%crestquest`, and passes when the journal reaches `--until`.

```sh
HEADED=1 bun e2e/family-crest-210-live.ts --stage 7 --until 8 --minutes 28   # the gold mine
HEADED=1 bun e2e/family-crest-210-live.ts --stage 0 --minutes 120            # end to end
```

Two things that harness has to do and a plain `setvar` does not:

- **Relog after the stage jump.** `update_questlist` recolours the journal entry
  at login only, and every module reads the tab rather than the varp — so a
  `setvar crestquest 7` without a relog leaves the quest reading *not started*.
- **Clear `crest_spells_levers_gauntlets` too.** The lever bits and the
  four-blasts-cast bits share that varp, so a stage jump that leaves it set
  starts Chronozon already weakened and the fight proves nothing.

It is **members-only** (`map_members`), so it needs the :8890 world, not :8888.

Caleb's five cooked fish and the two rubies are bank seeds by design — no shop
in the game stocks cooked bass or shrimp, and the Ardougne gem merchant restocks
a single ruby every 60k ticks. Everything else (moulds, antipoison, blast runes,
a pickaxe) is bought live.

## Fight Arena — stage-scoped harness

[`e2e/fight-arena-233-live.ts`](../../e2e/fight-arena-233-live.ts). Members content, so
`:8890` only.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | `setvar arenaquest N`, then relog so the quest list recolours |
| `--until N` | 14 | stop at this stage; 14 waits for the journal to go green |
| `--tick N` | 150 | server tick in ms; 150 is double speed |
| `--minutes N` | 120 | wall-clock budget |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--no-deploy` | off | skip the build and copy |

It deploys **its own copy of the client** through `deployIsolatedClient`: everything in
`out/` lands in `public/bot/<user>/`, and a generated `bot-<user>.html` points at it. Two
runs on one engine no longer overwrite each other, and the copy is swept on exit. That
also carries `navworker.js` and `collision.lcnav.gz`, both of which this quest needs —
refusing the arena's doors changed the transport graph, and a client-only deploy leaves
the navigator on the old edges.

The bank seed is coins, food and a rune melee kit — `rune_chainbody` rather than
`rune_platebody`, which wants Dragon Slayer. Nothing the quest can find in the world is
seeded: the Khazard disguise comes from the chest, the keys from the drunk guard and the
brew from the barman.

Stage starts: 1 and 2 at the chest, 3 and 5 outside the guard door, 6 and 8 on the arena
floor, 9 in the prison cell, 10 to 12 on the arena floor.

What the legs proved, at `--tick 150` on `:8890`:

| Leg | Result | What it covered |
|---|---|---|
| 0 → 2 | PASS, 1 min | Lady Servil, the journal parse, the chest's north-only stand, the disguise, the guard door |
| 2 → 5 | PASS, 3 min | the drunk guard, the walk out for a brew (`coins 1000→995`), the keys (`khali brew 1→0, cell keys 0→1`) |
| 5 → 9 | PASS, 3 min | the keys reclaimed after a death, the cell-gate cutscene, the ogre — 10 attacks, no damage taken under Protect from Melee |
| 9 → 12 | PASS, 5 min | Hengrad's cutscene out of the cell, the scorpion, Bouncer, the agreement — hitpoints never left 99, prayer 99 → 53 |
| 12 → 14 | PASS, 2 min | both scripted doors outward, the walk to Lady Servil, `QUEST COMPLETE`, 2 quest points |
| 0 → 14 | PASS, 7 min | the uncheated run: 26 steps, no parks, nothing seeded but coins, food and a banked rune kit |

The 5 → 9 leg overshoots its `--until 8` on purpose, and a leg that starts inside a pocket
spends its first three minutes watching the engine fail to reach a bank. Both are
explained in [Fight Arena's pitfalls](../decisions/quest-pitfalls-4.md).

## Fishing Contest — stage-scoped harness

[`e2e/fishing-contest-244-live.ts`](../../e2e/fishing-contest-244-live.ts). Members
content, so `:8890` only.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | the `%fishingcompo` value, 0 to 4, with its companion varps and the pass |
| `--until N` | 5 | stop at this stage; 5 waits for the journal to go green |
| `--tick N` | 300 | server tick in ms; 150 is double speed |
| `--minutes N` | 75 | wall-clock budget |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--stats N` | 99 | every skill, since the road crosses White Wolf Mountain |
| `--no-deploy` | off | skip the build and copy |

It deploys **its own copy of the client** through `deployIsolatedClient`: everything in
`out/` lands in `public/bot/<user>/` and a generated `bot-<user>.html` points at it, so a
neighbouring harness cannot decide mid-boot which branch this run exercises. The copy is
swept on exit, and it carries `navworker.js` and `collision.lcnav.gz` — this quest walks
from Draynor to Kandarin, so a client-only deploy would leave the navigator on old edges.

`--stage` writes three varps rather than one. `%fishingcompo` is the contest stage,
`%hemenster_comp_stage` counts the fee and the catches, and `%hemenster_pipe_stashed`
records the clove — and Bonzo re-seats a contest whose fee counter disagrees with the
stage, so a bare `setvar fishingcompo 3` describes a state the engine will not honour.
Each is read back, and the seed relogs because `update_questlist` recolours the tab at
login only.

The bank holds coins and food and nothing else: the clove comes from Morgan's cupboard in
Draynor, the spade from a house floor, the rod from Harry's in Catherby and the worms from
McGrubor's Wood. Stage 0 and 1 start at the Draynor bank; 2 and up start at Catherby,
because past the fee the quest never leaves Kandarin.

`--stage 2` is the exception: it hands over a clove, a rod and five worms, because a
character standing in a paid-up contest is carrying them, and making that leg walk to
Draynor for a clove buries the garlic stash it exists to test under a fifteen-minute round
trip. `--stage 3` seeds nothing, so it still proves the rod and the worms are sourced.

What the legs proved, at `--tick 150` on `:8890`:

| Leg | Result | What it covered |
|---|---|---|
| 0 → 5 | **PASS, 6 min** | the uncheated run: 16 steps, no parks, `QUEST COMPLETE` and 1 quest point |
| 2 → 4 | PASS, 2 min | the gate, the garlic stash, three carp — zero failed steps |
| 3 → 4 | PASS, 4 min | the rod at Harry's, the spade at Edmond's, the worm dig and three carp |

Every leg is proved by an inventory delta rather than a log line: `garlic 0→1` at the
cupboard, `spade 0→1` at the spawn, `fishing pass 0→1` from the dwarf, `coins 1000→995`
at Harry's, `red vine worm 0→5` in the wood, `coins 995→990` to Bonzo, `garlic 1→0` at the
pipe, three `raw giant carp` and finally `fishing trophy 1→0`. The eleven pitfalls the
live runs paid for are in [Fishing Contest's pitfalls](../decisions/quest-pitfalls-13.md).

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
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
- [Seeding test accounts](seeding-test-accounts.md)
