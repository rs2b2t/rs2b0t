[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Murder Mystery

The quest rolls a guilty sibling per character and hides the roll, so most of these
are about deriving it rather than reading it.

- **The thread is the roll, halved.** `~get_murder_thread` hands out green for Anna
  and David, red for Bob and Carol, blue for Elizabeth and Frank, so the colour in the
  pack cuts six suspects to two before a single print is lifted. Taking the thread
  first is what makes every later leg short.
- **A loop whose cursor no client state can hold belongs inside one step.** Which
  suspects the print has already cleared is unreadable — a mismatch destroys the print
  and hands the keepsake back, which is the state a suspect is in before being
  tested. Keeping the hunt in one `custom` step makes the cursor local, and a
  restart costs one pot of flour rather than looping on the first suspect forever.
- **A fixed order turns the pack into the verdict.** The hunt walks its order and stops
  at the match, so every keepsake held belongs to a suspect at or before the murderer
  and the last one held *is* the murderer. That survives a restart, and it is what
  narrows the poison leg to one sibling and one loc.
- **`%murder_poisonproof_progress` is written, not incremented.** The salesman sets it
  to 1 outright, so asking him again after the suspect has been questioned puts the leg
  back a step. Anything that re-runs the sweep has to re-run all of it, in order.
- **The journal separates the leg's end from its middle and nothing else.** Steps 1 and
  2 render the same page, so the sweep is written to be idempotent from any point and
  the journal is re-read after each suspect rather than branched on before them.
- **`~mesbox` is a chat modal, and what follows it is blocked until it is dismissed.**
  A mismatched print is deleted on the far side of `p_pausebutton`, so "the print is
  gone" is not readable until the box has been driven shut — the wait has to drive, not
  poll.
- **A ground obj whose Take is scripted is a renewable spawn with a bank gate.**
  `[opobj3,murderweapon]` adds a copy and leaves the spawn where it lies, and refuses
  only while one sits in the pack *or* the bank. Every barrel gates the same way
  through `~obj_gettotal`, so a banked keepsake makes its barrel silently useless and
  the module withdraws before any leg that a banked copy would block.
- **The stand for a wall-row loc is not the tile beside it on the map.** The flour
  barrel and the sacks sit on the kitchen's north wall row; the tiles north of them are
  outside the mansion and in a different component, so both stands are the row south.
  A path probe over the collision pack says which side, and the map file does not.
- **`Reach.locOp` walks on one call and acts on the next.** With the loc out of scene it
  runs `closeIn` and reports `retry` having clicked nothing, so a `promptLoc` that
  returns false is often only the approach. A step that visits four locs in a row and
  gives up on the first false restarts its own loop at the first suspect, walks back
  down for her, and never reaches the second — which reads as a `decide()` bug and is a
  missing retry.
- **Every named suspect renders a first name, and the guard renders `Guard`.** Two
  `murderguard` spawns stand at the mansion and nothing else called Guard is within
  reach of either, so the leash does the disambiguation the name cannot.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Habits](quest-pitfalls-habits.md)
- [Murder Mystery's harness recipe](../reference/quest-harness-recipes-6.md)
- [Add a quest](../how-to/add-a-quest.md)
