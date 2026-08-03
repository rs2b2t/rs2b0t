# Nav v2 — full 2004-era transport coverage

**Branch:** `feat/nav-v2-2004-transports`  
**Status:** ready for upstream PR  
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
| Doors | `doors.json` | Openable barriers (+ skill gates via `specialRequires.ts`) |
| Stairs / ladders | `stairEdges.json` | Level changes |
| Curated v1 | `transports.json` | Ships, portals, shortcuts, dungeon links |
| Curated 2004 travel | `v2/travelCatalog.ts` via `loadTransportGraph.ts` | Spirit/glider/Entrana/cart/essence/levers/agi |
| Special crossings | `specialCrossings.ts` | Dialog / NPC / quest unlock execute |
| Spell + jewellery | `teleportCatalog.ts` | Originless A\* inject (v2) |
| State re-enable | `stateAwareRequires.ts` | Safe single-dest re-enable of deferred stairs |
| Quest seeds | `transportQuestReqs.ts` | Journal names + setvar complete stages |

### `travelCatalog` families (curated)

| Family | Edges | Content anchor | Plan gates |
|---|---:|---|---|
| Spirit trees | 8 | `area_gnome/spirit_tree.rs2` + constants | Grand Tree / Tree Gnome Village + members |
| Gnome glider hub↔pad | 8 | `gnome_glider.rs2` + `glider.constant` | Grand Tree complete + members |
| Entrana ferry | 2 | `monk_of_entrana.rs2` | Members; **gear refuse at execute** |
| Shilo↔Brimhaven cart | 2 | `vigroy.rs2` / `hajedy.rs2` | Coins 10–200; Brim→Shilo needs Shilo complete |
| Essence entry | 5 | Aubury/Sedridor/Distentor/Cromperty/Brimstail | Rune Mysteries complete (+ members for Yanille/Ardy/gnome) |
| Wildy levers | 2 | `wilderness_lever.rs2` | Members |
| Agility OD shortcuts | 3 | castle wall + Edgeville monkeybars | Agility 5 / 15 (Shilo log already in transports.json) |
| **Total curated** | **30** | merged at graph load | |

Plus existing `transports.json` ships/gangplanks/coal log/ropeswings/essence **exits**/Shantay free exit/mining guild ladders.

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
| Ranging Guild door | Not in `doors.json` yet (content minigame; add when mapped) |
| Cooking Guild chef’s hat | Execute-time worn check; plan-time is cooking 32 only |

---

## 3. Architecture

1. Content first — cite `.rs2` + constants.  
2. Plan-time `TransportRequires` (members, quest, skill, coins).  
3. Multi-dest hubs → **one edge per destination** + specialCrossing matched by `toTile`.  
4. Executor: specialCrossing (NPC Teleport/Talk-to/dialog, spirit loc dialog, Entrana gear gate, glider map UI).  
5. Fail closed without WorldState on requires-gated edges.  
6. `loadDefaultNavEdges()` keeps NavWorker and pack tools in sync.  
7. Classic walker also snapshots WorldState when available so skill/quest doors stay honest.

### Plane / level notes

| Hop | Levels |
|---|---|
| Glider hub Ta Quir Priw | Plane **3** (Grand Tree top) ↔ pads plane 0 |
| Entrana ferry landings | Plane **1** deck tiles from content `set_sail` |
| Essence mine | Representative pad + `acceptAnyLanding` (random mine pads) |
| Stairs / ladders | `stairEdges.json` + door open + climb |
| Spirit / cart / levers | Same plane as content constants |

### Execute nuances

| Family | Execute path |
|---|---|
| Doors / gates | `doorCrossing` — approach tile, Open, step through; quest-lock blacklist |
| Ships / gangplanks | specialCrossing NPC Pay-fare + `toTile` match (Customs reverse must not steal gangplank) |
| Glider | Talk-to **Gnome pilot** + glidermap dest click (`mapChoice`) |
| Spirit trees | Loc Talk-to + dialog line matched by hop `toTile` |
| Essence entry | NPC **Teleport** action (fallback Talk-to + dialog) |
| Entrana | Talk-to monk; refuse board if restricted weapons/armour (name heuristic) |
| Wildy levers | Pull Lever |
| Agility shortcuts | Climb-over / Swing across on loc |

### Object highlighter (path paint)

When Global **Show nav path** is on:

- Path tiles paint into **areaGame** after 3D world (`pathScenePaint.ts`).
- **Object hulls** only for live scenery the executor would click (`liveTransportLoc` + `reader.locBox`).
- **No hull** for teleports, NPC-only hops, or locs missing from the loaded scene (avoids a fake cube on the player stand tile).

---

## 4. Coverage matrix

| Item | Status |
|---|---|
| Content audit tool | **done** |
| Disabled-row report | **done** (audit buckets) |
| Karamja / Brimhaven ferries | **done** (pre-existing + gangplank fixes) |
| Entrana ferry + gear gate | **done** |
| Shilo cart | **done** |
| Spirit trees (plan + dialog) | **done** |
| Gnome glider hub↔pad + map UI | **done** |
| Essence entry | **done** |
| Essence exit portals | **done** (transports.json) |
| Wildy levers | **done** |
| Coal log + island ropes | **done** (transports.json + specialCrossing skill) |
| Castle wall / Shilo log / monkeybars | **done** (travelCatalog + transports.json) |
| Shantay free desert exit | **done** (transports.json) |
| Shantay pass item northbound | **wont** for free pathing (item gate; desert exit is the OD fix) |
| State-aware monastery ladder | **done** (Prayer 31) |
| Horror/Watchtower multi-dest ladders | **wont** / blocked |
| Fishing Guild doors | **done** (fishing 68) |
| Magic Guild doors | **done** (magic 66) |
| Crafting Guild door | **done** (crafting 40) |
| Cooking Guild door | **partial** (cooking 32 plan-time; chef’s hat execute) |
| Mining Guild ladder down | **done** (mining 60 on surface from-tiles) |
| Ranging Guild door | **not in doors.json** |
| Zanaris / Lost City | **quest path** (out of generic travel catalog) |
| Path paint + loc hulls | **done** (live scenery only) |

---

## 5. Operator commands

```bash
# catalog + quest seed unit tests
bun test test/nav/travelCatalog.test.ts test/nav/transportQuestReqs.test.ts test/nav/specialRequires.test.ts test/nav/specialCrossingMatch.test.ts

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

Aliases (`Watchtower` → `Watch Tower`, etc.) resolve in `worldStateData` / `canonicalQuestName`.

### Guild / skill door seeds (plan-time)

| Gate | Skill | Tiles (world) | Content |
|---|---|---|---|
| Fishing Guild | fishing 68 | 2611,3394 / 2611,3398 | `fishing_guild.rs2` |
| Magic Guild | magic 66 | 2584/2597 × 3087/3088 | `magic_guild.rs2` |
| Crafting Guild | crafting 40 | 2933,3289 | `crafting_guild.rs2` |
| Cooking Guild | cooking 32 | 3143,3444 | `cooking_guild.rs2` (+ hat) |
| Mining Guild ladder | mining 60 | 3019,3339 / 3019,3341 / 3020,3340 | `mining_guild.rs2` |
| Monastery ladder | prayer 31 | stateAware `monasteryladder` | prayer guild |

---

## 6. Related

| Doc / code | Role |
|---|---|
| `src/bot/nav/v2/travelCatalog.ts` | Curated edges |
| `src/bot/nav/v2/specialRequires.ts` | Door + transport skill gates |
| `src/bot/nav/v2/transportQuestReqs.ts` | Quest journal + setvar seeds |
| `src/bot/nav/loadTransportGraph.ts` | Graph merge |
| `src/bot/nav/data/specialCrossings.ts` | Execute dialogs |
| `src/bot/nav/exec/specialCrossing.ts` | Entrana gear + spirit + glider map |
| `src/bot/nav/pathOverlay.ts` | Live loc hull highlighter |
| [docs/NAV.md](../NAV.md) | Product manual (path paint, nav v2 table) |
| Server `content/scripts/` | Authoritative hops |
