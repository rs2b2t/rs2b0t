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
filter, spell tele executor hop, pack tools (`route-probe --explain`, `mainland-corpus`,
`component-report`). Jewellery Rub + full WalkExecutor split still open.

```bash
# pack / unit
bun tools/nav/mainland-corpus.ts --explain
bun tools/nav/route-probe.ts --from 3222,3218,0 --to 3213,3424,0 --explain --tele --magic 99 --runes
bun tools/nav/component-report.ts
bun test test/nav/

# live (must use ~/redeploy.sh — engine is experiments/Server/engine, not ~/code/rs2b2t-engine)
~/redeploy.sh
HEADED=1 bun tools/nav-v2-tele-smoke.ts
```

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
