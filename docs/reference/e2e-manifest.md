[Manual](../README.md) › [Testing](../TESTING.md) › e2e case manifest

# e2e case manifest

`e2e/manifest.ts` lists every case the suite can run. The runner iterates it; nothing globs the directory.

## Case fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique across the manifest; names the scenario, not the harness |
| `harness` | yes | path under `e2e/`, including any subdirectory |
| `covers` | yes | `{ scripts?, subsystems? }`; at least one entry between them |
| `status` | yes | `vetted`, `documented`, `unvetted` or `broken` |
| `manual` | no | `true` keeps the case out of every level |
| `env` | no | environment for the child process, applied after `HEADED=0` |
| `args` | no | positional arguments, inserted before `--no-deploy` |
| `budgetMin` | no | minutes before the runner kills it; default 12 |
| `provenAt` | when `vetted` | commit where this case last ran green |
| `documentedIn` | when `documented` | doc path or npm script naming how to run it |
| `note` | no | what the case proves, or why it is broken |

## Status

| Status | Means |
|---|---|
| `vetted` | someone ran it green and recorded the commit in `provenAt` |
| `documented` | a doc or npm script explains how to run it; no green run on record |
| `unvetted` | neither |
| `broken` | known to fail, or asserts nothing |

Why `documented` is separate from `vetted`: a doc proves someone wrote instructions, not that the case passes. Collapsing the two states claims proof the repo does not hold.

## Levels

| Level | Runs |
|---|---|
| default, `quick` | `vetted` |
| `smart` | selected by `covers` against the working diff |
| `full` | `vetted`, `documented` and `unvetted` |
| `--only <text>` | any case whose id or harness contains the text, including `broken` and `manual` |

`broken` and `manual` cases are in no level.

```bash
bun run e2e -- --list              # what each level would run; no engine needed
bun run e2e -- --level full
bun run e2e -- --only hillgiant
```

## Selection by change

`smart` reads `covers`, not filenames.

| Changed path | Selects |
|---|---|
| `src/bot/scripts/<X>/**` | every case covering `<X>` |
| `src/bot/event/webwalk/**` | every case covering `nav` |
| `src/bot/multibox/**` | every case covering `multibox` |
| `src/bot/api/ai/clues/**` | every case covering `clues` |
| `src/bot/api/ai/quests/**` | every case covering `quests` |
| `src/bot/panel/**` | every case covering `panel` |
| `src/bot/{adapter,runtime,api}/**`, `package.json` | everything runnable |

## Subsystems

| Subsystem | Covers |
|---|---|
| `nav` | webwalk, pathfinding, transports, corpora, path paint |
| `multibox` | wall, tabs, slots, tab renderer |
| `clues` | clue engine and trails |
| `panel` | loadout and settings surfaces |
| `quests` | the QuestEngine dispatcher |
| `random-events` | event guardian and supervisor handling |
| `world` | inline-script proofs of ledges, pipes, ropes, doors |
| `infra` | smoke, hosted wall, external script, proxy |

## Adding a case

1. Add an entry to `CASES` naming the harness and what it covers.
2. Set `status: 'unvetted'` unless a doc explains how to run it.
3. Run `bun test test/e2e/manifestFence.test.ts`.

## Promoting a case to vetted

1. Run it green against a live engine.
2. Set `status: 'vetted'` and `provenAt` to the commit you ran.
3. Drop `documentedIn` if it carried one.

A `vetted` case with no `provenAt` fails the fence.

## Validation

`test/e2e/manifestFence.test.ts` rejects each of these, one message per violation:

| Violation | Message |
|---|---|
| two cases share an id | `duplicate case id: <id>` |
| a case names a missing harness | `<id>: no such harness: <path>` |
| a case names a missing script | `<id>: no such script: <name>` |
| a case covers nothing | `<id>: covers no script or subsystem` |
| `vetted` without `provenAt` | `<id>: vetted but carries no provenAt` |
| `documented` without `documentedIn` | `<id>: documented but carries no documentedIn` |
| a harness no case names | `no case names harness: <path>` |

`SCRIPT_NAMES` in `e2e/manifestTypes.ts` is compared against `src/bot/scripts/` in both directions, so a script added with no union entry fails, and a union entry whose directory was deleted fails.

Why `SCRIPT_NAMES` is a runtime array rather than a bare type union: a type union cannot be compared against the filesystem at test time.

## See also

- [Live-harness boundary](live-harness-boundary.md)
- [The live-harness ABI](../how-to/write-a-harness.md)
