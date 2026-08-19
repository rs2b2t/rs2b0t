[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Observatory Quest

The quest is five hand-overs and a cavern. Most of what it cost was geography.

- **A hand-over that cannot be batched does not mean the errands cannot.** The professor
  switches on `%itgronigen` at the top of `opnpc1`, so one conversation is one stage and
  the planks, bar, glass and mould are five separate walks back to him. The *fetching* has
  no such rule: opening each leg as soon as its stage is in reach turns four errands into
  one loop and four consecutive conversations.
- **Order the errands by the map, not by the quest.** Following the professor's order walks
  the length of the map three times — the planks are at the Barbarian Outpost, the seaweed
  two hundred tiles further north, and the sand, the pickaxe, the seam and the furnace are
  all south of both. The chain is sand, ore, planks, seaweed, cook, and one furnace visit
  that smelts the glass and the bar together.
- **A `p_telejump` behind a dialogue is not a ladder the graph will use.**
  `obs_dungeonladderdown` warns you about the goblins before it moves you, so
  `derive-transports` marks the edge *"behind a runtime quest/skill/inv guard"* and disables
  it. A `LadderHop` cannot recover it either — `hopLadder` clicks and waits, and the wait
  outlives the two-line conversation. The descent is the module's own leg; the three other
  ladders in the pair stay baked and route normally.
- **Eight locs render "Chest" and six of them are a trap.** `shutdungeonchest` spawns a
  poisonous spider and poisons the player on Search; only `loc_2197` holds the keep key,
  and `loc_2195` an antipoison. Nothing down here is looked up by the name they share.
- **`forceapproach` rotates with the placement.** The key chest is `forceapproach=north` at
  angle 2, which puts the only legal side to the south — the tile north of it is not even
  walkable, so a stand derived from the config word answers nothing at all.
- **The keep gate teleports rather than swings.** `@open_keep_gate` deletes the loc, moves
  the player one tile across and re-adds it three ticks later. From the north it refuses
  with `mes("The gate is locked.")` — a chat line, not a click that fails — so the player's
  own tile is the only test of whether the crossing happened, and the only test of whether
  the key is needed. Trying the gate first and fetching the key on the refusal reads
  `%itkeepgatelock` without being able to see it.
- **The keep is one tile wide, and the offline pack disagrees.** A `smashedtable` fills
  (2389,9455) and the sack fills (2389,9454), leaving the column at x 2390 as the only
  walkable ground inside. `route-probe` answers "cost 1, ok" for the tile beside the sack
  and the live walker answers `dest (2389,9455) unreachable beyond (2390,9455)` — so the
  stand is the sack's one cardinal neighbour, and the pack is not the last word on a stand
  inside four walls.
- **The guard stands on the stand.** `goblin_guard` spawns at (2391,9458), the tile beside
  the gate, and opening the gate runs `~npc_retaliate(0)` on anything within eight. An NPC
  makes its tile unwalkable for the client's own path search, so it is killed before the
  gate is touched rather than fought through the search that follows.
- **Soda ash exists only as burnt seaweed.** `cooking_generic_seaweed` is the one recipe
  that names it, and it cooks and burns to the same ash — so one weed off the shore is one
  soda ash on any range, and the item appears in no shop inventory, drop table or ground
  spawn in the game. Searching for a source finds nothing and reads as "not implemented"
  rather than "made, not sold".
- **A quest that spends its items must not list them in its record.**
  `planProvisioning` gathers `record.items` before the quest starts and is satisfied once;
  a restart at stage 5 would re-fetch three planks and a bar the professor has already
  taken. The record is empty and the module sources everything itself, bank first.
- **The hand-back needs the slot.** `professor_mould` returns the molten glass it deleted a
  stage earlier and refuses outright on a full pack, so stage 4 banks before it talks.
- **The dome is a sealed pocket of the surface.** Nothing walks into it; its ladder only
  goes down, and the cavern below is the only way in. The telescope also checks
  `npc_find(coord, observatory_professor2, 7, 0)`, so the stand has to be inside seven tiles
  of his dome copy or the click reports nothing.
- **An interface the click opens can block the conversation the click queued.**
  `[oploc1,telescope]` does `if_openmain(telescope)` and then `queue(constellation_dialogue)`,
  and `Player.canAccess()` is `!delayed && !containsModalInterface()` — main *or chat*. The
  queue therefore sits there, undelivered, for as long as the star chart is up: the bot stood
  at the telescope for ninety seconds with the reward one closed interface away. Close what
  the click opened, then drive the conversation.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Temple of Ikov: the fights](quest-pitfalls-26.md)
- [The Observatory harness recipe](../reference/quest-harness-recipes-14.md)
- [Add a quest](../how-to/add-a-quest.md)
