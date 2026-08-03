# Nav v2 — full 2004-era transport coverage

**Branch:** `feat/nav-v2-2004-transports`  
**Status:** implemented on branch (local iteration)  
**Date:** 2026-08-03  

**North star:** every *player-executable* travel hop that exists in the
revision-274 / LostCity-style content pack should be either:

1. **Routable** in A\* with honest `TransportRequires` + executor hop, or  
2. **Explicitly out of scope** with a one-line reason (broken loc, multi-dest
   dialog without a safe single dest, minigame-only, etc.).

Source of truth for “what exists” is the **deploy engine content tree**
(`CONTENT_DIR`, e.g. `~/experiments/Server/content/scripts`).

---

## 1. Inventory (bot + content)

### Graph layers

| Layer | Artifact | Role |
|---|---|---|
| Doors | `doors.json` | Openable barriers |
| Stairs / ladders | `stairEdges.json` | Level changes |
| Curated v1 | `transports.json` | Ships, portals, shortcuts, dungeon links |
| Curated 2004 travel | `v2/travelCatalog.ts` via `loadTransportGraph.ts` | Spirit/glider/Entrana/cart/essence/levers/agi |
| Special crossings | `specialCrossings.ts` | Dialog / NPC / quest unlock execute |
| Spell + jewellery | `teleportCatalog.ts` | Originless A\* inject (v2) |

### `travelCatalog` families (curated)

| Family | Edges | Content anchor |
|---|---:|---|
| Spirit trees | 8 | `area_gnome/spirit_tree.rs2` + constants |
| Gnome glider hub↔pad | 8 | `gnome_glider.rs2` + `glider.constant` |
| Entrana ferry | 2 | `monk_of_entrana.rs2` |
| Shilo↔Brimhaven cart | 2 | `vigroy.rs2` / `hajedy.rs2` |
| Essence entry | 5 | Aubury/Sedridor/Distentor/Cromperty/Brimstail |
| Wildy levers | 2 | `wilderness_lever.rs2` |
| Agility OD shortcuts | 3 | castle wall + Edgeville monkeybars (Shilo log already in transports.json) |
| **Total curated** | **30** | merged at graph load |

Plus existing `transports.json` ships/gangplanks/coal log/ropeswings/essence **exits**/Shantay free exit.

### Disabled-row policy

| Bucket | Stance |
|---|---|
| Multi-choice Climb (no up/down) | Leave disabled — use Climb-up/down rows |
| Non-traversable / no dest | Permanent wont |
| State-deferred (quest/skill) | Activate only via `stateAwareRequires` with Server evidence |
| Multi-dest ladders (Horror, Watchtower maze) | Stay disabled until single dest proven |
| Pack stand gap | Fix pack or stand; do not invent tiles |

Audit: `CONTENT_DIR=… bun tools/nav/content-transport-audit.ts` prints disabled buckets.

---

## 2. Explicit non-goals

| Item | Why |
|---|---|
| Fairy rings / canoes / carpets / balloons | Not in this content pack |
| Full agility *courses* | Training loops — only OD shortcuts |
| Random-event teles | Supervisor, not planner |
| Decorative broken ladders | No movement dest in content |

---

## 3. Architecture

1. Content first — cite `.rs2` + constants.  
2. Plan-time `TransportRequires` (members, quest, skill, coins).  
3. Multi-dest hubs → **one edge per destination** + specialCrossing matched by `toTile`.  
4. Executor: specialCrossing (NPC Teleport/Talk-to/dialog, spirit loc dialog, Entrana gear gate).  
5. Fail closed without WorldState on requires-gated edges.  
6. `loadDefaultNavEdges()` keeps NavWorker and pack tools in sync.

---

## 4. Coverage matrix

| Item | Status |
|---|---|
| Content audit tool | **done** |
| Disabled-row report | **done** (audit buckets) |
| Karamja / Brimhaven ferries | **done** (pre-existing) |
| Entrana ferry + gear gate | **done** |
| Shilo cart | **done** |
| Spirit trees (plan + dialog) | **done** |
| Gnome glider hub↔pad | **done** (map UI still uses loc interact) |
| Essence entry | **done** |
| Essence exit portals | **done** (transports.json) |
| Wildy levers | **done** |
| Coal log + island ropes | **done** (transports.json) |
| Castle wall / Shilo log / monkeybars | **done** (travelCatalog) |
| Shantay free desert exit | **done** (transports.json) |
| Shantay pass item northbound | **wont** for free pathing (item gate; desert exit is the OD fix) |
| State-aware monastery ladder | **done** |
| Horror/Watchtower multi-dest ladders | **wont** / blocked |
| Guild skill doors (Mining 60, …) | **partial** (doors exist; skill requires incomplete) |
| Zanaris / Lost City | **quest path** (out of generic travel catalog) |

---

## 5. Operator commands

```bash
# catalog unit tests
bun test test/nav/travelCatalog.test.ts test/nav/transportQuestReqs.test.ts

# pack walkability of curated endpoints
bun tools/nav/curated-travel-probe.ts

# ~12 transport-heavy OD pairs (pack + JSON for live)
bun tools/nav/transport-heavy-routes.ts --write --n=12 --explain
# Live: setvar quest seeds + relog + Quests.status check are automatic when:
HEADED=1 TRANSPORT_HEAVY=1 LIMIT=12 ENERGY_REFILL_AT=25 bun tools/nav-script-routes-live.ts

# content family scan + disabled buckets
CONTENT_DIR=~/experiments/Server/content bun tools/nav/content-transport-audit.ts
```

### Quest seeds (prod / live)

| Journal name | setvar | complete | Used by |
|---|---|---:|---|
| Rune Mysteries Quest | `runemysteries` | 6 | Essence entry |
| The Grand Tree | `grandtree` | 160 | Spirit (stronghold), glider |
| Tree Gnome Village | `treequest` | 9 | Spirit (village/young) |
| Shilo Village | `zombiequeen` | 15 | Hajedy cart → Shilo |
| Plague City | `elenaquest` | 30 | Ardougne spell (complete_read_scroll; 29 alone is not enough) |
| Watch Tower | `itwatchtower` | 14 | Watchtower spell (complete_read_scroll) |
| Eadgar's Ruse | `eadgar_quest` | 110 | Trollheim spell |

Source: `src/bot/nav/v2/transportQuestReqs.ts`. After `setvar`, **relog** so the quest-list colour updates (`Quests.status` is colour-based).

---

## 6. Related

| Doc / code | Role |
|---|---|
| `src/bot/nav/v2/travelCatalog.ts` | Curated edges |
| `src/bot/nav/loadTransportGraph.ts` | Graph merge |
| `src/bot/nav/data/specialCrossings.ts` | Execute dialogs |
| `src/bot/nav/exec/specialCrossing.ts` | Entrana gear + spirit loc dialog |
| [docs/NAV.md](../NAV.md) | Product manual |
| Server `content/scripts/` | Authoritative hops |
