[Manual](../README.md) › [World-walking](../NAV.md) › Doors and crossings

# Doors and crossings

A door is a path edge whose two tiles are not otherwise connected. Crossing one is
three separate problems, and conflating them is the classic bug:

- **Opening is not crossing.** The leaf animating open does not mean the player moved
  through it. The executor verifies the crossing itself — `isOnFarSide` compares
  distances to the near and far tiles rather than trusting the door's state.
- **Arrival at a door is wall-aware.** Plain Chebyshev distance says the tile on the
  other side of a wall is adjacent. `crossingEligible` requires the landing to be
  reachable before the crossing is triggered.
- **A door can re-shut** while you approach. `shouldApproachClosedBarrier` decides
  whether to close in first, and `chooseCrossClick` picks between stepping directly,
  clicking the landing tile, or clicking it in the scene.

Doors that are scripted to refuse entry from one side are **never** baked as
bidirectional — a one-way door baked both ways lures paths into dead ends. Double
doors are opened from the **exterior** stand; standing on a leaf wedges the crossing.

**Already open:** if the hop's Open-target is gone and a Close leaf is nearby (or
passage is free), the walker **skips Open waits** and continues — no multi-second
pause re-opening doors already swung open earlier on the route.

A door that refuses from *both* sides is not a door at all, and `derive-doors` skips
the type outright. `Open` in a loc's ops says nothing about whether the script honours
it: McGrubor's Wood's front gate is locked from inside the wood and guarded by the
Forester from outside, so the only way through the fence is the Loose Railing one
`Squeeze-through` edge away — curated, because "Squeeze-through" is not an `Open`.

## Special crossings

Some barriers need more than an `Open`: a toll, a fare, a dialogue, or a quest state.
Those are curated in
[`specialCrossings.ts`](../../src/bot/event/webwalk/data/specialCrossings.ts):

```ts
{ x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open',
  requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] },
  label: 'Al Kharid toll gate' }
```

`specialCrossingAt(x, z, level)` finds one, `meetsRequirement` checks affordability,
and `pickChoice` matches a dialogue option case-insensitively by substring so small
wording differences do not break a route.

Some barriers need a **permanent quest unlock** rather than a one-shot dialog at the
gate. Mort Myre’s Ulizius gate is a hard mesbox while Nature Spirit is not started;
once started the gate opens with no dialog. Those crossings carry `unlockQuest`: if
the quest is red, the executor walks to the NPC (`Drezel` in the Paterdomus mausoleum
after Priest in Peril), drives the start dialogue, returns to the gate, then opens it.

When the unlock NPC **grants items** on accept (Drezel: six unstackable pies), set
`freeSlots`. The executor banks disposable junk first if the pack is tight; if there
is still not enough space (or no bankable junk / bank unreachable), it **gives up**
rather than half-starting the quest or dropping gear.

A crossing can also gate on a **skill**, which is how Agility shortcuts are modelled:

```ts
{ x: 2598, z: 3477, level: 0, locName: 'Log balance', action: 'Walk-across',
  requiresSkill: { name: 'agility', level: 20 },
  label: 'Coal trucks log balance' }
```

`meetsSkill` checks it in the same two places `meetsRequirement` is checked — pruning
in `resetAvoids`, refusing in `handleSpecialCrossing`. Pruning is the important half:
without it a sub-20 account paths at a log it can never walk and wedges there, instead
of taking the long way round. The coal trucks log cuts mine→Seers from cost 263 to
156, and prunes back to 263 — still reachable — below the gate.

Note these entries are keyed at the edge's **`from` tile**, not the loc's own tile,
because `PathFinder` records `transport.locX/locZ` as the edge origin. A two-way
shortcut therefore needs two entries, one per direction.

Ship crossings carry a `toTile`, because they teleport rather than step — the
executor waits to land near that tile instead of watching for an adjacent move. A
crossing the bot cannot afford should be avoided **during planning**; discovering it
at the gate wastes the walk.

## Exact transport loc metadata

Location-backed transports may carry `locId` / `locX` / `locZ` from content-pack enrichment
(`bun run gen:nav-transports`). `locId` is the **map placement** (closed trapdoor on
the floor). When climb only exists on a transformed open loc, `openLocId` is set too;
`matchesTransportLoc` accepts either id. PathFinder prefers that metadata; the executor
falls back to nearby-name lookup when ids are absent. Special crossings resolve via
`specialCrossingForTransport` (exact loc tile, then approach stand).

Ladders with a single tele still wrapped in quest/skill/inv guards stay in the JSON as
`disabledReason` audit rows (not active graph edges), unless a curated activation in
`src/bot/event/webwalk/stateAwareRequires.ts` re-enables them with `requires` (merged at graph
load). Without a WorldState snapshot, requires-gated **graph** edges
**fail open** (pack-tool parity); live walks snapshot state and fail closed.

## See also

- [World-walking](../NAV.md)
