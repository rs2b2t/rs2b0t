[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Big Chompy Bird Hunting

Twelve, and only the first three are quest facts.

- **A shop that opens once shapes the item plan.** Bugs sells the knife and chisel,
  and Fycie the feathers, at `^chompybird_started` alone — one stage out of thirteen. Both
  counters are shut for every later stage and for every resume past it, so an established
  account's own pair is the source the module leans on and the ogre children are the
  fallback rather than the plan.
- **Twenty-five feathers is six arrows, and the quest takes six.** Fycie's stack covers
  what Rantz confiscates, which leaves nothing to shoot the chompy with. The
  quest as scripted expects the player to arrive with feathers; the module buys forty-eight
  and treats her stack as a bonus.
- **A grant that is one-per-account refuses in a chat line.** The ogre chest checks
  `inv_totalcat(inv, ogre_bellows) > 0 | inv_totalcat(bank, ogre_bellows) > 0` and answers
  "You search but find nothing in the ogre chest." The chest is a hundred tiles from the
  quest and the bank is four hundred, so the chest is tried first and its refusal is what
  pays for the booth trip.
- **A tile with exits is not a tile you can stand on.** Every swamp bubble but one sits on
  unwalkable floor whose neighbours are also unwalkable; the exit mask lists exits out of
  those tiles and no neighbour lists an exit in. `nearest()` picked one in the middle of
  the pool, the `oplocu` was accepted, and the player then stood ten seconds away from a
  loc nothing could reach. Read standability as "some neighbour can enter", never as
  "the mask is non-zero".
- **`openDialogue` does not walk.** It searches the npc list, which only holds what is
  within about fifteen tiles. Rantz is fifteen tiles from the bait clearing, so every talk
  issued from there failed in a millisecond with "no 'Rantz' nearby" — and passed on the
  attempt where he happened to have wandered closer. Walk to the anchor, then talk.
- **`~objbox` and `~doubleobjbox` suspend the script on a main modal.** Bugs shows the
  knife and chisel that way, and Rantz answers half his stages with one. `ChatDialog` reads
  the chat modal alone, so `driveDialog` stops at the first box and waits out its timeout
  while the conversation sits there. The driver has to click the main modal's continue
  button — `reader.mainModalButtonNearText('Click here to continue')` — as well as the chat's.
- **A menu that re-offers itself needs one-shot preferences.** `toadies_questions` is a
  five-option `p_choice5` that recurses after every answer, and only option one moves the
  quest to stage 15. A plain preference list picks option one forever. Spend a preference
  when it is taken, then fall through to "Ok, thanks."
- **A helper that acquires a prerequisite must not return as though it did the work.**
  `catchToad` filled the bellows and returned true, so the caller placed bait it did not
  have. Fill and catch in the same call, or report what it produced.
- **A step that waits has to wait where the trigger fires.** Rantz shoots only while the
  player is inside twenty tiles of him, and the toad pool is thirty-five tiles the other
  way. A bait loop that checks "is a toad down?" from wherever the last step ended waits
  out its window beside the pool.
- **A leg that spends coins needs the purse drawn before it talks.** Past the loan Rantz
  sells the replacement bow for 500-550 coins and answers an empty purse with "come back
  when you have" — a refusal that reads like a dropped click. A resume at stage 45
  retried the talk 122 times over ten minutes, because a failing custom step feeds no
  watchdog and so never parks itself.
- **A consumable floor is not one.** Three ogre arrows is a fight that runs dry with the
  bird still alive; the step then waited out its window and reported failure on a chompy
  it had been hitting. Set the floor at what the fight spends, and pick the spent ammunition
  back up — `ranged_dropammo_npc` leaves it at the target's feet.
- **Six locs can share one display name and only one carry the trigger.** The ogre
  spit-roast has an empty, a cooking, a cooked, a ruined and two chicken variants, all
  called "Ogre spit-roast"; `chompybird_spitroast_empty` is the only one with an `oplocu`.
  The cabbage patch is the opposite problem — it carries no `name=` at all, so the client
  menu reads null and a name query finds nothing. Both are matched by loc id.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Big Chompy Bird Hunting's harness recipe](../reference/quest-harness-recipes-17.md)
- [Add a quest](../how-to/add-a-quest.md)
- [Quests](../QUESTS.md)
