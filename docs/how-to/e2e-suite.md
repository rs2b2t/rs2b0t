[Manual](../README.md) › [Testing](../TESTING.md) › End-to-end suite

# Run the end-to-end suite

`bun run e2e` runs the offline gates, deploys once, then runs the harnesses sequentially
and writes a report that diffs against the previous run.

## Run it

```sh
bun run e2e                     # quick
bun run e2e -- --level smart    # only what the working diff can affect
bun run e2e -- --level full     # every harness, quests included
bun run e2e -- --gates-only     # offline gates, no engine needed
bun run e2e -- --only troll,horror
bun run e2e -- --verbose        # stream every child line
```

Exit code is 1 when anything is failing, so it drives a cron or a CI job directly.

## Levels

Every level draws from [`e2e/manifest.ts`](../reference/e2e-manifest.md). Nothing globs the directory.

| Level | Contains | Rough cost |
|---|---|---|
| `quick` | offline gates plus every `vetted` case | grows as cases are confirmed |
| `smart` | offline gates plus whatever the working diff can affect | varies |
| `full` | offline gates plus `vetted`, `documented` and `unvetted` | overnight |

`quick` runs nothing until a case is promoted to `vetted`, which needs a green run recorded in `provenAt`.

`smart` reads each case's `covers`: a change under `src/bot/scripts/<X>/` selects the cases covering `<X>`, and a change under `src/bot/event/webwalk/` selects the cases covering `nav`. A change to shared code, `adapter/`, `runtime/`, `api/` or `package.json`, can reach anything, so it selects everything rather than pretending to be clever. The report states which rule fired.

`broken` and `manual` cases are in no level. Reach one with `--only`.

```bash
bun run e2e -- --list      # what each level would run; no engine needed
```

## Watching it run

| Mode | Shows |
|---|---|
| Terminal (TTY) | one status line per item, rewritten in place with elapsed seconds and the child's most recent output line |
| Piped or cron | the same line, printed every 30 seconds, so a log records progress without carriage returns |
| `--verbose` / `-v` | every line the child emits, prefixed |

Full child output always reaches `out/e2e/logs/<case-id>.log` regardless of mode.

## The report

`out/e2e/report.md`, with per-case logs in `out/e2e/logs/`.

It leads with **newly broken since the baseline**, then newly fixed, then still broken.
A suite where twelve things always fail tells you nothing; the diff against
`out/e2e/latest.json` is what identifies a regression.

The first run has no baseline, so everything failing appears under "failing, no baseline
entry".

## Prerequisites

| | |
|---|---|
| Engine | running, and matching what the harnesses expect, most default to `:8890` |
| `ENGINE_DIR` | where deploy copies to; defaults to `~/code/rs2b2t-engine` |

The deploy step rebuilds `out/botclient.js` with `TARGET=local`. A live wall serving that
same file will reject new logins until it is rebuilt with `TARGET=live`.

## Herblore route survival

Run this standalone harness against an existing local engine:

```sh
ENGINE_DIR=/path/to/engine PROOF_DIR=/path/to/proof \
  bun e2e/herblore-survival-live.ts http://127.0.0.1:1080
```

It uses a new level-3 account, ten lobsters, and fifty banked lobsters.
It collects red spiders' eggs, banks them, and returns for another egg.
The proof JSON records HP, food, position, and script status on each sample.
Check the samples for eating during travel; completing the route alone does not prove this.
Set `HP_FIXTURE=1` to drain only the test account's current HP to six during
the return walk. This avoids waiting for random spider damage. The harness
then requires an observed low-HP sample and a bite before arrival, and records
the command tick, low-HP tick, bite tick, and their positions in the proof.
The script uses its eating task during long walks and eats at the 60% HP floor
even when a full heal would not fit. The existing five-HP minimum still applies.
The harness writes a screenshot and removes its isolated client deployment.
It does not change the engine's tick speed.

## Gates judged on output

The generator drift checks print `STALE` and some then exit non-zero on an unrelated
teardown crash in the vendored audio shim. Their verdict reads the output, so a clean
generator is not reported as a regression.

## Excluded

`hosted-proof-test.ts`, `hosted-wall-test.ts` and `external-script-test.ts` need a
registered account or a second origin, so no runner can provide their environment.

## FlaxRunner bank failures

Run this local-only regression with an engine that permits account cheats:

```sh
ENGINE_DIR=/path/to/engine bun e2e/flaxrunner-bank-results-live.ts --base http://127.0.0.1:1080
```

The harness seeds one bow string per scenario. It tests an unreachable walk, a
failed bank opening after a successful walk, and a successful deposit.
Per-account teleports create the failures. The harness records API results
without replacing them. Failed prerequisites must preserve the string and trip
count. The successful deposit must remove the string and count one trip.

Set `EXPECT_MODE=before` to assert the original defect. Set `PROOF_DIR` to
choose the JSON and screenshot directory. The default is
`out/flaxrunner-bank-results`. The harness removes its isolated client after each run.

## FireGiant full-pack bank loop

Run this local-only regression with an engine that permits account cheats:

```sh
ENGINE_DIR=/path/to/engine bun e2e/firegiant-full-pack-bank-live.ts --base http://127.0.0.1:1080
```

The harness uses one maxed account with Waterfall Quest complete. It tests a
25-food restock that fills all 28 slots, and a 24-food pack at the melee
anchor with one dropped Big bones on the floor. Neither full pack may bank
before the first fight. The first scenario must reach the dungeon and gain
combat XP. The second scenario must stay in the dungeon and log a kill. It
also samples the pack every 100 ms and fails unless a sample holds 28 used
slots, 24 food and the bones before any combat XP lands, so a run where the
bones never arrive or eating comes first cannot pass.

Set `EXPECT_MODE=before` to assert the original defect. Set `PROOF_DIR` to
choose the JSON and screenshot directory. The default is
`out/firegiant-full-pack-bank`. The harness removes its isolated client after each run.

## See also

- [The live-harness ABI](write-a-harness.md)
- [Test suites](../reference/test-suites.md)
- [Brimhaven landing plank harness](brimhaven-landing-plank.md)
