# Nav v2 — Shortest Path quality, web-walker execution, 2004 soul

**Branch:** `feat/nav-v2`  
**Status:** Phase 0 foundation (+ Microbot/SP research folded in)  
**Companion:** [MICROBOT_SHORTEST_PATH.md](./MICROBOT_SHORTEST_PATH.md) · [README](./README.md)

---

## North star

> Given who I am right now, what is the cheapest **executable** walk from A to B
> on this 2004 engine — and can we say *why* each hop was chosen?

Product analogues:

| Product | What we take |
|---|---|
| RuneLite **Shortest Path** | Whole-map collision + transport catalog + state filters + A\* |
| Microbot **Rs2Walker** | Execute the path: doors, transports, stall, repath, harness |
| **rs2b0t love** | Wire-indistinguishable clicks, honest arrival, era-correct world |

---

## Architecture (target)

```
 Scripts / Reach / DirectNavigator
              │
              ▼
     ┌────────────────────┐
     │  NavFacade         │  typed findPath / walkTo only
     │  (Navigator today) │
     └─────────┬──────────┘
               │
     ┌─────────▼──────────┐         ┌─────────────────────┐
     │  PathFinder (A*)   │◄────────│  TransportGraph     │
     │  worker thread     │  edges  │  compile(v1 JSON)   │
     │  + WorldState filter│         │  + requires filter  │
     └─────────┬──────────┘         └─────────────────────┘
               │ waypoints + PathHop[]
     ┌─────────▼──────────────────────────────────────┐
     │  WalkOrchestrator                              │
     │    WalkFollow │ DoorHandler │ TransportHandler │
     │    SpecialCrossingHandler │ Recovery(PlannedEdge)│
     └────────────────────────────────────────────────┘
```

**v1 keeps working** until `NAV_V2` dual-run is green.

---

## Phase plan

### Phase 0 — Foundation (this branch start) ✅

- [x] Plan + Microbot/SP research docs  
- [x] `TransportEdge` / `WorldState` / `TransportRequires` types  
- [x] `meetsRequires`, stable `edgeId`, `compileV1Graph` adapters  
- [x] Unit tests `test/nav/v2/contract.test.ts`  
- [x] Pointer from `docs/NAV.md`

### Phase 1 — Unified graph in the planner

- Compile doors + stairs + transports → `TransportEdge[]` at pack load  
- `PathFinder.addTransportEdges(edges)` path (keep v1 loaders as input)  
- Emit `PathHop[]` on successful outcomes for explain tooling  
- Typed `FindPathOptions` only on `Navigator.findPath` (no positional avoid/max mixup)

### Phase 2 — WorldState at plan time (Microbot PathfinderConfig.refresh)

- Snapshot: members, skills, quest status, item counts, freeSlots  
- Filter edges with `meetsRequires` before A\*  
- Migrate coal-trucks log / toll coins / members hops onto `requires`  
- Re-enable selected `disabledReason: state-aware…` rows as `requires`  

### Phase 3 — Executor modularization (Microbot P2 spirit, strangler)

- Extract pure decision helpers + thin handlers; keep behavior  
- Optional `PlannedEdge` recovery registry for stuck frontier  
- Trapdoor Open → Climb (`openLocId`) stays first-class  
- Session blacklist for quest-locked doors + repath (SP/Microbot pattern)

### Phase 4 — Connectivity + harness (Microbot F2P harness shape)

- Component flood-fill report (party mine vs guild under, …)  
- `route-probe --explain` hop list  
- Mainland 2004 route table (Lumbridge ↔ Falador ↔ Edgeville ↔ Varrock …)  
- Live: trapdoor mines, Edgeville dungeon, existing quests under `NAV_V2=1`

### Phase 5 — Cleanup

- Single compiled transport artifact optional  
- Delete dual path; v1 JSON remain generator inputs  
- Update `docs/NAV.md` as v2 manual

---

## Transport contract (summary)

See `src/bot/nav/v2/types.ts`. Inspired by Microbot `Transport` + TSV columns, sized for 2004:

- **Topology:** from, to, kind, cost  
- **Execution:** loc name/action/locId/openLocId/locX/locZ, landing toTile/acceptAnyLanding  
- **Gates:** skills, items, quests, members, freeSlots  
- **Audit:** disabledReason (true bugs / unwalkable dest only — not “has a quest gate”)

Dialog / Drezel side-trips stay **recipes** (execution), not A\* nodes — unless we later add
macro edges (“start Nature Spirit”).

---

## Explicit non-goals (near term)

- Fairy rings, spirit trees, skillcapes, POH, leagues  
- Live collision learn-blocked TSV store  
- Bidirectional A\* / heavy path smoothing  
- Monolithic walker rewrite  

---

## Success metrics

| Metric | Target |
|---|---|
| Regression | existing nav unit + live harnesses green |
| Explain | every ok path prints hop list via tool |
| State | skill/quest/item gates fail at plan with clear reason |
| Structure | WalkExecutor façade shrinks; handlers unit-tested |
| Data | no “mystery” dungeon hop without loc metadata |

---

## First PR sequence on `feat/nav-v2`

| PR | Content |
|---|---|
| **A** | Docs + types + requires + v1 adapters + tests (Phase 0) |
| **B** | PathFinder consumes `TransportEdge[]`; hop explain on outcomes |
| **C** | Live `WorldState` snapshot + filter |
| **D** | Handler extraction + PlannedEdge recovery stub |
| **E** | Route corpus + component report |

Base on latest ladder/trapdoor work (`openLocId`, LostCity ladders) so the catalog is worth filtering.
