[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Clock Tower

Clock Tower added five, and the first three are engine and API facts rather than quest ones:

- **A dungeon can have two mouths, and `crossHops` picks the nearest stand rather than a reachable
  one.** The clock tower's own cellar holds the black spindle and the rat poison and is
  walk-isolated from every other cog; the rest of the dungeon is a different ladder half a town
  away. Declaring a sealed cog room's ladder as a hop makes it the nearest underground stand from
  most of the map, and the walker loops on `no path to (2572,9632,0): unreachable`. Only a ladder
  every leg can reach belongs in `hops` — a sealed room climbs its own inside the leg that entered
  it.
- **A gate that refuses its own op from the side you can stand on is not a door.** `ctratgatea`
  advertises `op1=Open`, and `~check_axis` grants it only when the player's x equals the gate's,
  which is the caged side. It belongs in `SCRIPT_REFUSED` with the lever driving it — and once the
  baked edge is gone there is no path across, so the last tile is a `DirectNavigator` scene step
  and the server does the pathing with its live collision.
- **`opobju` had no client route at all.** Use-on reached locs, npcs and held items; an obj lying
  on the floor answers a fourth trigger, and the red-hot black cog is cooled through that one and
  nothing else. Read which trigger the handler is on before assuming the API can express it —
  `InvItem.useOn` had to learn ground items for this quest to be possible.
- **Counting the monsters never answers "did the poison land".** The cage rats are ordinary map
  spawns on `respawnrate=50`, so `npc_del` empties the pen for ten seconds and then it refills
  while `%cogquest`'s bit stays set. A leg that waits for the rats to be gone spends its full
  timeout on every pass. The gate is the oracle: Go-through, and either you are on the far side or
  you are not.
- **One ground spawn is not a source.** The bucket by the well east of the tower is the only one
  in reach and no Ardougne shop stocks one, so the run after the one that took it spins on
  `grabGround` until the spawn ticks back. Bank first, and `scanBank` before believing the bank is
  empty.

## See also

- [The map](quest-pitfalls.md)
- [Engine behaviour](quest-pitfalls-engine.md)
- [Tooling and verification habits](quest-pitfalls-habits.md)
- [Per-quest](quest-pitfalls-2.md)
- [Clock Tower's harness recipe](../reference/quest-harness-recipes.md)
