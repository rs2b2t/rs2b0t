# AccountLeveler combat camps

Training methods, equipment and recovery policy are in [the methods guide](ACCOUNT_LEVELER_METHODS.md).

Combat activities delegate looting to AutoFighter. Ground loot must offer Take and occupy a walkable tile. Failed pickups are skipped for 60 seconds by item ID and tile so combat can continue; the log records the item ID, position and result. Pickup confirmation checks that the selected item ID increased in the backpack. Walkable loot still uses the existing door recovery.

AutoFighter keeps an incoming attacker first, then prefers targets with an accessible path or a clear ranged/magic firing line. Blocked targets get one normal navigation attempt through doors, with a 20-second timeout. It rechecks reachability, camp bounds and target ownership afterward; a closest-tile stop outside a wall is insufficient. Blocked approaches and failed attacks skip that NPC for 30 seconds, unless it attacks us. Interruptions yield without imposing a cooldown.

## Combat camp eligibility

Melee offence uses the lower of Attack and Strength; ranged and magic use their own levels. All listed HP/offence/Defence requirements must be met. Normal combat prefers the strongest available training group unlocked by the player's actual combat level, then rotates eligible regions and samples camps randomly. It avoids the last three camps when alternatives exist and respects failure cooldowns and the Wilderness setting. Resource tasks select suitable drops independently of training groups, so high-level accounts can still gather cowhides or air talismans.

At Ranged 40, the leveler prefers the Ranging Guild archery competition for every Ranged session. It equips a usable bow and carries up to 10,000 coins, budgeting the bow separately and keeping a 200-coin reserve. The minimum trip budget is 700 coins after bow purchases, covering entry, spare arrows, travel and the reserve. The judge supplies the round's arrows, so startup shopping stops buying combat arrows at 40. Guild failures receive a cooldown; insufficient funds or a cooling guild fall back to lower combat camps. The child finishes without stopping the leveler when it cannot continue.

Ranged combat is restricted to the first three groups below, even at high combat levels. The combat-35-and-up groups are excluded until camps have verified safespots and an adapter that holds its firing position and handles looting safely. AutoFighter currently approaches blocked targets and walks to loot, so a possible safespot at a location does not qualify it. Armour, food, quest completion, resource requests and cooldowns cannot override this restriction. Melee and magic retain the full progression.

| Player combat level | Preferred targets, subject to individual stat requirements |
| --- | --- |
| Below 15 | Chickens, rats, giant rats, goblins, spiders, men/women, cows and other eligible starter camps; melee death walking without mandatory food. |
| 15–24 | Monks, barbarians/barbarian women, dwarves and Al-Kharid warriors. Prepare food first. |
| 25–34 | City guards, bears, zombies, skeletons, warrior women, chaos druids, unicorns, scorpions, Khazard troopers and soldiers. |
| 35–59 | Hobgoblins, giants and druids; moss giants, ghouls, Burthorpe guards, Gu'Tanoth ogres and Taverley baby blue dragons also require stronger individual stats and access requirements. |
| 60–79 | Lesser demons; Troll Stronghold trolls, Gu'Tanoth city guards and Brimhaven dungeon giants unlock at their higher camp minimums. These camps require lobster supplies. |
| 80+ | Lighthouse dagannoths, when Horror from the Deep is complete and the stat and food requirements are met. Otherwise use the strongest eligible lower group. |

These preference groups do not bypass Attack/Strength, Defence or HP requirements. If every stronger eligible camp is cooling down, lower groups remain available. Combat level matches the server's integer formula, including Prayer and the strongest melee/ranged/magic contribution.

| Camps | HP / offence / Defence minimum |
| --- | --- |
| Lumbridge/Falador chickens, Lumbridge/Draynor/Port Sarim goblins, Lumbridge/Edgeville men, Rimmington rats | 10 / 1 / 1 |
| Goblin Village, Lumbridge/Falador cows | 12 / 5 / 5 |
| Monastery monks, Ardougne farmer | 15 / 10 / 10 |
| Barbarian Village | 16 / 10 / 10 |
| Taverley chaos druids | 25 / 20 / 15 |
| Seers men/women, Catherby men, Ardougne men/cows/monks/goblins, Yanille men/cows | 25 / 20 / 20 |
| Ardougne guards, Khazard troopers | 30 / 25 / 25 |
| Yanille soldiers, Taverley surface druids | 35 / 30 / 30 |
| Wilderness skeletons | 30 / 20 / 20; Wilderness enabled |

### Expanded ordinary NPC camps

There are 95 combat camps. Fresh accounts have 20 eligible sites across eight regions and eight target types: Chicken, Goblin, Man, Rat, Giant rat, Spider, Giant spider and Woman. Region rotation and random site selection use each account's recent history; accounts do not follow a shared fixed route.

The following 28 sites were added from the local server content. Coordinates are the fighter's anchor, with a 12-tile target leash. Thresholds are player HP / offence / Defence, not the NPC's combat level.

| Site | Exact target | Anchor | HP / offence / Defence |
| --- | --- | --- | --- |
| Lumbridge swamp, west | Giant rat | `3195,3205,0` | 10 / 1 / 1 |
| Lumbridge swamp, south | Giant rat | `3209,3177,0` | 12 / 5 / 5 |
| South of Port Sarim | Giant rat | `2997,3193,0` | 12 / 5 / 5 |
| East Varrock | Giant rat | `3265,3382,0` | 12 / 5 / 5 |
| Southeast Varrock house | Spider | `3243,3395,0` | 10 / 1 / 1 |
| East Lumbridge | Giant spider | `3244,3234,0` | 10 / 1 / 1 |
| East of Edgeville | Giant spider | `3147,3481,0` | 10 / 1 / 1 |
| North of Shantay Pass | Spider | `3322,3140,0` | 10 / 1 / 1 |
| East Falador | Dwarf | `3019,3338,0` | 18 / 10 / 10 |
| Ice Mountain, southern foot | Dwarf | `3015,3428,0` | 25 / 20 / 20 |
| Ice Mountain, mine entrance | Dwarf | `2999,3449,0` | 25 / 20 / 20 |
| Southwest Lumbridge | Woman | `3218,3205,0` | 10 / 1 / 1 |
| East Lumbridge | Woman | `3243,3211,0` | 10 / 1 / 1 |
| Port Sarim | Woman | `3011,3236,0` | 10 / 1 / 1 |
| West Falador | Woman | `2970,3389,0` | 10 / 1 / 1 |
| Varrock square | Woman | `3223,3401,0` | 10 / 1 / 1 |
| Northeast Varrock | Woman | `3278,3499,0` | 10 / 1 / 1 |
| Catherby | Woman | `2817,3443,0` | 25 / 20 / 20 |
| West Yanille | Woman | `2566,3084,0` | 25 / 20 / 20 |
| Barbarian Village | Barbarian woman | `3079,3423,0` | 16 / 10 / 10 |
| Varrock pub | Barbarian woman | `3225,3395,0` | 16 / 10 / 10 |
| Al Kharid palace | Al-Kharid warrior | `3287,3172,0` | 18 / 10 / 10 |
| South of Falador farm | Highwayman | `3008,3276,0` | 15 / 10 / 10 |
| North of Draynor | Highwayman | `3110,3295,0` | 15 / 10 / 10 |
| Southeast Varrock woods | Unicorn | `3284,3352,0` | 25 / 20 / 20 |
| South of Edgeville | Unicorn | `3087,3452,0` | 25 / 20 / 20 |
| Al Kharid mine | Scorpion | `3299,3303,0` | 25 / 20 / 20 |
| Khazard battlefield, south | Gnome | `2532,3219,0` | 30 / 25 / 25 |

NPC IDs and combat levels come from [the NPC ID pack](https://github.com/ejtriple/rs2b2t-content/blob/1505e96cab12862c493ce63043e497530cc71068/pack/npc.pack) and [ordinary NPC definitions](https://github.com/ejtriple/rs2b2t-content/blob/1505e96cab12862c493ce63043e497530cc71068/scripts/_unpack/225/all.npc): Giant rat 86/87 (levels 3/6), Giant spider 59 (2), Spider 61 (1), Dwarf 118 (10), Woman 4–6 (2), Barbarian woman 17 (8), Al-Kharid warrior 18 (9), Highwayman 180 (5), Unicorn 89 (15), and Scorpion 107 (14). [Gnome definitions](https://github.com/ejtriple/rs2b2t-content/blob/1505e96cab12862c493ce63043e497530cc71068/scripts/areas/area_gnome/configs/gnome.npc) define IDs 66–68 as ordinary level-1 Gnome; these are distinct from Gnome troop. Their [AI handlers](https://github.com/ejtriple/rs2b2t-content/blob/1505e96cab12862c493ce63043e497530cc71068/scripts/areas/area_gnome/scripts/gnomes.rs2) retaliate against players and have no NPC-hunting behavior. Generic attacks use [the server combat handler](https://github.com/ejtriple/rs2b2t-content/blob/1505e96cab12862c493ce63043e497530cc71068/scripts/skill_combat/scripts/player/player_combat.rs2).

[The source and navigation tests](../test/scripts/accountLevelerLowLevelCamps.test.ts) read actual map spawns, require an Attack action, reject custom attack overrides, and check all nearby matching attackable NPCs. They route each anchor from Draynor, Falador and Varrock banks, then route from each anchor to nearby targets, with White Wolf Mountain and automatic low-combat danger avoidance enabled. NPC roaming and hunt ranges are also checked for stronger hostile overlap at starter sites. The NPC engine's [default roaming range](https://github.com/ejtriple/rs2b2t-engine/blob/2135d3a2a44646981ccbcafb684c65c6a507be89/src/cache/config/NpcType.ts) is used where content omits it. Nonattackable NPCs with the same name, such as the Mining Guild dwarf, are excluded just as AutoFighter excludes them.

Ice Mountain sites require stronger stats because the western mine entrance can route through the Dwarven Mine. The southern-foot anchor excludes guards across the cliff. The Varrock spider anchor keeps the camp leash north of the dark-wizard hunting area. Both Draynor forest spider candidates were rejected because a bear's roaming area overlaps the leash. Al Kharid spiders are north of Shantay Pass and clear of the scorpion spawns; scorpions and warriors are separate, food-carrying training tiers.

Imps remain excluded because [their server script](https://github.com/ejtriple/rs2b2t-content/blob/1505e96cab12862c493ce63043e497530cc71068/scripts/npc/scripts/imp.rs2) can teleport them 20 tiles. Hidden rock crabs, poison targets, Port Sarim prison rats, Champions' Guild chickens and Lucien's house rats are not selected. Quest-gated camps require their declared quests complete. Static source and path checks do not replace live testing of crowding, wandering, doors and combat behavior.

Delegated AutoFighter keeps loot within the camp leash plus four tiles. Returning to the anchor gets a 90-second walk attempt and succeeds only after the player is within three tiles. A failed return finishes only the child activity so AccountLeveler resets or replans; it does not stop the parent.

Western travel carries 200 coins for boats and avoids White Wolf Mountain. New western skilling choices require Attack/Strength/Defence 20, HP 25 and 12 food already available; initial food gathering keeps the starter routes to avoid a circular supply requirement.

Melee trains without mandatory food only below combat level 15. It chooses local low-level camps and death walks from the bank without treating deaths as camp failures. On reaching combat 15, it finishes the current fight, clears the old death-walk plan, and returns to the nearest bank to prepare food and stronger targets. Queued or retry plans also get replaced at this boundary. Other combat carries 12 food and maintains a stock target of 24. Banked lobster, salmon and trout take precedence over shrimp. Otherwise it produces trout when Fishing 20/Cooking 15 are available, or fishes and cooks shrimp. Banked raw fish skip fishing; enough cooked food skips both steps.

### Stronger training camps

The 18 additional sites in [trainingCamps.ts](../src/bot/scripts/AccountLeveler/trainingCamps.ts) use exact server NPC names and variants. `Giant` is the level-28, 35-HP NPC.

| Targets | Locations | NPC level / HP | Player combat minimum; HP / offence / Defence |
| --- | --- | --- | --- |
| Guard | West/east Varrock, Varrock palace, north/south Falador | 21 / 22 | 25; 22 / 15 / 15 |
| Bear | West Lumbridge, east Varrock woods, west Ice Mountain | 19–21 / 25–27 | 25; 22 / 15 / 15 |
| Zombie | Varrock sewers | 13 / 22 | 25; 22 / 15 / 15 |
| Skeleton | Edgeville dungeon | 21 / 24 | 25; 22 / 15 / 15 |
| Warrior woman | North Varrock palace | 24 / 20 | 25; 25 / 20 / 20 |
| Hobgoblin | Northwest Rimmington; Wilderness hobgoblin area | 28 / 29 | 35; 27–28 / 20 / 20 |
| Giant | North Yanille, Edgeville dungeon, eastern Wilderness | 28 / 35 | 35; 28 / 20 / 20 |
| Moss giant | Northwest Ardougne | 42 / 60 | 40; 35 / 30 / 30 |
| Guard | Burthorpe | 37 / 40 | 40; 30 / 25 / 25 |

Both Wilderness sites require Wilderness training enabled. [Training camp audits](../test/scripts/accountLevelerTrainingCamps.test.ts) verify exact variants, stats, Attack actions, nearby aggressive threats, poison, ordinary attack handlers and routes from three banks plus each camp's target spawns. Variants that can wander into the camp are included. Edgeville giants use the dungeon entrance without a brass key. Brimhaven island moss giants and an inaccessible Edgeville zombie location were rejected in that audit. These are source and navigation checks, not live combat verification at every camp.

### Additional regions and dungeon camps

The 19 camps in [advancedCamps.ts](../src/bot/scripts/AccountLeveler/advancedCamps.ts) declare quest completions, route skills, supplies, food, floor and target radius where needed. Completed quests unlock camps even when automatic questing is disabled. Missing route skills or unavailable supplies exclude the camp before tier selection. Required lobster supplies must be banked or producible with the account's current Fishing/Cooking levels.

| Camp | Combat minimum; HP / offence / Defence | Access and preparation |
| --- | --- | --- |
| Brimhaven pirates | 25; 25 / 20 / 20 | 200 travel coins |
| Brimhaven thieves | 25; 22 / 15 / 15 | 200 travel coins; eastern anchor excludes guard dogs |
| West Falador, Edgeville and south Varrock guards | 25; 22 / 15 / 15 | Ordinary guard variants |
| Varrock palace upper guards | 25; 25 / 20 / 20 | Floor 1 |
| North Ardougne guards | 25; 30 / 25 / 25 | 200 travel coins; six-tile target radius |
| West Khazard battlefield troopers | 25; 30 / 25 / 25 | 200 travel coins; eight-tile target radius excludes the commander |
| Crandor moss giants | 50; 40 / 35 / 35 | Dragon Slayer; 200 travel coins |
| Ghouls southwest of Canifis | 40; 35 / 30 / 30 | Priest in Peril; five-tile target radius excludes Ghasts |
| Gu'Tanoth ogres | 50; 40 / 35 / 35 | Watch Tower; Agility 25; 200 coins includes the chasm toll; two-tile target radius excludes chieftains |
| Southern Taverley baby blue dragons | 55; 50 / 40 / 40 | Owned Dusty key and equipped Dragonfire shield; lobsters; four-tile target radius; melee and magic only |
| Karamja volcano lesser demons | 60; 50 / 45 / 45 | Lobsters; 200 travel coins; no Dragon Slayer requirement |
| Crandor lesser demons | 60; 50 / 45 / 45 | Dragon Slayer; lobsters; 200 travel coins |
| Troll Stronghold outdoor trolls | 65; 55 / 50 / 50 | Troll Stronghold; Agility 15; owned Climbing boots, equipped; lobsters |
| Gu'Tanoth city guards | 65; 55 / 50 / 50 | Watch Tower; Agility 25; 200 coins includes the chasm toll; lobsters |
| Brimhaven dungeon moss giants | 65; 55 / 45 / 50 | Woodcutting 27; Bronze axe; 1,200 travel coins; lobsters; five-tile target radius |
| Brimhaven dungeon fire giants | 75; 60 / 55 / 55 | Woodcutting 10; Agility 12; Bronze axe; 1,200 travel coins; lobsters; six-tile target radius |
| Lighthouse dagannoths | 80; 65 / 60 / 60 | Horror from the Deep; lobsters; both level-74 and level-92 variants share the camp |

Lesser demons are excluded from Prayer objectives because they drop ashes. Brimhaven dungeon thresholds account for nearby level-63 wild dogs. Travel reserves are excluded from equipment shopping budgets; AutoFighter keeps travel tools and replenishes coins/items at bank visits before returning. A failed refill finishes the child activity at the bank so AccountLeveler can replan or resupply.

Baby blue dragons use the southern three-spawn cluster at (2897,9765). The camp excludes adult dragons, but the bank route crosses their room, so the shield is required for transit. Ranged is excluded because the leveler's bows displace the shield. No quest completion is required when the key and shield are already owned. AutoFighter loots and buries Babydragon bones, including when Prayer is the objective.

Navigation pays Saniboch and settles his dialogue before entering Brimhaven dungeon, checks the directional vine requirements, uses the completed-quest Lighthouse doorway and ladder destinations, and unlocks Taverley's deep dungeon gate with the Dusty key. Camp audits check source NPC variants and handlers, hunter envelopes including the extra four-tile loot radius, and routes from three banks to the anchor, back to the banks, and to target spawns. These checks do not establish live XP rates or food consumption.

Kalphite workers remain deferred: the entrance lands within a poisonous soldier's roaming/hunting envelope, and the leveler does not handle antipoison. Navigation now supports attaching the entrance rope and climbing down, but this does not enable a training camp. Soldiers and guardians are also excluded. The northern Canifis ghoul cluster is excluded because a nearby leech drains skills. Death Plateau trolls are excluded because throwers and stronger named trolls overlap the area. Upper-floor Brimhaven fire giants and other dungeon monsters remain outside the catalog pending route and threat audits.

