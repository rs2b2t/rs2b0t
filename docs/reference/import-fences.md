[Manual](../README.md) › [Architecture](../ARCHITECTURE.md) › Import fences

# Import fences

Six fences in [`eslint.config.ts`](../../eslint.config.ts) declare the layering.

| Fence | Applies to | Allows |
|---|---|---|
| Client internals | `src/bot/**`, except `src/bot/adapter/**` and `src/bot/runtime/BotClient.ts` | the four protocol const-enums and `worldmapKeyNames` |
| DOM | `src/bot/**`, except `src/bot/panel/`, `src/bot/main.ts`, `src/bot/multibox/{DomSlotOps,ProfileChooser,SettingsPanel,TabBar,VaultPrompt,main}.ts` and `src/bot/runtime/WorkerClock.ts` | — |
| api leaf | `src/bot/api/**` | `runtime/{Settings,BotHost,Scheduler}` only — never script lifecycle |
| data inert | `src/bot/data/**` | value imports from `geometry/` only; type-only imports anywhere |
| abi surface | `src/bot/runtime/abi.ts` | `api/`, `data/`, `geometry/`, `nav/`, `adapter/`, and `runtime/{Settings,defineBot}` |
| geometry leaf | `src/bot/geometry/**` | nothing outside itself; type-only imports anywhere |

Why `api` may name three runtime modules: `Execution` needs `Scheduler`, `Game`
and `fightUpkeep` need `BotHost.tickCount`, `loadout` and `bank/bankRules` read
`SettingsStore`.

A later config block declaring `no-restricted-imports` replaces every earlier
one for its files. Each fence therefore repeats the client-internals patterns
via the shared `CLIENT_INTERNALS` constant.

Negation re-includes a path only when it sits directly under the excluded
directory.

| Group | Re-includes |
|---|---|
| `**/runtime/**` + `!**/runtime/Settings.js` | yes — directly under `runtime/` |
| `**/api/**` + `!**/api/geometry/**` | no — one level deeper |

`geometry/` sits at `src/bot/` top level for that reason; under `api/` the data
fence could not re-admit it.

Moving `Settings.ts`, `BotHost.ts` or `Scheduler.ts` into a `runtime/`
subdirectory silently voids their api-fence exemptions. Fails closed.

`abi.ts` lives inside `runtime/`, so its siblings are named `./X.js` and carry no
`runtime` segment for `**/runtime/**` to match. Its fence denies `./*` and
re-admits `./Settings.js` and `./defineBot.js`.

`abi.ts` carries one line-scoped `eslint-disable-next-line` for the Merlin
harness hooks, absent from `packages/rs2b0t-api/index.d.ts` and consumed only by
`e2e/merlin-mordred-353-live.ts`. A new quest import there still errors.

Exempt from the client fence: the protocol const-enums `ServerProt`, `ClientProt`,
`CollisionFlag` and `MiniMenuAction`, plus `mapview/worldmapKeyNames`. They are inlined
at build time and carry no runtime coupling.

Five imports carry a line-scoped `eslint-disable-next-line` with a TODO, in
`nav/pathScenePaint.ts`, `nav/worldStateLive.ts` and `ui/basemapRegen.ts` (two). They
predate the fence firing and need adapter accessors. The disables are per line rather
than per file, so a new client import in those files still errors.

## The client pattern is `#/client/*/*`, not `#/client/*`

Gitignore semantics forbid re-including a file whose parent directory is excluded. Both
`\#/client/*` and `\#/client/**` match the directory segment `#/client/io`, which makes
`#/client/io/ServerProt.js` unreachable by any `!` negation — all four exemptions start
erroring. `\#/client/*/*` matches files two levels deep and never the directory itself,
so the negations survive.

Why: a one-line prefix would otherwise be the obvious simplification, and it silently
breaks every exemption rather than failing loudly.

## The fence was inert until 2026-08-11

Every pattern began with `#` (`#/client/*`, `#3rdparty/*`, …), and ESLint compiles
`no-restricted-imports` group patterns with gitignore semantics, where a leading `#`
marks a comment line. The group was discarded at config load, so the fence never
fired once. The patterns are escaped (`'\\#/client/*'`) and it now errors.

Two bypasses survive the escape:

- `patterns` does not cover dynamic `import()`.
- The DOM fence's `no-restricted-globals` is laundered by `(globalThis as {document?: Document}).document`.

## Contribution boundary

`src/bot/scripts/<A>/**` may not import `src/bot/scripts/<B>/**`.

Enforced by `bun run audit:script-dirs`.

Why it sits outside `no-restricted-imports`: specifiers inside `scripts/` are
relative, so a sibling reads `../MossGiant/X.js` and carries no `scripts`
segment for `**/scripts/**` to match — the same reason `abi.ts` needs a `./*`
deny-list. Globs would need one pattern per directory per nesting depth. The
audit resolves the specifier and compares two paths, which holds at any depth.

`src/bot/scripts/index.ts` is exempt — the registry barrel names every bot.

Probe: add `import { rangeSupplyEmpty } from '../RockCrab/RockCrabRangeLogic.js';`
to `src/bot/scripts/ChickenKiller/CowKiller.ts`. One report, exit 1.

## Prove a fence fires before trusting it

Write the forbidden import, confirm the error, revert. A passing config proves
nothing — this fence read as correct for months while discarded at load.

Probe every rule the file set carries. A new block can leave its own rule firing
while repealing another on the same files.

| Fence | Probe |
|---|---|
| client internals | add `import { sleep } from '#/client/util/JsUtil.js';` to a file in each fenced tree |
| api leaf | add `import { ScriptRunner } from '../../runtime/ScriptRunner.js';` to `src/bot/api/game/Game.ts` |
| data inert | add a value import of `api/skills/Skills.js` to any `src/bot/data/*.ts` |
| abi surface | add `import { Supervisor } from './Supervisor.js';` to `src/bot/runtime/abi.ts` |
| geometry leaf | add a value import of `api/game/Game.js` to any `src/bot/geometry/*.ts` |

## See also

- [Architecture](../decisions/architecture.md)
- [Live-harness boundary](live-harness-boundary.md) — the `tools/` and `e2e/` split
