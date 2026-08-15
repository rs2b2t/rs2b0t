[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: the map

Lessons each quest paid for in live runs. Stated once so the next module does not
re-pay them.

## Sealed pockets and the baked graph

areas — Grew's island, Toban's camp, the lower city, the city-guard pocket, each skavid
cave, the shaman enclave, the wizard's floor — are reachable only through a scripted
crossing that teleports the player, so nothing routes into them by walking. Two rules
fall out of that, and both were found the hard way:

- **Every branch escapes the current pocket before it acts.** A step that assumes it is
  standing on the mainland will send the walker at a tile on the wrong side of a one-way
  cave, and it will spend three passes proving it unreachable.
- **A stand tile next to an unwalkable loc is not automatically reachable.**
  [`tools/nav/probe-tile.ts`](../../tools/nav/probe-tile.ts) pathfinds to every tile a quest
  module names, from each of its regions, and is worth running before any live attempt.
  `findPath` snapping to within five tiles is a weaker claim than
  `walkResilient(radius: 2)` arriving — a wide blocker whose only open side faces
  away satisfies the first and never the second.
- **A flood over the baked graph merges components the player cannot connect.**
  Any door edge the walker can click but not *pay* — a guarded gate, a toll — makes two
  regions look like one. Watch Tower's design concluded a gold bar was unnecessary for
  this reason, and the opposite was true.

## Doors, spawns and prompts

Plague City paid for these five in live runs:

- **A ground spawn indoors is not a ground grab.** `grabGround` clicks Take the moment the
  item is within twelve tiles, and the server's own path search stops dead at the first
  shut door, which leaves the player standing still until the step times out. The spade and
  the picture on Edmond's floor are two rooms deep, so the step walks into the room first
  and takes the item from there.
- **A crossing that raises an objbox has not fired yet.** The garden dig shows the spade
  objbox and only then runs `p_telejump`, so polling the tile times out while the script
  waits on a click. Every area change drives the prompt rather than watching the tile.
- **A wall door's outside is the loc's own tile.** `check_axis` compares the player's
  coord with the loc's along the wall's axis, so the stand that runs the quest branch is
  the tile the door sits on. Bravek's door reads as the clerk's room from `(2529,3314)`
  and as his own from `(2530,3314)`, and the wrong one walks the bot back out every leg.
- **An op can fail without saying anything.** The plague house door runs every branch of
  `doors.rs2` inside `npc_find(coord, mournertwb, 14, 0)`, so with no mourner in earshot the op
  returns having changed nothing a client can read, which a timeout cannot tell from a slow
  server. Wait for the NPC the script looks for before sending the op.
- **A door the walker cannot answer is not a baked edge.** `loc_2535` opens for a warrant
  holder mid-conversation and `loc_2534` never opens at all, so with both baked the navigator
  alternated between them for two minutes a leg. Both belong in `SCRIPT_REFUSED`, and the
  crossing after the module's own open is a `DirectNavigator` scene step.

## See also

- [Engine behaviour](quest-pitfalls-engine.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Fight Arena](quest-pitfalls-3.md)
