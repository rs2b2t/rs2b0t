<!-- Quest supplies: withdrawals, inventory clearing, coins and food. -->

# Quest provisioning

[`engine/provisioning.ts`](../../src/bot/api/ai/quests/engine/provisioning.ts) assembles what a
quest needs **before** it starts, bank-first:

| Function | Job |
|---|---|
| `shouldFreshenPack(...)` | whether the quest opens by banking the pack to nothing |
| `planProvisioning(...)` | what to withdraw, given the record's items and what is held |
| `depositPlan(inv, keep)` | what to drop before starting |
| `gpShort(snap, estGp)` | how much coin is missing for a purchase |
| `floatWithdraw(...)`, `coinFloatWithdraw(...)` | withdrawing with headroom |
| `floatDrawPlan(...)`, `coinFloatPlan(...)` | how much of a float to draw, and whether it is closed |

## An empty pack per quest

`QuestEngine.freshenPack` banks all 28 slots, coin float (`COIN_FLOAT`) and food included, so
the quest's own withdrawal is the only thing that fills it. Both constants live in
`QuestEngine.ts`, and the fixed bank is `PROVISION_BANK`.

| When | Empties the pack |
|---|---|
| journal `notStarted` | yes |
| already underway | keeps quest items; trims a crowded pack at a safe bank opportunity |
| journal unread | no |
| pack already empty | no |

The session's first quest is no exception. A quest underway can
be carrying an item the server will not hand out twice: Shield of Arrav's chest reads
`inv_total(bank, arravshield1)` and Straven's `~obj_gettotal(phoenixkey2)` counts the bank, so a
swept half and store key cannot be gathered again.

For a resumed quest with four or fewer free slots, `resumePreparation` preserves untradeables,
quest materials, tools, equipment, coins, runes and potions. It deposits unrelated items and caps
ordinary food to the quest's allowance, normally eight. Quest food materials keep their required
quantities. Notes are banked in bulk; duplicate spare equipment retains one physical copy while
quest equipment and ammunition stacks are preserved. This also applies to modules declaring
`ownsInventory`.

Preparation runs near a usable bank or before a bank trip the module already requested. On the
central mainland surface (x 2944–3391, z 3200–3519), it can also walk to the nearest bank without
teleporting before the first quest action. It defers in combat and in bankless areas. Pirate rum
and Legends' filled water bowl defer cleanup because travel can destroy them. The module handles
those stages and any required equipment changes, including Entrana restrictions and Ikov's bridge
weight limit. A pack containing only protected items stays with the module's own recovery logic.

Deposits succeed only after the bank backpack snapshot confirms the unwanted items are gone.
Three failed preparation attempts block the quest with a bank or deposit failure reason.

## The food float

`FOOD_FLOAT` (8) is what a quest carries unless it proves it needs more. Both the engine's
`food: N` declarations and the modules that provision themselves start from it; a quest that
raises it says why. A quest declaring `food: N` draws up to N once, and the float is then closed
for that quest.
Eating during the quest does not reopen it, the provisioning block re-runs every tick while a
quest is still gathering, and topping the float up sent the bot back to the bank after every
meal. A death reopens it, because the pack is gone.

## The coin float

`COIN_FLOAT` (1000) is walking-around money unless a module names another figure. The engine
draws it once, then latches it the same way as food: a 10gp gate while a gather is still
outstanding must not emit `withdraw Coins`. Death, complete, and skip clear the latch.

Cook's Assistant and Sheep Shearer set `coinFloat: 0`. Neither spends anything, so a default
float would still send the first provision trip to the bank for money the quest never uses.

Two rules that are easy to get wrong:

- **A quest that buys anything must keep `coins` in its `tools`.** Omit it and the
  provisioner does not carry coin, so every purchase step parks with "need gp".
- Quest-internal consumables are not `record.items`. The record lists what the quest
  *requires*; things consumed along the way are the module's own business. The engine walks
  the list again on every session start and after every death, so a listed consumable is
  re-fetched by any run resumed past the leg that spent it. Dragon Slayer's Oracle charms
  were, with the map already in Ned's hands.

## Strike spells

Fight Arena, Witch's House, The Grand Tree and Lost City provision 150 casts before their boss
fights. [`strike.ts`](../../src/bot/api/ai/quests/strike.ts) chooses the strongest Strike the
Magic level permits, withdraws available bank stacks, and buys the missing runes from Betty.
Rune stacks survive quest inventory clearing. Combat can use a weaker Strike if its runes are
all that remain; it never switches to melee when runes run out.

Waterfall uses cakes independently of the global food setting. It preserves partial cakes and
uses banked supplies before stealing from the Ardougne cake stall. Stall bread and chocolate
slices count toward the same food loadout.

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

Goblin Diplomacy checks banked mail and dye ingredients before gathering. When mail still needs
farming, it equips the best usable carried or banked melee weapon, including two-handed swords,
and clears space for displaced equipment. It selects reachable targets before attacking. Its
combat loop tracks an encounter through death
or a bounded stall, resumes attacks after eating, and keeps incoming damage separate from
the player's own attack progress.

## See also

- [Quest engine](quest-engine.md)
- [Quest eligibility](quest-eligibility.md)
- [Add a quest](../how-to/add-a-quest.md)
