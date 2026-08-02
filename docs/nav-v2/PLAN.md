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

### Phase 2 — WorldState + path policy (Microbot PathfinderConfig.refresh)

- Snapshot: members, skills, quest status, item counts, freeSlots  
- Filter edges with `meetsRequires` before A\*  
- Migrate coal-trucks log / toll coins / members hops onto `requires`  
- Re-enable selected `disabledReason: state-aware…` rows as `requires`  
- **Teleport policy (first-class, not deferred):**  
  - catalog standard spell teleports (Varrock / Lumbridge / Falador / Camelot / Ardougne — we already cast via `Game.teleport`) as originless `kind: 'teleport'` edges with rune/level `requires`  
  - `PathPolicy.useTeleports` (and later per-destination toggles if useful)  
  - `PathPolicy.distanceBeforeTeleport` — do not burn a tele when the remaining walk is short (Microbot’s `distanceBeforeUsingTeleport`; **easier here**: ~5 destinations, not 200 TSV rows)  
  - tele cost uses `duration`/fixed tele cost so A\* does not treat them as free zero-distance cheats  

**Explicitly still later:** bank-for-missing-runes / `TransportRouteAnalysis` (direct vs bank-then-tele). Useful someday; not Phase 2.

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
| **D** | Spell teleport catalog edges + executor cast hop (`Game.teleport`) |
| **E** | Handler extraction + PlannedEdge recovery stub |
| **F** | Route corpus + component report |

Base on latest ladder/trapdoor work (`openLocId`, LostCity ladders) so the catalog is worth filtering.
