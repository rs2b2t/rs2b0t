# Patterns from Shortest Path → Microbot web walker

Research notes for **nav-v2**. Sources (public GitHub, 2026):

| Source | Role |
|---|---|
| [Runemoro / Skretzo `shortest-path`](https://github.com/Runemoro/shortest-path) | RuneLite plugin: collision map + A\* + transport TSVs + **overlay only** |
| [chsami/Microbot](https://github.com/chsami/Microbot) | Fork that **executes** SP paths via `Rs2Walker` (~web walker) |
| Microbot `WEBWALKER_IMPROVEMENT_PLAN.md` | Facade, robustness, data completeness |
| Microbot `docs/walker-p2-unification.md` | Unified obstacle model (`PlannedEdge` + resolvers) |
| Microbot `docs/F2P_WEBWALKER_HARNESS.md` | Live route regression harness |

We are **not** porting OSRS teleports or a 9k-line `Rs2Walker`. We steal **shapes** that fit a
2004 TypeScript bot with wire-indistinguishable clicks.

---

## 1. The split Microbot proved works

```
┌─────────────────────────────────────┐
│  Shortest Path (plan)               │
│  · CollisionMap / FlagMap           │
│  · Transport catalog (TSV)          │
│  · PathfinderConfig (filter state)  │
│  · Pathfinder A* / bi-dir           │
│  · Overlay (optional for bots)      │
└─────────────────┬───────────────────┘
                  │ path: List<WorldPoint>
                  │ transports keyed by origin
┌─────────────────▼───────────────────┐
│  Rs2Walker (execute)                │
│  · click along path (minimap/world) │
│  · handleDoors / handleTransports   │
│  · stall recovery + repath          │
│  · obstacle resolvers (P2)          │
└─────────────────────────────────────┘
```

**Lesson:** keep **plan** and **execute** as separate products with a frozen facade
(`Rs2PathApi` in Microbot). Upstream SP can change; only the facade moves.

**rs2b0t today:** already split (`PathFinder` worker + `WalkExecutor`). v2 formalizes the
facade (`Navigator` / typed options) so we never grow another 9k-line god class.

---

## 2. Transport as data (not code)

Microbot/SP load many **TSV catalogs** into `Map<WorldPoint, Set<Transport>>`:

- `transports.tsv` — doors, stairs, ladders, caves  
- `agility_shortcuts.tsv`, `ships.tsv`, `boats.tsv`, …  
- `teleportation_*.tsv` — item/spell/portal (origin often null)  
- Columns: Origin, Destination, Skills, Item IDs, Currency, Quests, Varbits, Varplayers,
  isMembers, Duration, Display info, **menuOption;menuTarget;objectID**

`Transport` fields that matter for bots:

| Field | Purpose |
|---|---|
| origin / destination | Graph endpoints |
| type | TRANSPORT vs AGILITY vs SHIP vs TELEPORTATION_* |
| skillLevels / quests / items | Plan-time gates |
| currencyName + amount | Toll / charter |
| objectId + action + name | **Execution** identity |
| duration (ticks) | Cost; teleports force ≥1 so distance doesn't dominate |
| isMembers / maxWildernessLevel | World filters |
| varbits / varplayers | State (quest progress, unlocks) |
| isConsumable | Item charges |

Permutation transports (fairy rings): blank origin × blank destination expanded to full matrix.
**2004:** almost none of that — we still want the **same row shape** for ladders, ships, logs.

**rs2b0t mapping:**

| SP / Microbot | Nav v2 |
|---|---|
| TSV catalogs | generators → unified `TransportEdge[]` (JSON ok) |
| `menuOption;menuTarget;objectID` | `loc.action`, `loc.name`, `loc.locId` (+ `openLocId`) |
| Skills / Quests / Items | `TransportRequires` |
| Currency | `items` or explicit `currency` |
| Duration | `cost` (+ optional `durationTicks` later) |
| PathfinderConfig.refresh() | rebuild filtered edge set from `WorldState` |
| disabled forever | `requires` instead of `disabledReason` when state-gated |

---

## 3. PathfinderConfig = world state filter

At refresh, Microbot re-evaluates every transport against:

- inventory / equipment / bank items (optional bank for “can I get the tele”)  
- boosted skills  
- quest states  
- varbits/varplayers  
- config toggles (use boats, use fairy rings, ignore teleports, …)  
- currency affordability  
- members world  

Cache key fingerprints inventory so **spending coins invalidates** usable transports.

**rs2b0t:** `WorldState` + `meetsRequires` (Phase 0 landed). Next: snapshot from Skills/Quests/Inventory
and filter edges inside `PathFinder` before search — same job as `PathfinderConfig.refresh`.

### Teleport toggles + distance-before-teleport — **early, not deferred**

Microbot’s `distanceBeforeUsingTeleport` and use-teleport config flags are **more important for us
than the research first assumed**, and **easier** on 2004:

| | OSRS / Microbot | 2004 rs2b0t |
|---|---|---|
| Tele inventory | dozens of TSV families (items, spells, diaries, POH, …) | Standard spellbook: Varrock, Lumbridge, Falador, Camelot, Ardougne (+ sparse quest/NPC teles) |
| Already in client | SP catalogs | `Game.teleport` / `api/Teleport.ts` already cast by name |
| Policy value | avoid burning a glory on a 15-tile hop | same: don’t Varrock-tele when the bank is 40 tiles away; **do** tele when walking half the map |
| Implementation size | large allow/deny matrix | one `kind: 'teleport'` catalog + `PathPolicy` |

**In Phase 2 with WorldState** (see PLAN.md):

- `PathPolicy.useTeleports` (default true once edges exist; scripts can force walk-only)  
- `PathPolicy.distanceBeforeTeleport` — min remaining Chebyshev (or estimated walk cost) before a
  teleport edge is admissible (same idea as Microbot)  
- optional later: per-destination allowlist (`varrock` only, etc.) when scripts need it  

**Still deferred (agree out of initial phases):**

- direct path vs bank-for-missing-runes (`TransportRouteAnalysis`) — nice for “I don’t have law runes
  but the bank does”; multi-step planner, not required to get tele-aware walking

---

## 4. Walker execution patterns worth copying

| Pattern | Microbot | Our v1 / v2 |
|---|---|---|
| Furthest click in reach | minimap scan ~14 Chebyshev | `selectClickTarget` + `TARGET_STEPS` |
| Corridor / path index | path index advance | `locateOnPath` + corridor |
| Closed trapdoor then climb | detect Open on composition when Climb-down planned | `openLocId` + `openShutTrapdoor` |
| Cross-plane steps never doors | skip door probe if plane differs | stair vs door kinds |
| Quest-locked door | dialogue match → session blacklist → repath | specialCrossings + avoidDoors; formalize blacklist |
| Stall recovery | activity-aware threshold, sidestep, repath | `STALL_TICKS` + walkLadder |
| Teleports / ships | wait duration / land near destination | `toTile` + `TRANSPORT_WAIT_MS` |
| Missing item for hop | compare direct vs bank route | deferred (few item teles in 2004) |

**P2 unified obstacle model** (adopt the idea, not the OSRS resolvers):

```
PlannedEdge { from, to }
ObstacleResolver.handles(edge, scene) → resolve →
  WALK_TO_ORIGIN | INTERACTED | CROSSED | ABORT | NOT_APPLICABLE
```

Resolvers for **us**: Door, Transport (ladder/ship/portal/trapdoor), SpecialCrossing (toll/quest unlock).
Rockfall/MLM is OSRS-only noise.

Microbot deliberately **did not** force doors+transports fully into pure resolvers when cascades were
working — strangler extraction, not big-bang. Same rule for `WalkExecutor`.

---

## 5. Facade-first (critical)

Microbot’s pain: `Rs2Walker` poked `ShortestPathPlugin` statics everywhere; every SP upstream change
broke automation. Fix: **`Rs2PathApi`** thin 1:1 facade; greppable invariant.

**rs2b0t:** scripts only talk to `DirectNavigator` / `WalkExecutor` / `Reach`. Never import
`PathFinder` internals or raw JSON from scripts. v2 keeps that; worker stays behind `Navigator`.

---

## 6. Live harness as product

Microbot F2P harness: numbered routes (Lumbridge stairs → Draynor door → Varrock sewers ×5),
fail-fast, `result.json`, agent loop: fail → patch → re-run one route → full suite.

**rs2b0t already has pieces:** `trapdoor-mines-live`, `edgeville-dungeon-exit`, quest pathable-from.
v2 elevates a **mainland route table** (F2P 2004 corpus) + pack-level component report.

---

## 7. What we must not copy

| Microbot / SP | Why not for us |
|---|---|
| 20+ teleport TSV families | **Catalog is small** — still do spell teles + policy; skip OSRS item/diary/POH matrix |
| Bank-for-missing-tele route analysis | Valuable later; multi-leg planner out of initial phases |
| 9k-line monolithic walker | We already feel `WalkExecutor` pressure — extract early |
| Live collision overlay + learn-blocked edges | Later; baked pack + doors first |
| Bidirectional A\* / path smoother | Only if expansion budgets hurt on 2004 map |
| League / POH / fairy permutation matrix | Out of era |
| Synthetic path injection | Violates wire-indistinguishable design |

---

## 8. 2004-specific geometry notes

- Building levels use **plane/level 0–3**.  
- Many “dungeons” use **z + 6400** same plane (party trap 3449↔9849), not level change.  
  SP’s `crossPlane()` door skip is insufficient; we key on **edge kind** (`dungeon` / `stair`) and
  `toTile` / z hop magnitude.  
- LostCity scripted ladders often need **exact locId** and sometimes **openLocId** (trapdoors).  
- Mining Guild vs party-room mine: connectivity is a **data/component** problem, not A\* aesthetics.

---

## 9. Adopted design principles (nav-v2)

1. **Catalog-first transports** with execution metadata on every edge.  
2. **Filter at plan time** from a cheap `WorldState` snapshot.  
3. **Facade** between scripts and pathfinder/worker.  
4. **Executor handlers** (door / transport / special) with optional PlannedEdge recovery registry.  
5. **Route harness + explain hops** before clever algorithms.  
6. **Strangler migration** — dual-run, no greenfield rewrite of corridor/door lessons in `docs/NAV.md`.

References (deep links):

- https://github.com/chsami/Microbot/blob/main/runelite-client/src/main/java/net/runelite/client/plugins/microbot/shortestpath/WEBWALKER_IMPROVEMENT_PLAN.md  
- https://github.com/chsami/Microbot/blob/main/runelite-client/src/main/java/net/runelite/client/plugins/microbot/shortestpath/Transport.java  
- https://github.com/chsami/Microbot/blob/main/runelite-client/src/main/java/net/runelite/client/plugins/microbot/util/walker/Rs2PathApi.java  
- https://github.com/chsami/Microbot/blob/main/docs/walker-p2-unification.md  
- https://github.com/chsami/Microbot/blob/main/docs/F2P_WEBWALKER_HARNESS.md  
