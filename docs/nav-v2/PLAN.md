# Nav v2 — Shortest Path quality, web-walker execution, 2004 soul

**Branch:** `feat/nav-v2`  
**Status:** **Complete** (product scope for first ship)  
**Companion:** [MICROBOT_SHORTEST_PATH.md](./MICROBOT_SHORTEST_PATH.md) · [TELEPORTS.md](./TELEPORTS.md) · [README](./README.md)

---

## North star

> Given who I am right now, what is the cheapest **executable** walk from A to B
> on this 2004 engine — and can we say *why* each hop was chosen?

---

## Dual-run (end user)

**Global settings → World walker**

| Value | Meaning |
|---|---|
| `classic` (default) | Pre–nav-v2 request shape; no tele catalog; no live WorldState |
| `v2` | Tele edges in A\*, hop logs, state filters, spell + jewellery execution |

Override: `WalkOptions.navEngine`, `?Global.navEngine=v2`.

Shared across both: collision pack, doors, trapdoor `openLocId`, ladder transport data.

---

## Phase plan

### Phase 0 — Foundation ✅

- [x] Plan + Microbot/SP research docs  
- [x] `TransportEdge` / `WorldState` / `TransportRequires` types  
- [x] `meetsRequires`, stable `edgeId`, `compileV1Graph` adapters  
- [x] Unit tests  

### Phase 1 — Unified graph ✅

- [x] `PathHop[]` on outcomes  
- [x] Typed `FindPathCallOptions`  
- [x] v1 edges carry `kind` + specialCrossing `requires`  
- [x] Single artifact **deferred** (three JSON inputs remain; compile at load)

### Phase 2 — WorldState + path policy ✅

- [x] Live `WorldStateData` snapshot  
- [x] Plan-time `meetsRequires` / policy filters  
- [x] Spell + jewellery tele catalog in A\* (v2 only)  
- [x] Curated state-aware ladder activations (`stateAwareRequires` — monastary 31 Prayer)  
- [x] Multi-dest deferred ladders stay disabled (documented)

**Still later (not ship blockers):** bank-for-missing-runes; duel-ring run-stall.

### Phase 3 — Executor ✅

- [x] Spell tele via `Game.teleport` (incl. Watchtower / Trollheim ids)  
- [x] Jewellery Rub + dialog (`teleportExecute.ts`)  
- [x] Hop logging (v2)  
- [x] Session door blacklist  
- [x] `PlannedEdge` types  
- [x] Tele execution extracted from WalkExecutor  
- [x] Full Door/Transport class split **deferred** (strangler; not required to ship)

### Phase 4 — Connectivity tools ✅

- [x] `component-report`, `route-probe --explain`, `mainland-corpus`  
- [x] Live suite = operator-only (not upstream CI)

### Phase 5 — Cleanup ✅

- [x] Dual-run via Global `navEngine` (not a second codepath delete)  
- [x] `docs/NAV.md` Nav v2 section  
- [x] This plan marked complete  

---

## Ship checklist

1. Global toggle classic / v2 (default classic)  
2. V2: spell + jewellery teles in path + execute  
3. V2: hop explain, WorldState filters  
4. Pack/unit green  
5. Operator live smokes optional  

---

## Explicit non-goals (remain)

- Fairy rings / OSRS tele matrix  
- Bank-then-tele multi-leg planner  
- Upstream live CI suite  
- Full WalkExecutor rewrite in one PR  
