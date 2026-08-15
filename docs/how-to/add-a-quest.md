[Manual](../README.md) › [Quests](../QUESTS.md) › Add a quest

# Add a quest

1. Add the record to [`data/quests.ts`](../../src/bot/api/ai/quests/data/quests.ts) — id, name, quest points, requirements, items.
2. Write `defs/<quest>.ts`: anchors as `Tile` constants, `NpcStop`s with `prefer`
   lists, `gather` functions for anything the bot must fetch, and a `decide()` that
   reads only the snapshot.
3. Register it in [`defs/index.ts`](../../src/bot/api/ai/quests/defs/index.ts).
4. Add a unit test for `decide()` — it is a pure function, so every branch is
   testable without a client. See [`test/api/ai/quests/`](../../test/api/ai/quests/).
5. Polish non-required stats: ideal smoke first, then realistic bank-seed, then
   **lower combat (etc.) until red** — store proven floor + failed floor + next
   probe in the module; wire `warnReadiness`; update [Testing](../TESTING.md) when
   a headed run moves the floor. Later add power-level tactics (safespots, …).
6. Prefer bank-first realistic harnesses (`givebank` / `bank:` seeds) before
   claiming the quest is done — inv+max only proves the mid-quest loop.

Start from [`defs/cooksassistant.ts`](../../src/bot/api/ai/quests/defs/cooksassistant.ts) for
the simple shape, [`defs/priestperil.ts`](../../src/bot/api/ai/quests/defs/priestperil.ts)
for one with level changes, gated doors, and a long item chain, or
[`defs/watchtower/`](../../src/bot/api/ai/quests/defs/watchtower/) for one large enough to need a
directory.

Watch Tower is also the reference for a quest whose map is **sealed pockets**. Nine

## See also

- [Quest engine](../reference/quest-engine.md)
- [Exec primitives](../reference/quest-primitives.md)
- [Quest pitfalls](../decisions/quest-pitfalls.md) — the lessons each quest paid for
