[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Sheep Herder

Sixteen, and the first nine are about moving an NPC the bot does not control.

- **An NPC enters the client's list only within about fifteen tiles.** The four sheep
  spawn scattered across East Ardougne — as far as thirty-two tiles from the enclosure —
  so "no sheep in the scene" describes where the character is standing rather than the
  world. Every leg walks to the sheep's map spawn before it looks for one, and the first
  version of this module burned sixty failed steps a minute at the pen gate instead.
- **`prod_sheep` walks the sheep one tile along `coord_direction(player, sheep)`,** which
  returns one of four cardinal directions and points away from the player. So the push a
  leg wants names the tile the character has to stand on — the one directly opposite —
  and a push whose stand is unwalkable does not exist however open the sheep's own
  destination is. Searching plain walkability finds routes the prod cannot drive.
- **The stand also has to be able to step onto the sheep.** The second sheep's field ends
  in a fence whose two sides are both walkable and neither passable, and a search that
  only asked whether the stand was walkable spent ten minutes trying to walk onto the far
  side of it. The Prod op reaches the npc from that tile or not at all, so the same
  `canStep` the sheep's own move needs applies to the stand.
- **The route is worthless the moment it is computed.** The sheep's `ai_timer` fires
  every 10 to 29 ticks and returns it to wander mode, and wander queues a waypoint within
  three tiles of its *spawn*, so it walks back the way it came between pushes. The search
  therefore re-runs from the sheep's own tile on every push rather than following a plan.
- **A walkable tile with no standable side is a trap, and 384 of them sit in this
  quest's region.** Three — (2610,3351), (2612,3349), (2610,3348) — hang off the corridor
  past the enclosure's south-east corner, and a sheep that wanders into one is there for
  good: the engine frees it only through `wanderMode`'s 500-tick teleport home, and
  prodding it resets the mode that counts those ticks. So the module searches twice — once
  over the tiles that touch no trap, once over everything — and two or three extra pushes
  buy a route the wander cannot funnel into one.
- **A greedy follow needs one potential, whatever it is built from.** Two things broke it
  here. Folding trap distance into the per-push score rather than the search made two
  neighbouring tiles each prefer the other, and the sheep went north and south forever.
  Then reading whichever of the two searches held the sheep's own tile swapped potentials
  as it wandered on and off the clear network, and 250 pushes moved one sheep eleven tiles
  east and back. Both maps are read through one function that charges a flat 1000 for
  being off the clear network, which is monotone in both directions.
- **The lock on which sheep is being herded is its last tile, not its client slot.** Three
  copies of every sheep share one display name and one quest bit, and the slot churns when
  the scene rebuilds — which sent a leg that had a sheep three tiles from the gate walking
  fifteen tiles back to a fresh copy at the spawn.
- **A world-walk that has to finish on a baked door tile spends its budget on the door.**
  The stand for the last push north sits on the enclosure gate, and `walkResilient` spent
  its full sixty seconds there without moving. The follow is always inside the loaded
  scene, so it belongs to `DirectNavigator` and the world-walker owns the opening approach
  alone.
- **The jump over the gate tests the sheep's current coord, not where the push sends
  it.** `npc_walk` is issued and *then* `inzone_coord_pair_table(sheepherder_pen_gate, …)`
  is read, so the push that sends the sheep over the gate is any push issued while it
  already stands on those three columns west of it. Direction stops mattering there.
- **The sheep inside the enclosure is a 150-tick `npc_add`.** The map spawn is deleted
  and replaced with a temporary copy that despawns, so the kill has to run in the same
  leg as the herd; a `decide()` round trip between them risks losing the sheep and
  buying another forty pushes. The deleted map spawn returns on its own respawn timer,
  which is what makes a lost sheep recoverable rather than fatal.
- **All four sets of remains render "Bones", as does the ordinary drop.** `sheepbonesa`
  to `sheepbonesd` differ only by id, and the furnace's `oplocu` branches on the exact
  one, so every lookup here is `invIds` and a ground-item id filter.
- **The enclosure gate is a `p_teleport`.** `check_axis` runs the protective-clothing
  branch only from the gate's own tile at x 2594, and from inside no check runs at all,
  so the character lands on the far side without ever walking through. Where it is
  standing after the op is the oracle; the loc reverts to a gate three ticks later.
- **`plaguesheep_furnace` is `forceapproach=east` at angle 2,** which puts the only legal
  side to the west in world space — the same rotation trap as the Yanille range.
- **The poisoned feed is never consumed.** `poison_sheep` deletes no item, so one feed
  carries all four kills, and Halgrive hands out another whenever the pack has none. The
  protective suit is untradeable with no shop; a lost half is re-bought from Doctor Orbon
  for 100 gold rather than withdrawn.
- **The item leaving the pack is three ticks ahead of the state it records.**
  `incinerate_bones` deletes the remains, waits three ticks and only then sets the quest
  bits, so a leg that stops when the pack empties hands `decide()` a journal that still
  reads "now I must kill it" — and the queue herds the same sheep a second time, forty
  pushes' worth. The oracle is the "The remains burn to dust." line, which the script
  prints after the write.
- **The reward is gated on the bitfield, not the quest stage.** `halgrive` pays out when
  `getbit_range(%sheepherdervar, 0, 12)` reads 7020 — all four sheep incinerated — so the
  journal's per-sheep lines are the state the module has to track, and `%sheepherderquest`
  only separates "needs a suit" from "disposing".

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Shield of Arrav](quest-pitfalls-7.md)
- [Sheep Herder's harness recipe](../reference/quest-harness-recipes-12.md)
- [Add a quest](../how-to/add-a-quest.md)
