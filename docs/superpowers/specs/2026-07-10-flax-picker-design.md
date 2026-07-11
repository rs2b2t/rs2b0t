# FlaxPicker — Seers flax field picker — design

**Date:** 2026-07-10
**Status:** approved (design)
**Category:** Crafting

## Goal

Pick flax at the Seers Village flax field, bank the raw flax at the Seers bank,
and repeat. Fills the gap `GatheringBot` leaves — that one *drops* the product
when full; flax wants **banking**.

## Domain facts (verified in `~/code/rs2b2t-content`)

- The flax loc is named **"Flax"** with a **"Pick"** op (`spinning_wheels.loc`);
  picking yields the **Flax** item. Seers is a members area (rs2b2t is members).
- Exact field/bank tiles are set live in the smoke (loc placements aren't in a
  greppable config): the harness teles near Seers, finds the nearest `Flax` loc,
  and reads its tile.

## New files

- `src/bot/scripts/FlaxPicker.ts` — `TaskBot`, category **Crafting**.
- `tools/flaxpicker-test.ts` — headless live smoke.

The implementer does NOT register the bot in `scripts/index.ts` (the controller
registers all three new bots centrally). The bot MUST `export const SETTINGS:
SettingsSchema`.

## Settings

| Key | Type | Default | Notes |
|---|---|---|---|
| `flaxName` | string | `Flax` | loc name |
| `pickOp` | string | `Pick` | interact op |
| `fieldTile` | tile | `2744, 3446` | field centre (verify/adjust live) |
| `bankStand` | tile | `2725, 3491` | Seers bank stand (verify/adjust live) |
| `bankBooth` | string | `Bank booth` | booth loc name |
| `obstacle` | string | `door, gate` | openable obstacles on the run |
| `leashRadius` | number | 10 | flax search radius from `fieldTile` |

## Loop (TaskBot, priority order)

1. **ContinueDialog** — dismiss stray continues.
2. **BankTrip** — validate: inventory full (no free slots) OR no reachable flax
   loc within the leash while carrying flax. Walk to `bankStand`
   (`walkOpening`/`walkResilient`, opening any door on the way), open the booth,
   **deposit all Flax** (and shared junk), then walk back toward `fieldTile`.
3. **Pick** — validate: not full AND a `Flax` loc with the `Pick` op exists
   within `leashRadius` of `fieldTile`. If we're not near the field, walk there
   (`walkOpening`). Interact `Pick` on the nearest `Flax`, wait for the flax
   count to rise (bounded), and loop. (Flax locs don't deplete the way rocks do,
   so nearest-with-op keeps finding one.)

Reuses `Traversal`/`walkOpening`, `Bank`, `Locs`, `Inventory` — the same
primitives as CookBot/ArdyThiever.

## onPaint HUD

Status + flax picked + bank trips + pack free-slots + tick (CookBot-style).

## Testing

**Live (headless)** `tools/flaxpicker-test.ts`: tele to Seers, discover the
actual `Flax` loc tile (set `fieldTile` from it), run, and assert (a) flax
accumulates in the pack, (b) on full it walks to the bank, deposits, and returns
to pick again — a full pick→bank→return cycle. (Debugprocs need `::~`;
`::~maxme` if a level is needed; maxme dialogs swallow the next typed command.)

## Non-goals

- Spinning flax into bowstring (bank raw flax only).
- Walking to Seers from elsewhere (start it at the field/bank).
