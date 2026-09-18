[Manual](../README.md) › [Testing](../TESTING.md) › Seeding

# Seeding test accounts

A full AIOQuester pass must exercise **provisioning**: empty pack, tools in the bank,
min skill levels, scanBank → withdraw → enter. Pre-loading the pack and `~maxme` only
proves the mid-quest loop. Live harnesses always run against a **local** engine, so
Server debug cheats are fair game.

| Goal | How (local Server) |
|---|---|
| Item in **inventory** | engine `give bronze_pickaxe 1`, then verify the inventory count |
| Jewellery in live OD | `nav-script-routes-live` seeds charged duel/glory/games at **start** (+ top-up each leg) so HARD paths may Rub; use `JEWELLERY_ONLY=1` for isolation legs |
| Item seed after long walks | Engine `give` adds to inventory; verify the item arrived before continuing |
| Item in **bank** | `seedItemsToBank`: give notes such as `cert_bronze_pickaxe`, then deposit at a booth |
| Wipe pack | `~clearinv` / `clearinv inv` |
| Wipe bank | `~clearbank` |
| Bulk max bank | `~bank_f2p` (no dialog), blunt fixture, not a realistic low-level kit |
| Stats | `advancestat mining 20` (then clear level-up dialogs) or `statsCsv=max` |
| Tick rate | `speed 300` (2×) in cheats |

**Bank seed path** (`seedItemsToBank` in [`e2e/tutorial/harness.ts`](../../e2e/tutorial/harness.ts)):

1. Clear level-up dialogs before calling the helper; it teleports to a booth.
2. Give `cert_<obj> <qty>` for noteable items, or `<obj> <qty>` for ordinary stackables.
3. Deposit the seeded quantity and verify the inventory change and unnoted bank
   count by item ID. Existing held items are preserved with Deposit-X.

Notes fit bulk food/coal fixtures in one slot. Items without a noted form must fit
in the available pack slots. An unavailable command or failed deposit stops setup.

This path follows stock Lost City 289: the engine implements
[`give`](https://github.com/LostCityRS/Engine-TS/blob/0c7cf6555d0cf92d2348999b2fd27c6ceff5ffbf/src/network/game/client/handler/ClientCheatHandler.ts#L340),
and its [obj packer](https://github.com/LostCityRS/Engine-TS/blob/0c7cf6555d0cf92d2348999b2fd27c6ceff5ffbf/tools/pack/config/ObjConfig.ts#L212)
generates `cert_` notes. The
[289 obj names](https://github.com/LostCityRS/Content/blob/92649430fcbc83538d8c4367ecb96cee1a67a944/pack/obj.pack)
include `cert_raw_lobster` and `cert_lobster`.

[`e2e/aio-quest-test.ts`](../../e2e/aio-quest-test.ts) exposes bank seeds as a
**`bank:`** prefix on `giveCsv`:

```text
bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:coal:8
```

vs inventory-only `knife:1,hammer:1`. Display names for verification are mapped from
engine debug names inside the harness (`bronze_pickaxe` → `Bronze pickaxe`).

## See also

- [Quest harness recipes](quest-harness-recipes.md)
- [Write a harness](../how-to/write-a-harness.md)
