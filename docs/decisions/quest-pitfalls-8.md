[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Sea Slug

Ten, and the first three are all the same mistake — trusting a coordinate.

- **A loc's level in the map file is not the level it stands on.** The fishing platform is
  a bridge: its map squares carry `LINK_BELOW`, and `GameMap.loadLocations` drops every
  loc one level when that flag is set. The NPC and OBJ sections are not shifted. So the
  ladder, the crates, the panel and the crane all read one deck higher in `m43_51.jm2`
  than Kennith and the damp sticks that sit beside them, and stands derived from the raw
  file land in the sea.
- **The crates are the wall of a room, not furniture on a deck.** A `wood1` run seals the
  room's east side with one shut door, and the crates are its north wall. A stand on the
  open deck sees the loc at two tiles, clicks it, and nothing happens — the server's own
  approach walk cannot open a door, so the op dies silently with no refusal and no
  message. `Reach.locOp` opens it; `walkResilient` plus a click does not.
- **The crane refuses from three of its four sides.** `oploc1,fishingcrane` bails when
  `coordz(coord) < coordz(movecoord(loc_coord, 0, 0, 3))`, and its 4x4 footprint runs
  z 3286-3289, so only the deck row north of it passes. From anywhere else the answer is
  "I need to get closer to use that.", which is what a missed click reads as too.
- **The journal writes one page for two stages, twice.** `seaslug_journal.rs2` shares a
  page between "spoken to Kennith" and "sailed to Kent", and again between "Kennith needs
  an escape" and "panel opened". Where the character is standing separates the first pair.
  For the second, kicking a panel that is already open costs one "nothing interesting
  happens", so both halves run as one leg and the pair needs no separating at all.
- **The boat puts the torch out.** `board_ardougne_to_fishing_platform` swaps every
  `torch_lit` in the pack for a `torch_unlit`, and `ignite_light_source` refuses a
  tinderbox anywhere inside the platform's zone. The torch is lit on the deck or not at
  all — from the damp sticks and the broken glass that spawn there.
- **Bailey has no line on stage 10.** His switch covers stages 3-9 and 11-12. A character
  that reaches `need_kennith_path` without a torch cannot climb the ladder and cannot ask
  for a replacement, so that resume is a dead end rather than a slow leg — the harness
  seeds one, and `decide` says so instead of looping.
- **A failed rub costs nothing.** `opheld1,dry_sticks` returns before it consumes
  anything, so a miss costs the tick it took. At Firemaking 70 the roll lands about three
  times in four, and one attempt is not a result.
- **Two objects render "Torch".** 594 is lit and 596 is not, and every test that matters
  in this quest — climb the ladder, talk to Bailey, sail home — turns on which one is
  held.
- **`mes` is a chat line, not a dialogue.** The ladder refusal, the panel, the crane and
  the rub all print through `mes`, so `GameMessages` is the oracle for each of them and a
  `driveDialog` waits out its timeout for a box that never opens.
- **Swamp paste has a counter.** Khazard General Store stocks 500 at 42gp, 110 tiles south
  of Caroline. Making it instead needs swamp tar, which spawns in the Lumbridge swamp and
  Morytania and nowhere near Ardougne.

## See also

- [Quest pitfalls](quest-pitfalls.md) — the map
- [Sea Slug harness recipe](../reference/quest-harness-recipes-7.md)
