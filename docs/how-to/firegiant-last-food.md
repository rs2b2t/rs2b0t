[Manual](../README.md) › [Testing](../TESTING.md) › FireGiant last food

# FireGiant last food

Run this local-only regression with an engine that permits account cheats:

```sh
ENGINE_DIR=/path/to/engine bun e2e/firegiant-last-food-live.ts --base http://127.0.0.1:1080
```

The harness uses one account with Waterfall Quest complete, attack, strength
and hitpoints at 40, and a stocked Seers bank. It starts the bot at the melee
anchor with three lobsters. After the bot eats the last food it must bank within
20 seconds, with no panic line. It must then leave the dungeon, restock,
return, and gain new combat XP. Every target change must be accounted for:
a kill, a steal, adoption of the giant on the bot while no target is held,
a stall re-pick, or a new trip. A refused attack ("I'm already under attack!")
must meet an accounted re-pick or the bank yield within 8 seconds, and the
run may hold at most two.

Set `EXPECT_MODE=before` to assert the original defect. Set `PROOF_DIR` to
choose the JSON and screenshot directory. The default is
`out/firegiant-last-food`. The harness removes its isolated client after each run.
