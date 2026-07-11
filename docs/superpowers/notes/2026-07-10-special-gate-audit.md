# Special-gate audit of `doors.json`

Date: 2026-07-10
Branch: `feat/nav-conditional-crossings`

## Goal

`src/bot/nav/data/doors.json` bakes ~1105 door/gate **edges** that the pathfinder
treats as free-to-open (a plain `Open`). A gate whose `Open` actually needs a
fee, an item, a quest state, or a dialogue is a latent bug there. This audit
walks every **distinct `locName`** (34 of them) in `doors.json`, resolves each
loc id to its content config via `~/code/rs2b2t-content/pack/loc.pack`, finds the
`Open`-op handler (a `[oplocN,...]` script or the generic category handler in
`scripts/doors` / `scripts/general_use/scripts/gates.rs2`), and classifies it:

- **(a) PLAIN** — opens/moves immediately (`~door_open`, `loc_change`/`loc_add`
  to an open variant, `~open_and_close_door`, `~open_gate`); no dialogue / item /
  quest / skill check.
- **(b) DIALOGUE** — starts a chat/choice (like the toll gate `border_gate.rs2`).
- **(c) CONDITIONAL** — checks an item, coins, quest varp, or skill before opening.

## Method notes

- `pack/loc.pack` maps numeric `locId -> config name` (e.g. `2882=border_gate_toll_left`).
- A config's `category` selects the generic handler when no config-specific
  `[oplocN,<configName>]` trigger exists. Generic-plain categories:
  `door_closed` / `door_opened` / `door_open_and_close` / `door_left/right_*` /
  `reverse_door_*` / `double_door_open_and_close_left/right` /
  `gate_main_closed` / `gate_outer_closed`. A **config-specific** trigger always
  overrides the generic one — several quest gates carry a `double_door_*` category
  yet are quest-gated because of a dedicated `[oploc1,<name>]` handler.
- The big buckets `Door` (111 configs) and `Gate` (69 configs) are **mostly plain**
  but each contains a handful of embedded quest/special configs; those specials are
  broken out below.

## Summary table

| locName | locId(s) (sample) | example coord | class | evidence (script + deciding line) |
|---|---|---|---|---|
| Ancient Gate | 2912/2913/2922/2923 (`lglockpickgate*`, `lgstrengthtrialgate*`) | 2809,9314,0 | c | `quests/quest_legends/scripts/quest_legends.rs2` `[oploc1,lglockpickgatebottoml] @open_outer_ancient_gate` (Legends quest lock/lockpick) |
| Ancient metal gate | 2255/2256 (`zombiequeengateclosed*`) | 2928,9516,0 | c | `quests/quest_zombiequeen/...quest_zombiequeen.rs2` `[oploc1,zombiequeengateclosedl] @rashtomb_open_gate` (quest state) |
| Arena Entrance | 3782/3783 (`troll_stronghold_arena_entrance_*`) | 2897,3618,0 | c | `quests/quest_troll/...quest_troll.rs2` `@open_troll_stronghold_arena_entrance` (Troll Stronghold quest) |
| Arena Exit | 3785/3786 (`troll_stronghold_arena_exit_*`) | 2916,3629,0 | c | `quests/quest_troll/...quest_troll.rs2` `@open_troll_stronghold_arena_exit` |
| Bamboo Door | 779 (`tbwt_bamboo_door`) | 2782,3057,0 | c | `quests/quest_tbwt/...quest_tbwt.rs2` `if (%tbwt_main < ^tbwt_complete) { mes("You do not have permission to enter here"); return; }` |
| Blacksmiths door | 2266 (`shilofurnacedoor`) | 2856,2963,0 | b | `areas/area_shilo/scripts/yohnus.rs2` — exit side plain; entry side `@shilofurnaceowner_blacksmiths` (NPC chat) |
| Cell Door | 3763 (`troll_celldoor`, cat `door_closed`) | 2855,10055,1 | a | generic `[oploc1,_door_closed]` (`scripts/doors/scripts/doors.rs2`) |
| Cell door | 3463 (`pip_prisondoor`) | 3415,3489,2 | c | `quests/quest_priestperil/...trapped_drezel.rs2` `if (%priestperil >= ^priestperil_unlocked_drezel) {...} else { mes("The cell door is locked shut."); }` |
| City gate | 2786–2789 (`ogreguardgate*`) | 2504,3062,0 | c | `quests/quest_itwatchtower/...quest_itwatchtower.rs2` `@open_gutanoth_gate` → guard dialogue unless `%gutanoth_gold`/`%itwatchtower` reached |
| Curtain | 1528 (`loc_1528`) | 3119,3105,0 | a | `areas/area_alkharid/scripts/misc_locs.rs2` `[oploc1,loc_1528] loc_change(loc_1529, 200)` |
| Door | 111 configs (`loc_*`, `alidoor`, `_haunted_door`, ...) | 2191,4961,0 | a (mostly) | generic `_door_*` handlers; embedded specials broken out below (haunted_door, alidoor, arena_*, capt_siad_cell_door) |
| Gate | 69 configs (`loc_*`, `border_gate_toll_*`, ...) | 2380,3425,0 | a (mostly) | generic `_gate_*`/`_door_*`/`double_door_*` handlers; embedded specials below (toll, hemenster, sheepherder, ball_irongate, outpost, varrock, shipyard, rat_pit_cage) |
| Guild Door | 2647 (`crafting_guild_door`) | 2933,3289,0 | c | `skill_crafting/scripts/crafting_guild/crafting_guild.rs2` `if (stat(crafting) < 40)...` + `if (inv_total(worn, brown_apron) < 1)...` |
| Keep gate | 2199/2200 (`keepgate_closed*`, cat `observatory_dungeon_gate`) | 2390,9457,0 | c | `quests/quest_itgronigen/...quest_itgronigen.rs2` `if(%itkeepgatelock = 0 & coordz(coord) > coordz(loc_coord)) { mes("The gate is locked."); return; }` |
| Large door | 21 configs (`loc_*`, `keep_lefaye_door`, ...) | 2009,4747,0 | a (mostly) | generic `door_*`/`double_door_*`; embedded special `keep_lefaye_door` (Merlin's Crystal) below |
| Legends Guild door | 2896/2897 (`legendsguilddoor*`) | 2728,3373,0 | c | `quests/quest_legends/scripts/legends_door.rs2` `if (%legendsquest >= ^legends_returned_to_radimus) {...} else { mesbox("You need to complete the Legends Guild Quest...") }` |
| Magic door | 2407 (`zanarismagicdoor`) | 2874,9750,0 | a | `areas/area_entrana/scripts/entrana_dungeon.rs2` `p_telejump(...)` — unconditional transport |
| Magic guild door | 1600/1601 (`magicguild_door_*`) | 2584,3087,0 | c | `areas/area_yanille/scripts/magic_guild.rs2` `if($entering = true & stat(magic) < 66) {... "You need a magic level of 66."}` |
| Metal gate | 2259/2260 (`zqshilogateclosed*`, cat `shilo_metalgate`) | 2875,2952,0 | b/c | `quests/quest_zombiequeen/...` `[oploc1,_shilo_metalgate]` — quest-complete plain else danger `~p_choice2` dialogue |
| Mine door entrance | 2675/2676/2690/2691 (`thttmine*`) | 3278,9426,0 | c | `quests/quest_desertrescue/...quest_desertrescue.rs2` `@open_camp_door` (Desert Rescue quest) |
| Prison Door | 79/80/2881 (`alidoor`, `arena_jeremydoor`, `arena_prisondoor`) | 2589,3142,0 | c | `alidoor`: `quest_prince` one-side `mes("The door is locked.")`; arena doors: `mes("...securely locked.")` (no open path) |
| Prison door | 2143/2144/2689/2692 (`capt_siad_cell_door`, `cauldrondoor*`, `shantay_prisondoor`) | 2889,9830,0 | b/c | `capt_siad`: locked; `cauldrondoor`: Taverley dungeon suit-of-armour trigger; `shantay_prisondoor`: 5-gp jail fine dialogue (see Needs review) |
| Solid black door | 4108 (`shadelair_blackdoor`) | 3465,9667,0 | c | `minigames/game_mortton/...mortton_catacombs.rs2` `if(inv_totalcat(inv, category_114)=0 & inv_totalcat(inv, category_115)=0){ mes("You need a key...") }` |
| Solid bronze door | 4106 (`shadelair_bronzedoor`) | 3479,9723,0 | c | same file; key-category gated (Shades of Mort'ton minigame) |
| Solid silver door | 4109 (`shadelair_silverdoor`) | 3461,9693,0 | c | same file `if(inv_totalcat(inv, category_115)=0){ mes("You need a key...") }` |
| Solid steel door | 4107 (`shadelair_steeldoor`) | 3471,9710,0 | c | same file; key-category gated |
| Storeroom Door | 3810 (`eadgar_storeroomdoor`) | 2869,10085,0 | c | `quests/quest_eadgar/...quest_eadgar.rs2` quest state OR `eadgar_troll_storeroom_key` else `mes("You need to find the right key...")` |
| Strange wall | 4545/4546 (`horror_far_left/right_door`) | 2513,4627,1 | c | `quests/quest_horror/...quest_horror.rs2` right door needs all `%horror*` runes set; both are one-directional quest walls |
| Sturdy door | 2337/2339/2340/2411 (`bkfortressdoor*`, `inacbkfortressdoor`, `zanarismarketdoor`) | 3016,3514,0 | b/c | `bkfortress`: needs bronze_med_helm + iron_chainbody worn else guard chat (Black Knights' Fortress); `zanarismarketdoor`: Lost City doorman chat; `inacbk`: `mes("It's locked.")` |
| Tomb doors | 2246/2247 (`thzq_tombroom*`, cat `zqtombdoor`) | 2892,9480,0 | c | `quests/quest_zombiequeen/...` `if(%zombiequeen < ^zombiequeen_unlocked_tombdoor){ mes("This door is completely sealed...") }` + puzzle |
| Wall | 2606/3632 (`dragonsecretdoor`, `macor_maze_walllow_safe4`) | 2836,9600,0 | c | `dragonsecretdoor`: `quest_dragon` `%dragon_wall`/quest state; `macro_maze_wall_door`: random-event maze |
| Wooden gate | 2261/2262 (`zqwoodengateclosed_*`, cat `shilo_woodengate`) | 2867,2952,0 | c | `quests/quest_zombiequeen/...` `[oploc1,_shilo_woodengate]` opens only if `%zombiequeen >= ^zombiequeen_complete` else `mes("The gate won't open.")` |
| slayertower_door | 4487 (`slayertower_door`) | 3428,3535,0 | a | no config-specific `[oploc*]` and no gating category found; opens as an ordinary Slayer Tower door |
| slayertower_door_mirror | 4490 (`slayertower_door_mirror`) | 3429,3535,0 | a | same — no gating handler |

### Embedded specials inside the `Door` and `Gate` buckets

| config | in bucket | class | evidence |
|---|---|---|---|
| `border_gate_toll_left/right` (2882/2883) | Gate | b | `areas/area_alkharid/scripts/border_gate.rs2` — **already handled** in `SPECIAL_CROSSINGS` (toll gate) |
| `_haunted_door` (Ernest the Chicken lever maze) | Door | c | `quests/quest_haunted/...` opens per `%ernestlever` bit puzzle |
| `_hemenster_gate` (Fishing Contest) | Gate | b/c | `quests/quest_fishingcompo/...` needs `fishing_competition_pass` + quest state; branching dialogue |
| `_sheepherder_gate` (Sheep Herder) | Gate | c | `quests/quest_sheepherder/...` needs quest started + worn `plague_jacket`+`plague_trousers` |
| `_ball_irongate` (Witch's House) | Gate | c | `quests/quest_ball/...` needs worn `leather_gloves` else shock damage; no dialogue |
| `_outpost_gate` (Barbarian Outpost) | Gate | b | `areas/area_barbarian_outpost/...` guard barcrawl dialogue unless `%barcrawl = complete` |
| `_varrock_gate` (Varrock east) | Gate | c | `areas/area_varrock/scripts/east_gate.rs2` members gate + Biohazard-quest search that confiscates items |
| `_shipyard_gate` (Grand Tree) | Gate | c | `quests/quest_grandtree/...` opens only if `%grandtree >= ^grandtree_released_prison` |
| `_rat_pit_cage` / `_tutorial_gate` / `_tut_mining_exit` | Gate | c | `scripts/tutorial/...` gated on `%tutorial` progress (Tutorial Island) |
| `alidoor` (Prince Ali Rescue) | Door | c | `quests/quest_prince/...` one side `mes("The door is locked.")` |
| `capt_siad_cell_door` (Desert Rescue) | Door/Gate | c | `mes("The door seems to be pretty locked.")` |

## Triage result

**Zero unambiguous special gates were added.** Every conditional/dialogue gate
found is gated on one of: a **quest varp**, a **skill level**, a **worn**
equipment slot, **tutorial** progress, a **minigame key category**, or a
**branching/rejection** dialogue with no single obvious "proceed" option. None
matches the toll-gate pattern that `SpecialCrossing` currently models — a plain
**inventory** `{item, count}` fee plus one clear proceed choice that teleports you
across. So no rows were appended and no test assertions were added; the audit
report stands on its own (a valid outcome per the task brief).

Concretely, the `SpecialCrossing` schema expresses only an inventory
`requires: {item, count}` and a `dialogue.choose[]`. It cannot express "worn
apron", "magic level 66", "quest varp >= X", or "key of category N", so the
conditional gates above would need schema extensions before they could be
annotated safely.

## Needs review (candidate specials that do not fit the current model)

These are real conditional gates, but each is **ambiguous** for auto-annotation
and is intentionally left out of `SPECIAL_CROSSINGS`:

1. **Shantay Pass jail door** (`shantay_prisondoor`, part of the `Prison door`
   bucket). Closest structural match to the toll gate: a **5-gp fine** with a
   `@multi2("Yes, okay.", ..., "No thanks, ...")` choice.
   *Why not added:* the fine dialogue only fires when the player is jailed
   (`%shantay_jail_progress = ^put_in_shantay_jail` and Shantay is nearby). It is
   an escape-from-jail interaction, not a normal navigational crossing the
   pathfinder would route through. Proposed row *if* the model gains a
   "context" guard:
   `{ locName: 'Prison door', action: 'Open', requires: { item: 'Coins', count: 5 }, dialogue: { choose: ['Yes, okay.'] }, label: 'Shantay Pass jail fine' }`
   (coord to be confirmed against the jailed-side tile).

2. **Witch's House iron gate** (`_ball_irongate`, `Gate` bucket). Single clear
   requirement — **worn `leather_gloves`** — but it is a *worn* check with **no
   dialogue** and it shocks you rather than repathing. Needs a `requiresWorn`
   concept.

3. **Crafting Guild door** (`crafting_guild_door`, `Guild Door`). Clear but
   compound: **Crafting 40** *and* **worn brown apron**; rejection-only dialogue,
   no proceed option. Needs skill + worn checks.

4. **Magic Guild door** (`magicguild_door_*`). **Magic level 66**; rejection-only
   dialogue. Needs a skill check.

5. **Fishing Contest gate** (`_hemenster_gate`). Needs `fishing_competition_pass`
   *and* an active-competition quest state; branching dialogue with no single
   proceed option.

6. **Shades of Mort'ton catacomb doors** (`Solid black/bronze/silver/steel
   door`). Require a **key of a specific category** (`category_113/114/115`);
   minigame-internal, no dialogue. Needs a key-category concept.

7. **Quest-varp gates** (all the rest: Ancient Gate/Legends, Ancient metal/Wooden/
   Metal/Tomb gates & doors/Zombie Queen, Arena Entrance-Exit/Troll Stronghold,
   Bamboo/TBWT, Cell door/Priest in Peril, City gate/Watchtower, Keep gate/
   Observatory, Large door keep_lefaye/Merlin's Crystal, Legends Guild door,
   Mine door entrance/Desert Rescue, Strange wall/Nature Spirit, Sturdy door/
   Black Knights' Fortress & Lost City, Wall/Dragon Slayer, Varrock east/Biohazard,
   Shipyard/Grand Tree, Prison Door/Prince Ali & Fight Arena, tutorial gates).
   All open only past a specific quest/tutorial varp; multi-step and out of scope
   for a simple crossing annotation.

## Verification

Because no code rows were added, the verification surface is unchanged. The
existing unit test (`test/bot/nav/specialCrossings.test.ts`) and the live toll-gate
proof remain the coverage. `bun test test/bot/nav/specialCrossings.test.ts` PASS
and `npx tsc --noEmit -p tsconfig.json` exit 0 were re-run to confirm nothing
regressed.
