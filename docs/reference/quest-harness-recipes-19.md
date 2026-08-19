[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Her)

## Hero's Quest — pair harness

[`e2e/heros-quest-pair-249-live.ts`](../../e2e/heros-quest-pair-249-live.ts) runs both gangs at
once, because neither half finishes alone: `grip_attack` refuses everyone but a Phoenix member,
`pete_treasuredoor` and the candlestick chest answer only to a Black Arm member who has given Grip
the papers, and `open_and_close_door` teleports the actor rather than opening, so the Phoenix bot
crosses the side door only on the spare key its rival trades over.

```
--stage grip|armband|full   where to start and stop
--stats N                   setstat every skill to N (default 70)
--tick MS                   engine tick, default 300
--minutes N                 wall-clock budget
```

`--stage grip` is the iteration loop: it sets `%heroquest` to 11 and 4 — the two stages the Brimhaven
dance begins at — banks the Phoenix bot's bow and arrows, and skips the shopping and the gang legs,
which take ten minutes a side and are proven on their own. Both bots still start at the Varrock booth
and walk the crossing, because `ownsInventory` makes the first step a bank read and Karamja has no
bank at all.

One `browser.newContext()` per account, as for Shield of Arrav. The gang is **not** a setting of
this quest — `heroGang()` reads Shield of Arrav's `arravGang`, so a character walks the same side in
both quests; the harness sets `arravGang` per page and `heroPartner` to the other name.

Prerequisites are set rather than earned: `zanaris`, `dragonquest`, `arthur`, `qp 55` and one of
`phoenixgang 10` / `blackarmgang 4`, never both. Setting both gang varps offers a bot both sides of the
quest, which is not a state any account reaches.

Shop stock is world state, so back-to-back runs contend for it: the third field of a `stock<N>=`
line is the restock rate in ticks, and Valaine's black platelegs are 20 000 of them — nearly two
hours at `--tick 300`. The disguise names Louie in Al Kharid first for that reason, and a run that
finds a shelf empty waits rather than fails.

The bank seed is coins, lobsters and **ice gloves**. The gloves are the one seeded quest item, and
the reason is in [Hero's Quest pitfalls](../decisions/quest-pitfalls-35.md): every ladder into the
Ice Queen's lair stands on a plateau the map flags seal, so nothing can walk to the only source of
them. `--stage armband` avoids the question entirely and is the fast loop for the two-bot dance.

## Hero's Quest — items harness

[`e2e/heros-quest-items-249-live.ts`](../../e2e/heros-quest-items-249-live.ts) is the one-account
half: it sets `%heroquest` to 13, seeds an armband, and watches the eel, the feather and the
hand-in.

```
--skip-eel                 seed a cooked lava eel instead of earning it
--skip-feather             seed a fire feather instead of earning it
--stats N / --tick MS / --minutes N   as above
```

Budget it generously. The eel is nine legs deep before a line is cast: about 25 chaos druids for
the harralander, Ardougne for the vial, Port Sarim for the slime and the rod, the Jailer for the
jail key, Velrak for the dusty key, then the gate into the deep dungeon, the lava spot and the
Catherby range. The two keys are kept, so a re-run resumes at whichever of them is already banked.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Fre)](quest-harness-recipes-18.md)
- [Quest harness recipes (G)](quest-harness-recipes-11.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M)](quest-harness-recipes-6.md)
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Quest pitfalls: Hero's Quest](../decisions/quest-pitfalls-35.md)
- [Seeding test accounts](seeding-test-accounts.md)
