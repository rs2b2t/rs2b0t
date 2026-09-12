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

The offline audit currently carries seven exceptions in
[`PACK_UNREACHABLE`](../../src/bot/api/ai/clues/data/unreachable.ts).
An entry describes a limitation of ordinary pack routing; it does not always
mean the clue solver cannot get there.

- **Kharazi Jungle, 3532, 3534 and 3536.** `kharaziTravel.ts` cuts through the
  jungle band on entry and exit. It needs a machete, an axe, and Radimus notes
  unless Legends Quest is complete. Ordinary A* cannot perform the cutting.
- **Tirannwn, 3560, 3562 and 3564.** After Regicide is complete,
  `tirannwnTravel.ts` routes across `REGICIDE_SEAMS`, including the return to
  the mainland. Those seams are separate from the ordinary nav graph.
- **Duel Arena, 3554.** The dig at `(3374,3250,0)` is inside the obstacle arena
  bounded by `(3364,3244)` and `(3388,3258)`. Entry requires an accepted duel
  with another player and obstacles enabled. The nearby Forfeit actions only
  leave the arena. The solver does not arrange duels, so this clue remains
  unsupported. A Shantay pass does not open it.

The Duel Arena bounds come from `duelarena.dbrow`; `duel_arena_start.rs2`
places the accepted duel participants in a selected arena. These are in
Content's `scripts/minigames/game_duelarena/` directory.

Southern desert clues such as 3552 do use Shantay Pass. The crossing consumes
a pass; the solver keeps or withdraws one and can buy a missing pass from
Shantay. See [Crossing tolls](clues-mechanics.md#crossing-tolls).

West Ardougne clue 3522 uses the main city gate once Biohazard is complete.
Both directions work without a Gas mask. Before Biohazard, the sewer pipe
requires Plague City started and a worn Gas mask. The pipe still requires
the mask after Plague City is complete; the city gate has no mask check.
Starting Biohazard fills in the garden mud patch. The navigator stops using
that entrance at the same point, even when carrying a spade and wearing a mask.

## Proving a gate

`e2e/clues/tirannwn-clue-gate-live.ts` runs 3560, 3562 and 3564 through
ClueSolver with Regicide complete. It requires solved trails and checks the
return from Tirannwn. Use `--check-gate` to also test the unfinished-quest
abandon, `--gate-only` to stop at the gate verdict, or `--no-exit` to omit
the return leg.

## See also

- [Clue database](clues-database.md)
- [Clue step mechanics](clues-mechanics.md)
