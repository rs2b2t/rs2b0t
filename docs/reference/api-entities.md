[Manual](../README.md) › [Scripting API](../API.md) › Entities

# Entities

## Entities & queries

Four world entity types, each queried through a fluent `EntityQuery`:

```ts
Npcs.query(): EntityQuery<Npc>
Players.query(): EntityQuery<Player>
Locs.query(): EntityQuery<Loc>          // scenery (doors, trees, rocks, stalls…)
GroundItems.query(): EntityQuery<GroundItem>
Npcs.all(): Npc[]
Npcs.nearest(count?: number): Npc[]
```

### EntityQuery

Chainable filters; terminal methods return results.

```ts
query()
  .name(...names: string[])   // case-insensitive exact match against any name
  .action(action: string)     // offers this action (case-insensitive)
  .within(dist: number)       // within dist tiles of the local player
  .withinOf(origin: WorldTile, dist: number)   // within dist tiles of another tile
  .inside({ minX, maxX, minZ, maxZ })
  .where(pred: (e) => boolean)
  // terminals:
  .results(): E[]
  .nearest(): E | null
  .nearestPreferLocal(preferRadius: number): E | null   // the cluster within preferRadius first, when one exists
  .first(): E | null
  .exists(): boolean
  .count(): number
```

```ts
const guard = Npcs.query().name('Guard').action('Pickpocket').within(3).nearest();
const oak = Locs.query().name('Oak').within(6).nearest();
const coins = GroundItems.query().name('Coins').within(12).nearest();
```

### Entity shapes

All entities are `Locatable` (`tile(): Tile`, `distance(): number`); most are
`Interactable` (`actions(): string[]`, `interact(action): boolean | Promise<boolean>`).

```ts
class Npc  { name; id; level; index; inCombat; health; valid(); targetsMe(); targetsAnotherPlayer(); /* + Locatable + Interactable */ }
class Loc  { name; id; /* + Locatable + Interactable */ }
class GroundItem { name; id; count; /* + Locatable + Interactable */ }
class Player { name; index; inCombat; targetsMe(); /* + Locatable, actions() */ }
```

> **Note:** `interact()` sends the action in place. It does **not** walk the
> player to a distant target. Walk first (see [Movement](api-movement.md)); the client
> paths within the loaded scene.

---

## See also

- [Scripting API index](../API.md)
