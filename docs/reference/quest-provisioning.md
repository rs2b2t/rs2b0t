<!-- Assembling a quest's pack: what to withdraw, when the pack is emptied, and the coin and food floats. -->

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
| `foodFloatPlan(...)` | how much food to draw, and whether the float is closed |

## An empty pack per quest

`QuestEngine.freshenPack` banks all 28 slots, coin float (`COIN_FLOAT`) and food included, so
the quest's own withdrawal is the only thing that fills it. Both constants live in
`QuestEngine.ts`, and the fixed bank is `PROVISION_BANK`.

| When | Empties the pack |
|---|---|
| journal `notStarted` | yes |
| already underway | no, the pack may hold the only copy of something |
| journal unread | no |
| pack already empty | no |

The journal is the only gate, and the session's first quest is no exception. A quest underway can
be carrying an item the server will not hand out twice: Shield of Arrav's chest reads
`inv_total(bank, arravshield1)` and Straven's `~obj_gettotal(phoenixkey2)` counts the bank, so a
swept half and store key are gone for good. A resumed quest can also be standing with no route back
to a bank. Emptying a pack the quest owns costs more than the junk it clears, and the module's own
`ownsInventory` deposits are what tidy a resumed pack instead.

Three failed bank trips and the quest starts on the pack as it stands rather than deadlocking.

## The food float

`FOOD_FLOAT` (8) is what a quest carries unless it proves it needs more. Both the engine's
`food: N` declarations and the modules that provision themselves start from it; a quest that
raises it says why. A quest declaring `food: N` draws up to N once, and the float is then closed
for that quest.
Eating during the quest does not reopen it, the provisioning block re-runs every tick while a
quest is still gathering, and topping the float up sent the bot back to the bank after every
meal. A death reopens it, because the pack is gone.

Two rules that are easy to get wrong:

- **A quest that buys anything must keep `coins` in its `tools`.** Omit it and the
  provisioner does not carry coin, so every purchase step parks with "need gp".
- Quest-internal consumables are not `record.items`. The record lists what the quest
  *requires*; things consumed along the way are the module's own business. The engine walks
  the list again on every session start and after every death, so a listed consumable is
  re-fetched by any run resumed past the leg that spent it. Dragon Slayer's Oracle charms
  were, with the map already in Ned's hands.

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

## See also

- [Quest engine](quest-engine.md)
- [Quest eligibility](quest-eligibility.md)
- [Add a quest](../how-to/add-a-quest.md)
