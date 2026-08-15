[Manual](../README.md) › [Testing](../TESTING.md) › Seeding

# Seeding test accounts

A full AIOQuester pass must exercise **provisioning**: empty pack, tools in the bank,
min skill levels, scanBank → withdraw → enter. Pre-loading the pack and `~maxme` only
proves the mid-quest loop. Live harnesses always run against a **local** engine, so
Server debug cheats are fair game.

| Goal | How (local Server) |
|---|---|
| Item in **inventory** | engine `give bronze_pickaxe 1` (prefer) or content `~item bronze_pickaxe 1` (needs `p_finduid` — silent no-op after long walks) |
| Jewellery in live OD | `nav-script-routes-live` seeds charged duel/glory/games at **start** (+ top-up each leg) so HARD paths may Rub; use `JEWELLERY_ONLY=1` for isolation legs |
| Item seed after long walks | Prefer engine **`give`** over `~item` (`~item` needs `p_finduid` and silent-no-ops when busy) |
| Item in **bank** | engine `givebank bronze_pickaxe 1` (or content `~bankitem bronze_pickaxe 1`) |
| Wipe pack | `~clearinv` / `clearinv inv` |
| Wipe bank | `~clearbank` |
| Bulk max bank | `~bank_f2p` (no dialog) — blunt fixture, not a realistic low-level kit |
| Stats | `advancestat mining 20` (then clear level-up dialogs) or `statsCsv=max` |
| Tick rate | `speed 300` (2×) in cheats |

**Bank seed path** (`seedItemsToBank` in [`e2e/tutorial/harness.ts`](../../e2e/tutorial/harness.ts)):

1. `givebank <obj> <qty>` for each item (engine `ClientCheatHandler` — no busy-guard).
2. If verify fails, retry with `~bankitem` (content debugproc; needs `p_finduid`).
3. Tele next to a booth, open it once, assert `Bank.count(displayName)`.

Do **not** invent give→deposit loops for food/coal: backpack unstackables fill the
pack and the seed stalls. Direct bank cheats skip that entirely.

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
