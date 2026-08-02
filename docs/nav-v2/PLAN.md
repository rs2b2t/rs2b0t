# Nav v2 — Shortest Path quality, web-walker execution, 2004 soul

**Branch:** `feat/nav-v2`  
**Status:** Phases 0–4 in progress (pathfinder hops/policy/teles, executor tele hop, tools)  
**Companion:** [MICROBOT_SHORTEST_PATH.md](./MICROBOT_SHORTEST_PATH.md) · [TELEPORTS.md](./TELEPORTS.md) · [README](./README.md)

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

**Dual-run:** Global **World walker** = `classic` (default) | `v2`. Classic walk
requests omit tele catalog and live WorldState. Shared data fixes (trapdoor
`openLocId`, ladder edges) apply to both.

---

## Phase plan

### Phase 0 — Foundation (this branch start) ✅

- [x] Plan + Microbot/SP research docs  
- [x] `TransportEdge` / `WorldState` / `TransportRequires` types  
- [x] `meetsRequires`, stable `edgeId`, `compileV1Graph` adapters  
- [x] Unit tests `test/nav/v2/contract.test.ts`  
- [x] Pointer from `docs/NAV.md`

### Phase 1 — Unified graph in the planner ✅ (partial)

- [x] Emit `PathHop[]` on successful outcomes  
- [x] Typed `FindPathCallOptions` on `PathFinder.findPath` / `Navigator.findPath`  
- [x] v1 edges carry `kind` + specialCrossing `requires` at compile  
- [ ] Single on-disk `TransportEdge[]` artifact (still compile from JSON)

### Phase 2 — WorldState + path policy ✅ (partial)

- [x] `WorldStateData` + live snapshot (`worldStateLive.ts`)  
- [x] Filter edges with `meetsRequires` / policy in search  
- [x] Special crossings skill/item → plan-time requires  
- [x] Spell tele inject + `PathPolicy` (toggles, distanceBeforeTeleport, allowlist)  
- [x] Jewellery catalog gated (needs `useTeleportCatalog: true` + item)  
- [ ] Re-enable disabled state-aware ladder rows as requires  

**Explicitly still later:** bank-for-missing-runes; duel-ring anim run stall.

### Phase 3 — Executor modularization ✅ (partial / strangler)

- [x] Spell tele hop via `Game.teleport` when waypoint has `teleportId`  
- [x] Hop logging in `walkTo`  
- [x] Session door blacklist API  
- [x] `PlannedEdge` types for recovery  
- [ ] Full handler extraction (Door/Transport/Special still in WalkExecutor)  
- [ ] Jewellery Rub dialog executor  

### Phase 4 — Connectivity + harness ✅ (pack tools)

- [x] `tools/nav/component-report.ts` pairwise seeds  
- [x] `tools/nav/route-probe.ts --explain`  
- [x] `tools/nav/mainland-routes.json` + `mainland-corpus.ts`  
- [ ] Optional local live suite (operator tooling; not upstream CI)

### Phase 5 — Cleanup

- Single compiled transport artifact optional  
- Delete dual path; v1 JSON remain generator inputs  
- Update `docs/NAV.md` as v2 manual

---

## Transport contract (summary)

See `src/bot/nav/v2/types.ts`. Inspired by Microbot `Transport` + TSV columns, sized for 2004:

- **Topology:** from, to, kind, cost (`from` optional/nullish semantics for originless teleports)  
- **Execution:** loc name/action/locId/openLocId/locX/locZ, landing toTile/acceptAnyLanding; teleports use spellbook cast (`Game.teleport`) not a world loc  
- **Gates:** skills, items, quests, members, freeSlots, currency  
- **Policy:** `PathPolicy` — teleport/ship/shortcut toggles + `distanceBeforeTeleport`  
- **Audit:** disabledReason (true bugs / unwalkable dest only — not “has a quest gate”)

Dialog / Drezel side-trips stay **recipes** (execution), not A\* nodes — unless we later add
macro edges (“start Nature Spirit”).

### Why teleport policy is early (2004 advantage)

OSRS Shortest Path has a huge tele matrix (items, spells, diaries, POH, …). **2004 has a small,
stable set** — standard spellbook destinations plus a handful of quest/NPC teles. That makes:

- cataloguing tractable in one PR,  
- `useTeleports` / per-destination allowlists cheap,  
- `distanceBeforeTeleport` a single Chebyshev (or path-cost) gate instead of a taxonomy of tele costs.

Scripts already escape with `Game.teleport('Varrock')` (e.g. GreenDragon). Wiring those into the
**graph** means the planner can choose “walk south until wildy ≤20 then Varrock tele” instead of
each script hand-rolling escape. Toggles exist so a nature runner or pure-walk quest can set
`useTeleports: false` without forking the walker.

---

## Explicit non-goals (near term)

- Fairy rings, spirit trees, skillcapes, POH, leagues (not in era / not needed)  
- **Bank-for-tele-items route analysis** (`TransportRouteAnalysis`) — agree useful later; out of initial phases  
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
| Teleports | policy can disable teles; long routes may use spell tele when runes+level allow and distance gate passes |
| Structure | WalkExecutor façade shrinks; handlers unit-tested |
| Data | no “mystery” dungeon hop without loc metadata |

---

## First PR sequence on `feat/nav-v2`

| PR | Content |
|---|---|
| **A** | Docs + types + requires + v1 adapters + tests (Phase 0) |
| **B** | PathFinder consumes `TransportEdge[]`; hop explain on outcomes |
| **C** | Live `WorldState` + `PathPolicy` (skill/toll + **tele toggles / distanceBeforeTeleport**) |
| **D** | Teleport catalog (spells + jewellery from Server scan) + executor cast/rub hops |
| **E** | Handler extraction + PlannedEdge recovery stub |
| **F** | Route corpus + component report |

Base on latest ladder/trapdoor work (`openLocId`, LostCity ladders) so the catalog is worth filtering.
