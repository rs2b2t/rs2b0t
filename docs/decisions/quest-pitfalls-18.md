[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Shades of Mort'ton

The quest is a supply problem wearing a minigame. Most of what it cost was the
supply half.

- **`~objbox` suspends the script on `p_pausebutton`.** Reading the diary sends
  an objbox first and opens the book after; the book therefore does not exist
  until the continue is clicked, and a wait on the main modal times out against a
  chat box nobody pressed. `~mesbox` and `~objbox` both end that way, so any loc
  or item whose script prints before it acts needs the continue drained before
  the effect it exists for is looked for.
- **A varp without `transmit=yes` is not on the wire, but its neighbours may be.**
  `%morttonquest` is server-only, so the stage still comes from the journal — yet
  `temple_repaired_p`, `temple_resources_p` and `temple_sanctity_p` all carry
  `transmit=yes`, and reading them is free. Check the `.varp` file before assuming
  a quest is journal-only.
- **A one-shot supply defines the budget for the rest of the quest.** The smashed
  table hands out two tarromin once per character and nothing else in Morytania
  sells or drops one reliably, so two vials — six doses — is the serum allowance
  for the run. Counting the conversations that need a dose (four) came first; the
  loadout followed.
- **An npc's shop op does not exist while he is afflicted.** Razmire carries
  `Trade-General-Store` and `Trade-Builders-Store` only on the cured npc type, so
  "does he offer the op" is the exact oracle for "does this trip cost a dose",
  and it costs nothing to ask.
- **The same counter is reached by different lines either side of a stage.** Before
  the rebuild the menu offers "Can I see the building store please?"; at
  `%morttonquest = 55` that option is gone and the way in is "I keep running out
  of building materials!". A shop step names every line that reaches its counter.
- **A menu that returns to itself makes a preference list loop.** Asking Ulsquire
  about the temple drops back into the same five options, so a driver that always
  picks the highest preference asks forever. Take each scripted option once, then
  leave on the exit line.
- **A ground-spawn loop must burn what is spare, not wait to hold the order.** Two
  logs spawn beside the Varrock east bank; a loop that waited to hold three before
  lighting any never lit one. Spend the surplus and let the respawn refill.
- **Mort Myre charges a food tax and a slot for it.** A ghast turns a random piece
  of food into Rotten food on the way south, so the crossing arrives one lobster
  poorer and one slot fuller — and the temple loadout has no slot to spare.
- **Every unfinished potion is called "Unfinished potion".** `tarrominvial` and
  `ashesvial` share the name, as do every unid ("Herb") and every serum vial size.
  The serum chain matches on ids alone.
- **The temple's fifteen pieces are what 100% means.** `%temple_repaired_p` is
  `30 + (walls_at_level_10 - 1) × 5`, which reaches 100 at fifteen: four corners,
  ten walls and the eleventh wall the south face has where the entrance is not.
- **A finished wall swaps `Repair` for `Reinforce`.** That is both the oracle for
  "this piece is done" and the op that keeps the server's `p_oploc(3)` build loop
  alive while the last percent lands, so the loop prefers Repair and falls back to
  Reinforce rather than stopping.
- **One click starts a server-side loop; re-clicking it costs three ticks.** The
  wall op re-queues itself, so the bot re-clicks only when the player is neither
  animating nor in combat for three ticks running — which is also what makes a
  shade interrupting the build cost nothing but the fight.
- **A self-re-queueing loop never leaves the loc it started on.** `p_oploc(3)`
  keeps building the wall that was clicked, and a wall at level 10 has no next
  stage — so the loop went on spending the pool into a finished wall and the
  temple sat at one repaired piece for four thousand resource points while
  sanctity climbed to 100%. Follow the target by tile and drop it the moment it
  stops offering `Repair`; "the player is animating" only proves the server is
  busy, never that it is busy with anything useful.
- **The temple is world state; the sanctity that unlocks it is not.** The walls
  hold their level for 9000 ticks, so a character can walk up to a temple another
  run finished, read 100% repaired, and still be refused the altar — sanctity is
  a player varp and only its own building earns any. The light leg therefore
  builds first and strikes second, and the rebuild leg waits for a build tick of
  its own before calling the temple done, because it is the tick and not the
  reading that moves `%morttonquest` on.
- **Carried material is not pool.** `~add_temple_resources` only converts a plank,
  a brick and five paste into 800 points on a successful build tick, so a pack
  full of material still reads `temple_resources_p` 0 — and a step that treats
  that reading as "nothing left to build with" gives up holding the answer.
- **"The player is animating" is not a lock you can wait out.** The wall's build
  loop re-animates every three ticks with no gap, so a light step that waited for
  a quiet tick before striking the altar never struck it. Gate the re-click of the
  loop on idleness; never gate the action that is trying to interrupt it.
- **A predicate for an item has to know the stage that consumed it.** Past
  `logs_on_pyre` the log is on the pyre, and "hold one log" still read true — which
  sent the bot back across the swamp to Varrock for a log the quest had finished
  with, from the last stage but one.
- **The reward for finishing the temple is on a 99-tick timer.** Both altar states
  are `loc_change(…, 99)`: a build tick arms the cold altar and it reverts to
  broken twenty seconds later, and the lit one goes out on the same clock. An
  errand between the rebuild and the strike — even the one that buys the olive
  oil the strike exists for — comes back to a broken altar, so the light step
  builds it back rather than reporting it missing, and the oil goes into the flame
  before anything optional does.
- **`~addxp` takes plain xp.** The `stat_advance` it wraps takes the engine's
  internal tenths, and the debugproc multiplies for you; passing tenths yourself
  lands 46 where 70 was wanted, and the harness reads the level back rather than
  trusting the command.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Nature Spirit's pitfalls](quest-pitfalls-6.md)
- [Shades of Mort'ton's harness recipe](../reference/quest-harness-recipes-7.md)
- [Add a quest](../how-to/add-a-quest.md)
