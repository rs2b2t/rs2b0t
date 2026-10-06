# AccountLeveler methods and equipment

The target is every enabled skill to 40. Attack, Strength and Defence come first, balancing the lowest stat, followed by the other combat skills, then skilling. Supply gathering can exceed the target to support another skill. Slayer is disabled in this game revision.

The planner checks loaded bank contents, inventory, equipment, levels, quest completion, supplier failures and available gold before choosing work. It buys tools separately from choosing resources: a better pickaxe doesn't force a switch to a higher ore. Completed resource dependencies return to their queued objective.

## Training catalog

Levels below are **selection thresholds**, which can deliberately differ from the game's minimum. Methods remain in use until the next useful threshold or the configured target. The controller returns to the bank to reconsider methods and equipment at those thresholds and between training sessions.

| Skill | Levels / preferred method | Location and supplies | Fallback / constraints |
| --- | --- | --- | --- |
| Attack | 1–4 iron scimitar; 5–19 steel; 20–40 mithril from Zeke. Use owned higher eligible scimitars. | Random eligible combat camps below; armour; Attack style. Melee below combat 15 uses no food. | Best affordable available tier. Do not request adamant/rune stock from Zeke. |
| Strength | Same weapon rules, based on Attack level. | Same camps, Strength style. | Train lowest melee stat first. |
| Defence | Same weapon rules; improve body, legs and helmet as Defence permits. | Same camps, Defence style. | Armour budget preserves money for the other kit slots. Helmets use the remaining budget after weapon, body and legs. |
| Hitpoints | Train alongside melee. If still below target, continue combat using the lowest melee stat. | Same camps and supplies. | Does not require a separate XP method. |
| Ranged | Bow gates: normal 1, oak 5, willow 20, maple 30, yew 40. Best available usable shortbow, then same-tier longbow. | Lowe stocks normal/oak bows and bronze arrows. Higher bows must already be owned. Rapid style, up to 300 bronze arrows carried. | Bronze arrows remain compatible with all selected bows. Strung bows are identified by item ID, never by display name alone. |
| Magic | Wind/Water/Earth/Fire Strike at 1/5/9/13; Wind/Water/Earth/Fire Bolt at 17/23/29/35. | Staff of air from Zaff; mind/chaos and elemental runes from Aubury/Betty. Carry up to 150 casts, reserve up to 200 casts. | Strongest usable banked spell first, then the strongest affordable refill; lower strikes remain valid. Air runes supplied by the staff. |
| Prayer | Bury bones while training combat; continue fighting if Prayer remains below target. | Same camps; AutoFighter loots and buries Bones and Big bones. | Giant camps contribute Prayer XP; no assumed dragon-bone stock. |
| Fishing | 1–19 small net; 20+ fly fishing for trout/salmon. Salmon joins the catch at 30. | Net: Draynor. Fly rod + up to 200 feathers: Seers or Barbarian Village, with local banking. | Net remains a cheap fallback below 40 if fly supplies are unaffordable/unavailable. At 40+, prepared accounts can use Catherby lobsters; fly fishing remains the fallback. Exact shrimp requests still use a net. |
| Fishing for food | Trout at 20; salmon at 30; lobster at 40 when requested by cooking. | Lobster pot at Catherby with its local bank. | No Karamja ferry loop. Lobsters can supply food or train Fishing from 40. |
| Cooking | Shrimps 1, trout 15, salmon 25, lobster 40. | CookBot, Catherby, Seers or Draynor range; 28 raw fish per batch. | Prefer the highest eligible **banked batch**, then the highest fish the account can catch. Cooking 1 never selects banked trout. |
| Mining | 1–29 copper/tin, choosing the lower bank stock; 30+ iron. | Copper/tin at Southeast Varrock; iron also at Fight Arena Mine, banking in Yanille; best usable pickaxe. | Copper/tin remain available for exact bronze-bar dependencies even above 30. Iron is deliberately delayed from its game minimum of 15 to 30. |
| Smithing | Bronze until 15; then iron if Mining is at least 30 or sufficient iron ore/bars are banked. | SmelterBot at Ardougne or Al Kharid; SmithingBot Varrock West anvil; hammer. | Bronze is sustainable when iron can't be sourced. Iron smelting can fail and consume extra ore. |
| Smithing products | Bronze dagger 1, scimitar 5, 2h sword 14, platebody 18; iron dagger 15, scimitar 20, 2h sword 29, platebody 33. | Use banked bars before smelting more; 14-bar minimum batch. | Chainbody is excluded because the delegated script's bar-count table disagrees with game content. Steel production is not selected yet. |
| Woodcutting | Trees 1–14, oaks 15–29, willows 30+. | Seers or Draynor trees, oaks and willows; nearby bank. | Normal/oak/willow log dependencies retain their exact tree type. Willows remain useful through 40; no automatic expensive-tree switch. |
| Firemaking | Normal logs 1–14, oak 15–29, willow 30+. | Firemaker at Seers or Varrock East; tinderbox. | Only upgrade when that wood can be chopped or at least 28 logs are banked; otherwise use a lower available wood. |
| Fletching | Shafts 1; normal shortbow 5/longbow 10; oak shortbow 20/longbow 25; willow shortbow 35/longbow 40. | BankFletcher cutting mode, knife, 28 matching logs. | Select a lower recipe if the wood cannot be sourced. Longbows replace shortbows when unlocked because cutting takes the same time. No bow-string dependency for cutting. |
| Crafting | Leather until 10; then pick and spin flax. Use a banked batch of leather at higher levels too. | Cowhide collection → Al Kharid tanning → LeatherCrafter with needle/thread; FlaxAIO at Seers from 10. | LeatherCrafter chooses gloves 1, boots 7, cowl 9, vambraces 11, body 14, chaps 18, coif 38. Flax is the sustainable fallback. |
| Agility | Gnome course through 40. | GnomeCourse; food. | Other existing agility scripts add hazards, travel or ticket-handling requirements; no unsupported Barbarian course assumption. |
| Thieving | Men 1–9; farmers 10–24; warrior women from 25 when western travel is eligible. | Lumbridge men; Ardougne farmer `(2645,3367)`; food, automatic banking, suicide mode off. | Warrior women in east Ardougne; farmers remain a fallback. No Wilderness rogues required. |
| Herblore | Druidic Ritual first; sustainable guam attack potions thereafter. Prefer higher recipes when both ingredients are banked. | Guam from identified/unidentified-ID-199 drops → HerbCleaner; water vials from Aemad, newts from Betty. | Druidic Ritual requires Attack/Strength/Defence 20 and HP 25 in this plan, plus equipment and food. Higher potion pairs below require 14 of each ingredient. |
| Runecraft | Rune Mysteries, then air runes through 40. | Quest with food/travel funds; EssMiner with best usable pickaxe; RuneCrafter Air/Solo with air talisman. | Goblins can supply the talisman. A reliable low-level rune method remains valid through 40. |

### Optional banked potion recipes

| Herblore | Herb | Secondary |
| --- | --- | --- |
| 3 | Guam leaf | Eye of newt |
| 5 | Marrentill | Unicorn horn dust |
| 12 | Tarromin | Limpwurt root |
| 22 | Harralander | Red spiders' eggs |
| 30 | Ranarr weed | White berries |
| 38 | Ranarr weed | Snape grass |

Higher herbs and secondaries are not automatically farmed by the current dependency graph. If a pair runs out, it replans to guam. Unfinished potions are tracked by the selected herb's item ID so a batch isn't interrupted after adding herbs to vials.

## Tools and equipment

| Tool / equipment | Use threshold | Source / fallback |
| --- | --- | --- |
| Iron pickaxe | Mining 1 | Nurmof; bronze if unavailable or unaffordable. |
| Steel pickaxe | Mining 6 | Nurmof. |
| Mithril pickaxe | Mining 21 | Nurmof. |
| Adamant pickaxe | Mining 31 | Nurmof. |
| Rune pickaxe | Mining 41 | Nurmof, relevant if supply mining exceeds 40. |
| Axes | All tiers usable from inventory at Woodcutting 1 in this revision. | Best owned rune/adamant/mithril; otherwise steel, iron, bronze from Bob. |
| Scimitars | Iron 1, steel 5, black 10, mithril 20, adamant 30, rune 40 Attack. | Owned eligible tiers; Zeke sells iron/steel/mithril. |
| Body and legs | Iron/bronze 1, steel 5, black 10, mithril 20, adamant 30, rune 40 Defence. | Bodies from Horvik; legs from Louie legs in Al Kharid `(3316,3175)`, through adamant. Owned eligible upgrades remain usable. Platebody preferred to same-tier chainbody; platelegs preferred to skirt. Rune platebody also requires Dragon Slayer. |
| Helmets | Iron/bronze 1, steel 5, mithril 20, adamant 30 Defence; owned black 10/rune 40. | Peksa in Barbarian Village `(3076,3429)` stocks full and medium helmets through adamant, excluding black/rune. Prefer a full helm within each tier; fall back when stock or gold is limited. No affordable or owned helmet means train without one. |
| Bow | Normal 1, oak 5, willow 20, maple 30, yew 40 Ranged. | Bank first where usable; normal/oak shop fallback. |
| Staff of air | Selected for magic training. | Zaff; avoids carrying air runes. |
| Fishing gear | Net 1, fly rod 20, lobster pot 40. | Gerrant; feathers provisioned for fly fishing. |
| Other tools | Recipe-dependent. | Tinderbox/hammer from general store, knife from Shantay, needle/thread from Dommik. |

Attack requirements apply to **wielding** gathering tools, independently of using them from the backpack. AccountLeveler carries its selected gathering tool; the child gathering script can wield it when allowed. It does not downgrade a usable pickaxe because Attack is too low.

Nurmof is underground at `(2997,9844)`. The navigation graph includes both the northern trapdoor and Falador stairs; the route regression test uses the actual collision pack.

### Seers market

`Try Seers market axes` enables one optional Rune axe attempt before woodcutting, only when already on World 1. It checks only while already near Seers, visits the bank and looks for the exact player `seers market`. It does not switch worlds.

The price limit is the smaller of `Market axe price limit` (default 50,000) and 10% of banked gold, with another 200 coins reserved for travel. Missing seller, missing stock, excessive price, rejected trade or timeout falls back to available tools. Quotes and both trade screens must match the seller, exact axe ID, quantity one and coin amount. Catalog-verified notes are accepted and banked before ordinary unnoted tool withdrawal.

The seller's current presence and stock are not assumed. Market behavior is covered by simulated protocol tests; no live player trades are performed by the test suite.

## Combat camp eligibility

Melee offence uses the lower of Attack and Strength; ranged and magic use their own levels. All listed HP/offence/Defence requirements must be met. Normal combat prefers the strongest available training group unlocked by the player's actual combat level, then rotates eligible regions and samples camps randomly. It avoids the last three camps when alternatives exist and respects failure cooldowns and the Wilderness setting. Resource tasks select suitable drops independently of training groups, so high-level accounts can still gather cowhides or air talismans.

| Player combat level | Preferred targets, subject to individual stat requirements |
| --- | --- |
| Below 15 | Chickens, rats, giant rats, goblins, spiders, men/women, cows and other eligible starter camps; melee death walking without mandatory food. |
| 15–24 | Monks, barbarians/barbarian women, dwarves and Al-Kharid warriors. Prepare food first. |
| 25–34 | City guards, bears, zombies, skeletons, warrior women, chaos druids, unicorns, scorpions, Khazard troopers and soldiers. |
| 35+ | Hobgoblins, giants and druids; moss giants and Burthorpe guards also require combat 40 and stronger individual stats. |

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

There are 76 combat camps. Fresh accounts have 20 eligible sites across eight regions and eight target types: Chicken, Goblin, Man, Rat, Giant rat, Spider, Giant spider and Woman. Region rotation and random site selection use each account's recent history; accounts do not follow a shared fixed route.

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

NPC IDs and combat levels come from [the NPC ID pack](../../rs2b2t-content/pack/npc.pack) and [ordinary NPC definitions](../../rs2b2t-content/scripts/_unpack/225/all.npc): Giant rat 86/87 (levels 3/6), Giant spider 59 (2), Spider 61 (1), Dwarf 118 (10), Woman 4–6 (2), Barbarian woman 17 (8), Al-Kharid warrior 18 (9), Highwayman 180 (5), Unicorn 89 (15), and Scorpion 107 (14). [Gnome definitions](../../rs2b2t-content/scripts/areas/area_gnome/configs/gnome.npc) define IDs 66–68 as ordinary level-1 Gnome; these are distinct from Gnome troop. Their [AI handlers](../../rs2b2t-content/scripts/areas/area_gnome/scripts/gnomes.rs2) retaliate against players and have no NPC-hunting behavior. Generic attacks use [the server combat handler](../../rs2b2t-content/scripts/skill_combat/scripts/player/player_combat.rs2).

[The source and navigation tests](../test/scripts/accountLevelerLowLevelCamps.test.ts) read actual map spawns, require an Attack action, reject custom attack overrides, and check all nearby matching attackable NPCs. They route each anchor from Draynor, Falador and Varrock banks, then route from each anchor to nearby targets, with White Wolf Mountain and automatic low-combat danger avoidance enabled. NPC roaming and hunt ranges are also checked for stronger hostile overlap at starter sites. The NPC engine's [default roaming range](../../rs2b2t-engine/src/cache/config/NpcType.ts) is used where content omits it. Nonattackable NPCs with the same name, such as the Mining Guild dwarf, are excluded just as AutoFighter excludes them.

Ice Mountain sites require stronger stats because the western mine entrance can route through the Dwarven Mine. The southern-foot anchor excludes guards across the cliff. The Varrock spider anchor keeps the camp leash north of the dark-wizard hunting area. Both Draynor forest spider candidates were rejected because a bear's roaming area overlaps the leash. Al Kharid spiders are north of Shantay Pass and clear of the scorpion spawns; scorpions and warriors are separate, food-carrying training tiers.

Imps remain excluded because [their server script](../../rs2b2t-content/scripts/npc/scripts/imp.rs2) can teleport them 20 tiles. Hidden rock crabs, quest-gated NPCs, poison targets, Port Sarim prison rats, Champions' Guild chickens and Lucien's house rats are not selected. Static source and path checks do not replace live testing of crowding, wandering, doors and combat behavior.

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

Both Wilderness sites require Wilderness training enabled. [Training camp audits](../test/scripts/accountLevelerTrainingCamps.test.ts) verify exact variants, stats, Attack actions, nearby aggressive threats, poison, ordinary attack handlers and routes from three banks plus each camp's target spawns. Variants that can wander into the camp are included. Edgeville giants use the dungeon entrance without a brass key. Brimhaven moss giants and an inaccessible Edgeville zombie location were rejected. These are source and navigation checks, not live combat verification at every camp.

## Budget and failure policy

Startup shopping defers Nurmof's underground shop below Hitpoints 25 or Defence 20; the tool is purchased when mining starts after combat training. Startup shopping shares a budget across the equipment and consumable list, retaining at least 200 coins or 10% of bank gold, whichever is larger. Individual provisioning trips reserve 200 coins for travel and verify inventory capacity and delivered items. Purchase budgets are conservative ceilings, not quoted NPC prices.

Startup purchase targets are ceilings: buy the available shelf stock, bank it and continue, without repeated visits to chase the target. Training accepts smaller arrow/feather/thread batches and complete sets of spell runes, with child restock quantities matched to the actual loadout. The next refill rechecks normal targets so a small purchase does not permanently shrink future batches. Empty shelves exclude the item for 60 seconds; use available alternatives or wait at the bank for a stock recheck. Unreachable vendors still allow owned gear or other available tiers.

Failures never finish the account leveler. Preparation retries from the bank twice, then discards the queued plan and replans; repeated preparation errors increase the retry delay from 3 seconds to a maximum of 60 seconds. Repeatedly failing combat or quest plans receive a 15-minute cooldown. Routine gathering resets twice, then replans after 30 seconds without cooling down food production. A combat camp that remains unreachable after navigation recovery is immediately cooled down for 15 minutes, allowing another camp to be selected.

When no method is currently possible, the leveler rechecks bank supplies and supplier availability at least every 30 seconds, or when an earlier cooldown expires. The blocking reason stays visible. Old gathering cooldowns are discarded, and the latest failure reason is saved separately from the short diagnostic history. Reaching every target still finishes successfully, and the Stop button still stops the script.

Source of truth: `src/bot/scripts/AccountLeveler/catalog.ts`, `methods.ts`, `equipment.ts`, `magic.ts`, `combat.ts`, `combatProgression.ts`, `trainingCamps.ts`, and the existing gathering-location, tool-tier, spell and shop databases. These choices use this repository's game revision, not modern OSRS requirements.
