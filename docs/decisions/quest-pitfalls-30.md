[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Underground Pass, reach and the temple

The thirteen that reaching a seam, Kardia's house and Iban's temple paid for; the map, the traps
and the seams are on the [first page](quest-pitfalls-29.md).

- **An op-click on a ground-decor seam has to be sent from beside it.** The ledge is shape 22 on a tile the
  collision pack calls blocked, so the server paths toward that tile, dead-ends, and answers "I can't reach
  that!" — the crossing script never runs, and the step reads it as the agility roll failing. Twenty rolls at
  ninety-five per cent each "failed" before the refusal was logged. `inOperableDistance` is
  `reachedEntity || reachedObj`, which a cardinal neighbour satisfies: walk there at radius 0 first.

- **`nearest()` cannot tell a diagonal neighbour from a cardinal one.** Both are Chebyshev distance one, and
  `reachRectangle` takes a cardinal side and nothing else. The second cavern's ledge is six identical locs in
  a column, and the nearest one to the character was always the diagonal — so four tries from one tile
  produced four "I can't reach that!" and the leg spent every ledge it had. Ask for a Manhattan distance of
  one when the op has to reach.

- **Choosing a cardinal tile and then walking to it at radius one throws the choice away.** The ring is
  cardinal because `reachRectangle` accepts nothing else, and a radius of one lands *beside* the tile that
  was picked — which is the diagonal, and the op answers "You can't do that from here." The second cavern's
  ledge refused four times that way with every try reported from the same diagonal tile, which reads as four
  failed agility rolls. It survived six per-leg runs and only showed up end to end, because the walk usually
  does land on the tile it aimed at.
- **A pocket traveller is the wrong tool for a stand two tiles away.** The five tiles the fire arrow can be
  shot from are a handful apart in one pocket, and the loop that tried each reached for the mover that
  crosses every leg of the pass. So a stand that was not walkable read as "no route" rather than "try the next
  one", and the traveller went hunting seams: forty-one "nowhere to stand" reports and eleven tiles of drift
  away from the rope. Six per-leg runs never saw it because they all arrived on the same tile; the
  end-to-end run arrived two tiles off and the first stand fell through. Short hops inside a pocket want the
  plain walk.
- **Proximity is not reach, for NPCs as well as locs.** Thirteen Iban disciples line the temple approach and
  `nearest()` returned one through the temple wall. The attack sent, nothing happened, and the step spent its
  three-minute wait out in silence — twice, because one long wait is indistinguishable from a slow fight. Filter
  the query by whether a cardinal neighbour can be stood on, take them in distance order, and give each a
  short wait: a level-thirteen NPC with twenty hitpoints that is not dead in forty-five seconds is not being
  fought at all.
- **Iban's temple has no floor in the collision pack.** A flood over x 2130-2143 by z 4640-4655 at level 1
  finds one isolated tile: not the altar, not Iban's own tile, not the tile the doors force-move the player
  onto. So every distance-based approach inside answers "unreachable" from a tile the character is standing
  on. Nothing there needs walking to — the doors are the entry and a use-on-loc is the throw, both of which
  leave the pathing to the server, which is the only thing in the temple that can see the ground.
- **Getting in is not getting out.** Kardia's house is a sealed fifteen-tile pocket — a flood from inside
  gives x 2151-2157 by z 4565-4567 and stops at her door, because the collision pack calls a door tile
  blocked. The doll is in there, so the leg that lifts it ends shut in, and every step after it answers
  "unreachable" for fifty-five minutes. What got the character *in* was an op-click, where the server does
  the pathing and can see the open door; the navigator, reading a static pack, never can. So the way out is
  open the door and then `DirectNavigator`, which clicks rather than routes — and it has to outrank every
  other step, because none of them can run until it does.
- **A radius counts distance, not walls.** Kardia's chest is two tiles from her door and on the other side
  of it, so `walkTo(chest, 3)` returned arrived from the street and the click that followed was refused by a
  server that could not path there. The door was only opened on the branch where that walk failed — which it
  never did. Anything indoors wants the reach helper that opens what stands in the way, not a distance test.
- **The one-shot obstacle that reports itself as a failure.** Knocking with the cat sets a bit that is never
  cleared, and every later knock answers "Inside you can hear the witch talking to her cat." That sentence is
  the distraction holding. Reading it as a failure sent the leg back for the cat that had respawned behind
  it, and it knocked at a door that would not take a second one for five minutes at a time. Three runs of
  "Kardia would not come to the door" were three reports of a step that had already worked.
- **Iban's temple is a dress code, not a door.** `@open_iban_door` wants both halves of the robe of Zamorak
  worn and `inv_freespace(worn) = inv_size(worn) - 2` — two worn slots and nothing else — or it answers
  "Only followers of Zamorak may enter." A module that armours up for the paladins and the demons arrives at
  the last door unable to open it. The robes drop from an Iban disciple, level thirteen with twenty
  hitpoints, and thirteen of them line the approach at x 2149-2163. So the armour comes off for the doors
  and goes back on after the throw, which also means the step that keeps gear on has to stand down over that
  stretch rather than re-wearing it every tick.
- **Two stages print the same journal page.** `upass_found_doll` and `upass_confronted_iban` share one branch
  in `upass_journal`, so the parser can never answer `confronted` — and the throw, gated on that stage,
  waited for a number that never arrives. Position is the readable fact: the doors force-move the player one
  tile west, so standing on the temple floor is what "past the doors" means.
- **Opening a door does not move anyone through it.** The loc swaps to its open variant and the player stays
  put, so a step whose oracle is "the character is now west of the door" times out on its own success. The
  open and the walk are two steps.
- **A step that walks itself does not need permission to run.** Two elements of the doll refused to act
  unless the character was already standing in that pocket — but every one of those steps opens with a walk
  that routes across the platforms itself, so the guard could only ever block its own step. Where the
  traveller can get there, asking where you are first is a deadlock with a reason string.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Underground Pass: the map and the traps](quest-pitfalls-29.md)
- [Underground Pass: what the live legs paid for](quest-pitfalls-31.md)
- [Underground Pass's harness recipe](../reference/quest-harness-recipes-16.md)
- [Add a quest](../how-to/add-a-quest.md)
