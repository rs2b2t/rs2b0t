# Conditional crossings + Al Kharid toll gate — design

**Date:** 2026-07-10
**Status:** approved (design), pending spec review
**Area:** navigation (`src/bot/nav`)

## Problem

Bots get stuck on gates during world-walking. The most visible case is the
**Al Kharid toll gate**: `WalkExecutor` treats it as an ordinary door.

Root cause (verified):
- `tools/nav/derive-doors.ts` emits a door edge for **any** loc with an `Open`
  op. The toll gate (`border_gate_toll_left`/`_right`, name "Gate", `op1=Open`,
  at (3268,3227) and (3268,3228)) is picked up as a plain, free door and baked
  into `src/bot/nav/data/doors.json` with the generic `Open` action.
- Opening it does **not** swing a gate — `oploc1` starts a **Border-guard
  dialogue** (`area_alkharid/scripts/border_gate.rs2`): "Can I come through this
  gate?" → if Prince Ali Rescue is done, a free pass; otherwise "You must pay a
  toll of 10 gold coins" → a 3-option choice; picking **"Yes, ok."** deletes 10
  coins and teleports the player across. With <10 coins it says "I don't have
  enough money" and nothing happens.
- `WalkExecutor.handleTransport` clicks `Open`, then waits up to 8s for the loc
  to vanish / collision to clear. A blocking dialogue never satisfies that, so it
  times out, marks the door failed, and repaths — the observed stall.

The general gap: **`WalkExecutor` has no concept of a crossing that needs a
precondition and/or a dialogue.** The toll gate is its first instance.

## Approach

Teach the executor about **conditional/dialogue crossings** via a small curated
data table, and drive them with the existing `ChatDialog` API. Any future
paid/dialogue/quest gate becomes one more row — no executor changes.

### 1. Data — `src/bot/nav/data/specialCrossings.ts`

Hand-curated, keyed by loc coord + level:

```ts
export interface SpecialCrossing {
    x: number; z: number; level: number;
    locName: string;                 // "Gate"
    action: string;                  // "Open"
    requires?: { item: string; count: number };  // { item: 'Coins', count: 10 }
    dialogue?: { choose: string[] }; // option text(s) to click, e.g. ["Yes, ok."]
    label: string;                   // "Al Kharid toll gate" (logs)
}
```

Al Kharid toll gate = two rows: (3268,3227,0) and (3268,3228,0), each
`requires { item: 'Coins', count: 10 }`, `dialogue { choose: ['Yes, ok.'] }`,
`label 'Al Kharid toll gate'`.

A pure lookup `specialCrossingAt(x, z, level)` returns the matching row or null.

### 2. `doors.json` unchanged

The toll gate stays a normal door edge so the pathfinder *can* route through it
**when we can pay**. All special behavior is layered at execution time. This
keeps the generated data clean and gives the audit (below) a single curated home
(`specialCrossings.ts`) rather than editing generated output.

### 3. `WalkExecutor.handleTransport` — the new branch

When the crossing's loc coord matches a `SpecialCrossing`:

- **Precondition unmet** — e.g. `Inventory.count('Coins') < 10`: log
  `"<label> needs 10 Coins — skipping"`, and fail the crossing so the caller
  adds it to `avoidDoors` and repaths. `failedDoor` is extended to always avoid a
  special crossing (not only level-less doors). Because there is no free F2P
  route around the toll gate, `walkTo` then ends cleanly with a reason instead of
  hanging. This is the **"ignore if you don't have 10 gold"** behavior
  (**decision: skip on <10gp** — a Prince-Ali-completed player with <10gp will
  not auto-use the free pass; documented limitation).
- **Precondition met** — `interact(action)`, then drive the dialogue:
  loop up to a bounded number of steps —
  - if a make/choice menu offers an option matching one of `dialogue.choose`
    (case-insensitive substring), click it (`ChatDialog.chooseOption`);
  - else if `ChatDialog.canContinue()`, `continue()`;
  - check **crossed**: the pay teleports the player to the far side, so
    "crossed" = `reader.worldTile()` reached the far tile `step`
    (`chebyshev(me, step) <= 1`) and/or coins dropped by the required count.
  Return true on crossed; false on timeout (→ retry/repath as today).
- **Not a special crossing:** existing behavior, unchanged.

Layering: `WalkExecutor` (nav) will import `Inventory` and `ChatDialog`
(`api/hud`). No cycle — `api/hud` depends on the adapter/router, not on `nav`.

### 4. Audit deliverable

Scan all `doors.json` edges, cross-referencing each loc's content `oploc`
handler, and flag any whose `Open` does something other than a plain
`door_open` (starts a dialogue, checks a condition/quest/item). Output:

- A short report (suspect gate → why → coord/locId).
- The **unambiguous** special gates annotated into `specialCrossings.ts` (the
  toll gate for certain; others only if clearly the same pattern).
- Ambiguous cases listed for user review, not silently changed.

Run as an Opus subagent over `~/code/rs2b2t-content` (per [[subagent-model-opus]]).

### 5. Testing

- **Unit** (`bun test`): `specialCrossingAt` lookup, the `dialogue.choose`
  option-matching, and the precondition eval over synthetic inputs.
- **Live headless** — `tools/tollgate-test.ts`, following the repo's proven flow
  (boot SwiftShader → login → tele → `::~<cheat>` → `runner`/`Traversal`,
  read state via `rs2b0t.reader`):
  1. Tele to the Lumbridge (west) side of the gate.
  2. **<10 gp:** drive `Traversal.walkTo` toward an Al Kharid tile; assert the
     walk returns without hanging and logs the toll-gate skip (no dialogue loop).
  3. **≥10 gp** (seed via `::~item coins 100`): assert coins drop by exactly 10
     and the player ends on the Al Kharid (east) side of the gate.

## Non-goals (YAGNI)

- Prince Ali Rescue free-pass detection (skip-on-<10gp decided).
- Auto-acquiring coins to pay the toll (the bot skips if it can't pay).
- Rewriting the pathfinder or `derive-doors` for special gates (runtime layering
  is sufficient; the audit only adds curated rows).
- Hardening every door edge / `walkOpening` (out of this scope; a full nav
  robustness overhaul was explicitly deferred).
