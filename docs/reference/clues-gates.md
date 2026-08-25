[Manual](../README.md) › [Clues](../CLUES.md) › Gates

# Clue gates and unreachable clues

## Gated clues

[`data/clueGates.ts`](../../src/bot/api/ai/clues/data/clueGates.ts) pairs a clue with the
quest that seals its destination. Each entry carries the quest-list display name and what
sits behind it:

```ts
3564: { quest: 'Regicide', reason: 'Lord Iorwerth is in the elf camp' }
```

`clueGate(id, status)` takes a status reader and returns null once that quest reads
`complete`, so a finished account walks the clue instead of abandoning it.
`ClueExecutor.blockReason` passes `Quests.status`, and the block names the status it saw:
`Lord Iorwerth is in the elf camp (Regicide reads inProgress)`.

`unknown` is the quest tab not yet loaded, not a finished quest, so it keeps the gate shut.

A clue belongs here only when a quest seals its destination. One that is merely awkward to
walk to does not, and one the nav pack cannot route to belongs in `PACK_UNREACHABLE` below.
The three Regicide clues are in both: the quest opens the region, and the pack still has no
edges across it.

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
  `WALL_STRAIGHT` doors, so paired gates, the Varrock sewer gates, the West
  Ardougne wall, leave regions islanded.
- **Item-gated crossings.** Entering the Kharidian desert southbound consumes a
  Shantay pass (edge is baked; `SolveClue.bankFirst` keeps/withdraws one, #371,
  and a leg that still comes up short buys one, see [Crossing tolls](clues-mechanics.md#crossing-tolls)).
  Offline pack audit still treats desert as closed without virtual WorldState.

## Proving a gate

`e2e/clues/tirannwn-clue-gate-live.ts` runs 3560, 3562 and 3564 through ClueSolver on one
account, first with Regicide unfinished and then with `regicide_quest` seeded to 15 and a relog.
The shut phase wants the abandon; the open phase wants ClueExecutor's `leg N` solve line, which
it logs on the statement after `blockReason` returns null. Absence of a gate line is not the
oracle, because a leg that died in the bank stop looks the same.

The open phase then reports where the walk stopped and does not fail on it. Pass
`--expect-solve` once the solver can cross `REGICIDE_SEAMS`.

## See also

- [Clue database](clues-database.md)
- [Clue step mechanics](clues-mechanics.md)
