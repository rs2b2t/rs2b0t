[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Tai–Temple)

Per-quest seed and stage commands, with what each recipe has proven.

## Tai Bwo Wannai Trio — brother-scoped harness

[`e2e/tbwt-261-live.ts`](../../e2e/tbwt-261-live.ts) drives the quest from a clean
account, or one brother's leg of it. Six varps are seeded together, then a relog.

```sh
HEADED=1 bun e2e/tbwt-261-live.ts --stage 0 --minutes 180 --tick 300                      # end to end
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --until 4 --minutes 45                        # the Lubufu bait leg
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --at 2912,3118,0                  # Tiadeche's catch
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --at 2844,3042,0     # Tamayu's hunt
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --tamayu 3 --flags 480  # the killing hunt alone
HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --tamayu 4 --at 2764,2976,0  # Tinsay
```

`--flags` is `%tbwt_flags`: bits 3-5 hold Tamayu's agility count, bit 6 that his spear
is strong enough, bit 7 that it is poisoned and bit 8 that the poison is Karambwan.

| `--flags` | State |
|---|---|
| `32` | four doses drunk, no spear given — the seed for testing the spear chain |
| `480` | four doses and an Iron spear(kp) — what the killing hunt needs |

A Tinsay-only run wants `--tamayu 4`: Tamayu is the only NPC on the island who will
skin a monkey, and he does it only once his own hunt is over.

`--packed` hands the kit straight to the pack. It is for iterating on one leg: a
mid-quest seed lands on Karamja, and without it the first four minutes of every leg
test are the ferry to Ardougne and back. The end-to-end run never takes it — sourcing
the kit is part of what that run proves.

Four details govern this harness:

- **`--stage` alone reaches none of the quest.** `%tbwt_main` holds one value across
  the brothers phase; the progress is in `%tbwt_tiadeche`, `%tbwt_tinsay`,
  `%tbwt_tamayu`, `%tbwt_lubufu` and `%tbwt_flags`, and each is set separately.
- **`%tbwt_main` and `%tbwt_tiadeche` are `transmit=yes`.** They are the exception the
  [varp decision](../decisions/quest-state-not-varps.md) names, so the module reads
  them off the wire and only opens the journal for the other three brothers.
- **The bank holds no knife, pestle or tinderbox.** Jiminua stocks all three inside the
  village, and seeding them would hide whether the bot can buy them. The net, seaweed,
  iron spear and agility potion are seeded, because nothing on Karamja sells those.
- **The kit is ranged.** `opnpc2,monkey` deflects every melee swing while the quest is
  live, so a seed with a scimitar in it never gets a monkey corpse.
- **The bundle guard earns its keep here.** Five other quest harnesses were deploying
  into the same `public/bot/` while this one was written, and one of them landed inside
  the fifteen seconds this harness spends booting. The queue-line check failed the run
  in the first minute with `another worktree deployed over it`; the fix is to rerun.

What the live runs paid for is in [Tai Bwo Wannai Trio's pitfalls](../decisions/quest-pitfalls-14.md).

## Temple of Ikov — stage-scoped harness

[`e2e/temple-of-ikov-250-live.ts`](../../e2e/temple-of-ikov-250-live.ts), members-only,
so `:8890`. The end-to-end command is vetted: uncheated `--until 100` finished in 39
minutes at `--tick 200`, on twenty lobsters, with no parks and no deaths. It was 70
minutes and about sixty lobsters before the ice cavern split into a crossing leg and an
armoured one, the chest search learned to read an empty chest, and the roots farm moved
to the peninsula in bank-picked gear.

```sh
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --until 100 --tick 200 --minutes 180              # end to end
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 10 --kit dungeon --until 30 --minutes 45  # boots, lever, arrows
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 30 --kit warrior --until 40 --minutes 30  # the Fire Warrior
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 40 --kit roots --until 60 --minutes 30    # Winelda
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 60 --kit guardian --until 100 --minutes 45 # guardians and Lucien
```

`--stage N` sets `%ikov` and relogs. `--lever` sets bit 0 of `%ikov_dungeon`, the
permanent unlock the south gate reads, so a stage test can skip the lava bridge.
`--until 100` asserts the journal is green rather than a varp value — the Armadyl
ending leaves `%ikov` at 80, not 100.

`--kit` is the seeding dial, and every step up it is a claim the run no longer makes:

| Kit | Adds | What it stops proving |
|---|---|---|
| `none` | — | nothing; the default |
| `dungeon` | pendant, candle, tinderbox, knife | the Catherby shops and the Seers knife spawn |
| `warrior` | + yew shortbow, 40 ice arrows, boots of lightness | the fletching chain, the ice chests, the webbed alcove |
| `roots` | + 20 limpwurt roots | the hobgoblin farm |
| `guardian` | + shiny key | Winelda's ferry — the key is what walks a seeded stage-60 run in through McGrubor's Wood |

The bank holds two million coins, three hundred lobsters, a set of studded leather and a
rune scimitar at every kit. Nothing else is seeded by default: the axe, the knife, the flax, the yew logs,
the bow string, the candle, the arrows, the boots and the roots each have a source the bot
walks to, and seeding one hides whether it can find it. The armour and the weapon are the
exception, because the quest sources neither — the module wears the best ranged pieces and
wields the best melee weapon the bank already holds, so an unseeded bank proves only that
it copes in boots with the yew axe.

Six facts govern this harness:

- **`--stats 70` is the default**, not 99. Thieving 42 and Ranged 40 are the server
  gates; woodcutting 60, fletching 65 and crafting 10 are what the yew shortbow costs,
  and the module warns rather than blocks below them.
- **The lava bridge fails at any non-negative weight.** The boots are -10lb worn, so
  the leg that crosses carries the candle, the pendant and food and nothing else — the
  bow is 3lb and never goes near it.
- **The armour goes on after the lever, never before it.** A studded body is 12lb, so the
  crossing leg fetches the boots and the lever alone and climbs out; the chest circuit is a
  second descent through the south gate, which needs no bridge. `--lever` does not skip
  that first descent: the module has no client-visible read on `%ikov_dungeon`, so it still
  walks to the gate to learn it is open — what the flag saves is the lava crossing behind it.
- **The Fire Warrior refuses anything but ranged with ice arrows in the quiver.** A run
  that reaches him without both stands there swinging and never lands a hit.
- **A seeded stage never walked the sourcing leg.** A run started at 50 has no axe
  banked, and bare fists against level-42 hobgoblins is what killed the first attempt,
  so the farm's arm check falls through to Aemad's counter when the bank is empty.
- **Winelda's teleport is one-way.** Past it the shiny key is the only way out, so a
  stage test seeded at 60 or 70 has to let the bot pick the key up before it can walk
  to Lucien.

What the live runs paid for is in Temple of Ikov's pitfalls, [engine behaviour](../decisions/quest-pitfalls-24.md), [the route](../decisions/quest-pitfalls-25.md) and [the fights](../decisions/quest-pitfalls-26.md).

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
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
