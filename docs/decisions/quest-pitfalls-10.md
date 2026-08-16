[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Monk's Friend

Monk's Friend added four, and the first is a correction to a conclusion drawn from the
engine source alone.

- **A player timer looks unrecoverable in the engine and is re-armed by the content.**
  The hidden ladder inside the ring of stones is `loc_add`ed by the `blanket_ladder`
  timer, and that timer is armed once, in Brother Omad's stage-0 dialogue. `Player.save()`
  writes coords, body, stats, perm varps and invs and no timers, and `removePlayer` calls
  `cleanup()`, which clears the map — so the save format says a logout at stage 10 strands
  the account with the blanket behind the one ladder that can no longer appear. It does
  not: `scripts/general/scripts/quests.rs2` re-arms the timer at login whenever
  `%drunkmonkquest >= ^drunkmonk_spoken_to_omad`. Read the content for the re-arm before
  reading the engine for the loss, and prove it live — the probe that settled this ran a
  seeded stage-10 account, relogged, walked 26 tiles off and waited 800 ticks, four times
  the loc's own `dur`.
- **`ladder_cellar` stands five tiles from the quest's own ladder and offers the same
  `Climb-down`.** A `within(6)` query centred on the ring picks it up and climbs into the
  Clock Tower dungeon, which probes `NO PATH` to the blanket — the cave is a sealed
  151-tile pocket whose only two ladders are both absent from the baked graph. Match the
  hidden ladder by tile, or keep it inside a `LadderHop`, whose three-tile radius around
  the stand excludes the decoy by construction.
- **A `useOn` step clicks the moment its walk returns, and the sink drops that click.**
  Every attempt that walked to the guardhouse sink first burned the full ten-second
  product wait; a retry from a standstill filled the jug in 295 ms. One leg spent fifteen
  minutes on that loop before the watchdog restarted the script. `useOnLoc` settles the
  scene between the walk and the use, which took the same leg to two minutes.
- **The AIOQuester `quests` setting is a record id, not a display name.** An entry that
  matches nothing is filtered out, and an empty selection means *every* quest — so a
  harness that seeds `"Monk's Friend"` instead of `drunkmonk` silently runs every quest
  and burns its budget elsewhere. The queue line names what loaded.

The thieves guarding the blanket need no plan: both are `huntmode=cowardly` with
`huntrange=1`, so at quest-ready stats neither ever engages and the food float is
traversal upkeep alone.

## See also

- [The map](quest-pitfalls.md)
- [Engine behaviour](quest-pitfalls-engine.md)
- [Tooling and verification habits](quest-pitfalls-habits.md)
- [Per-quest](quest-pitfalls-2.md)
- [Monk's Friend's harness recipe](../reference/quest-harness-recipes-6.md)
