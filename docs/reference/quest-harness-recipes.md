[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (A–D)

Per-quest seed and stage commands, with what each recipe has proven.

## Biohazard — stage-scoped harness

[`e2e/biohazard-234-live.ts`](../../e2e/biohazard-234-live.ts) drives the quest from a
clean account, or one leg of it. `--stage N` writes `%biohazard`, hands over the items
that stage assumes were already given, and relogs. Plague City is completed for you.

```sh
HEADED=1 bun e2e/biohazard-234-live.ts --stage 0 --until 16 --minutes 150 --tick 100  # end to end
HEADED=1 bun e2e/biohazard-234-live.ts --stage 0 --until 5 --minutes 30 --tick 100    # birds and the wall
HEADED=1 bun e2e/biohazard-234-live.ts --stage 5 --until 7 --minutes 30 --tick 100    # the headquarters
HEADED=1 bun e2e/biohazard-234-live.ts --stage 12 --until 14 --minutes 40 --tick 100  # the smuggle to Guidor
```

The bank holds coins and food alone. The bird feed, the pigeons, the rotten apples, the
doctors' gown, the mourner's key and the priest suit all have sources in the world.

Measured at `--tick 100`, no parks:

| Stages | Minutes | Covers |
|---|---|---|
| 0 → 5 | 2 | Elena, Jerico, the cupboard, the pigeons, the tower, Omart |
| 5 → 7 | 3 | the yard fence, the cauldron, the gown, the key, the crate |
| 7 → 10 | 1 | Kilron back over the wall, the distillator to Elena |
| 10 → 12 | 3 | the walk to Rimmington and the chemist |
| 12 → 14 | 5 | the errand boys, Thessalia, the gate, the inn, Guidor |
| 14 → 16 | 2 | Elena and King Lathas |
| 0 → 16 | 14 | a clean account to `QUEST COMPLETE!` |

The Rimmington and Varrock legs are the long ones, and both are walking rather than work.

Five details govern this harness:

- **It deploys its own copy of the client.** `deployIsolatedClient` puts the bundles under
  `public/bot/<user>/` and serves them from `/bot-<user>.html`, so a concurrent session's
  deploy cannot replace them mid-run. Doing it any other way loses `navworker.js` as often
  as `botclient.js`, and a stale navworker reads as a bug in this quest's own new transport.
- **It is members-only and needs Plague City complete.** The harness sets `%elenaquest 29`
  and relogs, because `update_questlist` only recolours the journal at login and the module
  is gated on the *journal*, not the varp.
- **Stats are 70, not maxed.** `setstat` is a built-in cheat branch with no level-up
  cascade, so it leaves the player undelayed — unlike `~maxme`, which swallows the next
  typed command.
- **Stages 5 to 7 start in West Ardougne** and stage 12 at the Rimmington chemist; every
  other stage starts at the Ardougne booth.
- **A mid-quest start past the wall costs one round trip.** The module defers its bank read
  to the mainland, so `--stage 6` walks out over Kilron, reads the booth, and comes back
  over Omart's ladder before the gown leg. A run from stage 0 reads the bank on its first
  tick and never pays it.

## Clock Tower — stage-scoped harness

[`e2e/clock-tower-236-live.ts`](../../e2e/clock-tower-236-live.ts) drives the
quest from a clean account, or one leg of it. `--stage N` counts **cogs already
placed**, 0 to 4, and writes `%cogquest` and `%cog_bits` together before
relogging.

```sh
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 0 --until 5 --minutes 60 --tick 200   # end to end
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 0 --until 1 --minutes 20 --tick 200   # black: bucket, water, cool
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 2 --until 3 --minutes 20 --tick 200   # blue: the secret wall
HEADED=1 bun e2e/clock-tower-236-live.ts --stage 3 --until 4 --minutes 25 --tick 200   # white: lever, poison, gate
```

The bank holds coins and food alone. The bucket, its water and the rat poison
all have sources in the world, and seeding one hides whether the bot finds it.

Measured end to end at `--tick 200`: **6 minutes** from a clean account.

Four details govern this harness:

- **The two varps have to move together.** `%cogquest` bits 0-3 carry the step
  and `%cog_bits` carries which spindles are filled, so setting one alone leaves
  the journal and the world disagreeing. `--stage` writes both, in the module's
  own fetch order — black, red, blue, white — and sets the cooled bit whenever
  black is already placed, or the bot pours a second bucket over a cold cog.
- **Stats are maxed rather than 70.** Ogres stand over the red cog and stay
  passive only above 106 combat; at 70 they chew on the bot for the length of
  the leg.
- **`--until 5` waits for the quest list to go green**, not for the varp: the
  recolour and the quest point land a tick behind `%cogquest`.
- **It fails in the first minute if the loaded bundle has no Clock Tower in its
  queue.** The engine serves one `public/bot`, and a concurrent session that
  deploys while this harness boots hands the run their branch instead.

## Dwarf Cannon — stage-scoped harness

Dwarf Cannon needs no items and no prerequisite quests: the Commander issues the railings
and the tool kit, Nulodion issues the notes and the mould, and every one has a re-issue
branch. The bank seed is coins, food and a melee kit only — seeding anything the quest
hands out would hide a dialogue that never fired.

[`e2e/dwarf-cannon-254-live.ts`](../../e2e/dwarf-cannon-254-live.ts) takes `--stage N`
(`%mcannon`) and `--multi N` (`%mcannonmulti`: bits 5-10 are the six railings, bits 0-3
the four cannon components), then relogs, since `update_questlist` only recolours the
journal at login. Useful `--multi` values are `2016` for all six railings, `15` for all
four components and `2031` for both.

| Recipe | What it proves | Status |
|---|---|---|
| `--stage 1 --multi 0 --until 2` | Six railings, and the Commander accepting them | **PASS** (3min) |
| `--stage 2 --multi 2016 --until 3` | The watchtower climb, the remains, the descent | **PASS** (4min) |
| `--stage 3 --multi 2016 --until 5` | The goblin cave, the crate, the mud-pile exit | **PASS** (3min) |
| `--stage 5 --multi 2016 --until 9` | The tool kit, the shed door, the repair menu | **PASS** (7min) |
| `--stage 9 --multi 2031 --until 11` | Nulodion, and the hand-back | **PASS** (4min) |
| `--stage 4 --multi 2016 --at 2620,9797,0` | Resuming from inside the cave | **PASS** (12min, QP 0→1) |
| `--stage 0` | Start to finish | **PASS** (17min, QP 0→1) |

## See also

- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (H)](quest-harness-recipes-8.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S)](quest-harness-recipes-7.md)
- [Quest harness recipes (T)](quest-harness-recipes-9.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
