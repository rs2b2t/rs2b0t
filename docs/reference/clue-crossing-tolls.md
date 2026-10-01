[Manual](../README.md) › [Clues](../CLUES.md) › Crossing tolls

# Clue crossing tolls

A toll the bot cannot pay does not read as "too poor", A* prunes the crossing, so
the region behind it leaves the graph and the leg reports a bare `unreachable`.
The Kharidian desert is the sharp case: it has one baked entrance and it
eats a Shantay pass, so a bot without one is told the desert does not exist.

[`gateItems.ts`](../../src/bot/event/webwalk/gateItems.ts) tells the two apart. On an
`unreachable` verdict the walker re-probes the same route with every crossing item
virtualized; if the route appears, the blocker is a shopping list and
`WalkExecutor.lastMissingGateItems` names it. `walkLeg` in the executor then buys
the toll (`GATE_ITEM_SHOPS`, Shantay stocks his own pass for 5gp, north of his
own gate) and resumes the original route. Missing tolls return immediately from
resilient walking so movement retries cannot erase the shopping list. Each walk
attempt can buy a pass, including a later desert entry after a pass is consumed.
A route that stays unreachable
with the full kit is a genuine nav-data gap and is reported as one.

The same lookup bug hid this from the bank planner: crossings are keyed at the
approach stand, but `itemsRequiredByWaypoints` matched on the loc tile alone. The
Shantay stand is (3304,3118) while its loc is (3302,3116), so the toll was
invisible and no pass was ever withdrawn. It now resolves through
`specialCrossingForTransport`, the same way the executor does.

## See also

- [Clue step mechanics](clues-mechanics.md)
