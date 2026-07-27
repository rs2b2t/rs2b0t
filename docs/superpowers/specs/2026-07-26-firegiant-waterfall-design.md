# FireGiant (Waterfall Dungeon) — Design

2026-07-26. New combat bot on branch `firegiant`, cut from `main`. Kills the 10 fire
giants in the Waterfall Dungeon with melee, range, or magic, and banks by teleporting
out and re-running the raft/rope/amulet entry chain.

Third clone in the MossGiant lineage (`MossGiant` → `GreenDragon` → `FireGiant`): same
settings vocabulary, same task list, same paint. What is new is the entry chain and the
fact that the dungeon has no walk-out.

## Engine facts this design is built on

All verified against `lostcity-dev/content`, not from memory. Sources:
`scripts/quests/quest_waterfall/scripts/quest_waterfall.rs2`, `scripts/_unpack/225/all.npc`,
`maps/m39_54.jm2`, `maps/m40_154.jm2`, and the baked collision pack `out/collision.lcnav.gz`.

### Entry

| Step | Loc | Coord | Mechanic |
|---|---|---|---|
| 1 | `Log raft` | loc origin 2509,3493 | `op1` Board, from the stand tile 2510,3493. **Refuses unless Waterfall Quest is started** (`%waterfall_quest > 0`). Teleports to 2512,3481. |
| 2 | `Rock` | 2512,3468 | `Use rope` on it. Requires `inzone(2510,3476 .. 2514,3481)` **and** your z > 3468. Force-moves you to 2513,3468. |
| 3 | `Overhanging tree` | 2512,3465 | `Use rope` on it, standing 2512,3466. Teleports to the ledge 2511,3463. |
| 4 | `Door` | 2511,3464 | `op1`. Amulet check is `inv_total(worn,…) > 0 \| inv_total(inv,…) > 0` — **inventory or worn, either works**. Teleports to 2575,9861. |

Consequences the bot must respect:

- **The raft lands you at 2512,3481, which is already inside the rope-throw zone.** No walk
  between boarding and throwing.
- **The rope is never consumed** — no `inv_del` on either handler. One rope lasts forever.
  The roped rock reverts after 8 ticks (`loc_change(…, 8)`), so every trip re-throws.
- **`op1` on the tree without a rope** = fall, `~damage_self(8)`, teleport to 2527,3413.
- **`op1` on the door without the amulet** = flushed, `~damage_self(8)`, teleport to 2527,3413.
- Both failure paths land on the **same tile**, `^waterfall_fail_coord` = 2527,3413, which is
  on solid ground 127 tiles from the raft. That makes it a clean self-healing signal.

### There is no walk-out

Flood-filling the collision pack from the ledge tile 2511,3463 returns **one tile**. The door
tile north of it is solid scenery; the barrel that dumps you downstream is on level 1 and
unreachable from the level-0 ledge. The in-dungeon `Door` (`baxtorian_door_waterfall_quest`)
just teleports back to that same one-tile ledge.

**Banking therefore requires casting a teleport.** This is the single fact that makes FireGiant
structurally different from MossGiant.

### The giants

`[firegiant]` npc 110, ten spawns, all in mapsquare 40,154:

```
west   2562,9886   2565,9887   2568,9889
centre 2573,9895   2575,9891   2577,9890   2577,9897
       2578,9895   2580,9890   2581,9895
```

`size=2` · `hitpoints=111` · `attack/strength/defence=65` · `vislevel=86` ·
`wanderrange=3` · `maxrange=5` · `huntmode=cowardly` · `huntrange=2` · `respawnrate=60`.

Two properties make safespotting work: a 2x2 NPC cannot enter a 1-tile-wide nook, and
`maxrange=5` leashes each giant to 5 tiles from its spawn. `huntrange=2` with cowardly
hunting means they are barely aggressive, so unsafespotted melee is also viable.

## Architecture

- **`src/bot/scripts/FireGiant.ts`** — the bot. `TaskBot`, MossGiant-shaped.
- **`src/bot/scripts/WaterfallEntryLogic.ts`** — sibling pure module (`NatureRunnerLogic`
  convention): coords, the leg table, and `legFor(tile)`. No client imports, unit-testable.
- **`src/bot/scripts/index.ts`** — registry entry, category `Combat`.
- **`tools/firegiant-test.ts`** — live smoke.

The entry chain lives in its own module because it is a second state machine; MossGiant is
already 660 lines and inlining this would push `FireGiant.ts` past the point where it can be
read in one sitting.

## The entry chain is a resumable leg ladder

The bot **derives the leg from its position every pass** and never remembers progress. Any leg
can fail and teleport the player somewhere else, so re-asking "where am I?" is both simpler and
strictly more robust than tracking a step index.

```
legFor(tile):
  z > 9000                          -> InDungeon      (walk to spot / fight)
  tile == 2511,3463                 -> AtLedge        (Open the door)
  within 3 of 2513,3468             -> PastRock       (walk 2512,3466; Use rope on tree)
  inzone 2510-2514 / 3476-3481      -> AtLanding      (Use rope on Rock)
  within 6 of 2527,3413             -> WashedOut      (walk to the raft)
  within 5 of 2510,3493             -> AtRaft         (Board the raft)
  otherwise                         -> Surface        (walk to the raft)
```

Each leg is precondition → action → assert-position-changed with a timeout → retry. Guards
before the two damaging ops:

- tree leg asserts `Inventory.contains('Rope')` before clicking, never `op1`
- door leg asserts the amulet is in inventory or worn before clicking

`WashedOut` is not treated as an error. It is the expected recovery state and simply rejoins
the ladder at the raft.

## Settings

MossGiant's schema verbatim — `combatStyle`, `meleeStyle`, `staff`, `spell`, `runesWithdraw`,
`bow`, `rangeStyle`, `ammo`, `ammoWithdraw`, `food`, `foodWithdraw`, `eatHp`, `panicHp`,
`loot`, `bankCommonJunk`, `buryBones` — plus:

| Setting | Type | Default | Notes |
|---|---|---|---|
| `safespotTile` | tile | `2568,9893` | `showIf` range/mage |
| `meleeTile` | tile | `2575,9893` | `showIf` melee |
| `escapeTele` | string | `Camelot` | Camelot / Ardougne / Falador / Varrock |
| `bankTile` | tile | `2725,3491` | Seers; the default tracks `escapeTele` (below) |
| `teleStock` | number | 2 | escape casts carried **in addition to** the one needed to leave, so a failed cast is not fatal |

`escapeTele` → `bankTile` default: Camelot → Seers `2725,3491` · Ardougne → Ardougne West
`2616,3332` · Falador → Falador West `2946,3369` · Varrock → Varrock West `3185,3440`. All four
come from `BANK_LOCATIONS`. An explicitly set `bankTile` always wins.

Teleport destinations read from `magic_spells.dbrow`; walk costs measured against the baked
nav pack:

| Tele | Magic | Runes | Lands | → bank | bank → raft | total |
|---|---|---|---|---|---|---|
| Camelot | 45 (members) | 5 air, 1 law | 2757,3478 | Seers 36 | 316 | **352** |
| Ardougne | 51 + Plague City | 2 water, 2 law | 2661,3301 | Ardy West 64 | 210 | **274** |
| Falador | 37 | 1 water, 3 air, 1 law | 2965,3378 | Fally W 25 | 746 | 771 |
| Varrock | 25 | 1 fire, 3 air, 1 law | 3213,3424 | Varrock W 40 | 870 | 910 |

Falador and Varrock stay in the list because a melee account with 25 Magic has no other way
out, but their help text states the walk-back cost.

Cast via the magic-tab component (`GreenDragon`'s `castVarrockTele` pattern): Varrock 1164,
Lumbridge 1167, Falador 1170, Camelot 1174, Ardougne 1540.

### Keep-list

`combatKeepNames({…, extra: ["Glarial's amulet", 'Rope', ...escapeTeleRunes]})` so
`depositAllExcept` never banks the three things required to get back in.

## Combat and positioning

Unchanged from MossGiant. `usesSafespot()` is mage||range → hold `safespotTile`, attack giants
inside the field radius, skip any giant whose attack pulls you off the tile. Melee anchors on
`meleeTile` with radius 8 and does not return between kills.

Defaults were computed, not guessed: for every walkable tile reachable from the dungeon
entrance, reject any tile cardinally adjacent to a position a 2x2 footprint can occupy within
its giant's 5-tile leash, then rank by giants in line of sight.

- **`2568,9893`** — 1-wide nook on the north edge of the west room, 4 tiles due north of the
  giant at 2568,9889 with a clear column between them. Matches where players safespot.
- **`2575,9893`** — centre room, 7 giants within 6 tiles.

Loot defaults to `DROP_DB['Fire giant']` minus arrows and obvious junk. The table already
carries rune scimitar, runite bar, dragonstone, and half of a key.

## Banking

Trigger is MossGiant's `BankRun.validate()`: out of food, out of ammo/casts, or inventory full.

```
cast escapeTele  ->  walk bankTile  ->  deposit all except keep-list
  ->  withdraw food / ammo / runes / tele runes
  ->  verify amulet + rope present   (missing and unbuyable -> park)
  ->  walk to the raft  ->  entry ladder  ->  walk to the fight spot
```

## Failure handling

- **Death** → log the tile, note that Glarial's amulet may be on the pile, park. No auto-restart
  and no `DeathRecovery` task: walking back is impossible without the amulet, and grinding on
  blind would burn bank stock. This replaces MossGiant's `DeathRecovery`.
- **Missing amulet, rope, or unstarted quest** at startup or after a bank trip → log the
  specific missing item and park.
- **Washed out at 2527,3413** → not a failure; rejoin the ladder.

## Prerequisites (not in scope)

The bot requires, and checks at startup:

- **Glarial's amulet** in inventory, worn, or bank
- **Waterfall Quest started** (`%waterfall_quest > 0` — one Almera dialogue)
- **Rope** in inventory or bank

Acquiring the amulet is its own chain (free Golrie → pebble → strip all armour, weapons, runes,
arrows, and logs → pebble on the tombstone → open the chest) and belongs in AIOQuester, not
here. Startup failure is a clear log plus park, matching how EssMiner gates on Rune Mysteries.

## Testing

- **Unit** — `WaterfallEntryLogic.legFor()`: feed tiles, assert the leg, including the zone
  boundaries and the washed-out radius. Pure, no client.
- **Live smoke** `tools/firegiant-test.ts` — seed with cheats (amulet, rope, quest varp), run
  the chain, assert arrival at 2575,9861, assert a kill, force a bank trip, assert re-entry.

## Open question for live verification

Whether `2568,9893` holds as a safespot in a real fight. The leash and footprint maths say yes,
but engine line-of-sight has corner rules that the static Bresenham approximation used here does
not model. The smoke confirms it; it is a setting either way, and `2568,9884` (2 giants in LoS,
nearest at 3, on the south approach) is the fallback.
