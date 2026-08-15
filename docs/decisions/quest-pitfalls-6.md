[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Nature Spirit

Seven, and the first three are dialogue and NPC-lifetime facts rather than quest ones.

- **A topic that re-offers its own list loops until the driver gives up.** Every branch
  of Filliman's tree ends by re-printing the same four or five options, so a prefer list
  naming one picks it again on every pass and the conversation only ends when
  `driveDialog` hits its iteration cap — 54 seconds a talk, five talks a quest. The fix
  is a driver that takes the topic **once** and the goodbye from then on.
- **An NPC that exists because you summoned it is gone a minute later.** Filliman is
  `npc_add`ed with a 100-tick life by `Enter` on the grotto door, so a step that merely
  reads the scene fails on every pass once he despawns — and a failing step feeds no
  watchdog, so the quest never parks. The summon also stands two tiles off the faith
  stone the ritual is judged on, so the order is summon, stand, then talk. Anything
  conjured by an op is re-conjured by that op, never waited for.
- **A grown loc reverts on a timer, so growing it and taking it cannot be two steps.**
  `loc_change(…, 25)` puts the bloomed log back twenty-five ticks after the bloom, and a
  resume holding no fungus goes looking for a log that has already gone. Cast and pick
  belong in one step whose oracle is the item in the pack.
- **Filliman's camp is a sealed pocket whose only exit is an agility jump.** A flood from
  the camp reaches nothing without the stepping-stone `Bridge`, and no bloomable stands
  inside it, so every harvest crosses the water. `stat_random(agility, 60, 252)` is not a
  certainty even at 99: a failed jump drops the character in the swamp and leaves the
  walker repathing, which the leg has to tolerate rather than read as unreachable.
- **The furnace's `Smelt` op is the ore-to-bar menu and nothing else.** Silver craft is
  `[oplocu]` on the furnace, so the bar is *used on* it. An op-based step lists eight
  bars and no sickle, which reads as a missing mould and is not one.
- **A shared sourcing helper carries its own map.** `pickaxeAt`'s last resort is the
  bronze pickaxe ground spawn at Rimmington, 360 tiles the wrong side of Al Kharid for a
  quest that mines there; Bob's counter in Lumbridge stocks five, seventy tiles from the
  rocks. Re-use the bank-first half and replace the fallback.
- **Fetch what is not quest-gated before starting the quest.** The ghostspeak amulet is
  wanted from the first word with the spirit and nothing about it is gated, yet starting
  first sends the bot east to the mausoleum, west to Lumbridge, and east again.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Nature Spirit's harness recipe](../reference/quest-harness-recipes-6.md)
- [Add a quest](../how-to/add-a-quest.md)
