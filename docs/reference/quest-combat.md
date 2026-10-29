<!-- Quest combat: spell supplies, prayer upkeep and weapon selection. -->

# Quest combat

## Strike spells

Fight Arena, Witch's House, The Grand Tree and Lost City provision 150 casts before their boss
fights. [`strike.ts`](../../src/bot/api/ai/quests/strike.ts) chooses the strongest Strike the
Magic level permits, withdraws available bank stacks, and buys the missing runes from Betty.
Rune stacks survive quest inventory clearing. Combat can use a weaker Strike if its runes are
all that remain; it never switches to melee when runes run out.

Witch's House equips a held or banked usable fire staff before provisioning Fire Strike. If fire
runes are short, it can buy a Staff of fire from Zaff. A complete rune supply or insufficient
staff funds keeps the rune path available. Casting and provisioning both account for the
equipped staff's elemental runes.

Fight Arena lures around the northern rock, Grand Tree uses the root passage, and Witch's
House uses the southern gap for the bear and a northeast corner lure for the wolf. Its first
two forms use ordinary Strike casts. Casting disables retaliation and staff autocast, removes
melee equipment, and checks position, range and line of sight before each cast. Lost City keeps
its existing Tree Spirit lure.

## Prayer

A quest declaring `pray: { protect, potions }` holds that protection prayer through its fights.
One op per tick: food first, then prayer, because the server drops the rest. Quest fights come in
three shapes and `prayerUpkeep()` is called from each:

| Fight shape | Called from | Quests |
|---|---|---|
| a step that returns to the engine each pass | `QuestEngine` tick | Dragon Slayer, Witch's House |
| a loop that already runs `Sustain` | the quester's `Sustain` hook | Fight Arena, Heroes' Quest, Horror from the Deep, Troll Stronghold |
| a loop that owns the bot for minutes | the loop itself | Fremennik Trials, Underground Pass (via `driveUntil`), Vampire Slayer |

| Situation | Action |
|---|---|
| in combat, points at `PRAYER_FLOOR`, a dose held | drink |
| in combat, protection down and available | raise it |
| the fight ends | drop it, held through the walk out it empties the flask |
| Prayer below the prayer's level | log once, fight on food alone |

Doses join the float like food, drawn once. Declared only on the nine quests above, whose fights
threaten the account. Lost City, Scorpion Catcher and Legends drive prayer inside their own fight
loops and declare nothing here.

## Weapons

No quest names a weapon. [`quests/weapons.ts`](../../src/bot/api/ai/quests/weapons.ts) derives the
table from `ITEM_DB`, so every one-handed melee type the item db knows is offered at every tier,
and a quest asks only for "a weapon".

| Tier | Attack | Also needs |
|---|---|---|
| Dragon | 60 | Lost City for the longsword and dagger, Hero's Quest for the battleaxe and mace |
| Rune | 40 | |
| Adamant | 30 | |
| Mithril | 20 | |
| Black | 10 | |
| Steel | 5 | |
| Iron, Bronze | 1 | |

The level buys the tier; within a tier any type will do. `tier60.rs2` gates dragon melee on a quest
as well as the level, so a level check alone withdraws a weapon the wield is refused for and the
quest fights bare-handed. `snap.attack` carries the level, the way `snap.prayer` carries points.

Goblin Diplomacy checks banked mail and dye ingredients before gathering. Missing redberries
get one purchase attempt at Wydin, then ground gathering southeast of Varrock; shared shop
stock cannot trap the quest in repeated purchase attempts. When mail still needs
farming, it equips the best usable carried or banked melee weapon, including two-handed swords,
and clears space for displaced equipment. It selects reachable targets before attacking. Its
combat loop tracks an encounter through death or a bounded stall, resumes attacks after eating, and keeps incoming damage separate from
the player's own attack progress.

Merlin's Crystal excludes the Wilderness north of the Chaos temple approach on both altar
journeys. This prevents the Ardougne lever shortcut through poison spiders. A blocked route
returns to the quest engine without an unrestricted scene-walking fallback.
The crystal step waits for the shatter result and recognizes the already-freed dialogue after
the crystal respawns, then proceeds to King Arthur instead of repeating the altar journey.

## See also

- [Quest provisioning](quest-provisioning.md)
- [Quest engine](quest-engine.md)
