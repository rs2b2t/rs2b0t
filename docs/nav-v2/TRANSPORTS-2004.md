# Nav v2 — full 2004-era transport coverage

**Branch:** `plan/nav-v2-2004-transports`  
**Status:** plan (inventory + phased PR stack)  
**Date:** 2026-08-03  

**North star:** every *player-executable* travel hop that exists in the
revision-274 / LostCity-style content pack should be either:

1. **Routable** in A\* with honest `TransportRequires` + executor hop, or  
2. **Explicitly out of scope** with a one-line reason (broken loc, multi-dest
   dialog without a safe single dest, minigame-only, etc.).

Source of truth for “what exists” is the **deploy engine content tree**
(this machine: `~/experiments/Server/content/scripts`), not OSRS wiki memory.
When in doubt, open the `.rs2` that implements the loc/NPC action.

---

## 1. Current inventory (bot)

| Layer | Artifact | Count (approx) | Role |
|---|---|---:|---|
| Doors | `doors.json` | ~1058 | Openable barriers from `derive-doors` |
| Stairs / ladders | `stairEdges.json` | ~1020 (`kind: stair`; ~50 disabled) | Level changes from `derive-stairs` + ladder pipeline |
| Curated transports | `transports.json` | **280** total, **~61 disabled** | Ships, portals, shortcuts, extra dungeon edges |
| Special crossings | `specialCrossings.ts` | 10 sites | Toll, ships dialog, Femi gate, Ulizius, coal log |
| Spell teles | `teleportCatalog.ts` | 7 | Varrock…Trollheim |
| Jewellery | same | 6 | Duel ring, games neck, glory×4 |
| Levers | same | 2 catalogued | Ardougne ↔ Wild (not injected in A\* with spells by default) |
| State-aware re-enable | `stateAwareRequires.ts` | **1** | Monastery ladder (31 Prayer) |

### `transports.json` by kind (live rows)

| kind | n | Notes |
|---|---:|---|
| dungeon | 222 | Mostly ladders / trapdoors / cave links |
| door | 25 | Guild doors, Tree Door, webs, walls |
| stair | 9 | Extra staircases not in stairEdges |
| gate | 8 | Gnome gate, loose railings |
| ship | 4 | Port Sarim↔Musa, Ardougne↔Brimhaven |
| gangplank | 4 | Board/disembark for those two lines |
| portal | 4 | Essence-mine exits → Aubury area |
| shortcut | 4 | Coal log balance, Karamja ropeswing pair |

### Disabled reasons (transports + stairs, high level)

| Bucket | Meaning | Plan stance |
|---|---|---|
| Climb multi-choice (`Climb` without up/down) | Ambiguous option | Prefer derived Climb-up/down rows; drop generic Climb |
| Non-traversable / no dest | Content has no movement | Keep disabled forever; document |
| State-aware deferred | Quest/skill/inv guard | Curate `STATE_AWARE_ACTIVATIONS` or specialCrossing |
| Multi-dest / dialog state | Horror, Watchtower maze, … | Stay disabled until single-dest or PlannedEdge resolver |
| Pack interaction tile missing | Collision / stand issue | Fix pack or stand offset; not “add edge” |

---

## 2. Content taxonomy (Server scripts)

Grounded under `Server/content/scripts/`. Each family below is a **coverage
bucket** for this program.

### A. Automatic / bulk (already mostly green)

| Bucket | Content | Bot today | Gap |
|---|---|---|---|
| A1 Open doors / gates | `doors/`, `general_use/gates.rs2` | `doors.json` + executor | Edge cases: locked, double doors, guild doors |
| A2 Stairs & ladders | `ladders+stairs/` | `stairEdges.json` + transports | Disabled state-aware rows; broken/multi-choice noise |
| A3 Trapdoors / manholes | `general_use/trapdoors.rs2`, `manholes.rs2` | Partial dungeon edges + `openLocId` | Completeness audit vs content |
| A4 Webs / slashables | `general_use/web.rs2` | Some `door` webs in transports | Knife / slash skill gates? |

### B. NPC / dialog travel (high value, incomplete)

| Bucket | Content path | Destinations (from scripts) | Bot today |
|---|---|---|---|
| B1 Karamja ferries | `area_port_sarim/sailors.rs2`, `area_karamja/customs_officer.rs2`, `interface_boat/sail.rs2` | Port Sarim ↔ Musa Point | **Done** (ship + gangplank + specialCrossing) |
| B2 Brimhaven ferries | `area_ardougne_*` / Captain Barnaby + customs | Ardougne ↔ Brimhaven | **Done** |
| B3 Entrana monks | `area_port_sarim/monk_of_entrana.rs2`, `area_entrana/*` | Port Sarim ↔ Entrana (weapon strip) | **Missing** |
| B4 Fishing Platform | `area_fishing_platform/` | Holgart / platform boats | **Missing** (audit) |
| B5 Shilo ↔ Brimhaven cart | `area_shilo/vigroy.rs2`, `area_brimhaven/hajedy.rs2` | Coin cart ride | **Missing** |
| B6 Captain Shanks / misc Karamja | `area_karamja/captain_shanks.rs2` | Local boat hops | **Missing** (audit) |
| B7 Charter / other paid sails | grep `set_sail` / `Pay-fare` in areas | Any extra lines in content | Inventory then edge each |

### C. Multi-dest “hub” systems (catalog + executor UI)

These are originless-or-hub teleports with a dialog/map, similar to jewellery.

| Bucket | Content | Requires (script) | Bot today |
|---|---|---|---|
| C1 Spirit trees | `area_gnome/spirit_tree.rs2` | Members; Grand Tree complete (stronghold); Tree Gnome Village complete (village/young tree) | **Missing** |
| C2 Gnome glider | `area_gnome/gnome_glider.rs2` + glider map UI | Members; Grand Tree progress for some pads; hub-only routing (must go via Ta Quir Priw unless crash) | **Missing** |
| C3 Spellbook teles | `skill_magic/.../teleport.rs2` | Magic + runes + quest for Ardy/Watchtower/Trollheim | **Done** (v2 catalog) |
| C4 Jewellery | `general/scripts/enchanted_jewellry/*` | Inventory charge stages | **Done** (v2) |
| C5 Wildy levers | wild / Ardougne lever scripts | Members / wildy rules | Catalogued; **wire execute + A\* inject** if not already |

Spirit tree dest constants (content): `^stronghold_tree`, `^village_tree`,
`^varrock_tree`, `^khazard_tree`.

Glider pads (content constants): `^ta_quir_priw` (Grand Tree hub), `^gandius`,
`^sindarpos`, `^lemanto_andra`, `^kar_hewo` (+ crash recovery path).

### D. Skill shortcuts (Agility)

| Bucket | Content | Bot today |
|---|---|---|
| D1 Coal trucks log | `skill_agility/shortcuts.rs2` `mine_log_balance1` | **Done** (transport + specialCrossing skill 20) |
| D2 Barb crumbling wall / watch wall | `castlecrumbly`, `watchshortcut` | Partial / audit |
| D3 Monkey bars, ropeswings, stepping stones | `_monkeybars`, `_island_rope_swing`, `_karamja_stepping_stone`, `zq_logbalance` | Sparse (one ropeswing pair in transports) |
| D4 Course obstacles | gnome/barb/wild courses | **Out of scope** as *routing* (training loops, not OD travel) unless a course segment is the only path |

### E. Area / quest gates (specialCrossing or requires)

| Bucket | Content examples | Bot today |
|---|---|---|
| E1 Al Kharid toll | `area_alkharid/border_gate.rs2` | **Done** |
| E2 Shantay Pass | `area_alkharid/shantay*.rs2` | **Missing** (pass / desert gate) |
| E3 Gnome Stronghold Femi | `gnome_gate.rs2` + Grand Tree | **Done** (dialog reopen) |
| E4 Mort Myre Ulizius | Nature Spirit unlock | **Done** |
| E5 Mining Guild / Crafting Guild / … | guild door scripts | Partial door edges; skill requires incomplete |
| E6 Zanaris / Lost City | `area_lostcity`, quest_zanaris | Special (leprechaun / shed) — plan as quest transport |
| E7 Holy barrier / mausoleum | `area_mausoleum` | Quest-gated — audit for Priest in Peril / Nature Spirit |
| E8 Magic guild / RC portals | Yanille, Aubury, Sedridor, Cromperty | Essence portal exits exist; **entry** teleports (NPC “Teleport”) missing as edges |

### F. Explicit non-goals (2004 content still)

| Item | Why out |
|---|---|
| Fairy rings | Not in this content era / not present as modern matrix |
| Canoes, balloon, magic carpets | Not in this content pack (or post-era) |
| Full Agility *courses* as routes | Training; use shortcuts only when they connect OD components |
| Random event teleports | Supervisor / macro events, not planner |
| Death pile / respawn pathing | Separate system |
| Multi-dest ladders without safe dest | Wrong floor worse than long walk (Horror, Watchtower maze) |

---

## 3. Architecture rules (how we add a hop)

1. **Content first** — cite the `.rs2` path + trigger (`oploc1`, `opnpc1`, `opheld4`).
2. **Plan-time gate** — encode skill / quest / members / items / coins in
   `TransportRequires` (or specialCrossing for dialog/NPC).
3. **Single destination** — multi-choice UI becomes a **catalog of edges**
   (one edge per dest), not one edge that guesses.
4. **Executor** — prefer existing `handleTransport` / specialCrossing /
   `teleportExecute` patterns; new families get a small `exec/*` or catalog
   executor (glider map, spirit dialog).
5. **Fail closed** — no WorldState snapshot → no requires-gated edge (already
   true for teles).
6. **Disable honestly** — if content has no static dest, keep `disabledReason`
   and list it in the coverage matrix (do not invent tiles).

### Suggested kinds / families

Extend beyond current `TransportKind` only when needed:

| Family | Representation |
|---|---|
| loc climb / open | existing door/stair/dungeon |
| npc fare | `ship` + specialCrossing (today) |
| hub tele (spirit / glider) | `teleport` catalog with `family: 'spirit_tree' \| 'glider'` **or** multi-edge from hub loc |
| jewellery / spell | existing |
| agility shortcut | `shortcut` + requires.skills |

---

## 4. Coverage matrix (working checklist)

Maintain as a living table in this doc (or generate later). Status key:
`done` · `partial` · `todo` · `wont` · `blocked`.

### Priority 0 — tooling

| Item | Status | Notes |
|---|---|---|
| Content→edge audit script | **partial** | `tools/nav/content-transport-audit.ts` scans CONTENT_DIR families |
| Disabled-row report | todo | Group by reason; % state-deferred with/without activation |
| Connectivity seeds | partial | `component-report`, `coverage.ts` — expand seed set per region |

### Priority 1 — mainland OD connectors (biggest path gaps)

| Item | Status | Content anchor |
|---|---|---|
| Entrana ferry (monk, weapon rules) | **partial** | edges + specialCrossing in `travelCatalog` / `specialCrossings` (execute weapon strip still soft) |
| Shilo↔Brimhaven cart | **partial** | edges + specialCrossing (fare min 10 coins; Brim→Shilo needs quest) |
| Spirit trees (4 dests) | **partial** | catalog edges in graph load; dialog execute still generic Talk-to |
| Gnome glider (5 pads, hub rule) | **partial** | hub↔pad only; map UI execute not wired |
| Agility shortcuts that split components | todo | `shortcuts.rs2` vs component-report |
| Shantay Pass | todo | `shantay_pass.rs2` |
| Essence **entry** (Aubury / Sedridor / guild) | todo | area scripts + `essence_mine.rs2` |
| Wildy Ardougne lever execute | todo | lever catalog + executor |

**Local progress (feat/nav-v2-2004-transports):** `travelCatalog.ts`, `lcCoord.ts`,
`tools/nav/content-transport-audit.ts`, NavWorker merges curated edges.

### Priority 2 — state-aware ladder activation

| Item | Status | Notes |
|---|---|---|
| Monastery 31 Prayer | done | `stateAwareRequires.ts` |
| Observatory / Horror / Watchtower multi-dest | wont/blocked | Until PlannedEdge or single dest proven |
| Entrana dungeon / other quest ladders | todo | Activate only with Server evidence |

### Priority 3 — long tail

| Item | Status |
|---|---|
| Fishing Platform boats | todo |
| Captain Shanks / misc island hops | todo |
| Guild skill doors (Mining 60, Crafting, …) | todo |
| Zanaris entry | todo (quest-shaped) |
| Remaining disabled “Climb” noise cleanup | todo |

---

## 5. Phased PR stack

Keep PRs small, shippable, and independently testable. Each phase ends with:

- unit tests for resolve / requires / path avoid  
- pack probe OD where possible (`findPath` with WorldState)  
- optional HEADED only for dialog-heavy hops  

### PR1 — Audit harness (no gameplay change)

- Tool: `tools/nav/content-transport-audit.ts` (or md generated checklist)  
  - Inputs: `CONTENT_DIR` (default deploy content), existing JSON  
  - Output: missing families + disabled buckets  
- Expand `docs/nav-v2/TRANSPORTS-2004.md` matrix from tool output  
- Tests: golden snapshot of “known families present in content”

### PR2 — Entrana + Shilo cart + Shantay

- Edges + specialCrossing / requires (coins, quests, weapon rule for Entrana)  
- Executor dialog paths  
- Pack probes: Port Sarim ↔ Entrana (members, no weapons); Shilo ↔ Brimhaven cost  

### PR3 — Spirit trees

- Catalog family + dialog choose strings from `spirit_tree.rs2`  
- Quest gates: Grand Tree / Tree Gnome Village  
- A\* multi-edge from each tree loc (or originless-from-player when in range — prefer **loc-backed** edges at tree tiles)  
- Execute: touch tree → dialog → telejump  

### PR4 — Gnome glider

- Catalog pads + hub constraint (must route via Ta Quir Priw when required by content)  
- Execute: open glider interface / NPC → select dest (mirror `if_button,glidermap:*`)  
- Crash path: only if we can detect failure (optional v1 skip)

### PR5 — Agility shortcut sweep

- Diff `shortcuts.rs2` locs vs transports  
- Add missing OD-relevant shortcuts with skill requires  
- Do **not** encode full courses  

### PR6 — State-aware activation batch

- Grow `STATE_AWARE_ACTIVATIONS` from Server evidence only  
- Report remaining disabled %  

### PR7 — Essence / guild / long tail

- NPC teleport edges into essence mine; verify exit portals already work  
- Guild doors skill requires  
- Fishing platform, etc.  

### PR8 — Docs + default policy

- NAV.md / API.md transport catalog summary  
- Optional: Global “use spirit trees / gliders” policy toggles (default on in v2 when members)  
- Connectivity CI optional (pack-only, not live)

---

## 6. Acceptance definition of “covered”

A family is **covered** when:

1. Every *single-destination* hop in content has a graph edge (or documented wont).  
2. Multi-dest hubs expose **one edge per destination** with correct requires.  
3. Plan-time filters match content (wrong skill/quest ⇒ edge absent).  
4. Executor completes the hop without forged packets (player-shaped).  
5. Pack probe or unit test proves OD connectivity change for at least one seed pair.  
6. Disabled leftovers are only permanent-broken or multi-dest-unsafe.

“All 2004-era transports” **does not** mean every ladder in Castle Wars or every
broken decorative loc — it means every **intentional travel system** in content.

---

## 7. Working commands

```bash
# bot unit
bun test test/nav/

# pack connectivity
bun tools/nav/component-report.ts --seed 3221,3218,0
bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --limit=20

# content (deploy tree)
export CONTENT_DIR=~/experiments/Server/content
rg -n 'set_sail|spirit_tree|gnomeglider|Pay-fare' "$CONTENT_DIR/scripts" --glob '*.rs2'
```

Engine for packs / deploy: `ENGINE_DIR=~/experiments/Server/engine` (see `~/redeploy.sh`).

---

## 8. Open questions (resolve during PR1 audit)

1. Spirit tree: loc-backed edges only, or also treat as originless when standing next to tree?  
2. Glider: implement interface click path vs NPC-only conversation path?  
3. Entrana: enforce weapon/armor ban in planner (requires inventory model) or only at execute?  
4. Should classic walker receive new edges, or v2-only for hub systems? (Recommend **shared graph data**, v2-only for catalog hub execute if classic lacks dialog stack.)  
5. Lever wildy: inject in A\* with `distanceBeforeTeleport`-like wildy policy?

---

## 9. Related docs

| Doc | Role |
|---|---|
| [README.md](./README.md) | Nav v2 ship summary |
| [docs/NAV.md](../NAV.md) | Product manual |
| `docs/local/nav-v2/PLAN.md` | Prior v2 ship checklist (local) |
| `docs/local/nav-v2/TELEPORTS.full.md` | Spell/jewellery scan notes (local) |
| Server `content/scripts/` | **Authoritative hop list** |
