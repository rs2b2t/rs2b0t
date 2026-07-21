# Repo Cleanup + Full Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Fletcher/Herbalist/Runecrafter bots, prune stale historic artifacts aggressively, sweep dead code and duplication from the bot surface, make module contracts accurate — proven green by unit tests + static gates + the full live smoke fleet.

**Architecture:** Sequential themed passes executed inline in this session (per the approved spec), with parallel **read-only** Explore agents used for candidate discovery only; every change applied and hand-verified centrally. One commit per theme (per consolidation for dedup) so the fleet can bisect.

**Tech Stack:** bun, TypeScript (`bunx tsc --noEmit`), eslint 9 flat config, the tools/ smoke fleet (`bun run smoke`), local rs2b2t engine on :8890.

## Global Constraints

- **Boundary — refactor only:** `src/bot/`, `src/mapview/` (light), `tools/`, `test/`, `templates/`, `public-bot/`, `desktop/main.cjs` (light). **Frozen:** `src/client/`, `src/dash3d/`, `src/graphics/`, `src/io/`, `src/datastruct/`, `src/util/`, `src/sound/`, `src/wordfilter/`, `src/config/`, `identifier.js`, `node_modules`, `out/`, `multibox-accounts.recovered.json`.
- **GATE** (fast static gate, run at the end of every task):
  `bun test 2>&1 | tail -3 && bunx tsc --noEmit && bunx eslint . 2>&1 | tail -2 && bun run build && bun tools/clues/audit-clues.ts 2>&1 | tail -3`
  Expected: `0 fail` unit tests; tsc silent (0 errors); eslint problem count ≤ the frozen-zone baseline recorded in Task 1 (bot surface reaches 0 in Task 6); build exits 0; clue audit exits 0.
- **Liveness roots** (a symbol/file is LIVE if reachable from any): bundle entries (`bundle.ts`, `bot.bundle.ts`), `ScriptRegistry` name-strings, the `__rs2b0t` public API surface (`packages/rs2b0t-api/index.d.ts` + `docs/API.md`), raw-string settings keys (`rs2b0t:set:<Script>:<key>`), tools scripts, tests, data packs consumed at runtime.
- **Deletion discipline:** before deleting symbol X: `grep -rn "X" src tools test templates packages docs README.md` must show only the definition site (string hits count as references).
- **Commit discipline:** `git status`/`git log --oneline -3` before every commit (user commits concurrently); stage files by exact path, never `git add -A`; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Branch:** all cleanup commits on `cleanup/2026-07-21` in this checkout (no worktree — gitignored `out/` build + `collision.lcnav.gz` are load-bearing for live smokes). Pre-work (Task 1) commits go on `main` first.
- **Frozen-zone lint policy:** never edit frozen files to satisfy eslint; record their problem count as the tolerated baseline.

---

### Task 1: Baseline fixes + pre-work commits on main, then branch

**Files:**
- Modify: `src/bot/scripts/ClueSolver.ts` (already-modified working tree — the post-solve bank-return feature)
- Modify (only if the 12 tsc errors require): `src/bot/scripts/ArdyCakes.ts`, `ArdyFighter.ts`, `ArdyThiever.ts`, `AutoFighter.ts`, `tools/ardyfighter-clue-test.ts`, `tools/clues/live-clue-sweep.ts`
- Modify: `tools/run-all-smokes.ts:38` (SPECIAL list)
- Add: `tools/ardyfighter-clue-test.ts`, `tools/merlin-tail-test.ts`
- Delete (untracked, `rm`): `tools/nav/cake-tiles-probe.ts`, `tools/nav/live-entity-collision-probe.ts`, `tools/nav/live-standoff-repro.ts`, `tools/nav/region-travel-probe.ts`, `tools/nav/rt1-ship-probe.ts`, `tools/nav/rt2-verify-probe.ts`

**Interfaces:**
- Produces: a `main` with 0 tsc errors, the ClueSolver feature + 2 asset tools committed, and branch `cleanup/2026-07-21` created from it. All later tasks run on that branch and rely on the recorded **eslint frozen-zone baseline** (count of problems in frozen files).

- [ ] **Step 1: Diagnose the 12 real tsc errors.** Run `bunx tsc --noEmit 2>&1 | grep "error TS" | grep -v "tools/nav/"`. Read each site; determine whether the four bot errors are caused by the uncommitted ClueSolver diff (SolveClue wiring) or pre-date it.
- [ ] **Step 2: Fix all 12** with minimal, behavior-preserving edits (missing `override` modifiers, type-only import drift, etc.). Re-run: `bunx tsc --noEmit 2>&1 | grep -c "error TS"` → expected `3` (only the two untracked probes remain).
- [ ] **Step 3: Delete the six untracked probes:** `rm tools/nav/cake-tiles-probe.ts tools/nav/live-entity-collision-probe.ts tools/nav/live-standoff-repro.ts tools/nav/region-travel-probe.ts tools/nav/rt1-ship-probe.ts tools/nav/rt2-verify-probe.ts`. Re-run tsc → expected **0 errors**.
- [ ] **Step 4: Record the eslint frozen-zone baseline:** `bunx eslint . 2>&1 | grep -E "^/" | sed 's|.*/rs2b0t/||'` — count problems in frozen dirs (`src/client`, `src/io`, `src/graphics`, …). Note the number in the task log; the GATE tolerates exactly these until the end.
- [ ] **Step 5: Add `'merlin-tail-test'` to SPECIAL** in `tools/run-all-smokes.ts:38` (Merlin's Crystal is an unverified draft; its harness must not join the auto-discovered fleet). Verify: `bun tools/run-all-smokes.ts --list` shows no `merlin-tail-test` row.
- [ ] **Step 6: Run unit tests:** `bun test 2>&1 | tail -3` → `0 fail`.
- [ ] **Step 7: Commit the ClueSolver feature on main** (include any Step-2 fixes in the bots it touches): `git add src/bot/scripts/ClueSolver.ts <touched bot files>` then `git commit -m "feat(clues): ClueSolver returns to the nearest bank after each solve"`.
- [ ] **Step 8: Commit the asset tools on main:** `git add tools/ardyfighter-clue-test.ts tools/merlin-tail-test.ts tools/run-all-smokes.ts <any live-clue-sweep fix>` then `git commit -m "test: commit ArdyFighter clue smoke + Merlin dev harness (SPECIAL-listed)"`.
- [ ] **Step 9: Branch:** `git checkout -b cleanup/2026-07-21`.

### Task 2: Delete Fletcher, Herbalist, Runecrafter (+ ProcessingBot cascade)

**Files:**
- Modify: `src/bot/scripts/index.ts` (remove line 6 `PROCESSING_SETTINGS` import, line 18 `ProcessingBot` import, the `// --- processing presets` comment + `processing()` helper block at ~250–259, the `Fletcher` registration at ~270–277, `Herbalist` at ~311–318, `Runecrafter` at ~320–327)
- Delete: `src/bot/scripts/ProcessingBot.ts`, `tools/fletching-test.ts`, `tools/herblore-test.ts`

**Interfaces:**
- Consumes: branch from Task 1.
- Produces: a script registry without the three names; later docs tasks assume they're gone.

- [ ] **Step 1: Read `src/bot/scripts/index.ts`** around each listed range (lines have shifted only if the user committed meanwhile) and delete the six blocks. Keep the `CookBot` registration and the `// --- smithing` NOTE comment intact.
- [ ] **Step 2: Delete the files:** `git rm src/bot/scripts/ProcessingBot.ts tools/fletching-test.ts tools/herblore-test.ts`.
- [ ] **Step 3: Verify zero remaining references:** `grep -rn "ProcessingBot\|PROCESSING_SETTINGS" src tools test templates packages` → no hits. `grep -rn "'Fletcher'\|'Herbalist'\|'Runecrafter'" src tools test templates packages` → no hits (BankFletcher and skill-name "runecraft" hits in frozen files are fine and expected).
- [ ] **Step 4: Run GATE** → all green (unit count may stay 721; ProcessingBot had no unit tests).
- [ ] **Step 5: Commit:** `git add -u src/bot/scripts tools && git commit -m "feat(scripts)!: remove Fletcher, Herbalist, Runecrafter (+ ProcessingBot cascade)"`.

### Task 3: Prune stale historic artifacts

**Files:**
- Delete: every file under `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/superpowers/notes/`, `docs/superpowers/research/` **except** `specs/2026-07-21-repo-cleanup-design.md` and `plans/2026-07-21-repo-cleanup.md` (pruned later in Task 12)
- Delete: `tools/nav/pip-probe.ts`, `tools/nav/tower-probe.ts`, `tools/nav/witchhouse-probe.ts`, `tools/nav/clue-tool-tiles-probe.ts`, `tools/nav/gnome-gate-test.ts`, `tools/ardythiever-bank-repro.ts`, `tools/find-green-dragons.ts`

**Interfaces:**
- Produces: `docs/` containing only living docs (`API.md`, `DEV.md`, the two cleanup docs) + `README.md`.

- [ ] **Step 1: Delete the docs:** `git rm docs/superpowers/notes/*.md docs/superpowers/research/*.md` and all dated specs/plans except the two 2026-07-21 cleanup files.
- [ ] **Step 2: Delete the seven concluded one-off tools** with `git rm`.
- [ ] **Step 3: Reference check:** `grep -rn "pip-probe\|tower-probe\|witchhouse-probe\|clue-tool-tiles\|gnome-gate-test\|ardythiever-bank-repro\|find-green-dragons\|superpowers/\(notes\|research\)" src tools test docs README.md` → only hits inside the two cleanup docs are allowed.
- [ ] **Step 4: Run GATE** → green.
- [ ] **Step 5: Commit:** `git commit -m "chore: prune shipped design docs + concluded one-off probes"`.

### Task 4: Dead-code sweep (detector-assisted, hand-verified)

**Files:**
- Create (scratchpad, NOT the repo): `<scratchpad>/scan-exports.ts` — unused-export scanner
- Modify/Delete: whatever the verified findings dictate, bot surface only

**Interfaces:**
- Consumes: pruned tree from Task 3.
- Produces: a findings log (scratchpad `dead-code-findings.md`) listing every deletion with its verification evidence; later tasks assume dead symbols are gone.

- [ ] **Step 1: Write the scanner** to `<scratchpad>/scan-exports.ts`:

```ts
// Lists exported symbols from src/bot, src/mapview, tools whose name appears
// nowhere else in src/tools/test/templates/packages/docs (string hits count).
// Crude by design — every hit is a CANDIDATE for hand verification, never a
// mechanical deletion.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['src/bot', 'src/mapview', 'tools'];
const refRoots = ['src', 'tools', 'test', 'templates/script-template/src', 'packages', 'docs'];
const files = (d: string): string[] => readdirSync(d).flatMap(f => {
    const p = join(d, f);
    if (f === 'node_modules' || f === 'dist') return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|md|d\.ts)$/.test(f) ? [p] : [];
});
const exportRe = /^export (?:default )?(?:abstract )?(?:async )?(?:function|class|const|let|enum|interface|type) (\w+)/gm;
const defs = new Map<string, string>();
for (const f of roots.flatMap(files)) {
    if (f.endsWith('.test.ts')) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(exportRe)) defs.set(m[1], f);
}
const corpus = refRoots.flatMap(files).map(f => ({ f, s: readFileSync(f, 'utf8') }));
for (const [name, def] of [...defs].sort()) {
    const uses = corpus.reduce((n, { f, s }) => n + (f === def
        ? Math.max(0, s.split(name).length - 1 - 1)   // ignore the def line itself
        : s.split(name).length - 1), 0);
    if (uses === 0) console.log(`${def}: ${name}`);
}
```

- [ ] **Step 2: Run it:** `bun <scratchpad>/scan-exports.ts | tee <scratchpad>/dead-exports.txt`. Also collect eslint's `no-unused-vars` hits on the bot surface.
- [ ] **Step 3: Dispatch 6 parallel read-only Explore agents** (subsystems: `src/bot/scripts`, `src/bot/api`, `src/bot/nav` + `src/bot/clues`, `src/bot/quests`, `src/bot/runtime|ui|events|input|adapter|multibox` + `src/mapview`, `tools` + `test`). Prompt each: *"Report (do not edit): (a) files/exports/branches that appear dead or unreachable, (b) commented-out code blocks, (c) comments referencing files, bots, or behavior that no longer exist, (d) settings keys or data entries no code reads. For each finding give file:line and the evidence. The following are LIVE even if unreferenced in-repo: anything reachable from ScriptRegistry registrations by name-string, the __rs2b0t API surface mirrored in packages/rs2b0t-api/index.d.ts, raw-string settings keys `rs2b0t:set:<Script>:<key>`, runtime data packs."*
- [ ] **Step 4: Verify every candidate personally** against the deletion discipline (Global Constraints), recording evidence per finding in `<scratchpad>/dead-code-findings.md`. When in doubt — especially anything smelling of live-verified behavioral quirks — keep it and note why.
- [ ] **Step 5: Apply verified deletions** (dead exports, dead files, dead branches, stale comments, commented-out code). Bot surface only.
- [ ] **Step 6: Run GATE** → green (unit-test count may legitimately drop if a dead module's tests died with it — name them in the commit).
- [ ] **Step 7: Commit** (split by area if large): `git commit -m "refactor: delete dead code (evidence-verified sweep)"`.

### Task 5: Duplication consolidation (conservative)

**Files:**
- Modify: only clusters that pass the rules below; each cluster = its own commit

**Interfaces:**
- Consumes: dead-code-free tree.
- Produces: consolidated helpers other tasks/docs may reference.

- [ ] **Step 1: Copy-paste scan:** `bunx jscpd src/bot tools --min-tokens 60 --reporters consoleFull 2>&1 | tee <scratchpad>/jscpd.txt` (if bunx can't fetch jscpd, skip — agent discovery still runs).
- [ ] **Step 2: Dispatch 3 read-only Explore agents** over `src/bot/scripts`, `src/bot` (non-scripts), `tools`, prompted: *"Report duplicate or near-duplicate logic clusters (≥ ~10 lines or repeated ≥3 times), with file:line spans and what varies between copies. Do not edit."*
- [ ] **Step 3: For each cluster, apply the rules:** consolidate ONLY if (a) mechanical + behavior-preserving, (b) the affected bots/tools have unit or smoke coverage, (c) the shared home is obvious (existing module like `tools/lib/harness.ts`, `src/bot/api/*`). Known suspects to check: pre-harness boilerplate in older `tools/*-test.ts`, combat-bot overlap (ChickenKiller presets vs MossGiant/GreenDragon template). Live-verified quirks stay put.
- [ ] **Step 4: Per consolidation:** make the edit, run GATE, commit separately: `git commit -m "refactor: dedupe <cluster> into <home>"`.

### Task 6: Lint to zero on the bot surface

**Files:**
- Modify: every non-frozen file eslint flags

**Interfaces:**
- Produces: `bunx eslint .` reporting only the Task-1 frozen-zone baseline.

- [ ] **Step 1:** `bunx eslint . --fix` (auto-fixes ~25 errors + 6 warnings). Then `git diff --stat` — **revert any hunk in a frozen file** (`git checkout -- src/client src/io src/graphics ...`).
- [ ] **Step 2: Hand-fix the remaining bot-surface problems.** Warnings judged individually: fix real smells; where a rule misfires on house style, prefer a targeted `// eslint-disable-next-line <rule>` with a reason over config loosening.
- [ ] **Step 3: Verify:** `bunx eslint . 2>&1 | tail -2` → problem count == frozen-zone baseline; none of the listed files are bot-surface.
- [ ] **Step 4: Run GATE, commit:** `git commit -m "chore: lint the bot surface to zero"`.

### Task 7: Readability + contract-comment pass

**Files:**
- Modify: bot-surface modules with missing/stale top-of-file contracts, misleading names, dead flags

**Interfaces:**
- Produces: every bot-surface module opens with an accurate contract comment (house style: what it does, how it's used, key invariants).

- [ ] **Step 1: Dispatch 4 read-only Explore agents** (same subsystem split as Task 4, minus tools) prompted: *"For each module: does the top-of-file comment exist and accurately describe today's behavior? Flag missing headers, stale claims (references to removed bots/params/flows), misleading symbol names, and boolean flags that are never read. Report file:line + what's wrong; do not edit."*
- [ ] **Step 2: Fix verified findings.** New headers follow the existing style (see `src/bot/scripts/ClueSolver.ts:23-31` for the register). Renames only where a name actively misleads AND the symbol is repo-internal (never on the `__rs2b0t` API surface).
- [ ] **Step 3: Run GATE, commit:** `git commit -m "docs(code): accurate module contracts + honest names"`.

### Task 8: Unify test placement

**Files:**
- Move: all 45 `src/**/*.test.ts` → `test/` mirroring paths (e.g. `src/bot/api/Reach.test.ts` → `test/api/reach.test.ts` style — match the existing `test/` naming convention seen in `test/scripts/ardythiever-logic.test.ts`)

**Interfaces:**
- Produces: one predictable test root; `bun test` count unchanged.

- [ ] **Step 1: Record the baseline count:** `bun test 2>&1 | tail -3` (expected `0 fail`, N pass).
- [ ] **Step 2: For each co-located test:** `git mv src/<path>/<Name>.test.ts test/<mirrored-path>/<kebab-name>.test.ts`, then rewrite its relative imports to the `#/` alias (`package.json` maps `#/*` → `./src/*`), matching how existing `test/` files import.
- [ ] **Step 3: Verify:** `bun test 2>&1 | tail -3` → same pass count, `0 fail`; `find src -name "*.test.ts"` → empty.
- [ ] **Step 4: Commit:** `git commit -m "test: unify placement under test/ (mirrored paths, # alias imports)"`.

### Task 9: Docs refresh

**Files:**
- Modify: `README.md` (line ~94 mentions "processing presets" — reword; verify the whole script list), `docs/DEV.md`, `docs/API.md`

**Interfaces:**
- Produces: docs matching the post-cleanup registry and commands.

- [ ] **Step 1:** Read all three; cross-check every named script against `src/bot/scripts/index.ts` registrations, every named command against `package.json`/`tools`. Fix drift (Fletcher/Herbalist/Runecrafter gone; BankFletcher is the fletching story).
- [ ] **Step 2: Verify:** `grep -n -i "fletcher\|herbalist\|runecraft\|processing" README.md docs/*.md` → only BankFletcher and game-skill mentions remain.
- [ ] **Step 3: Commit:** `git commit -m "docs: match the post-cleanup script registry and commands"`.

### Task 10: Full static regression

- [ ] **Step 1:** Run the full static suite and record outputs:
  - `bun test 2>&1 | tail -3` → `0 fail`
  - `bunx tsc --noEmit` → silent
  - `bunx eslint . 2>&1 | tail -2` → frozen baseline only
  - `bun run build` and `bun run build:bot` → exit 0
  - `bun tools/clues/audit-clues.ts` → exit 0
  - `sh tools/content-drift.sh` → run; if the sibling content repos are missing, record "environment unavailable" (report, don't fail the campaign)
- [ ] **Step 2:** Fix anything red, commit fixes, re-run until green.

### Task 11: Live fleet regression (the end-to-end)

- [ ] **Step 1: Engine up?** `curl -fsS http://localhost:8890/bot.html >/dev/null && echo UP || echo DOWN`. If DOWN: start it per `docs/DEV.md` (`npm run quickstart` in `~/code/rs2b2t-engine`, background, wait for UP).
- [ ] **Step 2: Launch the fleet in the background:** `bun run smoke` (deploys the current build once, then ~40 sequential smokes, 2–3h; per-smoke logs in `out/smoke-logs/`). Note: the deploy clobbers any live build — approved by the regression mandate.
- [ ] **Step 3: Monitor periodically;** on completion read the PASS/FAIL matrix.
- [ ] **Step 4: Triage every failure** (systematic-debugging; the log names the failing assertion). Classify: cleanup-caused (fix the cleanup), pre-existing bug (fix it), environment flake (rerun). Commit each fix separately.
- [ ] **Step 5: Rerun failed smokes on the final build:** `bun tools/run-all-smokes.ts --only <names>`. **Done = every fleet smoke green on the final build.**
- [ ] **Step 6: SPECIAL attempts:** run `external-script-test` (validates the public API after export pruning) and any other SPECIAL smoke the local environment supports (`multibox-test` needs the wall; `desktop-test`/`rendergate-test` need Electron via npx tsx; `e2e-smoke`/`hosted-proof-test` need prod origin). Record attempted/passed/unavailable — report, never skip silently.

### Task 12: Finish — self-prune, merge, report

- [ ] **Step 1:** Per the "Everything" prune: `git rm docs/superpowers/specs/2026-07-21-repo-cleanup-design.md docs/superpowers/plans/2026-07-21-repo-cleanup.md` (git history keeps them); remove the now-empty `docs/superpowers/` tree. Commit: `git commit -m "chore: prune the cleanup's own design docs (history keeps them)"`.
- [ ] **Step 2:** Final `GATE` run → green.
- [ ] **Step 3:** Invoke superpowers:finishing-a-development-branch — merge `cleanup/2026-07-21` → `main` (no push unless the user asks).
- [ ] **Step 4:** Report: what was deleted (bots, docs, tools, dead code), what was consolidated, fleet matrix (including SPECIAL attempts and any environment-unavailable items), and anything deliberately kept with reasons.
