[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: The Fremennik Trials

Seven trials in one quest, and the content decides most of them before the bot gets a
say.

- **A trial that cannot be won straight is a trial with a second half.** Manni's drinking
  contest reads one bit, `viking_keg_lowalc`, and concedes only when it is set. Nothing in
  the conversation sets it; the swap does, and the swap is refused while Manni can see
  you. The firecracker in the drain pipe is not colour, it is the mechanism, and a module
  that models the contest as "talk, choose Yes" loses every time with no error to read.
- **Thorvald's trial is passed by dying — on the fourth form only.** Koschei's first three
  forms are ordinary melee and kill an unarmed character outright; only the fourth is wired
  to `viking_honour_death`, and it has 255 hitpoints and 255 defence against a strength of
  5, so it cannot be beaten and cannot miss forever. Read what the *loss* branch does, and
  read which npc id it is attached to.
- **The protection prayer that carries the first three forms is also what times the fourth.**
  `playerhit_n_melee_viking` zeroes the damage while Protect from Melee holds, so the
  exact-lethal blow the honourable death needs can only land once prayer has drained — which
  is when the fourth form is the one swinging. Turning the prayer off to "let him
  win" sooner kills the character outright on form three, at 70 stats, in the open.
  `defeat_viking_enemy3` drains the bar to nothing anyway when the fourth form spawns.
- **The honourable death needs an exact roll, so leaving the fight is not the same as
  passing it.** `combat_viking_damage_player` calls `viking_honour_death` only when the
  damage lands on the character's last remaining hitpoint; an overkill is an ordinary death in Lumbridge
  with the vote unspent. The pass teleports to Thorvald's loft, so that tile is the test —
  a loop that reads "no longer in the battleground" as a win reports a Lumbridge respawn as
  a seventh vote.
- **A shop's stock line is the difference between a source and a bank seed.** Three shops
  list a raw shark and two of them list it at `0` — stock the shop only ever holds
  because a player sold one. Rufus in Canifis is the only entry with a baseline, and his
  door is Morytania's, which turns Fossegrimen's offering into a quest prerequisite the
  guide never mentions. Grep the `.inv` for a non-zero baseline, not for the item.
- **A hometown shop can be locked behind the quest it belongs to.** Rellekka's general
  store, fishmonger, spinning wheel and market all refuse anyone who is not yet a
  Fremennik, so the vegetables come from the field outside the gate and the fleece is spun
  in Seers' Village. Being in the right town is not being able to buy.
- **A vote count is not a quest stage.** `%viking` is one plus the number of votes and
  every trial keeps its own range in `%viking_bits`, so a harness that seeds the varp alone
  builds a character the content cannot produce: the journal reads three votes while all
  seven trials read not-started, and the bot walks back into work already paid for.
- **The journal is the only place the seven sub-states are visible.** Nothing transmits
  `%viking_bits`, and the flower trade alone has thirteen positions. `readProgress` reads
  them off the rendered page — `I now have the Navigator's vote` against
  `The Navigator will vote for me if I can pass his trial` — and the eleven
  `The <role> is looking for …` lines name where the trade has got to.
- **Two of the thirteen trade states render the same page.** `sigmund_started` and
  `sigmund_spoke_sailor` are indistinguishable in the journal, so the opening is one step
  that talks to the Sailor and then to Olaf rather than two the module cannot tell apart.
  Everything after that is item-driven: what is carried names the councillor who wants it.
- **A `useOnLoc` whose goal is "the item left the pack" returns with the loc's own
  conversation still up.** The fourth ingredient into Lalli's cauldron opens a chat that
  the next `openDialogue` inherits, so the fleece talk drove a dead chain to its end and
  then idled out its timeout. A driver that re-opens the conversation once the first pass
  produces nothing fixes it; one that opens once does not.
- **One councillor's menu changes when another councillor's trial opens.** Peer leads with
  "Ask about depositing your equipment" as soon as Thorvald's trial is live, and taking it
  banks the pack without ever starting Peer's own trial — so the same preference list used
  for both loops forever. The opening and the banking need separate lists.
- **A bartender is not always a shop.** The Forester's Arms serves beer through
  `@multi3` and has no `Trade` op at all, so `Shop.open` finds nothing and a `buy` step
  fails with "could not open Bartender's shop". Read the `.rs2`, not the sign.
- **A loc that answers with `~mesbox` has not finished when the click lands.** Both mounted
  heads in the puzzle house suspend on `p_pausebutton` and add the disk only once the box is
  continued, so a `Reach.locOp` whose oracle is the item waits out its window while the box
  sits there. `promptLoc` is the shape: reach, then drive whatever prompt came back.
- **Blocked floor under a trapdoor is normal.** Both trapdoor tiles in Peer's puzzle house
  are unwalkable in the collision pack — you arrive on them by teleport and step off — so
  every stand is beside one, and the ops are clicked from a cardinal neighbour.
- **The two halves of the puzzle house are separate pockets at ground level, and the
  mural belongs to the east one.** The riddle door opens into the west half, the ladder
  there climbs to the puzzle floor, and the mural that pays out the vase lid hangs on the
  dividing wall facing east — reachable only back down the *other* trapdoor. A flood over
  the pack says which side a loc is on; the map picture does not, and a box guessed one
  tile short put the bot in the east room while the module thought it was outside.
- **Both of Peer's doors belong in `SCRIPT_REFUSED`, and the bouncer's does not.** Door 1
  opens only to a solved lock and an empty pack, door 2 only to an `oplocu` with the key
  from inside; baked as edges the walker routes into a sealed pocket and repaths against a
  locked door forever. The longhall's backstage door is the opposite case — it refuses
  only the inward crossing, and the stage behind it is a dead end nothing routes through,
  so removing it would seal the bard in after his own performance.
- **Swensen's maze is seven fixed portals, and every other portal scatters you.** The
  route is a chain of tiny rooms: land, walk two or three tiles, click the one portal
  whose loc id belongs to the route. Matching by name picks a wrong portal, because all
  of them are called `Portal`.
- **Each portal jumps far enough to rebuild the scene, so the next portal is unqueryable
  for a few ticks.** `Reach.locOp` read that blank as "loc absent", walked the stand and
  returned `retry` without ever clicking, which the step reported as a wrong landing. The
  run reached the seventh portal only because each attempt resumed one leg further on, at
  28 attempts and one escape-rope reset. Positive evidence of scene sync is the rule
  ([level-change lag](level-change-lag.md)).
- **A tile the route only walks through is still mid-route.** Reading position by landing
  tiles alone makes an attempt parked on a portal's stand tile look scattered, and the
  escape rope then throws away every leg already won.
- **A bearing that names a quadrant is two bisections, not a compass stride.**
  `draugen_locate` compares the coordinates axis by axis, so every reading is the sign of
  dx and the sign of dz. Walking a fixed number of tiles along the named compass point
  random-walks and exhausts the step's budget; cutting a search box on each axis and
  aiming at its middle closes on the target in about eight readings.
- **A search box needs a way back out.** The target is an npc and wanders, half the box is
  sea, and a walk that lands short of an unreachable middle reads the same bearing from
  the same tile forever. Reopen the box around the character whenever the halves cross or
  the walk does not arrive, and reopen it wide every second time so a long drift is still
  found.
- **The honourable death leaves you on a loft the walker has no edge off.** The seventh
  vote is awarded by dying to Koschei, which drops the character on Thorvald's upper
  floor; every route out reads unreachable until that ladder is climbed, so the climb has
  to come before the walk to Brundt rather than inside the trial that earned it.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Shield of Arrav's pitfalls](quest-pitfalls-7.md)
- [The Fremennik Trials' harness recipe](../reference/quest-harness-recipes-18.md)
- [Add a quest](../how-to/add-a-quest.md)
- [Quests](../QUESTS.md)
