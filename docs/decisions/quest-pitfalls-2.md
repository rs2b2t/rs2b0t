[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls, continued

The Knight's Sword added eight, and the first three are engine behaviours rather than
quest facts:

- **`record.items` is provisioned before `decide()` ever runs.** The engine's
  provisioning block withdraws or *gathers* every listed item up front, and only adds
  the quest to `provisioned` once `plan.satisfied`. A module that means to acquire
  things at the stage that needs them — the resumable shape — has to set
  `ownsInventory: true`, which is the switch that skips both the spillover deposit and
  the provisioning block. The cost is that the engine then withdraws neither the coin
  float nor the food, so the module owns both.
- **A coin float has to be a threshold, not a target.** `buy` withdraws
  `estGp` whenever the pack holds less, so a module that tops up to an exact balance
  walks back to a booth after every single purchase — the top-up and the purchase take
  turns undoing each other. Withdraw a large float when the pack drops under a low-water
  mark, and keep each `estGp` far below it.
- **`mineRock` ignores its `qty`.** It mines one ore per invocation and
  `decide()` is asked again, so a module that wants a batch has to count it. "Smelt as
  soon as any ore is held" walked the 130 tiles between the Rimmington rocks and the
  Falador furnace eight times for one batch of bars.
- **A loc with no ops at all is a use-on target.** The Range carries no `op1`; cooking
  is `[oplocu,_cooking_oven]`. `Locs.query().name('Range').action('Cook')` therefore
  matches nothing, and the step fails in a way that reads as "the range is not in the
  scene". Read the `.loc` config before filtering by an op you assumed exists — the
  Fountain is the same shape, and the Furnace (`op2=Smelt`) is not.
- **A pinned bank is only worth it for a quest that stays in one town.** Bank contents
  are global, so naming a booth changes nothing except the walk. Pinning Falador sent
  the bot from Draynor across two towns for a coin float with a booth underfoot; this
  quest touches four towns and wants `'nearest'`.
- **`forceapproach` names the only side that works, and it rotates with the loc.**
  The packer starts the flags all-blocked and *clears* the named bit
  (`forceapproach=east` → `0b1111 & ~0b0010`), so east is the sole legal approach, not
  the forbidden one. The flags then rotate with the loc's placement: Sir Vyvin's
  cupboard is at rotation 1, so its "east" is **south** in world space, and true east
  is not even a pathable tile. Standing anywhere else has every op **silently dropped**
  — the server drops the op and the loc keeps its shut id, with no refusal message and no player movement. The
  symptom is indistinguishable from a missing loc, so read the `.loc` config and the
  placement rotation before believing anything else. (The Al Kharid furnace is the same
  shape: `forceapproach=east`, stand south.)
- **Reproducing a server-side guard client-side turns it into a wedge.**
  `~vyvin_distracted` is `npc_find(coord, sir_vyvin, 1, 0)`, so the obvious move is to
  check Vyvin's distance and only search when he is clear. Sir Vyvin has
  `wanderrange=8` in a room barely wider than that: he is adjacent most of the time, and
  the bot spun every pass without once clicking. His position is read a tick before the
  click and re-evaluated server-side *after* the walk anyway, so the client's copy of the
  rule is never the rule. Act and read the result — the portrait landing is the only
  honest oracle — and keep the proximity test as a **bounded** hint that saves a wasted
  click. Any check that can refuse forever needs a counter that eventually stops
  refusing.
- **When a recipe can fail, count the product and not the input.** `smelting.rs2` loses
  half of every iron batch, so a loop driven by ore consumed thinks it succeeded. Eight
  ore for two bars, re-derived from the bar count, and a short batch is a no-op.

Horror from the Deep added six, and the first two are not quest facts at all:

- **A fight loop gets one action per tick, and has to choose which one.** The server
  runs a single op per tick and drops the rest, so a loop that eats, prays and casts in
  the same pass loses two of the three — and the one it loses is the food. The Dagannoth
  mother killed the bot twice at a full pack of sharks before the loop was rewritten to
  advance on `Game.tick()` and issue one action, priority eat → pray → cast. With
  the budget honoured she landed ten damage in the fight.
- **`navworker.js` is a second bundle, and the transport graph is inside it.** A harness
  that deploys only `botclient.js` leaves the navigator on the old edges, and the symptom
  is a flat `no path to (…): unreachable` for a route that the offline probe says is
  fine. Deploy both, or nothing you add to `transports.json` exists at runtime.
- **The optimal prayer play and the one a bot can keep are not the same.** The mother's
  AI switches from melee to ranged when melee is prayed against and back when missiles
  are, and a switch costs her the turn — so alternating the two every tick means she
  never attacks at all. A bot cannot promise every tick: taking damage makes the loop
  eat, eating spends the tick's one action, and the prayer stops flipping when
  it matters — half the time on the wrong one, which is 99 hitpoints to dead inside a
  single form. **Holding** Protect from Missiles instead forces her onto melee, whose
  max hit is single figures, needs no timing at all, and leaves the action budget
  for food and casts. Four runs since, hitpoints never went below 85.
- **Which protection to hold is a question about the npc's script, not its name.** Both
  dagannoths look like ranged attackers and only one is. `horror_dagannoth_jr4` declares
  no `ai_*player2` of its own, so it runs the default melee AI at
  `damagetype=stab_style` — Protect from Missiles does *nothing* for it, and a junior
  fought under the "obviously right" prayer still cost seventeen hitpoints and a third
  of the prayer book, which is what later ran the pool to zero mid-mother. Read the
  npc's handlers before choosing; if it has none, it melees.
- **Two fights back to back share one prayer, and the gap between them is a fight too.**
  `spawn_dagmother` adds the mother on the tick the junior dies and sets her ranging
  three ticks later. Clearing the junior's protection on the way out and arming the
  mother's inside the next `decide()` costs a quest-engine round trip — journal
  read included — and she spends it hitting an unprotected character for up to
  twenty-four a time. It killed a run outright from full hitpoints. Hand the prayer
  over at the moment of the win, inside the step that won.
- **A consumed item is not a missing item.** Each slot of the strange wall eats what it
  is given, so the pass that re-checks the wall finds no dagger, stops at that slot, and
  never reaches the arrow behind it — a permanent wedge one death after the first
  attempt. Skip what is not held, and let the door say whether the wall is short.
- **When both branches of a journal line say the same words, the colour tag is the
  oracle.** `horror_journal.rs2` prints "I need to repair the bridge leading to Rellekka"
  either way and only swaps `@dbl@` for `@str@` when it is done, so that one flag has to
  be read *before* the tags are stripped. Everything else on the page normalises first.
- **A prompt raised by a use-on lands a tick later, and answering once is not driving
  it.** The strange wall answers a rune with a `~chatplayer` line, then a Yes/No header a
  tick after that. `driveChoice` returns the moment nothing is open — which is the gap
  between the two — leaving the choice on screen and the step waiting for a message that
  never comes. `driveUntil(expect, ['Yes'], …)` keeps answering until the goal lands.
- **Turning teleports on is a provisioning change, not a routing one.** A* only injects
  a hop the *live pack* can pay for, so flipping Global `navTeleports` against an empty
  rune pouch changes nothing at all — the log even says `tele=true` while the bot walks
  the quest. What made it work was buying the rune stack the dungeon needs anyway
  at the Varrock counter the nails leg already ends at, **before** the barcrawl instead
  of after it: 45 minutes end to end against 68 walking, 16 hops, and a ten-bar tour that
  fell from 927s to 622s.
- **Which teleports exist is a question about quests, not about magic.** Max stats buy
  four of them — Varrock, Lumbridge, Falador and Camelot. Ardougne needs Plague City and
  Watchtower needs Watch Tower, so the two legs that would gain most, the Yanille/sand-pit
  glass chain and the southern bars, gain nothing and stay walks. Check the catalog's
  `requires.quests` before promising a route.
- **Law is the rune you cannot shop for, and it must not ride the per-tick float.** Only
  the Mage Arena and the Magic Guild stock it and the Guild wants 66 magic — seven above
  what this quest proves — so it comes from the bank or not at all. Drawing it in the
  coin-and-food top-up, which runs on *every* decide tick, deadlocks against `smithNails`:
  that leg banks the pack to make room for ore, law is not on its keep-list, and the two
  undo each other forever — `smith 8 nails` → `withdraw Law rune×60` → `smith 8 nails`,
  parked at the booth until the engine gives up. Anything the pack-emptying legs will
  deposit belongs in the one-shot kit, drawn after them.
- **A prerequisite with its own name belongs outside the quest that found it.** Alfred
  Grimhand's Barcrawl is what opens the Barbarian Outpost gate, and Horror needs it only
  because Gunnjorn is behind that gate. It lives in [`src/bot/api/ai/quests/barcrawl/`](../../src/bot/api/ai/quests/barcrawl/)
  — `BarcrawlLogic.ts` for the ten bars and the card parse, `RunBarcrawl.ts` for the
  driver — with a `Barcrawl` script that runs the tour on its own and a quest branch that
  calls the same `ensureBarcrawl`. The quest keeps only the coin `QuestStep`, because that
  is the one part the engine has to bank for.
- **The oracle can stop answering when it succeeds.** The barcrawl card renders
  one green/red line per bar — until all ten are green, at which point `opheld1` swaps
  the scroll for "You are too drunk to be able to read the barcrawl card". Reading that
  as a failed read leaves the tour looping on the tenth bar forever; it is the finished
  state, and the refusal message is what says so.
- **A quest area can be two maps.** During Horror the lighthouse interior is a broken
  copy in mapsquare 38_71; repairing the lamp teleports the player by (+64,-960) into the
  one in 39_56, whose staircases route back into the copy, and the basement and the
  cavern are two more pockets in 39_72. Nothing walks between any of them, so every
  branch starts by asking which pocket it is standing in — a death mid-stage drops the
  character on the mainland and the walk back in is the doorway, not the ladder.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Later quests](quest-pitfalls-3.md)
- [Fight Arena](quest-pitfalls-4.md)
- [Clock Tower](quest-pitfalls-5.md)
- [Add a quest](../how-to/add-a-quest.md)
