[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Holy Grail

Thirteen, and the first four are all one fight.

- **A stage that only ever moves backwards cannot be the fight's oracle.** `defeat_titan`
  runs on the titan's death and reads `inv_total(worn, excalibur)`. Without it he heals to
  full, taunts, and sets `%grail` to 7; with it he dies and the player is teleported past
  him — and `%grail` does not move at all. The journal has no line for the win either,
  because the "I defeated the Black Knight Titan" paragraph only renders from stage 8. The
  crossing is read from where the character is standing or not at all.
- **Refuse the fight rather than warn about it.** A kill without Excalibur wielded is worse
  than no kill: it costs the fight and moves the quest to a stage that reads the same
  as the one before it. The wield check belongs in front of the first swing.
- **Blocked floor is not a wall, and only walls stop an attack.** The titan stands on
  x 2791, the one gap in a solid blocked column, and nothing can step onto his tile from
  either side. `reachRectangle1` reads `WALL_*` flags alone, so the adjacent tile east of
  him is a legal place to attack from even though it is a dead end with one exit.
- **A one-tile crossing needs a component test that a rectangle cannot express.** The
  arrival pocket's west edge steps east as z falls, and its rows interleave with the far
  side's on the same z. Flood the pack once, read the two components' per-row extents, and
  encode the bands between them.
- **`derive-doors` bakes straight walls only.** The Fisher King's hall is behind
  `loc_1530` at shape 9 — a diagonal door — so the baked graph calls his room sealed and
  every route to him reports unreachable. `Reach`'s "server said it cannot reach, open what
  is in front" path is what gets in; the walk has to stop on the near side and let the talk
  do the last tile.
- **A building whose floor plan interleaves with the ground outside it has no box.** The
  Grail castle's ground floor and the swamp around it share rows and x ranges; only its
  upper floors are unambiguous. The bell landing is the state change worth latching, and
  `level >= 1` is the only durable read.
- **An item op that answers in two zones and nowhere else is a walk, not a check.**
  `magic_whistle` teleports from four tiles on Karamja and from anywhere in the realm.
  Everywhere else it prints "The whistle makes no noise" and changes nothing, so the leg is
  "walk to the heads, then blow", never "blow, then see".
- **A ground obj on furniture is taken from beside it, and only from four sides.** The
  Grail sits on a `roundtable` and the whistles land on a `spookytable`; both block their
  tile. `reachedObj` wants the exact tile, but `Player.inOperableDistance` also accepts
  `reachedEntity`, and `reachRectangle1` reads the four cardinal neighbours alone. The walk
  target has to be the cardinal neighbour at radius 0 — a diagonal stand is not adjacent.
- **`walkResilient` returning true is not "standing on the tile you asked for".** The
  arrival probe accepts the closest reachable point when the destination is sealed, so a
  step that walks to an unreachable tile logs `arrived (0 clicks)`, reports ok, and then
  fails at the click. Two Draynor Manor whistles sat three tiles away for eleven minutes
  because the walk said it had arrived. Probe the destination in the pack before trusting a
  tile as a stand.
- **An item that unlocks a supply is a standing key, not a step's input.** The napkin is
  what makes `whistledoor` drop whistles, and whistles are needed at three stages the
  napkin's own leg never reaches. Checking for it once, where it is acquired, left every
  later leg failing with a message and no way to act on it — each one has to be able to
  withdraw it, or park saying why it cannot.
- **A quest hint item is not a quest gate.** `oploc2,percy_sacks` tests the stage and
  nothing else, so King Arthur's magic golden feather — which the journal talks about at
  length — is a Camelot round trip the bot never needs to make.
- **The Entrana monk searches the pack as well as the shoulders.** `~has_entrana_restricted_items`
  reads `inv` and `worn` for every weapon and armour category, so the strip is a bank trip
  and a strip. Take the gear off *first*: stripping after the deposit puts it straight back
  in the pack and buys a second trip.

## See also

- [Quest pitfalls: Shield of Arrav](quest-pitfalls-7.md)
- [Harness recipes (Haz–Hol)](../reference/quest-harness-recipes-8.md)
- [Quest engine](../reference/quest-engine.md)
