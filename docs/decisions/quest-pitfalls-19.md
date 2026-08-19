[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Gertrude's Cat

A one-quest-point fetch quest, and six of these are nav lessons that belong to
every bot that walks into the lumber yard.

- **A vault can leave the character standing on a tile the pack calls solid.**
  `gertrudefence` teleports onto the fence tile and stops there, and the fence
  blocks its own tile, so the planner snapped the start back to the south side
  and planned the same crossing again. The bot and the fence took turns every
  eleven seconds. The walker now steps onto the shortcut edge's planned landing
  after every crossing it accepts, which the server's own route finder can do
  from a solid tile even though the pack cannot plan it.
- **A transport's `to` is where the graph continues, not where the player
  lands.** Those are the same tile for most crossings and two tiles apart for
  this one. Moving `to` onto the landing tile would fix the landing check and
  break the graph, because an unwalkable node has no exits — both halves have to
  be satisfied separately.
- **The landing check passes on the first crossing and fails on the retry.**
  `matchesTransportLanding` compares the distance closed against where the walk
  began, so a crossing entered from ten tiles away reads as progress and the
  same crossing entered from its own approach tile does not. A hop that looks
  proven end to end can still be the one wedging a repath. Loosening the rule is
  not the fix — a short hop has to land on its planned tile or every frame of a
  stile's animation reads as crossed, which
  [`shortCrossingLanding.test.ts`](../../test/event/webwalk/shortCrossingLanding.test.ts)
  exists to hold. The crossing that ends mid-span is recognised by *where* it
  stopped: standing on the loc's own tile.
- **Fluffs sits on the yard's raised walkway.** `isArrived` compares level
  before distance, so a walk aimed at the ladder's own tile arrives on the floor
  below and reads as done. The yard ladder is in `stairEdges.json`, so asking for
  a tile on the walkway would climb it; the module climbs it by name instead, and
  waits on the level rather than on the walk.
- **Pick-up and Stroke both claw for 3 and give nothing.** `opnpc1` and `opnpc3`
  run `~fluffs_attack`; `opnpcu` does not. Every interaction with the cat is a
  use-on, and the two menu ops that read like the obvious way in are the two
  that cost hitpoints.
- **The brothers' dialogue is gated on how far apart *they* stand.**
  `npc_find(npc_coord, $other_boy, 3, ^vis_lineofsight)` measures Shilop against
  Wilough, not either against us, and both wander two tiles from their own
  spawn. The far-apart branch falls off the end of the label with no options
  offered, spending nothing and saying nothing — `fluffs_boy_single`, which
  reads like the single-brother path, is unreachable dead code. Only the 100
  coins leaving the pack proves the leg. The check also runs four chat lines in,
  so opening the conversation at the script's own limit loses two attempts in
  three to the pair drifting; the leg waits for them to stand adjacent.
- **Which crate holds the kitten is a server coord the client cannot see.**
  `%fluffs_crate` is `scope=perm` with no transmit, so the only way through is
  to search all six.
- **A route the pack can plan is not one the server will walk.** The sixth crate
  sits in the corner behind the yard's shed; the server's own finder gives up on
  the way round and walks to the closest tile it liked — nine tiles short, with
  no refusal and no message. Stepped by hand the same corner is four short walks,
  every one of which lands. Long detours want waypoints, and a bot standing still
  after a click is the symptom.
- **Where a leg starts decides whether it can finish.** The corner is walkable
  from the open ground by the fence and not from the tile the previous crate's
  Search leaves the character on, one tile from a crate that blocks its own. That
  is why the corner crate is searched first and why its waypoints begin at the
  fence rather than at wherever the loop happens to be.
- **The way out is as particular as the way in.** From (3307,3508), beside the
  crate under the ladder, the server walks to (3305,3504) and to (3303,3508) and
  refuses (3305,3496), (3306,3505) and (3306,3506) — all of them tiles the pack
  routes to happily. A refused walk is not a refusal: the character stands still,
  the walker calls it a stall, and five repaths later it gives up. One tile,
  (3305,3504), answers from every crate, the ladder and the fence alike, so every
  leg inside the yard is routed through it rather than tile to tile.
- **The crates that mew are NPCs; the crates that do not are locs.** Both render
  "Crate" and both offer Search, and the yard is full of the loc kind. Searching
  those answers "You find nothing." forever, which is also what the five wrong
  NPCs answer — matching on npc id 767 is what separates the two.
- **The right crate answers with a mesbox and the wrong one with a chat line.**
  The kitten lands after the box is dismissed, so the item is the only proof of
  success; `You find nothing.` is the cheap proof of failure, and without it
  each of the five wrong crates costs a full timeout.
- **A banked kitten empties every crate.** The search tests
  `inv_total(bank, gertrudekittens) = 0` as well as the pack, so a spare cannot
  be stockpiled and a kitten left in the bank stalls the leg with six honest
  "You find nothing."s.
- **A shop screen that has not finished shutting swallows a use.** Rubbing the
  leaves over the sardine runs the tick after Gerrant's shop closes, and the
  first two attempts left the pack untouched with no refusal — the third, after
  the engine had closed the leftover modal, landed in 748ms. Close the modal
  yourself and retry rather than reading the timeout as a failed recipe.
- **A cutscene outlives the item that started it.** The kitten leaves the pack
  six ticks before Fluffs finishes walking home, so a wait that watches the pack
  returns mid-scene and the leg walks off holding the closing mesbox. A character
  in that state does not move at all: the walker spent a hundred seconds clicking
  three tiles away and never took a step. Wait the scene out, then drive the box
  shut.
- **A use sent while a ladder still has the character delayed is dropped.** The
  first offer to Fluffs after the climb did nothing and looked like a
  refusal; the second, seconds later, was accepted. Retry inside the leg, or
  spend an engine step per attempt.
- **The journal pages are cumulative.** Every stage keeps the sentences of the
  ones before it, so the parse has to test the newest sentence first or stage 5
  reads as stage 3.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Gertrude's Cat harness recipe](../reference/quest-harness-recipes-11.md)
- [Add a quest](../how-to/add-a-quest.md)
