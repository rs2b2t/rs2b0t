[Manual](../README.md) › [World-walking](../NAV.md) › Level-change lag

# Level-change loc lag

**Every scene query is empty for about a tick after the level changes.** Climb a
ladder and immediately ask for nearby locs, and you get nothing. The scene has not been
rebuilt yet, so the query returns an empty list while the locs are still there.

This is the single most expensive gotcha in this subsystem: blank looks like
absent, so code concludes an object is missing and starts a recovery it never needed.
It caused a false "the crystal broke" wander loop at the Camelot tower, and phantom
ladder detours in the walker.

The executor settles after any level-changing transport before trusting the scene
([`WalkExecutor.ts`](../../src/bot/event/webwalk/WalkExecutor.ts)):

```ts
if (crossed) {
    if (transport.toLevel !== undefined) {
        await Execution.delayTicks(2);
    }
```

**Rule: require positive evidence of scene sync before concluding something is
absent.** An empty result immediately after a level change means "ask again".

A long teleport rebuilds the scene the same way a level change does. `Reach.locOp`
re-asks for up to 3s when the loc is blank and the character is already standing within
query range of it ([`Reach.ts`](../../src/bot/api/walking/Reach.ts)); a blank from
further off still walks the hint, because distance explains it without a rebuild.

## See also

- [World-walking](../NAV.md)
