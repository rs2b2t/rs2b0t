[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Hazeel Cult

Nine, and the first three generalise well past this quest.

- **`Reach.locOp` walks or acts, never both in one call.** When the loc starts outside the
  scene it runs `closeIn`, arrives, and returns `retry` without clicking. A tour of five
  sewer valves twenty tiles apart that bailed on the first `retry` therefore walked to
  valve one, failed, walked to valve two on the retry, failed, walked back to valve
  one — forever, at a cost of two minutes a lap. Failures do not feed the no-progress
  watchdog, so nothing parked it either. Any leg with more than one stop needs its own
  retry per stop.
- **A pocket in the same mapsquare is not a pocket you can walk to.** `m40_151` holds the
  mansion cellar, the cave mouth, four sewer islands, the cult hideout **and** the Clock
  Tower rat pen. From the hideout the Ardougne sewer ladder is twelve tiles away and
  renders in the scene, and there is no route to it. Box tests came from flooding the
  baked collision pack — 34 tiles at the cave mouth, 157 in the hideout — because every
  distance-based guess put an island or the cellar inside one of them.
- **A drop written by `ai_queue3` lands after the corpse leaves the scene.** The loop that
  waits for Alomone to disappear returns several ticks before `obj_add` fires, so the
  first look at the floor is empty and the leg reports a kill it could not collect. Wait
  on the item, not on the NPC.

Six are Hazeel Cult's own:

- **Both refusals are the same refusal.** `clivet_hazeel_cultist_fool` is reached from
  "You're crazy, I'd never help you." *and* from "So what would I have to do?" followed by
  "No. I won't do it.", and it is what sets `%hazeelcult_side` to the Carnillean side.
  Only "Ok, count me in" is unrecoverable, so the prefer list names all three safe answers
  and the leg uses `talkStrict`, which abandons rather than guessing.
- **The valve combination is a varp the client cannot see.** `%hazeelcult_valves` is
  `scope=perm` with no transmit, and `count_correct_valves` counts a *prefix* of set bits —
  four right and one wrong reads as the number before the wrong one. The only oracle is
  where the raft stops: the hideout, one of four islands, or nowhere at all. The module
  turns all five, rides, and treats any landing but the hideout as proof the belief was
  wrong.
- **`sewervalve3` is the odd one.** `_hazeelcult_valve` sets its bit on Turn-**left** for
  that loc and on Turn-**right** for the other four. Turning all five the same way leaves
  the raft where it is.
- **The hideout's only exit is the raft that brought you.** Every raft other than the one
  at (2567,9679) teleports back to the cave mouth, so the pocket escape is a `Board` and
  not a ladder. Registering it as a `LadderHop` would be worse than leaving it out —
  `crossHops` picks by distance and would send a character standing anywhere else at a
  stand it cannot reach.
- **`~obj_gettotal` counts the bank.** `defeat_alomone_hazeel_cultist` re-drops the armour
  on every kill *while no copy exists anywhere*, which makes a lost drop recoverable by
  fighting him again — and makes a banked suit a dead end that no amount of fighting
  fixes. The module keeps the armour off the deposit list and, at that stage, withdraws a
  banked one rather than riding back in.
- **The last step needs two NPCs in earshot, and says nothing when it has one.**
  `oploc1,hazeelcbopen` runs `npc_find(coord, sir_ceril_carnillean, 6, 0)` and the same for
  Jones, measured from the *player*, and returns in silence when either is out of range.
  A `driveUntil` on the journal would spend its full budget on that branch every time, so
  the leg watches for the chat going quiet instead and retries.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Habits](quest-pitfalls-habits.md)
- [Hazeel Cult's harness recipe](../reference/quest-harness-recipes-8.md)
- [Add a quest](../how-to/add-a-quest.md)
