[Manual](README.md) › Testing

# Testing

| Layer | What it proves | Cost |
|---|---|---|
| Unit tests (`bun test`) | the logic is right | seconds |
| Live harnesses (`e2e/*-test.ts`, `e2e/*-live.ts`) | the bot works against a live engine | minutes to hours |

## Pages

| Page | Covers |
|---|---|
| [Test suites](reference/test-suites.md) | what lives where, the collision pack |
| [Why this is testable](decisions/testability.md) | the design choices that keep logic headless |
| [End-to-end suite](how-to/e2e-suite.md) | `bun run e2e`: levels, the report, prerequisites |
| [The live-harness ABI](how-to/write-a-harness.md) | the ABI, shared helpers |
| [Write a harness](how-to/harness-shape.md) | the shape, and the end-to-end smoke |
| [Seeding test accounts](reference/seeding-test-accounts.md) | inventory vs bank cheats and their traps |
| Quest harness recipes [A–D](reference/quest-harness-recipes.md), [Dig](reference/quest-harness-recipes-15.md), [E](reference/quest-harness-recipes-4.md), [F](reference/quest-harness-recipes-2.md), [Fre](reference/quest-harness-recipes-18.md), [G](reference/quest-harness-recipes-11.md), [Haz–Hol](reference/quest-harness-recipes-8.md), [Her](reference/quest-harness-recipes-19.md), [Hor](reference/quest-harness-recipes-10.md), [I–L](reference/quest-harness-recipes-3.md), [M](reference/quest-harness-recipes-6.md), [N–O](reference/quest-harness-recipes-14.md), [P–R](reference/quest-harness-recipes-5.md), [Sea–Shades](reference/quest-harness-recipes-7.md), [Sheep–Shield](reference/quest-harness-recipes-12.md), [Tai–Temple](reference/quest-harness-recipes-9.md), [Tree–Tribal](reference/quest-harness-recipes-13.md), [U](reference/quest-harness-recipes-16.md) | per-quest seed and stage commands |
| [Quest harness method](reference/quest-harness-method.md) | what every quest harness does, whichever quest it drives |
