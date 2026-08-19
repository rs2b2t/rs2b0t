[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Hero's Quest

Sixteen, and the first one is a wall the quest cannot be finished through.

- **An area with a one-way exit has no entrance.** The Ice Queen's lair is reachable from the surface
  only by eight `ladder_cellar_inside_down` locs, and every one of them stands on a White Wolf Mountain
  plateau (x 2800-2861, z 3500-3521) whose boundary carries the map's `BLOCK_MAP_SQUARE` flag on every side.
  Three `ladder_from_cellar` locs climb *out* of it onto walkable ground, so a flood from the lair
  reaches 531 012 nodes and a flood from Varrock reaches 528 821 — the lair can reach the world and the
  world cannot reach the lair. `GameMap.loadLands` blocks on the same flag the collision builder
  reads, so the engine agrees with the pack. `ice_gloves` drops from nothing else, which puts the
  Entranan firebird feather out of reach on this content. Diff the two floods before believing a
  reachability failure is the walker's fault.
- **A wall with `blockrange=no` is the intended route.** Grip is sealed from the side room by
  `snipable_wall` (2637) at (2780,3198), beside a `castlearrowslit`. Nothing walks between the two
  pockets; the Phoenix bot shoots him through the wall from three tiles away while the Black Arm bot
  opens his drinks cabinet, which `npc_walk`s him onto that row. A quest whose kill has no melee route
  is not a broken map — read the loc's `blockrange` before assuming a path is missing.
- **`~open_and_close_door` teleports the actor and re-shuts in three ticks.** No door in this engine can
  be held open for a partner. What crosses a party is a tradeable key, not an opened door: Grip's spare
  (`misc_key`) is tradeable and goes over, while his keyring (`grip_keys`) is not and is instead
  `obj_addall`ed on death for both players to see.
- **A cooking range inside a sealed pocket is not a cooking range.** Taverley's (2844,3367) has no
  reachable stand at all, and the two Brimhaven ranges are the Shrimp and Parrot kitchen and a room the
  graph has no door into. Test every candidate surface against the pathfinder before pinning one;
  Catherby's (2817,3444) is the nearest one a walker can reach from the Taverley dungeon ladder.
- **A fishing spot can be behind a key, two NPCs deep.** The Taverley lava spots (2889-2891, 9766)
  sit past `deepdungeondoor`, whose `oploc1` answers "This gate is locked" and whose `oplocu` wants the
  dusty key; the dusty key comes from Velrak, whose cell answers only to the jail key, which the Jailer
  drops for 100 ticks where every other drop lasts 200. Neither key is consumed. A leg that walks
  straight at the spot loops on the locked gate forever — read the door's script before trusting a
  baked edge, and remember `~check_axis` reads the door's own tile as the outside.
- **A pocket predicate can need a rectangle cover, not a rectangle.** The deep dungeon interleaves with
  the rest of Taverley's across x 2881-2923, so one box over the pair claims a thousand corridor tiles.
  Four boxes, greedily grown from the flood and clipped to its bounding box, hold all 2473 pocket tiles
  and no tile of the main component. Grow the cover from the flood; never eyeball the box.
- **A sealed pocket is cheapest to enter and leave inside one step.** `fishLavaEel` crosses the gate,
  fishes and crosses back before it returns, so no bank, shop or range walk is ever planned from inside
  it. `decide()` still owns an egress for both Taverley pockets, because a restart taken mid-leg can
  leave a bot standing in either.
- **An item with no shop and no ground spawn is a drop table.** Harralander appears in no `.inv` in the
  content and in no map OBJ section, so the only source is the chaos druid herb table — 46 in 128 for a
  herb, 14 in 128 of that table for this one, about 25 kills. Grep the shop configs and the map objs
  before designing a leg around buying something.
- **`forceapproach` rotates with the placement angle.** Grip's cabinet is `east` at angle 3, which is
  north in world space; the candlestick chest is `north` at angle 2, which is south. `(dir + angle) & 3`
  is the only way to the legal side, and the wrong one produces nothing at all.
- **Two pockets can interleave along one row.** The Brimhaven hideout and the alley outside it share
  z 3167-3170 across x 2806-2810, so a single rectangle over the pair puts Grubor's own doorstep inside
  the hideout and every crossing then reads as already done. A pocket predicate is a union of boxes as
  often as it is one.
- **A door's two sides are named by its angle, not by the map.** `grubordoor` is a west wall, so its
  sides are (2810,3170) and (2811,3170) — east and west of one tile, where the other four doors in this
  quest are north and south of one. Derive the stands from the angle every time.
- **An option tree can gate its own options.** `grip_chat_options` only offers "Anything I can do now?",
  which is what hands over the spare key, after "So what do my duties involve?" has been asked. A
  `prefer` list has to name both, in that order, and one that leaves the tree.
- **A trapdoor model is not a trapdoor.** `trapdoor_nonactive` and `ikov_trapdoor` carry a model and
  nothing else: the type carries neither a name, an op nor a script, so a loc search finds a handle
  nothing can be clicked on. Three of them sit where the Ice Queen lair's one-way exits surface, which
  is what makes the sealed plateau look like it has entrances.
- **A bought-out shop is a dead shop.** `World.restock` reads `inv.items[index]` and skips a null
  slot, and a shared `allstock=no` shop that sells its last unit loses the slot — so Valaine's one
  pair of black platelegs never came back, and the bot spent 188 attempts over four minutes buying
  from an empty shelf. A purchase needs a list of stockists, not a shop; the legs also come from
  Louie in Al Kharid. Only the black full helm is single-sourced, and that is a known fragility.
- **A pocket the module owns is a pocket the module owes both ways.** Every `enter*` here leaves
  whichever other pocket it is standing in first, and every leg that walks to a bank, a shop or a
  partner calls `returnToStreet()` before it plans. Without that, the Black Arm bot took Trobert's
  papers inside the hideout and then read `no path to (2774,3187,0): unreachable` at Garv's door
  forever — the way in was fine and the way out was missing.
- **A paid crossing is a pathfinding requirement, not a step.** `no path to (2793,3180,0):
  unreachable without 30x Coins` is the failure in full: the Ardougne ferry costs 30 coins and the
  planner refuses the route without them in the pack. A quest that buys things pays its own way in by
  accident and stalls the moment a leg between purchases needs the boat, so `ownsInventory` owes a
  float of its own — topped up below a low-water mark, never restored to a target, or every shop
  costs a bank trip.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Shield of Arrav](quest-pitfalls-7.md)
- [Hero's Quest harness recipe](../reference/quest-harness-recipes-19.md)
- [Add a quest](../how-to/add-a-quest.md)
