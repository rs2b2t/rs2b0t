[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Fishing Contest

Eleven. The first four are quest facts, the rest are map and engine.

- **One of the four contest spots can win, and only with one bait.** `hemenster_catch`
  hands out a giant carp for a red vine worm at the *pipes* spot; the willow-tree spot
  answers a worm with a sardine and plain bait with shrimp, and `bonzo_handover_catch`
  needs a carp in the pack to declare a winner. The garlic that drives the stranger off
  the pipes is the quest, not a flourish.
- **Carrying fishing bait alongside the worms is a silent loss.** `~get_hemenster_bait`
  returns the worm only while one is held and falls through to `fishing_bait`, so a pack
  that runs dry mid-round starts catching sardines, hands over a losing catch and resets
  the entry — with nothing in the log to say why. Carry worms and no bait.
- **Losing the round is the recovery, not the failure.** Handing sardines to Bonzo resets
  `%fishingcompo` to started and the fee to unpaid, but `%hemenster_pipe_stashed` is
  permanent — so the re-entry is seated beside the pipes without a second clove. A bot
  wedged at the willow spot should lose on purpose.
- **Winning is not finishing.** `%fishingcompo` stops at `won_comp` until the trophy
  reaches the dwarf, and Bonzo hands out a replacement for a champion who lost theirs, so
  the trophy is never a dead end.
- **A ground-decor patch is not uniformly reachable.** McGrubor's red-worm vines are
  twenty-odd shape-22 locs packed shoulder to shoulder. From (2632,3497) the vine one tile
  north-west answers *"I can't reach that!"* while the one due west digs fine, and after
  the dig walks the character the answers change again. Reachability is a property of the
  pair, so a leg that re-clicks `nearest` loops on the same refusal forever — ours did,
  five times over three minutes. Walk the ring, and treat a refusal as evidence only until
  the next dig moves you.
- **A straight wall decoration is reachable from its own tile and nowhere else.**
  `ReachStrategy.reachWallDecor` accepts the loc's tile outright, and `reachWallDecor1`
  carries adjacency rules for the *diagonal* wall-decor shapes alone — shapes 4 and 5 fall
  through to `false`. Hemenster's pipes are shape 5, so a stand one tile south, which is
  what `useOnLoc`'s radius-2 walk settles for, sends an `oplocu` the server can never
  satisfy. A route-finder that reaches no legal tile emits nothing at all, so the leg
  spends its thirty seconds and reports failure with no reason. Stand on the pipe.
- **Straight-line distance picks the wrong spade.** From Catherby, Falador's spawn is 146
  tiles away and Edmond's in Ardougne 261 — but Falador is 363 of path over White Wolf
  Mountain and its aggressive wolves, where Edmond's is 312 on the flat. The mountain is
  the only land crossing between the two kingdoms, so which side you are standing on is
  the choice; the distance is not.
- **The tunnel mouths are named by compass, not by kingdom.** The *west* dwarf (2820,3487)
  stands on the Catherby side and the *east* one (2876,3483) on the Taverley side, which
  is the opposite of what "walk west to Kandarin" suggests. Both run the same script, so
  the only thing the choice decides is whether the leg crosses the mountain.
- **The gate is a baked door edge whose crossing is a conversation.** Morris asks for the
  pass, spends two chat pages and an `~objbox` on it, and only then `p_teleport`s the
  player through. The navigator's door handler clicks Open and waits for a step that never
  comes, so the module owns the crossing and the walker is only ever asked for tiles on
  one side of it.
- **Only one half of the gate leaves quietly.** `_hemenster_gate` runs Bonzo's *"calling
  it quits"* prompt when the contest is under way **or** when the half clicked is
  `fishinggateclosedr`, so a merely-started quest walks out through the left half with no
  prompt at all and into a dialogue through the right. Its other option leaves the gate
  shut, which is why the exit takes the reset.
- **Every stage renders its own page, and the stage can go backwards.** Nothing is struck
  through here — each page is rebuilt — so six needles read the ladder with no flags. That
  also rules out the last-good cache the other journal readers keep: a lost round walks
  `%fishingcompo` back to started, and a stale read would send the bot to fish a spot it
  no longer owns.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Fishing Contest's harness recipe](../reference/quest-harness-recipes-2.md)
- [Add a quest](../how-to/add-a-quest.md)
