[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Shield of Arrav

Fourteen, and only the first two are quest facts.

- **A reward that deletes one of two is not a reward that needs two.** `king_roald.rs2`
  tests `inv_total(inv, arravcertificate) > 0` and deletes one, gated on nothing
  but having *joined* either gang. A certificate obtained by trade finishes the quest for
  a character that never saw a shield half. Read what the completion script consumes
  before designing around what the guide says it wants.
- **A pickup gated on the bank cannot be stockpiled.** The chest and the cupboard refuse
  while a copy sits in inventory *or* bank, so a spare half is impossible and only the
  certificate — checked in neither — banks. Which item is farmable is a property of the
  gate, not of the item.
- **`~objbox` and `~mesbox` build a main modal, not a chat line.** "You find half a
  shield, which you take." never reaches `GameMessages`, so a `sawSince` oracle on it is
  dead code that always reads false. Read `reader.mainModalTexts()`, or count the item.
- **A loc that transforms keeps its old id for a tick.** The chest and the cupboard are
  each a shut loc and an open loc; checking for the open id immediately after the Open
  lands reads the shut one and calls a successful open a failure. Poll it.
- **`Reach` reporting `retry` is not a crossing that failed.** The cellar ladder lands
  the character underground and still returns `retry`. Where the character is standing is
  the oracle; the status is a hint.
- **A pre-walk in front of `Reach` doubles the budget and wedges.** `Reach.locOp` walks,
  opens the blocking door and retries on its own 90s budget; a `walkResilient` in front of
  it spends a second one, and the pair sat at the Phoenix cellar for two and a half
  minutes. Let `Reach` own the approach.
- **A leg that did its work and failed to leave should report the work.** Taking the half
  and then failing the climb out returned false, which threw away a shield half the pack
  was holding. The next pass's early branch retries the exit for free.
- **Putting a door in `SCRIPT_REFUSED` makes whatever it guards a one-way trap.** All
  three hideout doors had to be removed from the graph, and each sealed a pocket the bot
  then could not leave: the Phoenix chest room, the weapon store's ten-tile ground floor,
  and the Black Arm stairs. Every one showed up only once a bot was inside *holding the
  quest item*, because until then nothing needed to walk out. Removing a door is half the
  work; the module owes both directions.
- **A component test, not a distance test, says which side of a door you are on.** The two
  sides of a one-tile wall are two tiles apart, so a proximity check calls a character
  standing at the door already through it. Flood the pack once and box each side.
- **`ownsInventory` means nothing ever opens a booth.** No banked item is visible at all —
  `snap.bankIds` stays empty all run — so a quest that reads the bank has to ask
  for a `scanBank` itself. Ours parked beside a bank holding the key it was waiting for.
- **An npc's display name comes from the `.npc` config, never from a guide.** The curator
  is `Curator`; every walkthrough calls him Curator Haig Halen, and a name that matches
  nothing makes `Reach` report a bare `retry` with no hint that the name is the problem.

Three came from stockpiling, and none of them is reachable at the default target — one
cycle hides every one of them, so the loop needs its own run:

- **A predicate that reads where an item sits, rather than how many there are, makes two
  branches undo each other.** "Minting is done" tested the split between pack and bank, so
  banking the surplus flipped it true, the withdraw pulled the same pair straight back, and
  the pair took turns every 1.2 seconds. This is the coin-float lesson again: a threshold
  on a total is stable, a target on a location is not.
- **A trade offers from the pack, so a stockpile in the bank is not offerable.** The bot
  reached the hand-over holding zero and reported "nothing to give" while its own bank held
  six. Whatever a handoff needs has to be withdrawn before the handoff decides.
- **A flag where the work is a count stops the supplier after one unit.** Each shield half
  buys the pair two certificates, so a boolean "I gave my half" left the supplier waiting
  for a certificate while its partner waited for the second half.

Four more came from the two-account trade, and they generalise to any partner handoff:

- **The engine shuts the offer screen a tick before it opens the confirm.** A loop gated on
  "is a trade open" exits on that one frame, reads a pack view that is still swapped, and
  walks away — which closes the window the partner is confirming in. Tolerate the gap.
- **The pack view hides whatever is sitting in the offer.** A giver that counts its own
  items mid-trade sees them already gone and calls the trade done before the partner has
  confirmed. Measure once the window is shut.
- **A giver that keeps one of two is still a giver.** "Gone from the pack" is the wrong
  test wherever the giver keeps one — one fewer than the baseline is the test, and the
  baseline can only be taken with no window open. Taking it by declining an open trade
  kills the partner's handshake, and two bots then deadlock closing each other's windows.
- **A main modal swallows the Trade-with click.** A conversation driver that returns the
  moment its goal lands leaves the closing mesbox up, and the next leg's trade never opens
  for either side — with no refusal to say why.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Shield of Arrav's harness recipe](../reference/quest-harness-recipes-12.md)
- [Add a quest](../how-to/add-a-quest.md)
