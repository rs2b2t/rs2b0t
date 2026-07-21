# Repo cleanup + full regression — design

**Date:** 2026-07-21
**Status:** approved

## Goal

A leaner, agent-legible repo: three bots removed (Fletcher, Herbalist, Runecrafter),
stale historic artifacts pruned aggressively, dead code and duplication gone,
module contracts accurate — proven by a fully green end-to-end regression
(unit tests + static gates + the complete live smoke fleet).

## Boundary

Refactor **only the bot-authored surface**:

- `src/bot/` (255 files, ~43k lines), `src/mapview/` (light touch)
- `tools/`, `test/`, `templates/`, `public-bot/`, `desktop/main.cjs` (light)

**Never touched:** the deobfuscated 2004scape client engine — `src/client/`,
`src/dash3d/`, `src/graphics/`, `src/io/`, `src/datastruct/`, `src/util/`,
`src/sound/`, `src/wordfilter/`, `src/config/`. Churn there is pure risk.
Bot hook points into it change only when a bot-side change requires it.

## Pre-work (user-approved handling of uncommitted state)

1. **Commit** the working-tree ClueSolver change (post-solve walk back to the
   nearest bank, idle there) as its own feature commit. The cluesolve smoke
   exercises it in the regression.
2. **Commit** three untracked assets: `tools/ardyfighter-clue-test.ts` (smoke
   for the shipped AutoFighter clue feature), `tools/clues/live-clue-sweep.ts`
   (live clue audit harness), `tools/merlin-tail-test.ts` (dev harness for the
   unverified Merlin's Crystal draft). Fleet hygiene: `merlin-tail-test.ts`
   must be added to the `run-all-smokes.ts` SPECIAL list — an
   unverified-draft smoke must not poison the fleet.
3. **Delete** the six untracked one-off nav probes: `cake-tiles-probe.ts`,
   `live-entity-collision-probe.ts`, `live-standoff-repro.ts`,
   `region-travel-probe.ts`, `rt1-ship-probe.ts`, `rt2-verify-probe.ts`
   (findings already merged/documented; deletion is permanent and approved).

## Bot deletions

- Remove the `Fletcher`, `Herbalist`, `Runecrafter` registrations from
  `src/bot/scripts/index.ts`.
- That orphans `ProcessingBot.ts` + `PROCESSING_SETTINGS` + the `processing()`
  schema helper (no other consumers) — delete the cascade.
- Delete their smokes: `tools/fletching-test.ts`, `tools/herblore-test.ts`.
- **Keep** every "runecraft" occurrence that is the game *skill* name
  (`src/client/Skill.ts`, ScriptLibrary XP tracking, Settings, StrangeBox
  solver, MapView map-legend labels) — those are client/game plumbing, not
  the bot.

## Stale artifact prune (aggressive)

- Delete all shipped-work specs and plans under `docs/superpowers/`
  (27 specs, 20 plans; git history preserves them). This spec and its plan are
  themselves pruned in the final commit once the work merges — the repo keeps
  only living docs.
- **Living docs kept:** `docs/DEV.md`, `README.md`, anything referenced from
  code/tools or describing how to operate the project.
- Delete committed one-off probes whose investigations shipped:
  `tools/nav/pip-probe.ts`, `tools/nav/tower-probe.ts`,
  `tools/nav/witchhouse-probe.ts`, `tools/nav/clue-tool-tiles-probe.ts`,
  `tools/nav/gnome-gate-test.ts`, `tools/ardythiever-bank-repro.ts`,
  `tools/find-green-dragons.ts`.
- **Keep:** generators (`gen-*`), harness infra (`tools/lib/harness.ts`,
  `run-all-smokes.ts`, `deploy-local.sh`, `pack-rs2b0t.sh`,
  `build-collision.ts`, `derive-*`), reusable parameterized utilities
  (`route-probe.ts`, `probe-locs.ts`, `bench-path.ts`, `coverage.ts`,
  `scout-npcs.ts`, `inspect-scene.ts`, `live-proxy.ts`, `proxy-check.ts`,
  `maze-derive.ts`), and every `*-test.ts` smoke for a shipped bot.
- Candidates discovered during the sweep follow the same rule: delete
  one-off investigation tooling whose conclusion is merged; keep anything
  generic-reusable. `out/` and `multibox-accounts.recovered.json` are
  gitignored runtime state — untouched.

## Dead-code sweep (bot surface only)

Detector-assisted (tsc `--noEmit`, eslint, unused-export scan), but **every
deletion hand-verified** against the four liveness roots:

1. Bundle entries (`bundle.ts`, `bot.bundle.ts`).
2. `ScriptRegistry` registrations — scripts are referenced by **name string**.
3. The `__rs2b0t` public API surface (`packages/rs2b0t-api` mirrors it;
   external scripts consume it) — API-surface exports are live even when
   unreferenced in-repo.
4. Raw-string settings keys (`rs2b0t:set:<Script>:<key>`).

A deletion requires: no static refs, not on the public API surface, the
literal name doesn't appear in any string, not a runtime-consumed data pack.
Also in scope: stale comments referencing deleted things, dead settings keys,
commented-out code.

## Duplication consolidation (conservative)

- Discovery: parallel read-only audit agents + copy-paste scan across
  `src/bot` and `tools`.
- Consolidate **only** where mechanical, behavior-preserving, and covered by
  tests or a smoke. One commit per consolidation so the fleet can bisect.
- Known suspects: pre-harness boilerplate in older `tools/*-test.ts` (migrate
  to `tools/lib/harness.ts`), combat-bot overlap.
- Live-verified behavioral quirks are load-bearing; when in doubt, leave it.

## Readability-for-agents

- Every module keeps/gains an accurate top-of-file contract comment (existing
  house style: what it does, how it's used, key invariants). Fix stale ones.
- Fix misleading names; delete dead flags and commented-out code.
- Unify test placement: move co-located `src/**/*.test.ts` into `test/`
  mirroring paths (bun discovers both; placement becomes predictable).
- Refresh `README.md` / `docs/DEV.md` to the post-deletion script list and
  current commands.

## Regression (definition of done)

- **After every theme:** `bun test` + `tsc --noEmit` + eslint + `bun run
  build` + clue audit (`tools/clues/audit-clues.ts`) must pass.
- **Finale:** full live fleet — `bun run smoke` (~40 smokes, 2–3h,
  sequential, local engine on :8890; start the engine via `npm run
  quickstart` in `~/code/rs2b2t-engine` if down). Failures are triaged and
  fixed; failed smokes rerun on the final build. **Done = every smoke green
  on the final build.**
- SPECIAL-list smokes (desktop, hosted-proof, external-script, e2e, multibox,
  rendergate) attempted where the local environment allows —
  `external-script-test` matters most (validates the public API after export
  pruning). Any that need unavailable environments are reported, not skipped
  silently.
- AIOQuester fresh-account quest acceptance: **out of scope** (user chose
  full fleet without the extra quest run; the `aio-quest-test` smoke still
  runs in the fleet).

## Process

- Feature branch in **this checkout** (no worktree: gitignored
  `collision.lcnav.gz` + `out/` build are load-bearing for live smokes).
- Commit per theme (conventional prefixes); check `git log`/`git status`
  before every commit — the user commits concurrently on this checkout;
  never blind `git add -A`.
- Merge to main only after the fleet is green.

## Risks

- **False-dead deletion** of name-string/externally-consumed code →
  four-root liveness check + full fleet + external-script-test.
- **Fleet flakes** over a 2–3h run (engine hiccup, Chrome GPU) → per-smoke
  logs in `out/smoke-logs/`, rerun failures on the final build.
- **Aggressive docs prune** removing something living → keep-rule above;
  everything is recoverable from git history.
- **Concurrent user commits** → small commits, frequent log checks.
