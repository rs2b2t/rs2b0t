[Manual](README.md) › Map tile picker

# Map tile picker

The **Pick on Map** control on `type: 'tile'` script settings (WalkTo, fighters,
banks, gather stand tiles, …) opens a modal with:

1. an optional **worldmap basemap** underlay (decorative; MapPicker `showBasemap`), and  
2. a **walkable-tile overlay** from the same collision pack the navigator uses.

Clicks always **snap to the nearest walkable tile** in the collision pack. The
basemap is never used for pathing. Turn the basemap off to show only walkable
dots and destination pins.

Public API:

```ts
import { WorldMapPicker } from /* bot UI — not @rs2b0t/api */;
// WorldMapPicker.open(initial?) → Promise<{ x, z, level } | null>
```

Scripts only see the resulting `x,z,level` string on the setting. Implementation:

| Piece | Path |
|---|---|
| Modal + paint | [`src/bot/ui/WorldMapPicker.ts`](../src/bot/ui/WorldMapPicker.ts) |
| Dot theme / display prefs | [`src/bot/ui/mapPickerTheme.ts`](../src/bot/ui/mapPickerTheme.ts) |
| Basemap coords / manifest | [`src/bot/ui/worldMapBasemap.ts`](../src/bot/ui/worldMapBasemap.ts) |
| Live basemap rebuild | [`src/bot/ui/basemapRegen.ts`](../src/bot/ui/basemapRegen.ts) |
| Local CRC cache | [`src/bot/ui/basemapLocalCache.ts`](../src/bot/ui/basemapLocalCache.ts) |
| Rebuild confirm dialog | [`src/bot/ui/confirmDialog.ts`](../src/bot/ui/confirmDialog.ts) |
| Offline basemap bake | [`tools/map/build-basemap.ts`](../tools/map/build-basemap.ts) |

## Contents

- [Basemap bake (deploy)](#basemap-bake-deploy)
- [Walkable overlay](#walkable-overlay)
- [Settings (in-picker)](#settings-in-picker)
- [Rebuild map and local cache](#rebuild-map-and-local-cache)
- [Deploy layout](#deploy-layout)
- [Live smoke](#live-smoke)

## Basemap bake (deploy)

A full-world raster is produced once (like the collision pack), not on every open:

```sh
bun run gen:basemap
# or: bun tools/map/build-basemap.ts [--engine DIR] [--jag PATH]
```

**Default bake look:** entire map at max zoom-out (`1` pixel per tile, full
`mapWidth×mapHeight`), **no place-name labels**, no multi/free/NPC/item overlays.
Rebuild prefs can turn labels and overlays on later.

| Output | Role |
|---|---|
| `out/worldmap-basemap.<fingerprint>.png` | Immutable raster (fingerprint = hash of `worldmap.jag` + bake schema) |
| `out/worldmap-basemap.manifest.json` | Origin, size, `pixelsPerTile`, URL of the PNG |

`worldmap.jag` is resolved from `--jag`, `$ENGINE/data/pack/mapview/worldmap.jag`,
`out/worldmap.jag`, or a one-time download into `out/`.

Deploy scripts ([`tools/deploy-local.sh`](../tools/deploy-local.sh),
[`tools/pack-rs2b0t.sh`](../tools/pack-rs2b0t.sh), [`tools/b0t.sh`](../tools/b0t.sh))
bake the basemap if missing and copy the PNG + manifest next to `botclient.js`.
If the basemap is absent at runtime, the picker degrades to **collision dots only**.

Map geometry defaults match `MapView` (see `worldMapBasemap.ts`):

- origin `(32<<6, 44<<6)` → `(2048, 2816)`
- size `1600×1216` tiles
- `1` pixel per tile in the baked PNG (full-world / max zoom-out)

## Walkable overlay

Uses `collision.lcnav.gz` (same file as `Navigator` / `NavWorker`) and
`PathFinder.walkable`. Dots are LOD-sampled by zoom. Named
[`WALK_DESTINATIONS`](../src/bot/api/WalkDestinations.ts) pins are drawn on top.

Default walkable colour is a **dark blue** (`#0a3d7a` at 0.85 opacity) so the
grid stays readable on the classic basemap. Walkable dots default **off**.

## Settings (in-picker)

Map picker options are **not** under Global settings. Use the picker toolbar
**Settings** button → **Map picker settings** modal (namespace `MapPicker` in
[`SettingsStore`](../src/bot/runtime/Settings.ts) / `MAP_PICKER_SETTINGS`).

The settings modal opens with a short note on regeneration: display options apply
immediately; rebuild layers need **Rebuild map…** (confirm freezes the tab); close
without rebuild discards rebuild-layer edits; a CRC or prefs mismatch uses the
deploy basemap until you Rebuild.

**Rebuild map…** uses an in-app Yes/No dialog (with optional **Don't ask again**
checkbox above the buttons) before regenerating — not `window.confirm`. Re-enable
the prompt under Settings → Basemap rebuild → *Don't ask before rebuild*.

**Basemap rebuild** layer toggles are **draft** while Settings is open: close without
a successful rebuild reverts them. After a successful rebuild in the same session,
the draft baseline becomes the post-rebuild values (further uncommitted toggles still
discard on close). **Display** toggles apply immediately.

URL overrides: `?MapPicker.showBasemap=false`, `?MapPicker.showWalkable=true`, etc.

| Key | Default | Group | Purpose |
|---|---|---|---|
| `showBasemap` | `true` | Display | Basemap underlay; off hides Rebuild |
| `showWalkable` | `false` | Display | Walkable dots |
| `dotColor` | `#0a3d7a` | Display | Dot colour |
| `dotAlpha` | `0.85` | Display | Dot opacity |
| `bakeLabels` | `false` | Basemap rebuild | Place labels on regenerate |
| `bakeBorders` | `false` | Basemap rebuild | Borders |
| `bakeNpcs` | `false` | Basemap rebuild | NPC dots |
| `bakeItems` | `false` | Basemap rebuild | Item dots |
| `bakeMultimap` | `false` | Basemap rebuild | Multicombat tint |
| `bakeFreemap` | `false` | Basemap rebuild | Free-to-play tint |
| `skipRebuildConfirm` | `false` | Basemap rebuild | Skip freeze-warning dialog |

Display keys notify the open picker via `SettingsStore.onChange` so the canvas
updates while the settings modal is still open.

## Rebuild map and local cache

### When the basemap is regenerated

| Trigger | Behaviour |
|---|---|
| **Manual** | Toolbar **Rebuild map…** → in-app confirm → one-shot MapView bake from `worldmap.jag` |
| **CRC / prefs mismatch** | Local cache treated as miss → **deploy PNG** (no freeze). Status hints **Rebuild map…** |
| Open / pan / zoom / settings toggle | **Never** regenerates |

Opening the picker **never** runs MapView. A changed client `/crc` (new game rev) or
bake-prefs fingerprint only invalidates the cache; you rebuild when you want a fresh
local image.

Regenerated rasters are stored in **IndexedDB** (`rs2b0t-map-picker` / `basemap`), keyed by
the CRC string **and** bake prefs fingerprint. Hits require both to match. If `/crc`
is unreachable but a local entry exists, it is reused with a “CRC unverified” note.

### Manual rebuild steps

1. In-app confirm (Yes/No + optional Don't ask again) warns that the **tab may freeze**.  
2. Loads `worldmap.jag` from next to the bot bundle or `/worldmap.jag`.  
3. One-shot MapView load + full-map paint (no game loop); restores the game canvas + cursor.  
4. Writes IndexedDB under the current `/crc` key and updates the in-page basemap.

Requires `worldmap.jag` on the host when regenerating. Failure keeps the previous
image (deploy PNG or last good local cache). A timeout aborts further MapView work
at the next progress yield so shared canvas state is not left thrashing.

Everyday first-time use can use the deploy-time PNG until the user rebuilds. The
picker paints only on input (`requestAnimationFrame` coalescing); no continuous
redraw loop while the modal is open.

| Module | Role |
|---|---|
| [`basemapLocalCache.ts`](../src/bot/ui/basemapLocalCache.ts) | `/crc` key, IndexedDB read/write |
| [`basemapRegen.ts`](../src/bot/ui/basemapRegen.ts) | MapView one-shot bake |
| [`confirmDialog.ts`](../src/bot/ui/confirmDialog.ts) | Yes/No + Don't ask again |

## Deploy layout

Deploy places next to `botclient.js`:

- `collision.lcnav.gz` — walkable overlay  
- `worldmap-basemap.manifest.json` + `worldmap-basemap.<fp>.png` — default underlay  
- `worldmap.jag` — required only for **Rebuild map…**

## Live smoke

```sh
HEADED=0 bun tools/map-picker-basemap-live.ts [http://localhost:8890]
HEADED=0 bun tools/map-picker-walkto-e2e-live.ts [http://localhost:8890]
```

Attach proofs after open PR:

```sh
tools/attach-live-proof-to-pr.sh --pr <n> --issue 0 --slug map-picker-basemap \
  --harness 'HEADED=0 bun tools/map-picker-basemap-live.ts http://localhost:8890'
```
