# Waterfall Quest — content facts (2004scape sources)

Research agent output, 2026-07-16 (+ controller-derived TGV entrance). Sources:
`~/code/content/scripts/quests/quest_waterfall/`, area scripts, maps, packs.
abs x = mx*64+lx, z = mz*64+lz. Guides advisory only.

## Varps

- `%waterfall_quest` = varp 65 (main stage).
- `%waterfall_golrie_and_puzzle` = varp 66 — bit 0 = pebble taken; bits 1-18 = pillar
  progress (waterfall_pillars.rs2:6,20; golrie.rs2:16). NOT client-visible.

Stages (quest_waterfall.constant:1-13; ^waterfall_complete=10):
0 not_started · 1 started · 2 spoken_to_hudon · 3 opened_book_on_baxtorian ·
4 entered_glarial_tomb · 5 entered_waterfall · 6 entered_puzzle_room ·
8 placed_amulet · 10 complete. (Gaps 6→8, 8→10 are real.)

## Flow

| Stage | Trigger |
|---|---|
| 0→1 | Almera, pick "How can I help?" (almera.rs2:14) |
| 1→2 | Talk Hudon OR forced on raft landing (hudon.rs2:21; quest_waterfall.rs2:178) |
| 2→3 | Read "Book on baxtorian" (baxtorian_book.rs2:6-8) |
| 3→4 | Use Glarial's pebble on tombstone (quest_waterfall.rs2:120) |
| 4→5 | Open waterfall ledge door with Glarial's amulet (quest_waterfall.rs2:269-271) |
| 5→6 | Unlock baxtorian_door_2 leaf at 0_40_154_6_46 (quest_waterfall.rs2:398-399) |
| 6→8 | All 18 rune bits + use amulet on Statue of Glarial (amulet consumed; :415-426) |
| 8→10 | Use full urn on chalice (:462-488) |

## NPCs (map-derived)

- Almera id 304 (0,2522,3498) indoors (m39_54.jm2:6597) — start: choice2 pick opt 2
  "How can I help?" → stage 1.
- Hudon id 305 (0,2511,3484) — linear, no choices; raft landing force-fires it.
- Golrie id 306 (0,2515,9581) TGV dungeon, wanderrange 3 — talk → auto-search →
  "Could I take this old pebble?" → pebble + bit0 (golrie.rs2:15-16); holding
  `golrie_key` hands it over (deleted) (golrie.rs2:17-21).
- Hadley id 302 (0,2516,3428), Gerald id 303 (0,2528,3414) — flavor only, not required.

## Scripted rides/entries (stand → loc/op → arrive); fail coord = (0,2527,3413)

| Entry | Loc (id, coords) | Action | Arrival / notes |
|---|---|---|---|
| Almera's raft | lograft (1987) (0,2509,3493) | op1 Board (stage≥1) | tele (0,2512,3481); forces Hudon dialogue at stage 1 (quest_waterfall.rs2:154-184) |
| Rope on rock | crossing_rock (1996) (0,2512,3468) | USE rope; must be N of rock in zone (2510,3476)-(2514,3481) | forcemove to ≈(0,2513,3468); rope NOT consumed (:218-241). op1 "Swim to" = FAIL → fail coord |
| Rope on dead tree | overhanging_tree1 (2020) (0,2512,3465) | USE rope | tele (0,2511,3463) falls ledge; rope NOT consumed (:254-262). op1 = FAIL −8hp |
| Waterfall ledge door | waterfall_ledge_door (2010) (0,2511,3464) | op1 Open with Glarial's amulet worn OR in inv | tele (0,2575,9861) dungeon, stage 5 (:264-285). Without amulet: flood, fail coord, −8hp |
| Return door | baxtorian_door (2000) (0,2575,9861) | Open | tele back to ledge (0,2511,3463) (:287-289) |
| Tombstone | glarials_tombstone (1992) (0,2558,3444) | USE Glarial's pebble (tomb-gate check must pass) | tele (0,2554,9844) tomb landing, stage 4 (:102-122) |
| Barrel TRAP | barrel (2022) (1,2512,3463) | op1 | FAIL → fail coord (:291-297). AVOID |
| TGV dungeon entrance | ladder_cellar (1754) at (0,2533,3155) surface; dungeon side ladder_from_cellar_directional (1757) at (0,2533,9555) | Climb-down / Climb-up | ±6400 in place (ladders.rs2:96-98 + cellar pair) — controller-derived |

## Golrie leg (region 149)

- golrie_gate (1991) (0,2515,9575) — iron gate; needs `golrie_key` (use or op1 with key)
  (quest_waterfall.rs2:331-368).
- Key from golrie_crate (1990) (0,2548,9565) op1 Search — only yields at stage ≥3
  (quest_waterfall.rs2:315-328). Display name "A key".
- Route: ladder (2533,9555) → crate (2548,9565) → gate (2515,9575) → Golrie (2515,9581).
- Hazards: Hobgoblin id 122 lvl 28 ×many + zombies/bats.

## Tomb gate (quest_waterfall.rs2:44-100) — ENTRY CHECK, nothing is deleted

Forbidden in inv AND worn: all armour categories (hands/staff/helmet/body/legs/shield/
cape/godcape) + every weapon category (slash/blunt/stab/crossbow/axe/pickaxe/javelin/
2h/spear/spiked/thrown/scythe/bow/claws/polearm) + arrows.
Inv-only: category_149 (runes), headless_arrow, arrow_shaft, bow_string, knife,
ball_of_wool, needle, thread, leather variants, ALL logs variants, unstrung_bow,
clue scrolls + caskets (all tiers), cannon_parts. Worn-only: flowers.
NOT forbidden: jewellery/amulets (Glarial's amulet fine), pebble/urn/key, food, coins,
tinderbox. Practical: enter with food + pebble only.

Inside the tomb (region 153; entered UNARMED):
- Coffin (1993) (0,2542,9811) op1 Search → **Glarial's urn** (full) (:125-137).
- Chest (1994) (0,2530,9844) op1 Open → Search → **Glarial's amulet** (:140-151);
  forceapproach=north.
- Hazards: Moss giant lvl 42 ×3 at (2528,9843),(2541,9845),(2542,9819) + armed
  skeletons ×4 + zombies. Run past; do not fight unarmed.
- Exit: not covered by research — pin live/at implementation (landing "bottom of ladder"
  at (2554,9844) implies a ladder back up).

## Dungeon finale (region 154)

- baxtorian_crate (1999) (0,2589,9888) op1 Search → **baxtorian_key** "A key"
  (not consumed) (:370-379).
- baxtorian_door_2 (2002) leaves: (0,2566,9901),(0,2568,9893),(0,2604,9900),(0,2606,9892)
  + m39_154 leaves. Open with key (:381-410). Leaf at 0_40_154_6_46 → puzzle room, stage 6.
  Doors x>2600 teleport raised↔original rooms.
- Pillars (2004) ×6 at (2562,9910),(2562,9912),(2562,9914),(2569,9910),(2569,9912),
  (2569,9914). Place ONE air + ONE earth + ONE water rune on EACH (any order):
  bit=(pillar-1)*3+rune; each placement deletes 1 rune; RE-PLACING SAME TYPE IS A FREE
  NO-OP ("You remember putting that type of rune there." — waterfall_pillars.rs2:12
  before the delete at :15). Total 18 runes = 6 air + 6 earth + 6 water.
- Statue of Glarial (2006) (0,2565,9916): USE amulet with all 18 bits set → amulet
  consumed, tele (0,2603,9914), stage 8 (:418-426). BEFORE bits complete: 20 damage
  boulder, no progress (:429-436). statue_king (2005) at (2566,9916) is decorative.
- Chalice (2014) (0,2603,9910): USE full urn (needs ≥5 free slots, :467) → empty urn,
  queue complete (:462-484). op1 BEFORE completion = whirlpool trap → fail coord (:442-459).
- Hazards: Fire giant lvl 86 ×many, Shadow spider lvl 52, skeletons. Gear allowed here.

## Reward (quest_waterfall.rs2:487-495)

2× diamond, 2× gold bar, 40× mithril seeds, 13,750 Attack XP + 13,750 Strength XP
(engine ×10 fixed point), 1 QP (quest.constant:122).

## Items

Book on baxtorian (bookcase at (1,2520,3426) — UPSTAIRS in the tourist office, needs
stairs; op Read); A key ×2 (golrie/baxtorian — different objs, same display name!);
Glarial's pebble / Glarial's amulet (iop2 Wear, front) / Glarial's urn (full+empty same
display name "Glarial's urn"). Player-supplied: Rope ×1 (never consumed), 6+6+6 runes,
food. All quest items untradeable.

## Gotchas

- NO item loss on any failure — fail states only teleport (+ sometimes 8/20 hp).
- Chalice: NEVER op1 before completion (whirlpool). Statue: NEVER before 18 bits (20 dmg).
- Barrel on the ledge is a pure trap.
- Pillar progress is varp-invisible: blind-place all 18 (repeats free) then statue;
  a statue bounce (hp −20, amulet still held) means bits incomplete → re-place all.
- Runes cannot pass the tomb gate → sequence: tomb leg FIRST (deposit weapons/armour/
  runes/etc), then withdraw runes + gear for the falls leg.
- "A key" display-name collision (golrie vs baxtorian keys) — track by leg, not name.
- Both wig... (n/a here) — tomb landing exit ladder unpinned; verify live.
- Death mid-dungeon: untradeables' death handling engine-specific — deliberate-death
  test adjudicates.
