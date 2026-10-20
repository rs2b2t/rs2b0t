[Manual](../README.md) › [Blue dragon farming](../how-to/farm-blue-dragon-clues.md) › Recorded results

# Blue dragon clue farming results

Local engine runs at normal 600 ms ticks on 2026-09-29. Each passed the
complete farming, clue, restock and resumed-kill assertions without deaths.

| Site and target | Clue | Result |
|---|---|---|
| Taverley blue dragons | Final hard map step | [Passed](../e2e/jivedragons-taverley-blue-both-map-live.png) |
| Heroes' Guild blue dragon | Final hard map step | [Passed](../e2e/jivedragons-heroes-blue-both-map-live.png) |
| Gu'Tanoth greater demons | Final hard map step | [Passed](../e2e/jivedragons-gutanoth-blue-demons-map-live.png) |
| Gu'Tanoth blue dragons | Final hard coordinate step with Saradomin Wizard | [Passed](../e2e/jivedragons-gutanoth-blue-dragons-guardian-live.png) |

The potion restock check passed on 2026-09-30 at normal 600 ms ticks.
Super attack(1) and Super strength(2) were deposited and replaced with
three-dose flasks. Super defence(3) stayed in the inventory, with both banked
defence flasks untouched. The inventory also received five edible Lobsters after banking 20 noted
Lobsters. The bank held 35 Lobsters afterward (20 stocked plus 20 notes,
minus five withdrawn).
[Bank and inventory screenshot](../e2e/jivedragons-potion-restock-live.png).

The longsword puzzle check passed on 2026-09-30 at normal 600 ms ticks.
It started with a full pack and no dagger, prepared 15 Sharks with three free
slots, solved General Bentnoze's 79-move puzzle, collected two spilled
rewards after dropping food, then banked the trail pack. The resulting
inventory contained only 20 Lobsters, the Dusty key, nine Air runes, three
Water runes and three Law runes. The longsword stayed equipped throughout.
[Post-clue inventory screenshot](../e2e/jivedragons-longsword-puzzle-live.png).

The longsword guardian check passed the same day at 600 ms ticks. It defeated
the Feldip Saradomin Wizard, completed the hard clue with 10 Sharks left,
then returned to Falador and rebuilt the same farming inventory without a
death. No dagger was supplied or equipped.
[Guardian post-clue bank screenshot](../e2e/jivedragons-longsword-guardian-live.png).

For the White Wolf Mountain pilot and wolf-aggression check, run
`bun e2e/jivedragons-longsword-clue-live.ts --pilot`. It provokes a nearby Big Wolf,
requires the puzzle to open outside combat in the sheltered glider pocket, and
checks clue completion with the Dragon longsword still equipped.

The pilot check passed on 2026-10-01 at normal 600 ms ticks. It prepared
12 Sharks and four free slots, confirmed a Big Wolf attacking, then escaped
behind the glider. It solved the 29-move puzzle outside combat at
`(2852,3500,0)`, completed the clue and collected the spilled Rune plateskirt.
The character finished alive with 84 Hitpoints and its longsword equipped.
This check ends at clue completion.
[Pilot completion screenshot](../e2e/jivedragons-longsword-pilot-live.png).

For Entrana preparation and gear restoration, run
`bun e2e/jivedragons-longsword-clue-live.ts --entrana`. It starts with a full
backpack and ten equipped slots, checks that every slot is empty on Entrana,
and requires the original outfit and 100 arrows restored after the clue.

The Entrana check passed on 2026-10-01 at 600 ms ticks with 90 Hitpoints
remaining. It boarded with all equipment banked, completed the clue, and
restored all ten slots and 100 Bronze arrows at Catherby before returning
control to JiveDragons.
[Restored outfit screenshot](../e2e/jivedragons-longsword-entrana-live.png).
