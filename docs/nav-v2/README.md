# Nav v2

**Shortest Path–class planning + web-walker execution for a 2004 TypeScript bot.**

Built with the same love as the rest of rs2b0t: real client clicks, era-correct map, honest failures.

| Doc | What |
|---|---|
| [PLAN.md](./PLAN.md) | Architecture, phases, success metrics |
| [TELEPORTS.md](./TELEPORTS.md) | Server-scanned spell + jewellery + lever catalog |
| [MICROBOT_SHORTEST_PATH.md](./MICROBOT_SHORTEST_PATH.md) | Patterns from RuneLite SP + Microbot walker → our 2004 mapping |
| v1 manual | [docs/NAV.md](../NAV.md) (still authoritative for current behavior) |
| Code | [`src/bot/nav/v2/`](../../src/bot/nav/v2/) |
| Tests | [`test/nav/v2/`](../../test/nav/v2/) |
| Branch | `feat/nav-v2` |

## Status

**Phases 0–4 (partial).** Types, policy, Server tele catalog, PathFinder hops + state/tele
filter, spell tele executor hop, pack tools. **End-user toggle:** Global settings →
**World walker** = `Classic (stable)` (default) | `Nav v2 (experimental)`. Classic keeps
pre–nav-v2 request shape; v2 enables tele edges, hop logs, and live state filters.
WalkOptions may force `navEngine: 'v2' | 'classic'` per call.

```bash
# pack / unit (upstream-safe; no live engine required)
bun tools/nav/mainland-corpus.ts --explain
bun tools/nav/route-probe.ts --from 3222,3218,0 --to 3213,3424,0 --explain --tele --magic 99 --runes
bun tools/nav/component-report.ts
bun test test/nav/
```

Live harnesses (tele smoke, trapdoor mines, …) are **operator tooling** — not part of the
upstream test story. Run them only against your own engine deploy; do not document or
require a personal redeploy path in upstream PRs.

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
