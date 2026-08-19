[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Temple of Ikov, the fights

The ten the Fire Warrior and the hobgoblin farm paid for; the route is on the
[second page](quest-pitfalls-25.md) and engine behaviour on the
[first](quest-pitfalls-24.md).

- **A bow over an empty quiver is not a weapon, and nothing says so but the chat box.**
  The warrior fight ends with the yew shortbow still worn and every ice arrow spent, and
  two legs later the hobgoblin farm answered every Attack click with "There is no ammo
  left in your quiver" until the camp killed the bot and its kit hit the floor. The arm
  check tests the quiver behind the bow rather than the weapon slot alone, and both
  fights take the bow off on the way out. A near-empty quiver counts as unarmed too:
  the four arrows the warrior fight left over bought one timed-out hobgoblin and a walk
  back to the booth for the axe.
- **A count that adds the pack to the quiver cannot tell a sweep from a shot.** The
  warrior leg swept its spent arrows the moment it ran dry, and the sweep put them in the
  pack — where `iceArrowsHeld` counted them and the empty-quiver branch stopped firing.
  Every Attack for the rest of the 900-tick guard answered "There is no ammo left in your
  quiver" and the fight never restarted. Picking arrows up and nocking them are two acts,
  so the quiver alone decides whether a shot can go out and the pack decides whether one
  can be nocked.
- **The engine's food float is provisioned once, not maintained.** `provisioned.add(id)`
  retires the withdrawal for the run, so a module whose grind outlasts six lobsters has
  to ask for more itself. The roots farm restocks below three and takes ten, because the
  nearest booth is a minute's round trip from the camp, and the leg before the Fire
  Warrior takes eight, because the ice-chest circuit spends the float underground.
- **A hunger branch that yields the tick is a stall once the food runs out.** `Sustain.run()`
  returns nothing whether it ate or found an empty pack, so `if (hungry()) { await
  Sustain.run(); continue; }` spun the Fire Warrior guard out at 30 hitpoints without
  a single click — three minutes of a fight that never started. Both fight loops test
  the pack before they yield to it.
- **A fight loop that counts its own Attack clicks misses a kill it did not click for.**
  Auto-retaliate fought the Fire Warrior to death while every `interact('Attack')` came
  back false — he stands behind the door that summoned him and the path to him is
  through it — so a "down after N shots" test gated on N spun out the full guard twice
  over a corpse. `Game.inCombat()` is what proves the fight happened.
- **The hobgoblin camp is a crowd.** Three level-42 attackers take 38 hitpoints off faster
  than one lobster puts them back: an `eatBelowHp` of 0.55 died at twelve roots with food
  still in the pack. The farm eats at 0.75, walks back to the booth at five lobsters rather
  than three, and abandons a kill outright below 45% with nothing left to eat — the walk to
  the booth is also the walk out of the camp. Twenty roots cost about sixty lobsters at
  70 stats, so the harness seeds three hundred; no shop is a way out, as every cooked
  lobster in the shop database has a baseline of zero and the one armoury near Ardougne
  is inside the Biohazard-gated training camp.
- **The peninsula west of the Crafting Guild is the better camp.** Ten of the fourteen
  surface hobgoblins stand between (2905,3266) and (2920,3298), against six on the
  Ardougne coast the leg first used, and Falador West at (2946,3369) is a shorter bank run
  than Ardougne's — 206 tiles to the stand against the coast road. `wanderrange` is 3 and
  `maxrange` 5, so a retreat at (2933,3323) is well clear of the aggro the leg has to
  break to reach a booth.
- **The weapon comes out of the bank, like the armour.** The crossing kit leaves the bot
  bare-handed and the axe the yew was cut with is a poor answer to a crowd, so the farm
  wields the best melee weapon banked before it falls back to that axe. A hobgoblin carries
  1 stab defence and 1 slash defence, so tier beats shape and a scimitar leads each tier;
  a refusal is shed the same way a refused body is, and the axe is the floor under all of
  it.
- **Aggression outlives the decision to stop fighting.** A farm that runs out of food and
  stands still is still standing in the camp: the retreat has to clear the aggro
  radius, so the module walks to the Ardougne road before it hands the tick back.
- **The food that survives one leg is what blocks the next.** Winelda's twenty roots are
  twenty unstackable slots, and the fifteen lobsters the farm was carrying left nineteen
  free — the withdraw retried for five minutes without ever fitting. The trim before that
  withdraw keeps the roots, the coins and the pendant and nothing else, because the fight
  the food was for is over by the time it runs.


## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Temple of Ikov: engine behaviour](quest-pitfalls-24.md)
- [Temple of Ikov: the route](quest-pitfalls-25.md)
- [Temple of Ikov's harness recipe](../reference/quest-harness-recipes-9.md)
- [Add a quest](../how-to/add-a-quest.md)
