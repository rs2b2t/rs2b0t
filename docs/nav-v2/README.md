# Nav v2

**Shortest Path–class planning + web-walker execution for a 2004 TypeScript bot.**

Built with the same love as the rest of rs2b0t: real client clicks, era-correct map, honest failures.

| Doc | What |
|---|---|
| [PLAN.md](./PLAN.md) | Architecture, phases, success metrics |
| [MICROBOT_SHORTEST_PATH.md](./MICROBOT_SHORTEST_PATH.md) | Patterns from RuneLite SP + Microbot walker → our 2004 mapping |
| v1 manual | [docs/NAV.md](../NAV.md) (still authoritative for current behavior) |
| Code | [`src/bot/nav/v2/`](../../src/bot/nav/v2/) |
| Tests | [`test/nav/v2/`](../../test/nav/v2/) |
| Branch | `feat/nav-v2` |

## Status

**Phase 0 — foundation.** Types, `meetsRequires`, v1→edge adapters, research docs.  
PathFinder + WalkExecutor still run **v1**. Dual-run and `NAV_V2` come in later phases.

## Mental model (one picture)

```
  Shortest Path idea          Microbot idea              rs2b0t v2
  ─────────────────          ─────────────              ─────────
  collision map       +      execute every hop    =   pack + worker A*
  transport catalog          doors / transports         TransportEdge graph
  skill/quest filter         stall + repath             WorldState filter
  tele toggles / min dist    live harness               PathPolicy (early — few 2004 teles)
  (overlay for humans)                                  Walk* handlers + corpus
```

## Import

```ts
import {
    compileV1Graph,
    activeEdges,
    meetsRequires,
    type TransportEdge,
    type WorldState
} from '#/bot/nav/v2/index.js';
```
