# rs2b0t manual

How the client works, how to run it, and how to write bots for it.

**Target: [rs2b2t](https://rs2b2t.com) only.** This is not an official client for the
pure Lost City or 2004scape projects and is not maintained for those targets.

## Start here

| If you want to… | Read |
|---|---|
| Write a bot | [Scripting API](API.md), then the [script template](script-template/README.md) |
| See what already exists | [Bundled scripts](SCRIPTS.md) |
| Run it locally | [Running locally](RUNNING.md) |
| Change the client itself | [Architecture](ARCHITECTURE.md), then [Testing](TESTING.md) |
| Maintain the deployment | [Dev and deploy](DEV.md) |

## Pages

| Page | Covers |
|---|---|
| [Running locally](RUNNING.md) | [the path from a cold clone](how-to/run-locally.md), and [ports](reference/ports.md) |
| [Architecture](ARCHITECTURE.md) | the layers and the ABI boundary, then [design](decisions/architecture.md), [namespaces](reference/namespaces.md) and [fences](reference/import-fences.md) |
| [Scripting API](API.md) | the surface, split by subsystem; start with [write a bot](how-to/write-a-bot.md) |
| [World-walking](NAV.md) | [pack](reference/nav-pack.md), [pathfinding](reference/nav-pathfinding.md), [doors](reference/nav-doors.md), [teleports](reference/nav-teleports.md), [walker](reference/nav-walker.md) |
| [Map tile picker](MAP-PICKER.md) | Pick on Map: display modes, then [reference](reference/map-picker.md) and [baking](how-to/bake-the-basemap.md) |
| [Quests](QUESTS.md) | [engine](reference/quest-engine.md), [primitives](reference/quest-primitives.md), [eligibility](reference/quest-eligibility.md), [adding one](how-to/add-a-quest.md) |
| [Clue scrolls](CLUES.md) | [database](reference/clues-database.md), [mechanics](reference/clues-mechanics.md), [host yielding](decisions/clue-host-yielding.md), [tracing a failure](how-to/trace-a-clue-failure.md) |
| [MultiBox](MULTIBOX.md) | the wall, then [reference](reference/multibox.md), [telemetry honesty](decisions/multibox-telemetry-honesty.md) and [diagnosis](how-to/diagnose-multibox.md) |
| [Bundled scripts](SCRIPTS.md) | catalog of the shipped bots and their settings (generated) |
| [Testing](TESTING.md) | [suites](reference/test-suites.md), [why it is testable](decisions/testability.md), [writing a harness](how-to/write-a-harness.md), [seeding](reference/seeding-test-accounts.md), [the tools/e2e boundary](reference/live-harness-boundary.md), [case manifest](reference/e2e-manifest.md) |
| [Dev and deploy](DEV.md) | the three run modes, then [live wall](how-to/run-the-live-wall.md), [build targets](reference/build-targets.md), [maintainer infra](how-to/maintainer-infra.md) |
| [Loc identity](decisions/loc-identity-model.md) | why a loc is a placement, not an ID |
| [Loc state in the client](reference/loc-identity.md) | what the client does with locs that change state, and the gaps |
| [Nav operator tools](nav/README.md) | transport coverage, client-vs-pack path paint, live nav harnesses |
| [Doc migration](MIGRATION.md) | in-progress rewrite of this manual to one-type-per-file; delete when the table is all ✅ |

---

Design specs and implementation plans are working notes, not part of this manual, and
are not committed — see `.gitignore`.
