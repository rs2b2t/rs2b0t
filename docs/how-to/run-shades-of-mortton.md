[Manual](../README.md) > Shades of Mortton

# ShadesOfMortton

Select **ShadesOfMortton** in the script library. The script progresses through access keys to Fiyr shades, burns remains with magic pyre logs and opens matching chests. One key of the highest available metal is always reserved for access.

Start with Shades of Mortton and Priest in Peril complete, access through the Mort Myre gate, 80 Firemaking, 75 Woodcutting, 40 Fishing, 40 Cooking and at least 50 Hitpoints. Wear suitable melee equipment; high melee stats and armour substantially reduce food trips. Keep a working axe, lobster pot, hammer and tinderbox in the bank. Existing food, coins, logs, oils and pyre logs are used first.

The script replenishes lobsters by fishing and cooking at Catherby, gathers magic logs at Sorcerer's Tower, buys temple materials and olive oil, repairs the temple and makes sacred oil. Low coins trigger a separate magic-log gathering trip whose logs are sold to Arhein. Selected equipment looted from chests is sold to Razmire when his store is accessible. Fine cloth, keys, swamp paste and other loot are banked. No player trade or OSRS-only item is required.

Razmire is woken by talking before spending serum. When a cure is needed, the script uses banked serum or obtains tarromin from afflicted villagers and makes serum from it, a water vial and ashes. It sanctifies the remaining serum and permanently cures him.

The default **Local** supply strategy carries up to 300 noted lobsters and noted magic pyre logs, then hunts, burns remains and opens chests without banking between every phase. Razmire converts notes through small sell-and-buy-back transactions. Each transaction checks affordability and verifies the supplies returned to the inventory. Shop stock is shared, so unavailable buybacks fall back to banked trips. **Banked** keeps the original separate batches.

Start with **Pyres per expedition: 40** and **Target hunting batch: 14**. Actual hunting batches shrink to leave space for supplies and rewards. The bot reserves its highest access key and banks protected loot when inventory space runs low. Buybacks cost coins; increasing the expedition size does not guarantee faster or more profitable runs.

**Protection: Auto** uses Protect from Melee at 43 Prayer during dungeon trips or combat. Banked prayer potions are carried, drunk when points run low and replenished from notes locally. The bot checks the dose change and restored points. Potions are optional: when they run out, food remains the renewable fallback. The script does not make prayer potions or flick prayers. Choose **Food only** to disable this support.

**Chest equipment: Sell** sells eligible new equipment to Razmire. **High alch** first casts High Level Alchemy on eligible new equipment worth at least 1,000 coins at alchemy value, using banked nature and fire runes at 55 Magic. It preserves worn gear, keys and supplies, and sells remaining eligible equipment. Runes are optional and are not produced by the script. It uses ordinary spell timing and keeps the melee weapon equipped.

Food shortages trigger a retreat; deaths or missing weapons stop the script. Random events yield to the shared event handler, then any pending funeral, chest or shop transaction is reconciled before banking. Repeated failures stop with the failing activity in the log. Check that message before restarting.

The renewable routes make continued operation possible without a stocked bank, but they take time. The script targets the highest shade tier; it does not claim an optimal XP or profit rate. Initial equipment, tools, levels and quests are prerequisites.

## Validation

```sh
bun test test/scripts/ShadesOfMortton*.test.ts
ENGINE_DIR=/path/to/engine bun e2e/shades-of-mortton-live.ts cycle --minutes 35
```

The local harness also accepts `progression`, `oil`, `make`, `food`, `logs`, `funds`, `serum`, `pyre`, `hunt`, `unnote`, `prayer`, `alchemy` and `expedition`. Each creates a disposable account and seeds the unrelated prerequisites. `cycle` checks banked cremations, chest opening and another hunting trip. `progression` starts without access keys. `make` combines partial sacred-oil bottles into eight magic pyres. `pyre` isolates two cremations and reward pickups; `hunt` isolates two Fiyr kills and remains pickups. The advanced probes check supply buybacks, a verified potion dose, an alchemy cast and a local cycle with no second bank visit. Evidence is written under `out/sh<run>/proof.json` and `final.png`.
