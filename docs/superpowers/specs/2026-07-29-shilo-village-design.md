# Shilo Village (AIOQuester) — Design

2026-07-29. Twentieth and twenty-first quest modules for the AIO quester, on branch
`shilo-village` cut from `main`. Closes [#156](https://github.com/rs2b2t/rs2b0t/issues/156).

Shilo Village is the longest chain the quester has attempted — fifteen journal stages, four
sealed underground areas, two above-ground pockets the walker cannot currently reach at all,
a three-form boss, and an item chain that runs bones → shard → key and pommel → beads →
necklace. It also cannot be *started* without Jungle Potion, which is not implemented, so
this design covers both quests.

## Engine facts this design is built on

Verified against `lostcity-dev/content` (byte-identical to `LostCityRS/Content` for these
quests) and the baked collision pack `out/collision.lcnav.gz`. Sources:
`scripts/quests/quest_zombiequeen/**`, `scripts/quests/quest_junglepotion/**`,
`scripts/areas/area_karamja/scripts/trufitus.rs2`,
`scripts/skill_agility/{scripts,configs}/shortcuts.*`,
`scripts/skill_herblore/scripts/identifying/identify.rs2`,
`scripts/skill_smithing/configs/smithing/smithing.dbrow`, and `maps/m{43,44,45}_{46,47,48,145,146,148}.jm2`.

The local dev world is a members world (`WorldConfig.node.members` defaults true,
`Player.members = true`), which every area and half the items here require.

### Jungle Potion is a hard gate

`[opnpc1,mosol_rei]` opens with `if(%junglepotion < ^junglepotion_complete) { ... return; }`
and `[opnpcu,trufitus]` only reaches the Wampum-belt branch inside
`if(%junglepotion >= ^junglepotion_complete)`. There is no other way to start the quest, so
Jungle Potion ships in the same change. Its own prerequisite, Druidic Ritual (`druid`), is
already implemented.

### Stage varps

`%zombiequeen` is the stage; `%zq_map_mechanisms` is a bitfield. Neither reaches a
revision-274 client, so — as with Watch Tower and Waterfall — the rendered journal is the
only browser-visible oracle and `readProgress()` parses journal text.

| Const | Value | Reached by |
|---|---|---|
| `not_started` | 0 | — |
| `started` | 1 | Trufitus accepts the Ah Za Rhoon search |
| `found_mound` | 2 | `Look-at` the mound (or Trufitus's "I don't know where to look") |
| `searched_mound` | 3 | `Search` the mound |
| `dug_mound` | 4 | **spade** used on the mound (jumps straight from stage 1–3) |
| `lit_mound` | 5 | **lit candle / lit torch** used on the fissure |
| `roped_mound` | 6 | **rope** used on the fissure |
| `entered_ah_za_rhoon` | 7 | `Search` the roped fissure (Agility 32) |
| `left_ah_za_rhoon` | 8 | leaving mapsquares 45_145 / 45_146 |
| `entered_tomb_bervirius` | 9 | crawling into `zqrocks` (needs the tattered-scroll bit) |
| `unlocked_rashliyia_tomb` | 10 | **bone key** used on the carved doors |
| `entered_with_beads` | 11 | passing the ancient metal gate wearing the beads |
| `unlocked_tombdoor` | 12 | third **bones** placed in the tomb doors |
| `retrieved_corpse` | 14 | dolmen searched after the third Nazastarool dies |
| `complete` | 15 | **Rashiliya corpse** used on the Bervirius dolmen |

`%zq_map_mechanisms` bits: `0` used_table_logs, `1` deciphered_plaque, `2` used_dolmen_paper,
`3` always_crystal, `4` found_door, `5` read_tattered_scroll, `6` read_crumpled_scroll,
`7..8` tomb-door bone count, `9..11` naza 1/2/3 defeated.

Only four of those bits gate anything:

- `read_tattered_scroll` — `[oploc2,zqrocks]` refuses the Bervirius tomb without it.
- `read_crumpled_scroll` — `[opheldu,zqbonebeads]` refuses the necklace craft without it.
- `found_door` — `[opheldu,zqboneshard]` refuses the bone key without it. Set by `Search`ing
  the carved doors **while the stage is exactly `entered_tomb_bervirius`**.
- tomb-door bone count — how many of the three bones are already placed.

Quest points 2. Skill gates: Crafting 20 (beads 15, necklace 16, key 20), Agility 32,
Smithing 4 (bronze wire), Mining 4. The issue specifies max stats.

### The region is a set of sealed pockets

Flooding the pack from Tai Bwo Wannai (2809,3086,0) over `exitMask` plus the baked
door/stair/transport edges — the traversal `PathFinder.search` uses:

| Component | Tiles | Holds |
|---|---|---|
| MAINLAND | 454,667 | Trufitus, Mosol Rei, Jiminua, the anvil, sacred ground, the south shore |
| **EASTJUNGLE** | 6,193 | the mound (2921,2999), the palm trees and carved doors (2915–2917, 3090–3092) |
| **CAIRNISLE** | 160 | the log bridge, `zqrocks` (2762,2990) |
| Ah Za Rhoon north (45_146) | 669 | secret stone, smashed table, waterfall rocks |
| Ah Za Rhoon south (45_145) | 972 | loose rocks, old sacks, gallows |
| Bervirius tomb | 151 | the dolmen, the handholds |
| Rashiliyia tomb entry | 58 | the ancient gate, the tomb exit |
| Rashiliyia tomb inner | 741 | the rash rocks, the tomb doors, the dolmen |
| Shilo Village | 3,083 | post-quest only |

`probe-shilo` reports **EASTJUNGLE and CAIRNISLE as `pathable-from=[NOTHING]`**: the mound and
Rashiliyia's tomb are unreachable by the walker today. That is a data gap, not a walker bug.

### The three missing crossings

All three are ordinary Agility shortcuts, not quest content, and `derive-doors` cannot see
them (they are `GROUND_DECOR` / `CENTREPIECE`, not doors).

| Loc | Op | Instances | Joins | Script |
|---|---|---|---|---|
| `zq_logbalance` "A wooden log" | Balance | (2907,3049), (2909,3049) | MAINLAND (2906,3049) ↔ EASTJUNGLE (2910,3049) | teleports ±4x in two ticks; `stat_random(agility,90,250)` fall |
| `zqrockjump1/2/3` "Stepping stones" | Balance | (2925,2950/2949/2948) | EASTJUNGLE (2925,2951) ↔ MAINLAND (2925,2947) | one tile per stone; `stat_random(agility,50,253)` fall |
| `zqclimbingrocks` "Rocks" | Climb | (2792–2794, 2978–2980) | MAINLAND (2795,z) ↔ CAIRNISLE (2791,z) | Agility 15 eastbound only; moves 4 tiles |

The log and the climbing rocks become **four curated `transports.json` edges**, `kind:
"dungeon"` — the kind that carries a `toTile`, so the executor waits for the landing rather
than for a door to open. Every bot gains the route and the Shilo module carries no code for
them. Re-probing after the edges: the mound, the carved doors and Cairn Isle all report
`pathable-from=[MAINLAND]`, and MAINLAND grows by exactly 6,353 tiles — EASTJUNGLE plus
CAIRNISLE.

**The stepping stones are deliberately not an edge.** All three stone tiles are unwalkable
water in the pack, so `PathFinder.addEdges` would drop any per-hop edge, and a single
four-tile edge would satisfy the executor's `chebyshev(me, toTile) <= 3` landing test after
the first of four clicks. They buy nothing either: with the log in place, the waterfall exit
routes back to Trufitus in 100 waypoints and to the mound in 130.

Quest-scripted crossings stay in the module, because nothing but the quest can use them:

| From | Via | To |
|---|---|---|
| EASTJUNGLE (2921,2999) | `Search` the roped fissure | Ah Za Rhoon N (2898,9401) |
| Ah Za Rhoon N (2887,9373) | `Search` "Cave in" | Ah Za Rhoon S (2888,9283) |
| Ah Za Rhoon S (2886,9283) | `Search` "Cave in" | Ah Za Rhoon N (2887,9374) |
| Ah Za Rhoon N (2940,9349/9353) | `Search` waterfall rocks | MAINLAND south shore (2929,2946) |
| CAIRNISLE (2762,2990) | `Search` well stacked rocks | Bervirius tomb (2760,9389) |
| Bervirius tomb (2765,9376) | `Climb` handholds | CAIRNISLE (2764,2976) |
| EASTJUNGLE (2916/2917,3090) | `Enter` hillside entrance | Rash tomb entry (2929,9525) |
| Rash tomb entry (2928/2929,9527) | **bone key** on "Tomb exit" | EASTJUNGLE (2916,3093) |
| Rash tomb entry (2928/2929,9516) | `Open` ancient gate **wearing beads** | Rash tomb inner (2929,9515) |
| Rash tomb inner ↔ entry | `Climb` `zq_rashrocks` (2927–2930, 9511–9515) | (2928,9511) / (2929,9515) |

The eastbound tomb exit is worth stating twice: `[label,zq_open_tombexit]` **fails while you
carry the bone key** ("The door seems to be locked!"). The key must be *used on* the door,
not the door opened.

### Where every item comes from

**Jiminua's Jungle Store (2767,3122), keeper `Jiminua`**, stocks almost the whole kit — a
single shop trip 35 tiles from Trufitus: Rope 18gp, Spade 3, Chisel 1, Candle 3, Tinderbox 1,
Bronze bar 8, Hammer 1, Bread 12, Cooked meat 4, Papyrus, Charcoal.

- **Bronze wire** is sold nowhere. Smith the bronze bar at the **Tai Bwo Wannai anvil
  (2790,3101)** — Smithing 4, which is exactly why the quest asks for it.
- **Lit candle**: buy an unlit Candle plus a Tinderbox and light it. Only `lit_candle`,
  `lit_black_candle` and `torch_lit` satisfy `[oplocu,ahzarhoon_entrance_fissure]`; the
  light source is consumed.
- **3× Bones**: no shop sells them and every quest NPC has `param=death_drop,null`. Bank
  first; otherwise the Khazard Battlefield ground-spawn cluster (2456–2484, 3217–3234),
  ~170 tiles from Ardougne West and MAINLAND-reachable.

There is **no bank on Karamja** before the quest completes, so the module sets
`ownsInventory: true` and banks at Ardougne West (2616,3332) — the nearest bank to the
Brimhaven ship, which is already a curated crossing.

### Object IDs

Five Jungle Potion unids all display as "Unidentified herb", so the module keys on
`snap.invIds`, never names.

| Item | id | Item | id |
|---|---|---|---|
| unidentified_snake_weed | 1525 | zqboneshard | 604 |
| unidentified_ardrigal | 1527 | zqbonekey | 605 |
| unidentified_sito_foil | 1529 | zqberviriusscroll (Tattered scroll) | 607 |
| unidentified_volencia_moss | 1531 | zqrashiliyiascroll (Crumpled scroll) | 608 |
| unidentified_rogues_purse | 1533 | zqcorpse (Rashiliya corpse) | 609 |
| snake_weed / ardrigal | 1526 / 1528 | zqzadimusbones (Zadimus corpse) | 610 |
| sito_foil / volencia_moss | 1530 / 1532 | zqdeadbeads (Beads of the dead) | 616 |
| rogues_purse | 1534 | zqbonebeads (Bone beads) | 618 |
| mosol_wampum_belt | 625 | zqbevsword (Sword pommel) | 623 |
| rope / spade / chisel | 954 / 952 / 1755 | bronzecraftwire | 1794 |
| bones / bronze_bar / hammer | 526 / 2349 / 2347 | unlit_candle / lit_candle / tinderbox | 36 / 33 / 590 |

## Design

### Jungle Potion — `defs/junglepotion.ts`

One file, roughly the size of `druidicritual.ts`. Journal text is unambiguous at every
stage, so `readProgress()` needs no flags — the stage alone plus held items is enough.

Loop, five times: walk to the herb loc → `Search` → `Identify` the unid → walk to Trufitus →
talk with `prefer: ["Of course!"]`. The engine only accepts a herb once the stage is
`found_*`, which picking sets, so pick-before-hand-in falls out of the state machine rather
than being sequenced by hand.

| Herb | Loc name | Op | Tile |
|---|---|---|---|
| Snake weed | Marshy jungle vine | Search | 2760,3014 (also 2761,3017) |
| Ardrigal | Palm tree | Search | 2870,3115 (also 2874,3124 / 2877,3120) |
| Sito foil | Scorched earth | Search | 2784,3067 (also 2789–2791,3047–3049) |
| Volencia moss | Rock | Search | 2850,3035 (also 2851,3033/3036) |
| Rogues purse | Fungus covered Cavern wall | Search | 2850,9476 |

Rogues purse is inside a pocket: `Rocks` (2824,3118) `Search` → telejump (2830,9520);
`Hand holds` (2830,9522) `Climb` → (2823,3120). Same `escapePocket` treatment as Shilo.

Start dialogue: `prefer: ["It's a nice village, where is everyone?", "Me? How can I help?",
"It sounds like just the challenge for me."]`.

### Shilo Village — `defs/shilo/`

Watch Tower's directory shape, because the same forces apply:

| File | Job |
|---|---|
| `areas.ts` | tiles, loc/npc/obj ids, `shiloArea(tile)` classifier over the nine components |
| `journal.ts` | `readShiloProgress()` — stage + flags from journal text |
| `supplies.ts` | bank/shop/smith sourcing, `held`/`banked`/`owned` helpers |
| `ahzarhoon.ts` | mound, fissure, the two cave rooms, scrolls, gallows, waterfall exit |
| `cairn.ts` | climbing rocks, log bridge, `zqrocks`, the Bervirius dolmen and handholds |
| `rashtomb.ts` | palm trees, carved doors, ancient gate, rash rocks, tomb doors, Nazastarool |
| `index.ts` | `decide()` — one switch over the stage, every branch escaping its pocket first |

`decide()` follows Watch Tower's `at(area, wanted, step)` idiom: no branch assumes it is
standing on the mainland, because every one of them can be re-entered after a death,
a restart, or a random event inside a sealed pocket.

Journal flags parsed by `readShiloProgress()`:

| Flag | Journal line |
|---|---|
| `read-tattered` | "i've read the tattered scroll" |
| `read-crumpled` | "i read the crumpled scroll" |
| `found-door` | "the lock is made out of bone" |
| `bones-placed:N` | "i've placed one bone" / "i've placed two bones" |
| `naza:N` | the three escalating "nazastarool" paragraphs |

One wrinkle the journal cannot cover: once `used_dolmen_paper` is set (searching the Bervirius
dolmen), the journal stops rendering the scroll lines. `read-crumpled` is needed *after* that
point, for the necklace craft. The module therefore reads a held scroll whenever the flag is
absent — reading is idempotent and cheap — and both scrolls are re-obtainable from their
original locs if lost, as a recovery branch.

### Two hazards designed around

- **Mosol Rei's "What danger is there around here?" spawns one to three aggressive Undead
  Ones** (levels 61–73). His dialogue is driven with `talkStrict`, never `talkThrough`, so an
  unmatched option abandons the conversation instead of falling through to the last one.
- **`fake_coins` on the tomb floor summon a mob and turn to dust.** The module never loots
  inside region 45_148.

### Combat

Nazastarool has three forms, all named "Nazastarool", each summoned by re-searching the
dolmen at (2892,9487): zombie (level 91, 70hp), skeleton (level 68, 70hp), ghost (level 93,
80hp). Melee at max stats, `Sustain.run()` below the quest's `eatBelowHp`, food bought at
Jiminua's or withdrawn at Ardougne. The pattern is Demon Slayer's:
`Npcs.query().name(...).action('Attack').nearest()` then re-search the dolmen once the kill
lands.

### Records

`data/quests.ts` gains real requirements for both, which today are `{}`:

```ts
{ id: 'junglepotion', name: 'Jungle Potion', questPoints: 1,
  requirements: { quests: ['druid'], skills: [{ skill: 'herblore', level: 3 }] }, items: [] }

{ id: 'zombiequeen', name: 'Shilo Village', questPoints: 2,
  requirements: { quests: ['junglepotion'], skills: [
      { skill: 'crafting', level: 20 }, { skill: 'agility', level: 32 },
      { skill: 'smithing', level: 4 }, { skill: 'mining', level: 4 }] },
  items: [] }
```

`items` is empty for both. `ownsInventory: true` makes the engine skip provisioning
entirely, so a `mustHave: Rope` would only mis-report the quest as blocked when the bank has
no rope — which is fine, because the module buys one on Karamja.

## Testing

`tools/shilo-solo-test.ts`, cloned from `watchtower-solo-test.ts`: local sim on :8888,
`speed 300` (2× ticks), `~maxme`, `setvar zombiequeen <n>` and `setvar zq_map_mechanisms
<bits>` followed by a relog (the quest-tab colour is pushed by `if_setcolour`, only
re-derived by the login script), `--give` for seeding, `--minutes` for the budget.

**A stage test seeds only what that stage produces, never its tools.** Every Watch Tower
stage-10 test handed the bot a pickaxe, so all of them passed while the quest could not
mine. Spade, chisel, tinderbox, hammer and coins are what this quest can silently lack.

Order of work:

1. Rebuild the collision pack from the current engine, add the six transport edges, and
   re-run the reachability probe until the mound, the carved doors and Cairn Isle report
   `pathable-from=[MAINLAND]`.
2. Unit tests for both `decide()`s and both journal parsers — pure functions, no client.
3. Live per-stage runs, cheapest first: Jungle Potion whole; then Shilo stages 0→4, 4→7,
   7→8, 8→9, 9→10, 10→12, 12→14, 14→complete.
4. One uncheated end-to-end from a fresh account: Druidic Ritual → Jungle Potion → Shilo
   Village, `~maxme` only.

## What the live runs changed

Four things the scripts did not make obvious, each found by running the quest:

- **`start_junglepotion` tests `%druidquest = ^druid_complete` for equality**, so the
  prerequisite cheat has to set exactly 4. A higher value reads as "requirements not
  met" and Trufitus silently refuses the job — the module was right and the harness
  was wrong.
- **Jungle Potion's journal has a hole.** At `found_snake_weed` while the unidentified
  herb is held it writes no line at all, and every other `found_` stage writes the
  *previous* stage's "go and pick it" line. A carried unid now outranks the journal:
  it exists only because we just picked it, which is exactly the state the journal
  cannot express.
- **Scripted chains have quiet gaps.** Burying Zadimus runs dig → apparition → speech
  → shard → closing box, and between those nothing is open. `driveChoice` returned at
  the first gap and the rest never ran, so `driveUntil(expect)` drives to the goal
  instead of to the first silence.
- **The ledge past the ancient gate is its own area.** The gate drops you at
  (2929,9515), between itself and the climbing rocks. Treating that as still the entry
  corridor made `decide()` re-open the gate, which sends you straight back north.
- **Both scrolls render their body as a *main* modal**, built with `if_settext`, not as
  a chat box. `driveChoice` cannot see it, and while it is up every journal read comes
  back empty — which `decide()` reads as "stage unavailable" and parks the quest one
  step after the scroll it just read.
- **The watchdog could not see journal flags.** Reading a scroll or searching a lock
  moves no item, no tile and no stage — only a named flag, which `progressSignature`
  ignored. Every such step read as "no progress" and spent its whole budget on the way
  to being parked. Fixed in the shared engine; Watch Tower's flags were equally blind.
- **One shop trip, not six.** Jiminua is 35 tiles from Trufitus and the mound is 200 the
  other way, so buying one item per `buy` step cost six crossings of the island.
- **Rashiliyia's tomb is the other way round.** The climbing rocks drop you *south* of
  the skeletal doors; the dolmen and the remains are north, behind them. Three bones is
  the only way through, so `derive-doors` must not bake them — with the edge in, the
  pathfinder routed through a wall and the walker repathed forever against "This door
  is completely sealed"; the ancient gate had the same problem.
- **A plain z test cannot name the two sides.** The corridor east of the doors runs up
  to z=9511 on the *southern* side, so "north of z=9480" put the foot of the climbing
  rocks behind the doors. The dolmen room needs its own bounding box.
- **Leaving the chamber is three moves.** Cross back south, walk to the foot of the
  rocks, then climb — "no climbable rocks in range" was the bot standing at the dolmen
  with the remains in hand and nowhere to go.
- **The pack was baked with the jungle plants, not the carved doors** they hide, so the
  tile east of the doors is not a stand the walker can reach at all.

## Deliverable

One PR from `shilo-village` (main is PR-only): the transport edges, the two quest records,
`defs/junglepotion.ts`, `defs/shilo/`, registration in `defs/index.ts`, unit tests, the solo
test tool, and a `docs/QUESTS.md` note on the two lessons this quest adds — that an unreachable
region is a nav-data problem, and that a door which refuses the very key that opens it is a
`useOn`, not an `Open`.
