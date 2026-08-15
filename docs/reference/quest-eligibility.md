[Manual](../README.md) › [Quests](../QUESTS.md) › Eligibility

# Quest eligibility

[`EligibilityEvaluator`](../../src/bot/api/ai/quests/EligibilityEvaluator.ts) reports each quest
as `DONE`, `READY`, or `BLOCKED` **with reasons**, combining
[`RequirementChecker`](../../src/bot/api/ai/quests/RequirementChecker.ts) (quest points, skill
levels, prerequisite quests) and [`ItemChecker`](../../src/bot/api/ai/quests/ItemChecker.ts)
(inventory and bank).

Items are `mustHave` or `acquirable` — the difference between "you cannot start this"
and "the bot will go and get it". `AIOQuester` consumes eligibility to choose what to run.

### Bot-proven floors (polish goal)

`data/quests.ts` lists **server / wiki gates** only (e.g. Elemental Workshop mining
20). Many quests still need combat, food, or gear the server does not gate.

**Polish iteration goal for every quest with non-required combat (or similar):**

1. Green mid-quest loop (often max stats + ideal kit) — proves the script path.
2. Realistic bank-seed + **official skill mins**, then probe **bare-minimum** for
   non-required stats (combat, etc.) via headed harness — lower until red, keep
   the lowest green profile in module constants.
3. Record failed floors too (so we do not re-probe known deaths forever).
4. Later: **power-level tactics** (safespot / kite / skip-fight vs melee) chosen
   from the same snapshot skills, so low accounts still clear without grinding.

Optional `warnReadiness(): string | null` runs **once** when a quest becomes the
active runner. Soft advisory if the account is below a proven floor (or if no
low floor is proven yet) — not a queue block.

Elemental Workshop reference constants
([`supplies.ts`](../../src/bot/api/ai/quests/defs/elementalworkshop/supplies.ts)):

| Constant | Role |
|---|---|
| `EW_OFFICIAL_SKILLS` | Server gates (20 mining / smithing / crafting) |
| `EW_PROVEN_COMBAT_FLOOR` | Lowest green headed combat (**50/50/40/50**, bank seed) |
| `EW_FAILED_COMBAT` | Known red (40/40/25/40 died on Water elemental) |
| `EW_PROBE_COMBAT` | Next lower search (45/45/30/45) |

Harness recipes and bank seeding: [Testing](../reference/seeding-test-accounts.md).

## See also

- [Quest engine](quest-engine.md)
