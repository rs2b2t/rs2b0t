[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Temple of Ikov, the route

The fourteen that are the route and the temple; the seven that are engine behaviour are on the
[first page](quest-pitfalls-24.md), and the fights and the farm are on the
[third](quest-pitfalls-26.md).

- **The quest has two endings, and only one of them is a fight a bot should take.**
  Lucien's ending needs the staff carried out past five Guardians of Armadyl, level 45,
  50 hitpoints, 55 slash defence. Armadyl's needs Lucien dead: level 14, 17 hitpoints,
  and he is only attackable at all while the Armadyl pendant is worn. The module takes
  Armadyl's, never touches the staff, and `obj_gettotal` is why, the guardians turn on
  anyone whose *bank* holds one.
- **The pendant that opens the door also marks you.** Lucien's pendant has to be worn to
  open the Door of Fear from the south, and worn in front of a guardian it is what makes
  them attack. The module wears it for every dungeon leg and stows it before the
  guardian conversation.
- **A conversation that ends in a teleport is not over when the chat closes.** Winelda's
  `if_close` runs five ticks before her `p_teleport`, so the guardian leg started while
  the bot was still on her ledge, where the shiny key is a McGrubor round trip away
  rather than seventy tiles, and the walker said as much. The leg waits the ferry
  out and asks her again if it never came; she repeats it for nothing.
- **Winelda's ferry is one-way, and the way back is an item on the far side.** She
  teleports the player to (2664,9876), a pocket whose only exits are a ladder into
  McGrubor's Wood and the door at the top of it, which answers "The door is locked." to
  anyone without the shiny key lying at (2628,9859). The key is therefore not optional
  content; it is the exit, and it is picked up before the guardians are spoken to.
- **That door belongs in `specialCrossings`, not in `SCRIPT_REFUSED`.** Removing it
  seals the pocket for good; leaving it bare walks a keyless bot into McGrubor's Wood
  for a door it cannot open. Keyed on `requires: { item: 'Shiny key' }` the pathfinder
  prunes it until the key is held and routes through it afterwards, which is both
  behaviours at once.
- **The bow is a fletching chain, not a purchase.** Ice arrows carry
  `param=levelrequire,40`, and the ammo check refuses any bow whose own `levelrequire`
  is lower, so yew or magic, and no shop in the game stocks either. A yew shortbow is
  woodcutting 60 for the log, crafting 10 to spin a flax into a bow string and fletching
  65 twice. None of those is a quest requirement, which is what `warnReadiness` is for.
- **Ice arrows are one chest at a time.** Six chests share the ice cavern and
  `%ikov_icearrowchest_coord` names the one holding arrows, re-rolled after every find,
  so the search is a circuit rather than a chest. Each find is one to five arrows, 80%
  of every shot lands recoverable on the floor, and the Fire Warrior has 59 hitpoints,
  the module holds twenty before it opens his door, sweeps the spent ones afterwards,
  and sweeps mid-fight rather than walking out if the quiver empties. Twenty is a floor
  rather than a stockpile on purpose: one circuit of the six chests takes three minutes
  and clears it, where a target of thirty spent a second circuit collecting one arrow.
- **The re-roll can land back on the chest that last paid out.**
  `~randomize_ice_arrow_chest` is a bare `random(6)` over all six coords with no memory of
  the current one, so a find leaves a one-in-six chance the next batch is under the same
  lid. Walking on to the next chest buys the same odds plus ten tiles, so the leg
  re-opens the one it is standing on until it comes up empty.
- **A goal-only oracle pays the full timeout on every chest that is not the one.** A find
  raises an `~objbox` and an empty chest answers with a bare
  `mes("You search the chest, but find nothing.")`, so waiting on the arrow count alone
  spends the six-second budget in full five times a circuit, ten seconds a chest in the
  live log, half of it standing still. The wait clears on the count or on that line,
  whichever comes first, and the count is still what decides whether it found anything.
- **The ice cavern is nine level-61 spiders and the weight gate is what decides when armour
  can go on.** `ice_spider` is `damagetype=^crush_style`, `huntmode=cowardly` over a
  `check_nottoostrong` that a 70-stat account is nowhere near, and its spawns sit on the
  chest circuit. No armour survives the lava crossing, a studded body is 12lb against
  the boots' -10lb, so the leg was split: the crossing fetches the boots and the lever
  and nothing else, and the chest circuit is a second descent through the south gate,
  which needs no bridge once the lever is pulled. The quest sources no armour, so the
  bank is the wardrobe: the best ranged piece it holds per slot, feet and weapon left to
  the boots and the bow.
- **Having stood past the gate is the only record that it is unlocked.** `%ikov_dungeon`
  is untransmitted and no journal line moves for the lever, so a module that has to choose
  between a weight-limited descent and an armoured one has nothing to read. It remembers
  the first walk through the gate for the session and plans for the crossing until then,
  which costs a resumed run one bare descent and never risks an armoured bot at the lava.
- **`inIceCavern` is a half-plane, and the boots room is inside it.** The test is
  `z <= 9802 || x >= 2688`, south or east of the temple proper, and the boots room sits
  at z 9759-9768, so it answers true from a pocket the bot has to climb out of. Standing
  in the cavern and having come through the gate are therefore different questions, and
  only `pastSouthGate` answers the second.
- **`fetchBoots` returns true for a leg of the descent, not for the boots.** Lighting the
  candle, walking, climbing down and landing in the dark room is one call that answers
  true with an empty pack; taking them and climbing out is the next. Merging it into a
  larger step read that first true as "boots in hand" and ran the gate check from the dark
  room, where the half-plane above said the gate was open, so the leg reported success
  with no boots, the next pass climbed back out, and the two thrashed until the quest
  parked three times. It keeps a step of its own, and `decide` re-reads the pack each pass.
- **A banked pair of boots is not a worn pair, and nothing else withdraws them.** The boots
  errand asked `heldOrBanked`, so a pair sitting in a booth read as "done", and `decide`
  fell straight through to the gate check. That check descends for a second pair, and its
  candle had been dropped from the kit by the same bank read, so it logged "short a
  tinderbox or a candle" and returned false in 2ms, forever: a failing step feeds no
  no-progress watchdog, so the run never parked. The errand now withdraws what the bank
  holds and only descends when there is no pair anywhere.
- **All six chests are `forceapproach=north`, and each placement rotates that.** Walking
  to within two tiles of the chest and clicking Open worked for the ones whose legal side
  the walk happened to land on and was dropped in silence for the rest, two of six on the
  first run. Every chest carries its own stand, one tile off, and the leg walks onto it
  rather than near it.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Temple of Ikov: engine behaviour](quest-pitfalls-24.md)
- [Temple of Ikov: the fights](quest-pitfalls-26.md)
- [Temple of Ikov's harness recipe](../reference/quest-harness-recipes-9.md)
- [Add a quest](../how-to/add-a-quest.md)
