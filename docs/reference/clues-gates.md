[Manual](../README.md) › [Clues](../CLUES.md) › Gates

# Clue gates and unreachable clues

## Gated clues

[`data/clueGates.ts`](../../src/bot/api/ai/clues/data/clueGates.ts) lists clues behind a quest
or region the bot has no route through. The solver reports the reason and abandons
immediately rather than walking until the navigator gives up. Only permanent locks
belong here; a clue that is merely awkward to walk to does not.

## Clues the pack cannot reach

Twenty-two clue destinations sit in components the baked nav graph cannot route to.
These are gaps in the **nav data**, not the clue database: the solver abandons
cleanly, and fixing one is a `transports.json`/`doors.json` change that makes the
clue start working with no solver edit. Each is listed with its diagnosis in
`KNOWN_UNREACHABLE` in [`audit-clues.ts`](../../tools/clues/audit-clues.ts), so the
audit stays at zero findings while the list stays honest about what is missing.

The recurring causes are worth knowing, because they affect more than clues:

- **Underground is entered one-way.** Several cellars had a climb-*out* edge and no
  climb-*in*, so the area was unreachable. Fixed for the Lumbridge cellar and
  the Varrock manhole; other cellars likely have the same gap.
- **Double doors and gates are not derived.** `derive-doors` emits single
  `WALL_STRAIGHT` doors, so paired gates — the Varrock sewer gates, the West
  Ardougne wall — leave regions islanded.
- **Item-gated crossings.** Entering the Kharidian desert southbound consumes a
  Shantay pass (edge is baked; `SolveClue.bankFirst` keeps/withdraws one — #371,
  and a leg that still comes up short buys one — see [Crossing tolls](clues-mechanics.md#crossing-tolls)).
  Offline pack audit still treats desert as closed without virtual WorldState.

## See also

- [Clue database](clues-database.md)
- [Clue step mechanics](clues-mechanics.md)
