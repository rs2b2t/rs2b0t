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

Waterfall uses cakes independently of the global food setting. It preserves partial cakes and
uses banked supplies before stealing from the Ardougne cake stall. Stall bread and chocolate
slices count toward the same food loadout.

Near the Ardougne bank and stall, Waterfall finishes stocking eight foods. During travel, it
refills at three or fewer. Cake healing waits through eating cooldowns and verifies consumed
portions; the hostile crate uses a bounded health target while the safe ledge requires full HP.

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

## See also

- [Quest combat](quest-combat.md)
- [Quest engine](quest-engine.md)
- [Quest eligibility](quest-eligibility.md)
- [Add a quest](../how-to/add-a-quest.md)
