[Manual](README.md) › Map tile picker

# Map tile picker

The **Pick on Map** control on `type: 'tile'` script settings opens a modal with
two display modes:

| **Show basemap** | What you see |
|---|---|
| **On** (default) | Classic [2004scape worldmap](https://2004.lostcity.rs/worldmap) **surface** terrain + optional Key / multi / free / labels. `worldmap.jag` has no L1–L3 floor rasters — upper **Level** still uses collision dots for that plane so the control is not a no-op. |
| **Off** | Collision-dot grid + named destination markers |

Clicks always **snap to the nearest walkable tile**. The basemap is never used for pathing.

## Deploy bake (terrain + per-type Key overlays)

```sh
bun run gen:basemap
```

Runs MapView **once** and writes:

| Asset | Role |
|---|---|
| `worldmap-basemap.<fp>.png` | Terrain only (no Key icons) |
| `worldmap-key-type-<id>.<fp>.png` | One transparent overlay **per Key legend type** (Bank, Altar, …) |
| `worldmap-key.<fp>.png` | All Key icons (composite; fallback) |
| `worldmap-labels.<fp>.png` | Town / place names (transparent) |
| `worldmap-key-index.<fp>.json` | Names + placements |
| `worldmap-multi.<fp>.png` / `worldmap-free.<fp>.png` | Zone tints |
| `worldmap-basemap.manifest.json` | URLs + geometry |

Key names match the classic applet **Key** panel (`WORLDMAP_KEY_NAMES`). Each type is
pre-generated as its own overlay so Settings can toggle **Bank** without **Altar**
with no MapView cost.

Default basemap view is **terrain only** (no Key types selected).

## Settings (in-picker)

| Key | Default | Group | Purpose |
|---|---|---|---|
| `showBasemap` | `true` | Display | Mode: worldmap vs classic dots+destinations |
| `dotColor` / `dotAlpha` | dark blue | Display | Dot style (**classic mode only**) |
| `keyIconTypes` | `[]` | Worldmap layers | Multiselect of Key legend types (pre-baked per type) |
| `showPlaceLabels` | `false` | Worldmap layers | Town / place names (pre-baked) |
| `showMultiTint` / `showFreeTint` | `false` | Worldmap layers | Zone tints (pre-baked) |
| `bakeLabels` … | `false` | Basemap rebuild | Rare live MapView stamps |
| `skipRebuildConfirm` | `false` | Basemap rebuild | Skip freeze warning |

**Rebuild map…** is rarely needed: deploy already bakes terrain + every Key type +
tints. Use Rebuild after a game update or for experimental stamps (labels, NPC dots).
Everyday Key layers = Settings only (instant).

## Live smoke

```sh
HEADED=0 bun tools/map-picker-basemap-live.ts [http://localhost:8890]
```
