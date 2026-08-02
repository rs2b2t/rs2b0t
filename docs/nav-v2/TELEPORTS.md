# Teleport catalog (LostCity Server scan)

**Source:** LostCity-style content scripts + `magic_spells.dbrow` (spell teles, jewellery rubs, levers) as implemented on the 2004scape/Server content tree you build against.  
**Scan date:** 2026-08-02  
**Purpose:** same role as trapdoor `openLocId` enrichment — ground nav-v2 tele edges in **what this engine actually implements**, not modern OSRS wiki memory.

Coord convention in scripts: `plane_mx_mz_lx_lz` → world  
`x = mx * 64 + lx`, `z = mz * 64 + lz`.

Shared gates (`teleport.rs2`):

- `~pre_tele_checks` — tutorial island, trawler, mime/maze randoms, duel arena (“Coward!”), Ana barrel, …
- Spell / jewellery wildy caps below  
- Anim: `human_castteleport` + `~player_teleport_normal` (≈3 ticks + jump)

---

## 1. Standard spellbook (originless)

| teleportId | Magic | Members | Runes | Landing (approx) | Script / DB |
|---|---:|---|---|---|---|
| `varrock` | 25 | no | 1 fire, 3 air, 1 law | 3213,3424,0 | `magic_spell_teleport_varrock` |
| `lumbridge` | 31 | no | 1 earth, 3 air, 1 law | 3221,3218,0 | `magic_spell_teleport_lumbridge` |
| `falador` | 37 | no | 1 water, 3 air, 1 law | 2965,3378,0 | `magic_spell_teleport_falador` |
| `camelot` | 45 | **yes** | 5 air, 1 law | 2757,3478,0 | `magic_spell_teleport_camelot` |
| `ardougne` | 51 | **yes** | 2 water, 2 law | 2661,3301,0 | Plague City complete + scroll read |
| `watchtower` | 58 | **yes** | 2 earth, 2 law | 2933,4713,**2** | Watchtower complete + scroll read |
| `trollheim` | 61 | **yes** | 2 fire, 2 law | 2890,3679,0 | Eadgar’s Ruse complete |

- Wildy: blocked if `wilderness_level > 20`  
- Execution already exists in bot: `Game.teleport(name)` / `api/Teleport.ts` (Varrock…Ardougne; **not** Watchtower/Trollheim yet)  
- Source: `content/scripts/skill_magic/scripts/spells/teleport.rs2` + `configs/magic_spells.dbrow`

---

## 2. Enchanted jewellery (inventory Rub = `opheld4`)

Charge chain via `param=next_obj_stage` / `charges`. Enchant recipes in `magic_spells.dbrow` `convertobj`.

### Ring of dueling (`category_136`)

| | |
|---|---|
| Items | `ring_of_dueling_8` … `_1` (names `Ring of dueling(N)`) |
| Enchant | Emerald ring → `(8)` at Lvl-2 Enchant (27 Magic) |
| Op | `opheld4` on category — **inventory only** (no `opworn` rub in scripts) |
| Destinations **on this Server** | **Al Kharid Duel Arena only** → ~3315,3235,0 (`map_findsquare` r=2) |
| Dialogue | “Al Kharid Duel Arena.” / “Nowhere.” |
| Wildy | blocked if level **> 20** |
| Charges | decrements stage; dust at 0 |

**Era note:** modern OSRS duel rings multi-dest (Castle Wars, Ferox, …). **This content only implements Duel Arena.** Catalog must match Server, not wiki wish-list.

### Games necklace (`necklace_of_minigames`)

| | |
|---|---|
| Items | `necklace_of_minigames_8` … `_1` (`Games necklace(N)`) |
| Enchant | Sapphire necklace → `(8)` at Lvl-1 Enchant (7 Magic) |
| Op | `opheld4,_necklace_of_minigames` — inventory |
| Destinations **on this Server** | **Burthorpe Games Room only** → ~2207,4940,0 |
| Dialogue | “Burthorpe Games Rooms.” / “Nowhere.” |
| Wildy | **> 20** blocked |
| Members | games room is members geography |

**Era note:** modern games necklace has Corp / Barb assault / Wintertodt / etc. **Server: Burthorpe only.**

### Amulet of glory

| | |
|---|---|
| Items | `amulet_of_glory_4`…`_1` charged; `amulet_of_glory` uncharged (rub fails) |
| Enchant | Strung dragonstone amulet → uncharged glory (Lvl-5 Enchant 68 Magic); **recharge** at Heroes’ Guild fountain (`fountain_of_heroes.rs2` → `_4`) |
| Op | `opheld4` per charge stage — inventory |
| Destinations | Edgeville 3087,3496 · Karamja 2918,3176 · Draynor 3105,3251 · Al Kharid 3293,3163 |
| Wildy | blocked if level **> 30** (higher than spells/jewellery above) |
| Charges | 4 max; last charge → uncharged glory |

### Ring of life (not a planner hop)

- Passive: when worn + HP ≤ 10% base + members + wildy ≤ 30 → destroy ring, tele Lumbridge  
- **Do not** put on the graph as a chosen edge  

### Non-tele jewellery (present, irrelevant to graph)

- Ring of recoil / forging / wealth — no teleport scripts  

---

## 3. World levers / fixed teleports (loc-backed, not inventory)

| Id | From concept | Landing | Notes |
|---|---|---|---|
| `lever_ardougne_to_wild` | Ardougne lever | 3154,3924,0 (deep wild) | Warning dialog; `wildinlever` |
| `lever_wild_to_ardougne` | Wilderness lever | 2562,3311,0 | `wildoutlever` |
| KBD levers | inside/out KBD lair | 2717,9802 / 3067,10254 | cave graph, not general webwalk |

Treat as **loc transports** (like trapdoors), not `kind: 'teleport'` originless — player must walk to the lever.

---

## 4. Already on nav as non-spell edges

| Kind | Examples |
|---|---|
| ships / gangplanks | Port Sarim ↔ Karamja, Ardougne ↔ Brimhaven |
| portals | Essence mine exit, lost city, … |
| dungeon z±6400 | ladders, trapdoors |

Do not reclassify those as teleports.

---

## 5. How teleports enter path calculation (not a post-path hack)

Spell/jewellery teleports are **originless**: you cast/rub from *wherever you stand*.
They are not a baked ladder at a fixed tile. In A* they still behave like any other
edge — same expansion loop, same costs, same hop list on the outcome.

**What the code does at search time** (sometimes called “inject” in commits — poor word):

1. Snapshot `WorldState` (skills, runes, members, quests).  
2. Filter the teleport **catalog** with `PathPolicy` + `meetsRequires`.  
3. For each allowed destination, add a temporary graph edge  
   `startTile → landing` with `kind: 'teleport'`, cost ~40, `teleportId`.  
4. A* runs on **walk + doors + stairs + dungeons + those tele edges**.  
5. If the cheapest route uses a tele hop, the waypoint carries `teleportId` and
   the executor casts/rubs it.

There is no second phase that “injects a tele after walking.” If tele is not in the
graph for that search, you get a pure walk (cost ~226 Lumbridge→Varrock). If it is,
cost drops to ~40 and hops show `Cast Varrock teleport`.

| Family | `kind` | `teleportId` examples | `requires` | `PathPolicy` |
|---|---|---|---|---|
| Spell | `teleport` | `varrock`…`trollheim` | magic + runes + members + quest | `useTeleports`, `distanceBeforeTeleport`, `allowTeleportIds` |
| Duel ring | `teleport` | `dueling_arena` | any `Ring of dueling(*)` charge | same; consumable charge |
| Games neck | `teleport` | `games_burthorpe` | any `Games necklace(*)` | members implied by landing |
| Glory | `teleport` | `glory_edgeville` etc. | `Amulet of glory(1–4)` | wildy 30 rule at execute |
| Levers | `dungeon` / `other` loc | n/a | walk to loc | not tele policy |

**Inventory matching:** accept any charge stage (`ring_of_dueling_1`…`_8` or name regex `Ring of dueling(`).

**Execution:**

1. Spell → `Game.teleport`  
2. Jewellery → open inv, Rub, pick dialogue (still open)  
3. Wait near landing (`toTile` + radius ~2)

---

## 6. Fidelity warnings

1. Server destinations are incomplete vs modern OSRS for duel ring / games neck — catalog Server truth.  
2. Glory Rub is **inventory-only**; worn glory does not expose Rub.  
3. Uncharged glory cannot tele.  
4. Landings use `map_findsquare` radius 2 — planner uses `acceptAnyLanding` / slack.  
5. Jewellery is **not** path-scoped bank-withdraw (bank cache API is separate work).

## 7. Code

[`src/bot/nav/v2/teleportCatalog.ts`](../../src/bot/nav/v2/teleportCatalog.ts) · execute: `teleportExecute.ts`.
