[Manual](../README.md) > Shades of Mortton

# ShadesOfMortton

Select **ShadesOfMortton** in the script library. There is one automatic loop: obtain a silver access key, prepare sacred oil, collect one Fiyr remain per available log and oil bottle, burn the remains, and open silver chests. The cheapest colour of silver key is reserved for access and never spent on a chest.

The setup follows [Garlic's 2004scape guide](https://www.youtube.com/watch?v=DxLwWL2Qg18&t=595): ordinary noted magic logs, noted food, coins, a hammer, a tinderbox and swamp paste. Wear suitable melee equipment before starting. The script prefers a banked Flamtaer hammer, carries up to 100 noted magic logs and 300 noted lobsters, and withdraws up to 50,000 coins. It keeps four loose lobsters and replenishes them locally. Existing banked pyre logs can also be used.

Complete Shades of Mortton and Priest in Peril, unlock the Mort Myre gate, and have 80 Firemaking and at least 50 Hitpoints. Higher melee stats and armour reduce food use. Gathering replacements requires 75 Woodcutting for magic logs, 40 Fishing for lobsters and 40 Cooking to cook them. These gathering levels are checked only when the corresponding supplies run out. Keep an axe and lobster pot in the bank if gathering is needed.

A usable carried inventory starts directly. Otherwise, the script visits the bank to load supplies. It uses the best access key already available, or works up through lower shades until it obtains silver access. Bootstrap cremations also use magic pyre logs.

In Mortton, the script buys olive oil, repairs the temple as needed, sanctifies oil, and hunts enough shades for that batch. Batch size follows inventory space and available supplies. After hunting, it sells small batches of noted ordinary logs to Razmire, buys the logs back, douses them with sacred oil, and cremates the remains. It collects rewards, opens surplus silver keys, sells unwanted new chest equipment, and repeats. It preserves fine cloth, clues, resources, worn equipment and the reserved access key.

Food and optional prayer potions use the same local note exchange. Buybacks require coins and shared shop stock; the script verifies each purchase before continuing. Empty vials and rotten food are dropped to recover space. Repeated shop or temple failures stop with the current activity instead of silently changing strategy.

Razmire is woken by talking first. If serum is needed, the script uses carried serum or makes it locally from tarromin, ashes and water. Bank preparation carries serum, ashes or one loose log for this purpose. The script sanctifies serum and applies the permanent cure. This setup does not require a separate trip to Varrock.

There are two settings:

- **Use prayer potions**: uses Protect from Melee at 43 Prayer and consumes banked potions. Food remains the fallback when potions run out. The script does not make potions or flick prayers.
- **High alch valuable loot**: at 55 Magic, consumes banked nature and fire runes to alch eligible new chest equipment worth at least 1,000 coins. Otherwise, eligible equipment is sold to Razmire. The script does not produce runes.

Bank trips happen when supplies run out or protected loot fills the inventory. The script reloads banked supplies first, catches and cooks lobsters when needed, gathers magic logs, and sells logs to Arhein if shop money runs out. It then returns to the same village loop. These replacement trips take time; continued operation still requires the equipment, tools, levels and quests above.

Food shortages trigger a retreat. Death or a missing weapon stops the script. Interrupted funeral, chest and shop transactions are reconciled before another action or bank trip.

## Validation

```sh
bun test test/scripts/ShadesOfMortton*.test.ts
ENGINE_DIR=/path/to/engine bun e2e/shades-of-mortton-live.ts expedition --minutes 35
```

The local harness creates disposable accounts. `expedition` starts with ordinary magic logs, no banked oil or pyre logs, and checks a complete village cycle without a second bank visit. `prepared` starts in Mortton with a supplied inventory and checks serum, oil and the next hunt without any bank visit. `cycle` exercises existing pyre stocks. Additional modes cover progression, oil, pyre crafting, food, logs, funds, serum, individual cremations, hunting, note exchange, prayer and alchemy. Evidence is written under `out/sh<run>/proof.json` and `final.png`.
