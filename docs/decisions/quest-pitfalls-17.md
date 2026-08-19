[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Tree Gnome Village

Nine, and the first four are about one building.

- **A loc op that raises a mesbox pauses until its continue is clicked.** The crumbled
  wall answers with "The wall has been reduced to rubble." on a `p_pausebutton`, and the
  climb runs after it. A wait that only polls the tile holds the tick the button needs,
  so the leg timed out at forty-five seconds and the crossing fired the moment it handed
  the tick back. Every wait behind a loc op drives dialogue — that is `driveUntil`.

- **A door that opens from one side only is not an edge.** `khazard_stronghold_door`
  advertises `op1=Open`, so `derive-doors` baked it, and every route to the chest went
  through a door whose script opens it for a player already north of it and answers
  "The door seems to be locked from the inside." to everyone else. It belongs in
  `SCRIPT_REFUSED` — which then makes the stronghold a one-way pocket, and the module
  owes both directions: in over the crumbled wall, out through the door it lost.
- **Two rooms can share a bounding box and still be two rooms.** The hall behind the
  crumbled wall spans x 2500-2512, z 3254-3259; the room with the ladder spans
  x 2500-2506, z 3251-3256. A box over either answers for the wrong side of the wall
  between them, so each is a per-row span and the flood is what fills them in.
- **A diagonal door moves rather than swings.** `_door_closed` on a `wall_diagonal`
  deletes the loc and re-adds it one tile along, so the tile you clicked becomes
  walkable and its neighbour becomes blocked. Neither is in the baked graph, so the
  crossing between the two rooms is a `DirectNavigator` scene step after the Open.

Two are about reading the quest rather than the map.

- **The three tracker gnomes are decoration in this revision.** `tracker_gnome.rs2`
  records nothing — the varbits arrived in 2005 — and the ballista checks three fixed
  answers, so talking to all three teaches the module nothing it could read back. The
  quest is one loc op with height 4, x 3 and y 5.
- **`p_choice5_header` renders the same five labels three times.** "0001" to "0005"
  appear for the height, the x and the y in turn, and the header line is the only thing
  that separates them. `chatModalTexts()` carries it; matching on option text alone
  picks the first prompt's answer for all three.

Three are about the two orbs.

- **`orb_of_protection` and `orbs_of_protection` share a display name.** Both render
  "Orb of protection", and only the plural (588) finishes the quest. Every lookup goes
  through `snap.invIds`.
- **Both hand-overs are re-earnable, and both consult the bank.** The chest and the
  warlord each refuse while a copy sits in inventory *or* bank, so a banked orb has to
  be withdrawn rather than won again, and a lost one is re-issued by walking back. A
  `wait` at either stage would be wrong in both directions.
- **The village is a sealed pocket whose other two doors are quest-gated.** The spirit
  tree needs the quest complete and Elkoy's escort needs it started, so the opening walk
  to King Bolren is the Loose Railing at (2515,3161) and nothing else — 411 units of
  path against 231 once the quest is under way.

One more, found on the way to an axe and left alone:

- **The Ardougne training-camp gate is a baked edge that Biohazard gates.**
  `lathastraining_gatel` and `lathastraining_gater` answer "This is a restricted area."
  until `%biohazard` is complete, and both are in `doors.json`. Nothing here routes
  through them, so they are noted rather than refused; the Armoury's Iron axe is the
  wrong source for that reason, and Aemad's Adventuring Supplies is the right one.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Tree Gnome Village's harness recipe](../reference/quest-harness-recipes-13.md)
- [Add a quest](../how-to/add-a-quest.md)
