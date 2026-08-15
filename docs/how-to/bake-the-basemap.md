[Manual](../README.md) › [Map tile picker](../MAP-PICKER.md) › Bake the basemap

# Bake the basemap

## Bake at deploy

1. Run:

   ```sh
   bun run gen:basemap
   ```

Runs MapView once and writes the terrain, one overlay per Key legend type, labels,
tints and the manifest. See [Baked assets](../reference/map-picker.md#baked-assets).

## Rebuild from the picker

Rebuild is rarely needed — deploy already bakes terrain, every Key type and the tints.
Use it after a game update, or for experimental stamps such as labels and NPC dots.
Everyday Key layers are a Settings toggle and are instant.

1. Open a `type: 'tile'` setting and click **Pick on Map**.
2. Choose **Rebuild map…**.
3. Accept the freeze warning, unless `skipRebuildConfirm` is set.

## Verify

1. Run:

   ```sh
   HEADED=0 bun e2e/map-picker-basemap-live.ts [http://localhost:8890]
   ```

## See also

- [Map tile picker reference](../reference/map-picker.md)
