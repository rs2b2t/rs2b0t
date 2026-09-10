[Manual](../README.md) › [Scripting API](../API.md) › World catalogs

# World catalogs, continued

### Fishing methods & mining rocks

```ts
FISHING_METHODS / resolveFishMethod / FISHING_METHOD_OPTIONS
gearKeepNames / hasFishingGear / missingFishingGear / fishingRestockPlan
ALL_FISHING_GEAR_NAMES / gearLabel(method)
spotMatchesMethod(actions, method) / WHIRLPOOL_IDS

ROCK_TYPES: Record<oreName, locIds[]>
ROCK_OPTIONS / resolveRockIds(names)
GAS_ROCK_IDS / GAS_ROCK_TICKS / BROKEN_PICKAXE
```

### Walk destinations

City / bank presets used by WalkTo and the **map tile picker** (named pins on the
pick modal). Full picker behaviour (basemap, walkable snap, Global settings):
[Map tile picker](../MAP-PICKER.md).

```ts
WALK_DESTINATIONS / WALK_OPTIONS / resolveDestination(name)
```

Settings of `type: 'tile'` in a script schema get a **Pick on Map** button in the
parameters UI. That modal is bot-panel chrome (`WorldMapPicker`), not part of
`@rs2b0t/api`; scripts only receive the chosen `x,z,level` string.

### Pickpocket targets

```ts
PICKPOCKET_TARGETS: { name; level }[]
PICKPOCKET_TARGET_NAMES
ARDOUGNE_PICKPOCKET_TARGETS   // Guard / Knight / Paladin / Hero
```

### Cow locations & rune craft routes

```ts
COW_LOCATIONS / resolveCowLocation / nearestCowLocation / COW_LOCATION_OPTIONS
isCowFieldLootTile(anchor, leashRadius, tile)   // same level and within leashRadius of the camp anchor
needsTollCoins / shouldBootstrapTollCoins / AL_KHARID_BANK / TOLL_COIN_TARGET

RUNES: Record<string, RuneRoute>   // rune, talisman, level, bank name, ruins tile
RUNE_OPTIONS / DEFAULT_RUNE
```

```ts
import {
    resolveMiningLocation,
    pickaxeReq,
    planGatherToolAcquire,
    PICKPOCKET_TARGET_NAMES,
} from '@rs2b0t/api';
```

---

## See also

- [World catalogs](api-catalogs.md)
- [Scripting API index](../API.md)
