[Manual](../README.md) › [Testing](../TESTING.md) › Live-harness boundary

# Live-harness boundary

`tools/**` may not import into `e2e/**`, directly or through a dynamic `import()`.

`tools/**` may not contain a file named `*-test.ts` or `*-live.ts`.

`e2e/**` may not contain a file matching Bun's default test patterns
(`*.test.ts`, `*_test.ts`, `*.spec.ts`, `*_spec.ts`).

Enforced by `test/tools/e2eSplitFence.test.ts`. The closure is reported by
`bun run audit:e2e-split`.

The runner lives at `e2e/runner.ts` rather than under `tools/`, because it reads
`e2e/manifest.ts` and this fence forbids the other direction. See the
[case manifest](e2e-manifest.md).

The reverse direction is allowed: `e2e/nav-script-routes-live.ts` and
`e2e/nav-script-travel-live.ts` import corpus builders under `tools/nav/`. Those
builders need no browser and carry their own unit tests, so they stay on the
tools side and are reached across the boundary.

Why the third rule: `bun test` skips the harnesses because their names use a
hyphen and Bun's patterns need a dot or an underscore. One rename would put
Playwright and a live-server dependency into the unit run.

Why a test rather than `no-restricted-imports`: membership is transitive through
the harness ABI, and ESLint globs match one specifier at a time — the same
reason the contribution boundary sits outside the ESLint config.

A fourth rule: no file under `tools/` may import `playwright`, whatever else it
imports. `e2e/clues/live-clue-sweep.ts` escaped the first draft on two counts
at once — it hand-rolled `chromium.launch` instead of importing the harness ABI,
so the closure never reached it, and its name ends `-sweep.ts`, so the suffix
rule did not match.

Why the fence checks specifiers rather than the closure: the closure drops edges
that leave its source map, which is what keeps `src/` out of it. Reading only
`tools/`, an import of `e2e/lib/harness.ts` resolves to a path outside the map,
the edge disappears, and the closure reports nothing. The first draft of this
fence was inert for that reason.

The transitive rule reads `consumersOf`, not `liveClosure().move`. `move`
includes the ABI that `e2e/` imports, which is the permitted direction, so
filtering it flags the held-back corpus builders as violations.

`SPEC` covers `from '…'`, bare `import '…'`, `import('…')` and `require('…')`,
and `resolveSpec` resolves extensionless specifiers, because
`moduleResolution: "bundler"` makes that spelling idiomatic and it typechecks.
A specifier assembled by concatenation never appears as one literal, so `mentionsAcross`
also rejects any relative literal naming an `e2e/` path. Prose naming an `e2e`
command is not a violation — only a literal starting `./` or `../` can be
concatenated into a working specifier.

| Rule | Probe |
|---|---|
| boundary | `printf "import { boot } from '../e2e/lib/harness';\n" > tools/probe-fence.ts` |
| concatenation | `printf "const s = '../e2e/lib/' + 'harness.js';\n" > tools/probe-fence.ts` |
| browser | `printf "import { chromium } from 'playwright-core';\n" > tools/probe-fence.ts` |
| suffix | `touch tools/probe-fence-live.ts` |
| unit-run | `touch e2e/probe-fence.test.ts` |

Each probe fails one named test. Delete the file afterwards.

Eleven probe forms are verified against this fence: extensionless, side-effect,
`require`, concatenated, re-export, multi-line, an `e2e/` file other than the
entry, a hand-rolled browser, a nested-directory crossing, both filename
suffixes, and both Bun test-name forms.
