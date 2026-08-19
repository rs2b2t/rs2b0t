[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Underground Pass, what the live legs paid for

The eleven the per-leg runs found after the module was written; the map and the traps are on the
[first page](quest-pitfalls-29.md) and reaching a seam on the [second](quest-pitfalls-30.md).

- **A region test and a step's own oracle have to agree.** The Ardougne wall gate leaves the character
  standing in the gateway, and `upassArea` counts x 2557 and 2558 as neither side — so the crossing step
  reported success, the queue asked for it again, and its second attempt walked back east to a gate that had
  shut behind it. Fifty seconds and a stack of "unreachable" lines per run. The crossing now steps onto the
  far stand and answers with the same region test the caller reads.
- **A telejump is not a seam, and its direction is in the map rather than in the script.**
  `@upass_area_2_3_entrance` branches on `loc_angle`: the unicorn doors at (2370,9665) and (2371,9665) are
  angle 1 and land the player at (2401,9610), four tiles from the loose railings, while all four doors at
  z 9611 are angle 3 and land them at (2371,9666) in the first cavern. A guard that asked whether the
  JOURNEY crossed the caverns therefore hid the one door that goes where leg 3 is going, because the slave
  cages (z 9655) and the railings (z 9606) sit on the same side of a split at z 9664. Ask where the door
  leads, which its own tile answers.
- **Rank a telejump above every seam that gains.** The door that lands beside the railings stands
  fifty-nine tiles from them, so every distance heuristic puts it last and the search spends a leg crossing
  stone bridges to prove the near ones lead nowhere.
- **A crossing that can be re-crossed turns a maze into a pendulum.** Spending a seam from the side it was
  crossed from is what lets a character out of a cul-de-sac, but offered as an equal candidate it swings the
  route between two sides of the same bridge — nine minutes of it in one run. The way back belongs in its
  own tier, after every fresh seam and every item-use.
- **"Nowhere to stand" has three causes and one message.** The ring can be off the loaded scene, the scene
  can call every tile of it blocked, or the flood can be unable to walk there from this pocket. Only the
  third is a seam in another pocket; the first two are bugs. The count of each is one line and saves a run
  per diagnosis.
- **A crossing measured from where the hop began credits the walk that approached it.** The route walks to
  a seam's stand before sending the op, and that stand can be fourteen tiles off — which cleared the two-tile
  "did we cross" test on its own. The pipe out of the slave cages was recorded as crossed when the character
  had only walked up to it: the seam was struck off, and the search carried on believing it stood in the
  pocket beyond. Measure from the tile the op was sent from, and re-take that baseline after an op sent from
  range, because the server walks the player before the script runs.
- **The unicorn doors are one shuttle with three ends, and the journal cannot say which one is live.**
  `@upass_area_2_3_entrance` picks on the door's angle and on `%upass >= ^upass_killed_unicorn`: the z 9611
  pairs always land at (2371,9666), and the pair at z 9665 lands at (2401,9610) beside the loose railings
  before the unicorn dies and at (2376,9610) after. Stages 3 and 4 print the same journal page, so no module
  can predict which. Score a door by the BEST of its ends, take it, and read where it landed.
- **Ask the client, not the collision pack.** Three route arguments built on the pack were wrong — it called
  the ledge's stand sealed when the bot crosses it every run, and it models a telejump as joining the pockets
  its door sits between. `bun e2e/upass-pocket-probe.ts --from x,z` stands on a tile and reports which anchors
  the loaded scene can walk to and what seams it holds. One run answers what an afternoon of flood-filling
  guessed at.
- **A distance test cannot answer a question about topology, and the second cavern asks five of them.**
  Which seam is worth taking is decided by where it LANDS the player, not where its loc stands — the spade
  dig reads as one tile of progress and teleports forty, and the unicorn doors stand fifty-nine tiles from
  the landing that finishes the journey. Whether a crossing happened is whether the pocket was left, not
  whether the character moved two tiles — the slave cages stand ON the corridor they open off, so walking
  past one counted as using it and struck it off. How many tries a seam deserves is a skill roll, and a
  server refusal — "I can't reach that!", "You can't do that from here" — is not one. Which of a door's four
  sides to stand on is decided by where crossing from it lands, because a door puts the player out the side
  opposite the one it was used from. And ranking those sides wants MANHATTAN, since chebyshev takes the
  greater axis and hid eleven tiles of southward gain behind one tile of x.
- **A landing under the character's feet is not a gain.** The cage into the mud cell carries that cell as
  its landing, which is what gets the route in; from inside, the same landing led the list and took the
  character straight back out to the corridor it had left a moment before.
- **The offline seam graph cannot be transcribed into a route.** Every crossing that is not a loc op is
  absent from it — the spade dig, the rope swing and both telejumps — so a breadth-first search over the
  report answers NO ROUTE between the well bottom and the railings, which the module walks. Read the report
  for what joins what, and let the runtime search choose.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Underground Pass: the map and the traps](quest-pitfalls-29.md)
- [Underground Pass: reach and the temple](quest-pitfalls-30.md)
- [Underground Pass's harness recipe](../reference/quest-harness-recipes-16.md)
- [Add a quest](../how-to/add-a-quest.md)
