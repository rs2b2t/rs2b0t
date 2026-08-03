# Classic nav vs pre–nav-v2 (`bce3c6e`)

Baseline commit: **`bce3c6e`** (Add hill giant script — last main tip before dual-run nav-v2).

## What “classic” means now

There is **one** pathfinder + executor stack. Classic is **not** a frozen copy of
pre-v2 sources; it is the shared engine with v2-only features disabled.

| Concern | Pre-v2 (`bce3c6e`) | Classic (default) today | v2 |
|---|---|---|---|
| Graph load | doors + transports.json + stairs | + **travelCatalog**, state-aware stair re-enable | same graph |
| WorldState | none | live snapshot when possible | same |
| Requires on edges | none | skill/quest/coins via `specialRequires` + catalog | same |
| No-state pack find | all edges open | **fail open** on requires (pack parity) | same |
| Live find | all edges open | fail closed when state says unmet | same |
| Tele inject | n/a | **off** | on (policy) |
| Bank-for-route | n/a | **off** | on |
| A* / long-range | Chebyshev always | Chebyshev; **Dijkstra if long-range edges** (#335) | + tele floor |
| MAX_EXPANSIONS | 300k | 500k | 500k |
| Door execute | inlined WalkExecutor | `exec/doorCrossing` (same logic + open-loc fast path) | same |
| Paint / camera | n/a | optional globals | optional globals |

## Audit findings (code review)

### Not a regression (shared improvements)

- **Open-door skip waits** (#356) — both engines.
- **Ship / gangplank / glider / spirit** execute fixes — both engines.
- **Guild skill gates, mining ladder, ropeswings** — honesty when WorldState present.
- **travelCatalog** on the graph — extra OD options for classic too.
- **Door approach-before-Open** — both engines.

### Real classic / pack-tool issue fixed on this branch

- **Requires fail-closed without WorldState** skipped every gated edge (ships with coin
  requires, fishing guild, …) in offline `PathFinder` / worker calls that omitted
  `state`. Pre-v2 had no requires, so those edges always expanded.
  - **Fix:** without `state`, do not drop requires-gated **graph** edges (fail open).
  - Tele **inject** still fail-closed without state (v2-only path).

### Intentional differences vs pre-v2 (keep)

- Live classic with WorldState will **not** plan through Fishing Guild at fishing 1
  or ships with 0 coins — pre-v2 would plan then fail at execute. Prefer honesty.
- Long-range edges force Dijkstra when no tele floor (#335) so A* prefers cheap
  portals/ships over pure walk; expansion budget raised to 500k.

### “v2 swallowed v1”

Accurate in the sense that **classic does not run a separate codebase**. The dual-run
switch only gates:

1. teleport catalog inject  
2. path-scoped bank planner  
3. v2 hop logging  

Everything else is shared by design. Tests: `test/nav/classicParity.test.ts`.

## How to re-audit

```bash
# Diff nav tree against baseline
git diff --stat bce3c6e..HEAD -- src/bot/nav/

# Classic default + requires metadata
bun test test/nav/classicParity.test.ts
```
