[Manual](../README.md) › [World-walking](../NAV.md) › Corridor snap

# Corridor snap

The player seldom lands squarely on a path tile: the server walks its own route, so the
bot drifts a tile or two off the plan. `locateOnPath` therefore matches the
**furthest** path index within `CORRIDOR` tiles of the player, scanning only a window
ahead of the last known index:

```ts
for (let i = fromIdx; i < Math.min(fromIdx + window, tiles.length, limitIdx + 1); i++) {
    if (tiles[i].level === me.level && chebyshev(tiles[i], me) <= corridor) found = i;
}
```

The window matters. A path that folds back on itself passes near its own earlier
tiles, and an unwindowed search would "advance" the bot across a fold it never
walked.

`selectClickTarget` then picks a target **by path index, not straight-line
distance** — the furthest clickable tile at or before the limit, walking backwards
from the top:

```ts
for (let i = top; i > pathIdx; i--) { if (isClickable(tiles[i])) return i; }
```

Choosing by distance instead would cut corners across walls, because two tiles either
side of a wall are adjacent in space and far apart along the path.

### The starvation case

Those two rules interact badly at short range. `selectClickTarget` searches
strictly `i > pathIdx`, and the terminal snap can put `pathIdx` **on the last tile**.
For any hop of three tiles or fewer the search window is then empty, and the executor
emits **zero clicks** — reporting "blocked" or "as close as reachable" while standing
still, having never tried.

`starvedTerminalIndex` is the rescue: when the player is not already on the end tile
and the end tile is clickable, it returns the terminal index directly.

```ts
export function starvedTerminalIndex(tiles, me, isClickable): number {
    const end = tiles[tiles.length - 1];
    if (end.level !== me.level || (end.x === me.x && end.z === me.z)) return -1;
    return isClickable(end) ? tiles.length - 1 : -1;
}
```

**Players and NPCs never block navigation.** A bot standing on your destination tile
is not why a walk failed — this was proven live with two clients stacked on one tile.
Suspect click starvation or a door instead.

## See also

- [World-walking](../NAV.md)
