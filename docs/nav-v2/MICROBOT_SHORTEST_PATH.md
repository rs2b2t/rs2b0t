# SP / Microbot → nav-v2 (patterns we kept)

Thin map of public Shortest Path + Microbot walker ideas to this 2004 bot. Not a port.

| Pattern | Use here |
|---|---|
| Plan vs execute split | `PathFinder` worker + `WalkExecutor` / `exec/*` |
| Transport catalog as data | JSON edges + `teleportCatalog.ts` |
| Plan-time skill/item/quest filter | `WorldState` + `meetsRequires` |
| Tele cost floor + min distance | `PathPolicy` / `distanceBeforeTeleport` |
| Path-scoped bank items | `bankPlan.ts` (runes/tolls; jewellery stays inv-only) |
| Route recovery on stall | `routeRecovery.ts` |
| Optional path paint | `pathPublish` + tile quads (HTML overlay; not RuneLite depth) |
| Live F2P harness as product | operator tools only — not upstream CI |

**Skipped:** bi-dir A\* / region LRU (map fits in RAM), fairy/cape matrix, learned collision TSV,
full ObstacleRegistry rewrite.

Catalog detail: [TELEPORTS.md](./TELEPORTS.md). Manual: [NAV.md](../NAV.md).
