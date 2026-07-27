# FireGiant (Waterfall Dungeon) — Design

2026-07-26. New combat bot on branch `firegiant`, cut from `main`. Kills the 10 fire
giants in the Waterfall Dungeon with melee, range, or magic, and banks by teleporting
out and re-running the raft/rope/amulet entry chain.

Third clone in the MossGiant lineage (`MossGiant` → `GreenDragon` → `FireGiant`): same
settings vocabulary, same task list, same paint. What is new is the scripted entry chain
and a two-step exit (dungeon door, then the barrel off the ledge).

## Engine facts this design is built on

All verified against `lostcity-dev/content`, not from memory. Sources:
`scripts/quests/quest_waterfall/scripts/quest_waterfall.rs2`, `scripts/_unpack/225/all.npc`,
`maps/m39_54.jm2`, `maps/m40_154.jm2`, and the baked collision pack `out/collision.lcnav.gz`.

### Entry

| Step | Loc | Coord | Mechanic |
|---|---|---|---|
| 1 | `Log raft` | loc origin 2509,3493 | `op1` Board, from the stand tile 2510,3493. **Refuses unless Waterfall Quest is started** (`%waterfall_quest > 0`). Teleports to 2512,3481. |
| 2 | `Rock` | 2512,3468 | `Use rope` on it. Requires `inzone(2510,3476 .. 2514,3481)` **and** your z > 3468. Force-moves you to 2513,3468. |
| 3 | `Dead tree` | 2512,3465 | `Use rope` on it, standing 2512,3466. Teleports to the ledge 2511,3463. |
| 4 | `Ledge` | 2511,3464 | `op1` "Open". Amulet check is `inv_total(worn,…) > 0 \| inv_total(inv,…) > 0` — **inventory or worn, either works**. Teleports to 2575,9861. |

Loc names are the engine's, not the wiki's: the tree is **`Dead tree`** (op1 `Climb`) and the door
is **`Ledge`** (op1 `Open`). The rock keeps the name `Rock` in both its unroped (1996) and roped
(1997) forms, so a name query matches either.

**Three locs named `Ledge` are spawned side by side** — 2011 at 2510,3464, 2010 at 2511,3464,
2012 at 2512,3464 — and all three carry `op1=Open`, but **only the middle one (2010) has an
`oploc1` script**. Clicking either outer leaf silently does nothing. A `nearest()` query from the
ledge tile can pick an outer leaf and wedge the bot forever, so the door must be selected by
tile: `.where(l => l.tile().x === 2511 && l.tile().z === 3464)`.

Consequences the bot must respect:

- **The raft lands you at 2512,3481, which is already inside the rope-throw zone.** No walk
  between boarding and throwing.
- **The rope is never consumed** — no `inv_del` on either handler. One rope lasts forever.
  The roped rock reverts after 8 ticks (`loc_change(…, 8)`), so every trip re-throws.
- **`op1` on the tree without a rope** = fall, `~damage_self(8)`, teleport to 2527,3413.
- **`op1` on the door without the amulet** = flushed, `~damage_self(8)`, teleport to 2527,3413.
- Both failure paths land on the **same tile**, `^waterfall_fail_coord` = 2527,3413, which is
  on solid ground 127 tiles from the raft. That makes it a clean self-healing signal.

### The way out is the barrel (corrected 2026-07-27)

**An earlier version of this spec claimed there was no walk-out. That was wrong**, and it was
wrong because it trusted a map file over the running game. The `.jm2` LOC line for the barrel
parsed as level 1, which put it out of reach of the level-0 ledge, and flood-filling the collision
pack from 2511,3463 returns one tile — so "teleport or nothing" looked proven.

Standing on the ledge in a live client says otherwise:

```
Barrel@2512,3463,lvl0 d=1 ops=[Get in]
```

Level 0, one tile away, directly clickable, and its description reads *"A wooden barrel, maybe a
way off this rock."* The route out is:

| Step | Loc | Coord | Result |
|---|---|---|---|
| 1 | `Door` | 2575,9861 (the entry tile) | `op1` → ledge 2511,3463 |
| 2 | `Barrel` | 2512,3463 | `op1` "Get in" → 2527,3413 |

2527,3413 is 118 tiles from Ardougne West and 127 from the raft, so the barrel loop is roughly the
same length as the Camelot one (328 vs 352) while costing **no runes, no magic level and no
quest**. It is therefore the default `Way out`; the teleports stay selectable and only save the
walk back to the exit door.

Because the barrel always works, missing teleport runes are a detour and never a trap: a teleport
that will not fire falls back to walking out, and nothing parks for want of runes.

**The lesson, which cost real time twice:** the collision pack and the map files are derived data.
When they disagree with the running client about what exists, the client wins. The same mistake in
the other direction produced the rope-throw stand bug.

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
- **`src/bot/scripts/FireGiantLogic.ts`** — sibling pure module (`NatureRunnerLogic`
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
| `safespotTile` | tile | `2568,9892` | forward spot, `showIf` range/mage |
| `safespotFallbackTile` | tile | `2568,9893` | melee-proof retreat, `showIf` range/mage |
| `meleeTile` | tile | `2575,9893` | `showIf` melee |
| `escapeTele` | string | `Barrel (free)` | Barrel / Camelot / Ardougne / Falador / Varrock |
| `runeBuffer` | number | 500 | spare runes per type on top of the cast budget, `showIf` mage |
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

The barrel needs nothing at all, so the teleports are purely a convenience — they skip the walk
back to the exit door. Their help text states the walk-back cost.

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

- **Unit** — `FireGiantLogic.legFor()`: feed tiles, assert the leg, including the zone
  boundaries and the washed-out radius. Pure, no client.
- **Live smoke** `tools/firegiant-test.ts` — seed with cheats (amulet, rope, quest varp), run
  the chain, assert arrival at 2575,9861, assert a kill, force a bank trip, assert re-entry.

## Live verification (2026-07-27)

**`2568,9893` holds as a safespot.** Range smoke on the local sim: the bot entered, walked to the
tile through the `Large door` at 2565,9881, and killed a fire giant for 521 ranged xp with
**zero** `returning to the safespot` events, **zero** food eaten, and no deaths.

**The safespot is two-tier.** `2568,9892` is the forward spot: it sees two west giants
(2568,9889 at d=3 and 2562,9886 at d=6) so it kills faster, but unlike 9893 a 2x2 footprint fits
with its **origin on that tile**, so a giant can occasionally reach it. The bot holds 9892 and drops
to `2568,9893` — the melee-proof nook — the moment it **takes a hit**, and returns to the forward
spot on the **next kill**. Damage is the honest trigger: a giant walking past is harmless, and only
something connecting means the tile has failed. A kill means whatever reached us is gone, so the
forward spot is worth retrying — no timer, so it neither gives up early nor sulks in the nook.

Both tiers are in the west room, so room-gated targeting is unaffected by a retreat, and both keep
west giants inside bow range.

### Rune budgets have to allow for looted runes

The cast budget (`runesWithdraw`, in casts) assumes the trip only spends what it carried in. It
does not: fire giants drop chaos, air, blood, law and death runes, so a lucky trip keeps casting
well past its planned count and drains whichever rune is scarcest. With Camelot as the way out
that rune is air — the teleport's — and the bot ends up unable to leave. `runeBuffer` (default
500) is withdrawn on top of the computed requirement for each rune the spell needs; runes stack,
so it costs no extra inventory slots.

This is mitigation rather than a guarantee. The robust fix is the barrel: it needs no runes at
all, which is why it is the default way out.

### Looting is a burst

Loot lands on the corpse tile, so collecting it means leaving the safespot and tanking. Three
things made that slow, all fixed: `LootCorpse` grabbed one item per task hop (~600ms each), a
failed Take blocked 4s with `interact()`'s result ignored, and — the big one — success was measured
as `Inventory.used() > before`, which **never moves for a stackable drop** merging into an existing
slot. Coins, runes and arrows are most of this table, so each one burned the full timeout and
reported failure. Looting now drains the pile in one pass (`lootBurst`), counts a stack increase as
success, and breaks off to eat rather than finishing the pile at low HP.

### Leashing stage

`interact('Attack')` on a giant beyond weapon range makes the **server walk you into range**, which
steps off the safespot; `ReturnToSafespot` then drags you back before the shot leaves, the giant is
marked skipped for 8s, and the bot ping-pongs without ever attacking.

Safespotting therefore engages a giant only once it is already within weapon range — bow 7, magic
10 (`attackRangeFor`), both shorter than `FIELD_RADIUS` 10. Anything further puts the bot in a
**`leashing fire giant`** stage: hold the tile, keep eating if needed, and poll until the giant
closes. If it never arrives inside `LEASH_WAIT_MS` (15s) it is skipped for 20s and the bot picks
another. Melee is unaffected — it walks to its targets by design.

### Target order: east to west

Distance is the wrong ordering in the west room. The giants wander up to 3 tiles, so the westmost
one frequently reads as nearest while a wall blocks line of sight — the bot picks it, cannot hit it,
and dances. Safespotting sorts by **x descending** (`eastFirst`), nearest breaking ties, so the
three west giants are engaged 2568 → 2565 → 2562. Melee keeps the plain nearest-first sort.

### Room-gated targeting

The chambers overlap inside `FIELD_RADIUS`: from the safespot, 8 of the 10 spawns are within 10
tiles and the nearest **east** giant (2573,9895, d=5) is closer than two of the three west ones. A
radius therefore cannot keep a safespotting bot in its own room. Targeting is gated on
`roomOf()` instead — west is x ≤ 2571, east is x ≥ 2572, which splits the spawns cleanly (west tops
out at 2568, east starts at 2573). The gate applies only when safespotting; melee still uses the
plain radius, and an anchor outside both boxes falls back to radius-only.

Melee passed the same way from `2575,9893` (542 combat xp). Both styles reached the dungeon in
~10 minutes from a fresh Lumbridge spawn, the bulk of which is the Seers walk.

Entry-chain timings from the melee run:

```
[578s] rafted down to the landing
[598s] crossed to the rock
[598s] down on the ledge
[608s] inside the Waterfall Dungeon
```

### What live testing changed

- **`ROPE_THROW_STAND` (2512,3477) was added.** The raft landing satisfies the engine's `inzone`
  check but sits 13 tiles from the rock across water — past `aplocu` range — so the server
  answers "I can't reach that!" and nothing happens. Zone membership and op reachability are two
  separate constraints; the rock leg now walks to the stand first.
- **Every entry leg now logs on its timeout path.** All four previously swallowed failure, so a
  wedge surfaced only as a 10-minute watchdog hit with no explanation.
- **The ranged ammo check now counts the quiver.** `withdrawStyleSupplies` compared only the
  pack, so once `GearEquip` moved the arrows into the quiver it declared the bank empty and set
  `supplyKnownEmpty`, which would have suppressed the ammo bank trip once the quiver ran dry.
