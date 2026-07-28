# RTFM pass — design

**Date:** 2026-07-26
**Status:** approved
**Goal:** make rs2b0t a repo where "read the manual" is a real answer — the manual exists, it is cross-linked, it is runnable from a cold clone, and the code points into it.

## Problem

The repo documents its surface well and its interior not at all.

| | today |
|---|---|
| Doc pages | 3 (`README.md`, `docs/API.md`, `docs/DEV.md`) + orphaned `desktop/README.md` |
| Doc cross-links | 4, all `README → docs/*`. API.md and DEV.md link back to nothing and to each other never. |
| Code → doc references | 1, in a shell-script header (`tools/deploy-local.sh`); **zero** in TypeScript, across ~80k hand-written lines |
| Undocumented subsystems | `nav` (2.5k lines), `quests` (5.4k), `scripts` (15.8k), `api` (4.1k), `multibox` (1.7k), `runtime` (1.5k), `clues` (1.1k), `adapter` (1.2k), `ui` (1.1k), `shops`, `events`, `input` |
| Undocumented tooling | `tools/` 132 files / 16.7k lines; `test/` 129 files / 10.4k lines |
| `bun test` mentioned in docs | never |
| lint/format commands | none exist (`eslint`/`prettier` are devDeps with no `package.json` script) |
| Local run from a cold clone | impossible — the engine is one line naming a **private** repo |

The repo is public (`rs2b2t/rs2b0t`). The engine (`ejtriple/rs2b2t-engine`) and ops repo (`ejtriple/rs2b2t`) are private.

Hard-won behaviour — the several-hour findings — lives only in commit messages: loc-snapshot level lag, bank deposit-view lag, corridor-snap click starvation, double-door entry mechanics, "players/NPCs never block nav". None of it is in the tree as prose.

## Non-goals

- Reversing `761204b` (the ~12.7k-line comment strip). Code stays terse.
- Documenting `src/client/` (the 15k-line 2004scape client) beyond its boundary with `src/bot/`.
- Rewriting `docs/API.md`'s content. It is good; it joins the link graph and gains cross-references.
- Publishing the private engine or ops repos.

## Decisions

| Decision | Choice |
|---|---|
| Code comments | **Both**: full TSDoc on the public API surface; terse `// docs/X.md#anchor` pointers on internals. No restored prose. |
| Audience | **Public-first, maintainer appendix.** The primary local-run path works for a stranger with no access to the private repos. |
| Doc scope | **Full set** — 11 pages: the index, 8 new pages, and the 2 existing ones relinked. |
| Gotchas | **Into subsystem pages**, beside the code that handles them. |
| Anti-rot | **Link-integrity test + generated `SCRIPTS.md`.** `bun test` fails on drift. |
| Delivery | **One PR.** |
| Verification | **Execute the public path.** RUNNING.md records what was observed, not what was inferred. |

---

## 1. The manual

```
docs/README.md        NEW  index; "start here" routes by role
docs/RUNNING.md       NEW  local setup, tests, lint, smokes + maintainer appendix
docs/ARCHITECTURE.md  NEW  the tree, the layers, the fences, how a bot call becomes a packet
docs/API.md           keep the scripting surface; relinked
docs/NAV.md           NEW  collision pack, A*, doors, transports, Reach, arrival, stuck-recovery
docs/QUESTS.md        NEW  engine, defs, exec primitives, quest state
docs/CLUES.md         NEW  cluedb, ClueExecutor, solvers, tool acquisition, audit harness
docs/SCRIPTS.md       NEW  catalog of the registered bots (generated)
docs/MULTIBOX.md      NEW  wall, slots, profiles/vault, login coordination, telemetry
docs/TESTING.md       NEW  bun test layout + the tools/ smoke fleet
docs/DEV.md           keep build targets, run modes, hosting; gains a TOC and back-links
```

### Linking rules

These are the substance of "better at linking and referencing", and §5 enforces them.

1. **Breadcrumb.** Every page opens with `[Manual](README.md) › <Page>`.
2. **TOC.** Any page over ~100 lines carries an anchor list.
3. **Code references are links**, never bare prose: `` [`WalkExecutor.ts`](../src/bot/nav/WalkExecutor.ts) ``. A moved file then breaks visibly.
4. **Two-way.** If page A explains what page B calls, B links out and A links back. Every page ends with **See also**.
5. **No orphans.** `desktop/README.md` and a new `templates/script-template/README.md` join the graph. The four `docs/*-e2e/` screenshot directories (~14 committed JPGs) are harness *output*, not documentation: `tools/cow-routes-e2e.ts` writes `docs/cowkiller-e2e/`. Repoint that writer at `out/` and **delete the four directories** — git history retains the images, matching the repo's existing pruning habit. *Veto this at spec review if the evidence shots should stay tracked.*
6. **Stable anchors.** A heading that code points at is API. Renaming one fails the test.

### Page contracts

Each subsystem page follows one shape: **what it is → the pieces (each linked) → how a typical operation flows → documented behaviours → see also**.

- **`ARCHITECTURE.md`** — the layer stack (`client` → `adapter` → `api` → `scripts`), the two eslint fences and why they exist (only `adapter/` may name client internals; DOM only in `ui/` + entrypoints), the `globalThis.__rs2b0t` ABI boundary and why the bot bundle never mangles property names, the path a `interact('Attack')` call takes to a packet.
- **`NAV.md`** — the baked collision pack (`out/collision.lcnav.gz`, derived from an engine's data by `tools/nav/build-collision.ts`), `PathFinder`/`Navigator`/`WalkExecutor`/`DirectNavigator`, the door + transport graph and `specialCrossings`, the `Reach` last-mile primitive, arrival semantics, the stuck ladder.
- **`QUESTS.md`** — the engine/defs/exec split, quest state read from journal + held items (never varps), provisioning, `AIOQuester` and `QuestDashboard`.
- **`CLUES.md`** — `cluedb` generation, `ClueExecutor` yielding to the host loop, step kinds, tool acquisition, the audit harness.
- **`MULTIBOX.md`** — slots and iframes, profiles/vault, login coordination, resource telemetry and its honesty rules (the existing DEV.md telemetry section moves here; DEV.md links to it).
- **`TESTING.md`** — the 17 `test/` directories, the happy-dom preload in `bunfig.toml`, the `tools/*-test.ts` live-harness pattern and its ABI (`globalThis.rs2b0t`), `run-all-smokes.ts` and its subsetting flags, which harnesses need Node rather than Bun and why.
- **`SCRIPTS.md`** — generated (§5).

### Behaviour notes ("gotchas")

Each lands on the page that owns it, adjacent to the code that handles it, with that code linked.

**Sourcing rule: every behaviour note must be traceable to code in the tree or to the commit that fixed it.** A claim that cannot be tied to something checked in does not get stated as fact. This keeps the manual from confidently asserting folklore.

## 2. `docs/RUNNING.md`

Ordered so a stranger can follow top to bottom:

1. **Prerequisites** — Bun, Node ≥24 (Playwright/Electron harnesses), `git submodule update --init` for `3rdparty/`.
2. **Get an engine** — public `LostCityRS/Engine-TS`; boot it; the port it serves (recorded from §4, not assumed).
3. **Deploy the client** — `bun install`, then `ENGINE_DIR=… sh tools/deploy-local.sh`. Document what the script actually does: builds both clients, builds the collision pack from *that engine's* data on first run, copies into `public/{client,bot}` + `bot.html` + `multibox.html`.
4. **Login key** — the `local` target bakes the rs2b2t engine's rotated 1024-bit modulus. An unmodified upstream engine uses a different key, so `LOCAL_RSAE`/`LOCAL_RSAN` must be supplied; document the exact command that derives them from that engine's `private.pem`. Wrong key ⇒ login response code 6.
5. **Run** — open `/bot.html`, create an account, pick a script from the panel. Wall at `/multibox.html`.
6. **Desktop shell** — link to `desktop/README.md`.
7. **Against live** — `bun run b0t`, cross-linked to DEV.md's run-mode table.
8. **Tests** — `bun test`, per-directory runs, the preload.
9. **Lint and format.**
10. **Smokes** — `bun run smoke`, `--list` / `--only` / `--skip`, log locations, runtime expectations.
11. **Troubleshooting** — login code 6, port clashes, the checkout-wide launcher lock, backgrounded-tab throttling.
12. **Maintainer appendix** — `~/code/rs2b2t-engine` quickstart, cheats/debugprocs, prod deploy.

### `package.json` scripts

Add `test`, `lint`, `format`, `gen:scriptdocs`. Lint and format are currently undocumented because they are uninvokable. `bunx eslint .` is verified clean, so it is the real gate. `format` takes explicit paths rather than `.`: prettier is configured but unenforced, and `prettier --write .` would rewrite 310 pre-existing files.

### Private details in a public repo

`docs/DEV.md` today names `~/code/rs2b2t`, `ops/Caddyfile.game`, the SSM key, and ADR-0016. Under public-first they are **fenced under an explicit "Maintainer / private infrastructure" heading, not deleted.** Removing them from the public repo is a separate call for the maintainer to make.

## 3. Code conventions

### TSDoc — the public surface

`packages/rs2b0t-api/index.d.ts` (70 blocks present, finish it) and `src/bot/api/**` (51 files). Editor hover becomes the manual. Every class- and exported-function-level block ends with `@see docs/X.md#anchor`.

```ts
/**
 * Walk to `dest`, crossing doors and transports along the way.
 * Resolves only on verified arrival; never assumes a click landed.
 * @see docs/NAV.md#walking
 */
```

### Pointers — the internals

`nav`, `quests`, `clues`, `runtime`, `multibox`, `adapter`, `shops`. One line, no prose, only where behaviour is non-obvious:

```ts
const CORRIDOR = 3; // docs/NAV.md#corridor-snap
```

The ~339 comments surviving `761204b` (mostly `src/bot/scripts/`) are deliberate survivors and stay as they are; a pointer is added only where a new page now owns the topic.

## 4. Verification stage

Before RUNNING.md is written, the public path is executed: clone `LostCityRS/Engine-TS` into the scratchpad, boot it, derive its modulus, build and deploy the client, log in, run a script. **RUNNING.md then documents what was observed.** If a step does not work as inferred, the doc records the real behaviour, and the gap becomes a finding to report rather than a silent inaccuracy.

## 5. Anti-rot

### `test/docs/links.test.ts`

Fails `bun test` when docs and code drift. Asserts, across every `.md` in `docs/` plus `README.md`, `desktop/README.md`, `templates/script-template/README.md`:

- every relative link resolves to a file that exists;
- every `#anchor` exists as a heading in its target file;
- every `src/…` / `tools/…` / `test/…` path cited in backticks exists on disk;
- every `// docs/X.md#y` pointer in hand-written source resolves to a real page **and** a real anchor;
- no page in `docs/` is unreachable from `docs/README.md`.

Excludes `docs/superpowers/**` (SDD artifacts, historical by nature).

### `tools/gen-scriptdocs.ts`

Emits `docs/SCRIPTS.md` from `ScriptRegistry` — the 36 registered bots already carry `name`, `description`, `category`, `tags`, and `settingsSchema`. Follows the existing `gen:shopdb` / `gen:cluedb` / `gen:dropdb` pattern. A test asserts the checked-in file matches the registry, naming `bun run gen:scriptdocs` in its failure message.

## Risks

| Risk | Handling |
|---|---|
| The upstream-engine path does not work as inferred | §4 executes it first; the doc records reality |
| Behaviour notes assert stale folklore | Sourcing rule — traceable to code or commit, or omitted |
| Large single PR (~11 pages, 51-file TSDoc sweep, pointer sweep) | Chosen deliberately; the link test makes the diff self-checking |
| Pointer comments drift into prose, undoing `761204b` | One line, path + anchor only; no rationale in code |
| Anchors become load-bearing and rename-hostile | That is the point, and the test surfaces it immediately |

## Definition of done

- `docs/README.md` reaches every other page; every page links back; no orphans.
- A cold clone can reach a running bot using only public resources, by steps that were executed.
- `bun test` covers link integrity and `SCRIPTS.md` freshness, and passes.
- `bun test`, `bun run lint`, `bun run format` exist, are documented, and pass.
- Public API surface carries TSDoc ending in `@see`; internals carry pointers, not prose.
- `bun run lint` and `bunx tsc --noEmit` clean (both pass on the tree today, so any failure is this branch's). Prettier is checked **only on files this branch touches** — `prettier --check .` already fails on 310 pre-existing files and is not a signal about this work.
