[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Eadgar's Ruse

Eadgar's Ruse spans four kingdoms, three shops and a crate maze, and most of what it
cost was geography rather than dialogue.

- **A quest's own prerequisite list is not what the content checks.** The guide says Troll
  Stronghold; `troll_eadgar.rs2` checks `%troll_freed_eadgar`, a varbit Troll Stronghold
  never requires. A character can finish that quest on Godric alone and then walk into an
  empty cave with nobody to talk to. Read the *entry* script, not the requirements table.
- **The completed journal still carries the sub-progress the varbit holds.** "I've rescued
  Godric and Mad Eadgar." survives quest completion, so the flag is readable long after
  `Quests.status` has flattened to `complete` — read it once and cache it rather than
  parking on a state nothing else exposes.
- **A staircase written as `switch_int(loc_angle)` is invisible to the stair deriver.**
  `tools/nav/stairsParse.ts` only understands `case <coord> : p_telejump(...)`, so the one
  staircase joining the stronghold to its storeroom was missing from the graph and the
  goutweed crate read `unreachable` from every tile in the game. The doors past it had
  been derived; only the stair was absent, which is the shape that reads as a
  content bug rather than a nav gap.
- **A component count, not a distance, says whether an area is reachable.** The storeroom
  half of the bottom floor is four disconnected pockets joined by two doors and that stair.
  Flood the collision pack per pocket before assuming a walkable tile can be walked to.
- **Every unfinished potion in 2004 displays as "Unfinished potion".** A name-keyed
  withdraw pulls whichever unf the bank sorted first, so the troll-potion chain is
  addressed by object id — the ranarr vial is id 99 and nothing about its name says so.
- **A varbit gate with no message is indistinguishable from a missing item.**
  `make_alco_chunks` needs both of Parroty Pete's conversation bits and prints nothing at
  all when only one is set. Neither is visible to the client, so both lines are re-asked
  on every pass; two dialogues cost less than one unexplained no-op.
- **A shop that stocks four of the five things a leg needs decides the route.** Heckel
  Funch sells the pineapple, the vodka and the knife, and Gulluck sells the axe one ladder
  above him — so the axe the scarecrow needs at stage 60 is bought on the parrot trip at
  stage 30 rather than paying for a second seven-hundred-tile walk.
- **A fenced field is a sealed pocket until its stile is in the graph.** The Ardougne wheat
  field — the closest grain to the zoo, the trees and the chicken farm — was 228 tiles with
  no way in. One curated `Climb-over` pair opened it.
- **The journal prints the shopping list, so read it rather than counting.** At stage 70
  the quest-list tab names what Eadgar is still short of, singular and plural
  ("1 sheaf of grain", "10 sheaves of grains"), which is the only way to know what a
  half-finished turn-in still owes after a restart.
- **A food float sized for the pack is not sized for the walk.** The scarecrow is sixteen
  slots of grain and chicken, so the float was trimmed to four to fit it — and the run then
  died to thrower trolls three times, because the trim stayed on across stage 70
  including the crossings where the pack was empty. Shrink a float while the load is being
  gathered, not while the stage that gathers it is open.
- **A crossing nothing fights back at is a prayer problem, not a combat problem.** Five
  thrower trolls open on sight across the only way onto Trollheim, and this quest walks it a
  dozen times. Protect from Missiles tracking the throwers — up while one is in range, down
  the moment the last is behind — is what makes the leg survivable, and it is the same
  pattern Troll Stronghold already needed.
- **`public/bot` is shared, and a quest that adds transport edges cannot detect the loss.**
  A neighbouring session's deploy landed inside the boot window twice, and the only symptom
  was `no path to (2890,10086,2): unreachable` — the module was fine, the navworker was
  someone else's. Use [`deployIsolatedClient`](../../e2e/lib/harness.ts); it is what it is
  for.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Troll Stronghold and the mountain](quest-pitfalls-3.md)
- [Add a quest](../how-to/add-a-quest.md)
