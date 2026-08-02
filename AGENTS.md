# rs2b0t — agent working notes

Project rules for automated agents working in this repo. Keep this file short; link out for depth.

## Local plan docs (large work)

When a task is **multi-issue, multi-session, or has a large triage / design dump** (cleanup sweeps, multi-bot refactors, quest rebuilds, long e2e campaigns):

1. **Write it down early** under `docs/superpowers/plans/` (gitignored working notes — not the user manual).
2. Use a dated name: `YYYY-MM-DD-<slug>.md` (e.g. `2026-08-02-upstream-issue-cleanup.md`).
3. Capture at least: branch + base SHA, scope / exclusions, per-item verdicts, key files, fix outlines, test matrix, checklist with open boxes.
4. **Update the plan as you go** — mark checklist items when they land, note live proof paths, deferrals, and PR URLs. Cold resume must not require re-triaging from chat.
5. Do **not** put long design dumps only in chat; do **not** commit plan files (see `.gitignore` → `docs/superpowers/`).

Existing examples: `docs/superpowers/plans/`. Specs (if any) live under `docs/superpowers/specs/`.

The published manual is `docs/*.md` (API, NAV, QUESTS, …). Plans are operator memory; manuals are product docs.

## Live verification (issue / nav fixes)

Prefer the **gold-standard issue harness** patterns in [`docs/TESTING.md`](docs/TESTING.md#gold-standard-issue-harnesses):

- Assert **game state** (tile, XP, items), not only log lines.
- On green: screenshot + JSON via `tools/lib/harnessProof.ts` (`writeSuccess`).
- On red: failure screenshot (`writeFailure`).
- When practical: baseline / pre-fix repro (`writeBaseline` or offline NO PATH unit test).
- Reference harnesses: `tools/shantay-pass-route-test.ts`, `tools/edgeville-dungeon-exit-test.ts`.

Redeploy the bot client before live runs so the harness hits this worktree’s bundle.

## Related

- Manual index: `docs/README.md`
- Live harness / redeploy: `docs/DEV.md`, `docs/TESTING.md`
