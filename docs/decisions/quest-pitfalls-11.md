[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Tribal Totem

Eight, and half of them are about the nav graph rather than the quest.

- **A door whose script reads which side you stand on is a one-way edge, and baking it both
  ways seals what it guards.** `[oploc1,tribaltotemdoor]` opens only for
  `coordz(coord) > coordz(loc_coord)`, so Handelmort Mansion lets you out and never in. As an
  ordinary `doors.json` row the pathfinder read the mansion as a shortcut, the walker spent
  three crossings on it before blacklisting it for the run, and every route into the building
  still ended in `unreachable`. `derive-doors.ts` drops the instance; the
  outward half is curated back in `travelCatalog.ts`. Dropping it alone would have left the
  mansion a pocket with no exit.
- **The walker's unstick opens whatever shut door it is standing beside, whether or not a
  route named it.** Wedged against the inner door, it reached for the combination door one
  tile away — which answers an Open with a modal rather than a step. A door that raises an
  interface is a hazard from any stall nearby, not only from a path that crosses it.
- **A stair edge can arrive by auto-reverse, and the reverse of a safe climb-down is a
  trap.** `stairs.rs2` gives the mansion's Climb-down; the derivation reverses it, enrichment
  matches `totemtrapstairs` at the far end, and the result is an edge that drops anyone who
  has not Investigated the stairs into the Ardougne sewers for a fifth of their hitpoints.
  `DISABLED_AUTO_REVERSES` in `derive-stairs.ts` is where that belongs — the module cannot
  refuse an edge the pathfinder hands the walker.
- **Interface component ids come from the pack, not from the `.if` file.**
  `tribal_door2:com_43` is component **760**: the packer numbers a root's children from
  `root + 1`, and the root itself is 716. Counting components in the interface file gives 43
  and clicks nothing.
- **The lock's state is only ever in its own text.** `%handelmort_traps_disabled` packs the
  four dials into bits 1-20 and the solved flag into bit 0, and none of it is transmitted.
  Each arrow click is verified by reading the dial's `if_settext` echo back through
  `reader.ifText`, and the confirm button is judged on "The combination seems correct!" —
  `com_57` runs `if_close` before it tests the word, so the modal shuts either way.
- **Every journal page repeats the ones above it.** The teleported page still contains the
  R.P.D.T. sentence and the crate page still contains the mansion one, so the parser tests
  the newest sentence first and works backwards. Testing the oldest line first pins every
  stage at 1.
- **The walkthrough's route is not the only one.** Both the guide and the quest send you to
  the R.P.D.T. depot through Cromperty's teleport block, but the depot has a Large door and
  the crates are ordinary walking distance from the Ardougne bank. Only the mansion leg needs
  the wizard, which is one fewer conversation on two of the four legs.
- **A quest whose only entrance is a teleport needs a where-am-I branch.** Provisioning walks
  the bot out of the mansion to the bank for its food, so the next pass at the teleported
  stage finds itself outside a building nothing can walk into. `decide()` boxes the sealed
  part of the mansion and routes back through Cromperty when the tile is outside them.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Tribal Totem's harness recipe](../reference/quest-harness-recipes-9.md)
- [Nav doors](../reference/nav-doors.md)
- [Add a quest](../how-to/add-a-quest.md)
