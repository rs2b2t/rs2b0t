# AccountLeveler methods and equipment

The target is every enabled skill to 40. Attack, Strength and Defence come first, balancing the lowest stat, followed by the other combat skills, then skilling. Supply gathering can exceed the target to support another skill. Slayer is disabled in this game revision.

The planner checks loaded bank contents, inventory, equipment, levels, quest completion, supplier failures and available gold before choosing work. It buys tools separately from choosing resources: a better pickaxe doesn't force a switch to a higher ore. Completed resource dependencies return to their queued objective.

## Training catalog

Levels below are **selection thresholds**, which can deliberately differ from the game's minimum. Methods remain in use until the next useful threshold or the configured target. The controller returns to the bank to reconsider methods and equipment at those thresholds and between training sessions.

| Skill | Levels / preferred method | Location and supplies | Fallback / constraints |
| --- | --- | --- | --- |
| Attack | 1–4 iron scimitar; 5–19 steel; 20–40 mithril from Zeke. Use owned higher eligible scimitars. | [Eligible combat camps](ACCOUNT_LEVELER_COMBAT.md); armour; Attack style. Melee below combat 15 uses no food. | Best affordable available tier. Do not request adamant/rune stock from Zeke. |
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

## Combat camps

See [combat eligibility and camp locations](ACCOUNT_LEVELER_COMBAT.md) for stat requirements, starter sites, stronger targets and source audits.

## Budget and failure policy

Startup shopping defers Nurmof's underground shop below Hitpoints 25 or Defence 20; the tool is purchased when mining starts after combat training. Startup shopping shares a budget across the equipment and consumable list, retaining at least 200 coins or 10% of bank gold, whichever is larger. Individual provisioning trips reserve 200 coins for travel and verify inventory capacity and delivered items. Purchase budgets are conservative ceilings, not quoted NPC prices.

Startup purchase targets are ceilings: buy the available shelf stock, bank it and continue, without repeated visits to chase the target. Training accepts smaller arrow/feather/thread batches and complete sets of spell runes, with child restock quantities matched to the actual loadout. The next refill rechecks normal targets so a small purchase does not permanently shrink future batches. Empty shelves exclude the item for 60 seconds; use available alternatives or wait at the bank for a stock recheck. Unreachable vendors still allow owned gear or other available tiers.

Failures never finish the account leveler. Preparation retries from the bank twice, then discards the queued plan and replans; repeated preparation errors increase the retry delay from 3 seconds to a maximum of 60 seconds. Repeatedly failing combat or quest plans receive a 15-minute cooldown. Routine gathering resets twice, then replans after 30 seconds without cooling down food production. A combat camp that remains unreachable after navigation recovery is immediately cooled down for 15 minutes, allowing another camp to be selected.

When no method is currently possible, the leveler rechecks bank supplies and supplier availability at least every 30 seconds, or when an earlier cooldown expires. The blocking reason stays visible. Old gathering cooldowns are discarded, and the latest failure reason is saved separately from the short diagnostic history. Reaching every target still finishes successfully, and the Stop button still stops the script.

Source of truth: `src/bot/scripts/AccountLeveler/catalog.ts`, `methods.ts`, `equipment.ts`, `magic.ts`, `combat.ts`, `combatProgression.ts`, `trainingCamps.ts`, and the existing gathering-location, tool-tier, spell and shop databases. These choices use this repository's game revision, not modern OSRS requirements.
