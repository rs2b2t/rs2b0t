[Manual](../README.md) › [Nav](../nav/README.md) › Transport reference

# 2004-era transport coverage

## Graph layers

| Layer | Artifact | Role |
|---|---|---|
| Doors | `doors.json` | Openable barriers, plus skill gates via `specialRequires.ts` |
| Stairs / ladders | `stairEdges.json` | Level changes |
| Curated transports | `transports.json` | Ships, portals, shortcuts, dungeon links |
| Curated 2004 travel | `v2/travelCatalog.ts` via `loadTransportGraph.ts` | Spirit trees, gliders, Entrana, cart, essence, levers, agility |
| Special crossings | `specialCrossings.ts` | Dialog / NPC / quest-unlock execute |
| Spell + jewellery | `teleportCatalog.ts` | Originless A\* inject |
| State re-enable | `stateAwareRequires.ts` | Safe single-dest re-enable of deferred stairs |
| Quest seeds | `transportQuestReqs.ts` | Journal names and setvar complete stages |

## travelCatalog families

| Family | Edges | Content anchor | Plan gates |
|---|---:|---|---|
| Spirit trees | 8 | `area_gnome/spirit_tree.rs2` | Grand Tree / Tree Gnome Village, members |
| Gnome glider hub↔pad | 8 | `gnome_glider.rs2` | Grand Tree complete, members |
| Entrana ferry | 2 | `monk_of_entrana.rs2` | Members; gear refused at execute |
| Shilo↔Brimhaven cart | 2 | `vigroy.rs2` / `hajedy.rs2` | Coins 10–200; Brim→Shilo needs Shilo complete |
| Essence entry | 5 | Aubury, Sedridor, … | Rune Mysteries; `essenceEntrySetsReturn` |
| Essence exit | 4×5 multiloc | Session return, `EssenceSession` | Same-origin only |
| Wildy levers | 2 | `wilderness_lever.rs2` | Members |
| Agility OD shortcuts | 3 | Castle wall, Edgeville monkeybars | Agility 5 / 15 |
| **Total curated** | **30** | merged at graph load | |

`transports.json` adds ships, gangplanks, the coal log, ropeswings, essence exits, the
Shantay free exit and mining guild ladders.

Three of its entries were curated for Eadgar's Ruse and are load-bearing for anything
walking that ground:

| Crossing | Loc | Why it is curated |
|---|---|---|
| Troll storeroom staircase | 3788 / 3789 at 2852,10061 | The stair deriver reads `case <coord> : p_telejump(...)` and these stairs are written `switch_int(loc_angle)`, so the storeroom half of the stronghold's bottom floor had no way in |
| Mad Eadgar's cave | 3759 / 3760 | Gated on Troll Stronghold complete — an unfreed Eadgar leaves the entrance landing on an empty level 0 |
| Ardougne farm stile | 993 at 2638,3350 | The wheat field is a sealed 228-tile pocket without it |

## Plane notes

| Hop | Levels |
|---|---|
| Glider hub Ta Quir Priw | plane 3 (Grand Tree top) ↔ pads plane 0 |
| Entrana ferry landings | plane 1 deck tiles, from content `set_sail` |
| Essence mine | representative pad plus `acceptAnyLanding` (random pads) |
| Spirit, cart, levers | same plane as the content constants |

## Execute paths

| Family | Execute |
|---|---|
| Doors / gates | `doorCrossing` — approach tile, Open, step through; quest-lock blacklist |
| Ships / gangplanks | specialCrossing NPC Pay-fare plus `toTile` match; the Customs reverse must not steal the gangplank |
| Glider | Talk-to Gnome pilot, then a glidermap destination click (`mapChoice`) |
| Spirit trees | Loc Talk-to, dialog line matched by the hop's `toTile` |
| Essence entry | NPC Teleport action; falls back to Talk-to plus dialog |
| Entrana | Talk-to monk; board refused on restricted weapons or armour |
| Wildy levers | Pull Lever; Ardougne→wild confirms a warning dialog the first time |
| Agility shortcuts | Climb-over or Swing across on the loc |

Ship fares (30 coins) attach via `specialRequiresAt` even when the crossing is keyed at
deck L1 and the graph stand is pier L0, because they share x/z.

Mort Myre `freeSlots: 6` is execute-only, not a permanent plan gate.

Entrana restricted gear is gated at both plan and execute time.

## Path paint

With Global **Show nav path** on, path tiles paint into `areaGame` after the 3D world
(`pathScenePaint.ts`). Object hulls appear only for live scenery the executor would
click (`liveTransportLoc` plus `reader.locBox`) — never for teleports, NPC-only hops, or
locs missing from the loaded scene, which would draw a fake cube on the player's stand
tile.

## Quest seeds

| Journal name | setvar | complete | Used by |
|---|---|---:|---|
| Rune Mysteries Quest | `runemysteries` | 6 | Essence entry |
| The Grand Tree | `grandtree` | 160 | Spirit (stronghold), glider |
| Tree Gnome Village | `treequest` | 9 | Spirit (village/young) |
| Shilo Village | `zombiequeen` | 15 | Hajedy cart → Shilo |
| Plague City | `elenaquest` | 30 | Ardougne spell; 29 alone is not enough |
| Watch Tower | `itwatchtower` | 14 | Watchtower spell |
| Eadgar's Ruse | `eadgar_quest` | 110 | Trollheim spell |

Aliases such as `Watchtower` → `Watch Tower` resolve in `worldStateData` /
`canonicalQuestName`.

## Skill gates

| Gate | Skill | Tiles | Content |
|---|---|---|---|
| Fishing Guild | fishing 68 | 2611,3394 / 2611,3398 | `fishing_guild.rs2` |
| Magic Guild | magic 66 | 2584/2597 × 3087/3088 | `magic_guild.rs2` |
| Crafting Guild | crafting 40 | 2933,3289 | `crafting_guild.rs2` |
| Cooking Guild | cooking 32 + worn Chef's hat | 3143,3444 | `cooking_guild.rs2` |
| Mining Guild ladder | mining 60 | 3018,3340 / 3019,3339 / 3019,3341 / 3020,3340 | `mining_guild.rs2` |
| Ranging Guild door | ranged 40 | 2658,3438 | `ranging_guild_door.rs2` |
| Monastery ladder | prayer 31 | stateAware `monasteryladder` | prayer guild |
| Outer island ropeswing | agility 10 | 2709,3209 / 2511,3091 | `shortcuts.rs2`; not the softlock swing |

## Not covered

| Item | Status |
|---|---|
| Shantay pass northbound | Won't for free pathing — item gate; the desert exit is the OD fix |
| Horror / Watchtower multi-dest ladders | Blocked until a single destination is proven |
| Zanaris / Lost City | Quest path, outside the generic travel catalog |

## Code

| File | Role |
|---|---|
| `src/bot/event/webwalk/travelCatalog.ts` | Curated edges |
| `src/bot/event/webwalk/specialRequires.ts` | Door and transport skill gates |
| `src/bot/event/webwalk/transportQuestReqs.ts` | Quest journal and setvar seeds |
| `src/bot/event/webwalk/loadTransportGraph.ts` | Graph merge |
| `src/bot/event/webwalk/data/specialCrossings.ts` | Execute dialogs |
| `src/bot/event/webwalk/exec/specialCrossing.ts` | Entrana gear, spirit, glider map |
| `src/bot/event/webwalk/pathOverlay.ts` | Live loc hull highlighter |

## See also

- [What counts as a transport](../decisions/transport-scope.md)
- [Verify transport coverage](../how-to/verify-transports.md)
