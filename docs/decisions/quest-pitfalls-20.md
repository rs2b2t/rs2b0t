[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: The Grand Tree

Twelve, and the first three are engine and content facts rather than quest ones.

- **Ground decor with `active=yes` blocks its own tile.** `changeLocCollision` turns a
  `GROUND_DECOR` shape into a `changeFloor` whenever the loc is active, so both Grand Tree
  trapdoors and the cave ladder are holes in the walkable map rather than tiles to stand on.
  The stand is the one adjacent tile the exit mask still reaches — (2487,3465) for Glough's
  trapdoor — and the server paths the last step itself.
- **An enum with a duplicate key answers with the last value.** `daconia_coords` lists
  `0_38_154_24_30` twice, as 0 and as 1, and `EnumType.decode` builds a `Map`, so the root at
  (2456,9886) reports 1. That is the only reason `%daconia_rock_root = random_range(1,15)`
  can ever land on it — index 0 is unreachable by construction.
- **`derive-stairs` does not bake spiral staircases.** Anita's house is a thirteen-tile
  first floor whose only link is `spiralstairs_wooden`, and there is no row for it in
  `stairEdges.json`; a flood reports her unreachable while she stands six tiles from the
  quest. `grandtree_climbtree`, the Agility 25 climb to Glough's pillar floor, is missing for
  the same reason. Both legs own the climb and the descent.
- **The caves have one mouth, and it is a quest loc.** `grandtree_trapdoorunder` at the foot
  of the tree opens only at `^grandtree_complete`, so everything from the demon to the last
  Daconia rock happens behind Glough's trapdoor — which `[oploc1,grandtree_trapdoorclosed]`
  opens at every stage from 130 up. That `>=` is what makes a death after the demon
  recoverable: the module drops back in rather than parking on an unreachable King.
- **The stronghold gate refuses in one direction at a time.** `gnome_areagate` turns the
  player back on the way *out* at stage 80 and on the way *in* at stage 90, so the two legs
  either side of the shipyard are the glider and Femi's food cart rather than a walk. Nothing
  about the gate is broken in between, which is why it stays a baked edge.
- **A conversation that walks, teleports and then speaks again outlasts `driveDialog`.**
  King Narnode's opening leads the player to his trapdoor, drops it into the foundations and
  climbs it back out inside one `opnpc`, with silences of five ticks and more; Glough's
  stage-70 branch calls the guards, marches the player to a ladder, jails it and hands over
  to Charlie and then the King; the foreman closes the dialogue, walks the player
  thirty-five tiles across his yard and teleports it into his office before he asks the
  first of three questions. `driveDialog` gives up after 1.5s of quiet and starts a *fresh*
  conversation, so stage 80 ping-ponged between the foreman's spawn and his office for eight
  minutes and then parked. Every one of these legs is a `driveUntil` on the goal — the bark
  sample in the pack, the tile outside the cell, the lumber order — with the prefer list
  carried along. Once the chain has moved him, `[opnpc1,grandtree_foreman]` sees him inside
  the office zone and skips to the questions, so the leg talks to a Foreman already in the
  scene where he stands rather than dragging the player back out to the anchor.
- **The pillar floor is a pocket, and preparation decided inside it has no route out.**
  Glough's top floor is seven walkable tiles reached by an Agility 25 climb, and its only
  exits are that tree back down and the trapdoor — neither of them a baked edge. A demon kit
  chosen there planned a bank trip the pathfinder could not answer and spent six minutes on
  `no path to (2449,3482,1): unreachable`. The kit is bought from stage 120, on the ground,
  before the first climb; a run that arrives on the pillars still owing gear climbs down for
  it rather than banking where it stands.
- **A gate that teleports you through also blocks the tile it drops you on.**
  `open_shipyard_gate` swaps both halves for an `inviswall` for three ticks after the
  teleport, so the client's own pathfinder rejects every click candidate from the tile the
  player is standing on and repaths five times in a fifth of a second. It clears itself, but
  a two-pass walk budget is spent on the recovery — the leg after that gate wants a
  five-pass one.
- **The King's translation is five pages and one preference list, if it is ordered.**
  `narnode_correct_b2` and `_b3` both want "None of the above.", `_b3` onward want three
  specific lines, and each page offers `None of the above.` as its last option. Putting the
  three specific answers ahead of it in the prefer list picks correctly on all five pages,
  because `pickPreferred` scans preferences in order rather than options.
- **Two quest NPCs answer a wrong choice with violence.** The shipyard worker at the gate
  wants Ka-Lu-Min syllable by syllable and attacks otherwise, and the foreman asks three
  questions about Glough's wife, his dinner and his girlfriend before handing over the lumber
  order. Both prefer lists name the right answers and nothing else; the gate's lives in
  `SPECIAL_CROSSINGS` so the walker can cross it unattended.
- **A twig on a pillar is neither held nor lost.** `_grandtree_pillar` drops the item at the
  loc's own coord and the trapdoor checks `obj_find` per tile, while the King re-issues all
  four whenever `~obj_gettotal` finds none in the pack or the bank. Asking him for a fresh set
  while three are already laid is therefore a waste rather than a wedge — so the module asks
  only when it holds none at all. All four render "Twigs", so every read is by id.
- **`%femi_help` charges only in the middle.** 0 is "never met her" and 2 is "helped with
  the boxes"; both ride the cart free, and only 1 — set by refusing the boxes at the gate —
  costs 1000gp. The Femi crossing already in `SPECIAL_CROSSINGS` answers the box question
  with "OK then", which is what keeps the cart free later.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [The Grand Tree's harness recipe](../reference/quest-harness-recipes-11.md)
- [Add a quest](../how-to/add-a-quest.md)
