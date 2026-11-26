[Manual](../README.md) › [Testing](../TESTING.md) › [End-to-end suite](e2e-suite.md) › Brimhaven landing plank

# Brimhaven landing plank

Run this local-only regression with an engine that permits account cheats:

```sh
ENGINE_DIR=/path/to/engine bun e2e/brimhaven-landing-plank-live.ts --base http://127.0.0.1:1080
```

The harness sets Agility 75 and Hitpoints 40, gives 1000 coins and 10 lobsters,
and teleports to the arena entrance. Each later attempt tops up 1000 coins so a
restock stop cannot strand the account. It pays Cap'n Izzy and uses the entrance ladder.
The clerk rebuilds the landing plank rows on every new ticket pillar, and only one
row has no broken plank. The harness waits at the landing until the ticket arrow
points at a pillar whose shorter hop is the landing plank and the intact row is not
the middle one, which is the row the map ships with. Then it lets the script cross.
The run passes when the script walks onto the intact row, read from the client's
plank loc type ids, does not fall and gains agility XP. Set `AFTER_REBUILD=1` to
also wait until a new ticket pillar, and so a plank rebuild, appears while it watches.

Set `EXPECT_MODE=before` to assert the original defect: a script that always walks
the middle row falls when that row is broken. Set `PROOF_DIR` to choose the JSON and
screenshot directory. The default is `out/brimhaven-landing-plank`.
The harness removes its isolated client after each run.

## See also

- [The end-to-end suite](e2e-suite.md)
- [The live-harness ABI](write-a-harness.md)
