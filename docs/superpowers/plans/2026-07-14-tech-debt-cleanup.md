# Tech-Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove verified dead code, prune how/what comments (keep why-comments), extract duplicated helpers, and fix broken smoke infrastructure — with zero behavior change to the bots and the public ABI kept intact.

**Architecture:** The bot layer (`src/bot/**`), tools, and tests are the refactor surface. The ported game client (`src/client`, `src/dash3d`, `src/graphics`, `src/io`, `src/config`, `src/datastruct`, `src/sound`, `src/wordfilter`, `src/mapview`) mirrors upstream and is untouched except `src/util/JsUtil.ts` (shared, two verified-dead exports). The vendored rsmod subset (`src/bot/nav/rsmod/`) stays verbatim for vendor parity.

**Tech Stack:** TypeScript, Bun (test runner + bundler), ESLint 9 flat config, Playwright smokes.

## Global Constraints

- Baseline before ANY change: `bun test` → 390 pass / 0 fail; `bunx tsc --noEmit` → exit 0. Both must hold after EVERY task.
- The frozen public ABI (`src/bot/runtime/abi.ts` `installAbi()` surface, incl. `reader`) must not lose or rename any property. Additions are allowed.
- Scripts are registered/driven by STRING NAME (`src/bot/scripts/index.ts`, smokes) — never rename a registered script name or settings key (`rs2b0t:set:<Script>:<key>`).
- Comments policy: keep engine-quirk / protocol / tick-timing / coordinate-provenance / workaround-reason comments verbatim when moving code. Never delete a WHY comment.
- Generated data files (`src/bot/clues/data/cluedb.ts`, `src/bot/shops/data/shopdb.ts`, `src/bot/api/maze/mazeRoutes.ts`) are edited only via their generators.
- `src/bot/nav/rsmod/**` is vendored — no edits.
- Commit after each task with a conventional message; never batch unrelated tasks into one commit.

## Deliberately deferred (report, don't do)

- Combat-loop unifications (`killTarget`, `eatUpTo`, `rideBatch`, ArdyFighter/ArdyThiever de-fork, `ReturnToAnchor`) — live-tuned behavior; needs a working smoke fleet for per-script verification first.
- `Bank.openBooth`/`openNearest` unification — live-tuned retry counts/geometry.
- `reader.toWorld` / `reader.menuEntries` deletion — dead in-repo but on the frozen ABI escape hatch; needs an API_VERSION bump decision.
- `Game.say` / `Game.recentChat` — unused + untyped but reachable on the frozen ABI; product decision.
- InputDriver/ActionRouter seam, `RenderGate` boost, `AbstractBot.inputMode` — kept (architecture seam / test-used / public ABI).
- Modal scaffold unification (ParamsModal/ScriptLibrary) — ScriptLibrary has no test.
- `quests/types.ts` export drops — quest-executor extraction (roadmap: quest #2) will import these types.
- `WalkExecutor.followPath` pure-math extraction — hot, subtle; optional testability follow-up.
- BotPanel constructor split into section builders — readability-only, no test coverage.
- rsmod dead flags (`BlockAccessFlag`, `DirectionFlag`) — vendor parity.
- Fleet-wide smoke migration beyond the files this plan already touches (stretch batch at the end if all green).

---

### Task 1: Branch + config/deps mechanical fixes

**Files:**
- Modify: `eslint.config.ts`, `package.json`
- Delete: `package-lock.json`, `rsa.ts`
- Modify: `public-bot/bot.html` (dead CSS rule)

**Steps:**
- [ ] `git checkout -b refactor/tech-debt-cleanup`
- [ ] `eslint.config.ts`: extend `globalIgnores(['src/3rdparty/'])` → `globalIgnores(['src/3rdparty/', 'out/', 'desktop/', 'packages/', 'templates/', 'public-bot/'])`. Add `'!#/dash3d/CollisionFlag.js'` to the fence `group` array (after the two `!#/io/*` entries) — CollisionFlag is a const enum (inlined, no runtime coupling) imported legitimately by `src/bot/nav/localReach.ts:8` and `src/bot/api/Reachability.ts:4`; today it passes by matcher luck only.
- [ ] Delete `package-lock.json` (npm residue; bun.lock is authoritative — desktop/ and templates/ each have their own bun.lock).
- [ ] Delete `rsa.ts` (standalone upstream keygen script; zero imports; writes private.pem/.env for a server this repo doesn't run).
- [ ] `package.json`: remove devDependencies `bcrypt-ts` (zero refs), `node-forge`, `@types/node-forge` (only consumer was rsa.ts). Keep `prettier` (used via .prettierrc). Run `bun install` to sync bun.lock.
- [ ] `public-bot/bot.html`: delete the dead `.rs2b0t-select { … }` CSS rule (~line 166) — the dropdown it styled was replaced by the ScriptLibrary modal.
- [ ] Verify: `bun test` (390 pass), `bunx tsc --noEmit`, `bunx eslint . 2>&1 | tail -3` (should now report ONLY real source findings, no out/ or templates/ noise).
- [ ] Commit: `chore: eslint ignores built artifacts + explicit const-enum fence; drop npm lockfile, rsa.ts keygen, dead deps`

### Task 2: Delete verified-dead code (src)

**Files:**
- Modify: `src/util/JsUtil.ts`, `src/bot/BotHost.ts`, `src/bot/BotClient.ts`, `src/bot/shops/StockModel.ts`, `test/shops/stockmodel.test.ts`, `src/bot/quests/types.ts`, `src/bot/scripts/SmelterBotLogic.ts`, `src/bot/scripts/SmelterBotLogic.test.ts`, `src/bot/runtime/Scheduler.ts`, `src/bot/multibox/DomSlotOps.ts`, `src/bot/runtime/RenderGate.ts`, `src/util/WorkerClock.ts`, `src/bot/api/Banking.ts`, `src/bot/api/tasks/PeriodicBank.ts`, `src/bot/scripts/CooksAssistant.ts`, `src/bot/quests/QuestDashboard.ts`, `tools/maze-derive.ts`, `src/bot/api/maze/mazeRoutes.ts` (via generator)

**Each deletion below was independently grep-verified (0 refs incl. string keys, ABI, d.ts):**
- [ ] `src/util/JsUtil.ts`: delete `downloadText` (line 5) and `arraycopy` (lines 7+) — unused by client AND bot.
- [ ] `src/bot/BotHost.ts`: delete `addTickListener`, `addPacketListener`, `addShutdownListener`, their backing Sets (`tickListeners`, `packetListeners`, `shutdownListeners`), and the now-empty fan-out loops; keep `tickCount` counting and `addFrameListener`/`addDrawListener` (heavily used). Simplify `BotClient.mainquit` passthrough accordingly.
- [ ] `src/bot/shops/StockModel.ts`: delete `buyCost` (TDD scaffolding; Planner inlines a cap-aware variant). Delete its `describe('buyCost')` block in `test/shops/stockmodel.test.ts:45-57`.
- [ ] `src/bot/quests/types.ts:33-34`: delete the `solver?: never` reserved field + its comment (YAGNI; git history preserves intent).
- [ ] `src/bot/scripts/SmelterBotLogic.ts:88-96`: delete `lastPrimaryIndex` (built for one-at-a-time smelting; Smelt-X batch rewrite obsoleted it — contrast CookBot's used twin) + its 2 test cases.
- [ ] `src/bot/runtime/Scheduler.ts`: delete the `launchGate` field (never assigned anywhere → permanently null) + its guard branch at ~line 99.
- [ ] `src/bot/multibox/DomSlotOps.ts`: remove the dead `?inputmode=synthetic` query param (~line 49) + fix the comment at ~line 20 (the param is consumed by nobody; synthetic input was collapsed to direct-only). Delete the dead re-export line `export { LOGICAL_W, LOGICAL_H, THUMB_W }` (~line 134; keep the consts module-private).
- [ ] Delete dead type re-export lines: `src/bot/runtime/RenderGate.ts:53` (`export type { RenderGateImpl }`), `src/util/WorkerClock.ts:87` (`export type { WorkerClockImpl }`).
- [ ] Delete redundant path-banner comments: `src/bot/api/Banking.ts:1`, `src/bot/api/tasks/PeriodicBank.ts:1` (`// src/bot/api/...` restating the filename).
- [ ] `src/bot/scripts/CooksAssistant.ts`: delete `log2` wrapper (~lines 85-87), point its 6 `this.bot.log2(` call sites at `this.bot.log(`.
- [ ] `src/bot/quests/QuestDashboard.ts:106`: replace the inline `r.members ? ' [M]' : ''` with the existing `tag()` helper used at :120.
- [ ] `tools/maze-derive.ts` (~line 60): stop emitting the dead `MAZE_SHRINE` duplicate into mazeRoutes.ts, then `bun tools/maze-derive.ts` to regenerate; verify the diff is exactly the removed const.
- [ ] Verify: `bun test` && `bunx tsc --noEmit`.
- [ ] Commit: `refactor: delete verified-dead code — JsUtil pair, BotHost listener API, buyCost, lastPrimaryIndex, solver field, launchGate, inert synthetic param`

### Task 3: Export-keyword hygiene sweep (drop `export` on internal-only symbols)

Drop ONLY the `export` keyword; every symbol stays defined and used in-file. Verified: none are on the ABI or imported by tests.

- [ ] `src/bot/nav/walkLadder.ts`: `StepPhase` (:21), `LadderAction` (:13-19), `StepOffset` (:106). Keep `LadderState`/`LadderObs`/`LastOutcome`/`backoffTicks` exported (imported elsewhere).
- [ ] `src/bot/nav/PathFinder.ts:62-64`: `DOOR_COST`, `TRANSPORT_COST`, `MAX_EXPANSIONS`.
- [ ] `src/bot/api`: `BANK_STRATEGY_OPTIONS` (Banking.ts:39), `COMBAT_STYLE_MODE` (CombatStyle.ts:7), `COLOUR_NOT_STARTED`/`COLOUR_IN_PROGRESS`/`COLOUR_COMPLETE` (hud/Quests.ts:17-19 — keep the colour-truncation comment), `WALL_ID` (maze/mazeGraph.ts:24), `EventKind` + `DetectedEvent` (RandomEvents.ts:86-88), `ItemSource` (ItemAcquisition.ts:20), `Pt` (eventEvade.ts:5), `MazeLoc` (mazeGraph.ts:7).
- [ ] `src/bot/runtime`: `LOG_RING_CAPACITY`, `ScriptState`, `LogLevel`, `LogLine` (ScriptContext.ts), `settingToString`, `LAMP_SKILLS`, `SettingType` (Settings.ts), `SupervisorIteration` (Supervisor.ts:13).
- [ ] `src/bot/ui/paramControls.ts`: `ControlKind` (:3), `listItems` (:23), `ParamControl` (:54), `CONTROLS` (:58). Keep `resolveControl` exported (test-imported).
- [ ] `src/bot/events/EventBus.ts`: drop `export` on `SkillXpEvent`, `SkillLevelEvent`, `InventoryChangedEvent`, `VarpChangedEvent`, `TickEvent` (:3-32) — they compose `EventMap`, which STAYS exported (public via abi events typing).
- [ ] `src/bot/quests/exec/primitives.ts:81`: `hopLadder` (internal-only; `pickPreferred`/`isUnderground`/`needsHop` stay exported — test-imported).
- [ ] `src/bot/shops/Planner.ts`: `BuyPlanItem` (:19), `ShopPlan` (:20), `Decision` (:126). `src/bot/shops/types.ts`: `GateSpec` (:30), `RouteShop` (:37).
- [ ] `src/bot/scripts`: `Ingredient` (SmelterBotLogic.ts:16), `Held` + `StepId` (RuneMysteries.ts:19-20), `HOSTILE_NAMES` + `TargetSpot` + `AttackerCandidate` (ArdyThieverLogic.ts:44,12,46).
- [ ] `src/bot/scripts/tutorial/stages/*.ts`: drop `export` from all 66 stage task classes (Survival 11, Chef 9, QuestGuide 5, Mining 10, Combat 11, BankChapel 13, Magic 5). Keep the `*Stages()` factory exports — they're the only imports TutorialBot uses.
- [ ] LEAVE: `quests/types.ts` types (imminent quest-executor consumers), `RATE_LIMIT_*` (test-imported), rsmod flags (vendored), `tools/nav/lib.ts` (low value), public-but-unused ABI members (`Npc.valid`, `Area.circular`, `EntityQuery.count`, `Npcs.nearest`, `Players`).
- [ ] `test/shops/planner.test.ts`: import `BUDGET_BUFFER` from Planner and replace the hardcoded `1.25` at :73 and :98 — makes the export real and desync-proof.
- [ ] Verify: `bun test` && `bunx tsc --noEmit`.
- [ ] Commit: `refactor: drop export on internal-only symbols; test imports BUDGET_BUFFER`

### Task 4: Shared helpers — Skills.hpFraction, ContinueDialog, Overlay, dom.el, sumCountByName

**New modules (complete code in sub-steps), then mechanical call-site replacement.**

- [ ] `src/bot/api/hud/Skills.ts`: add to the `Skills` object:
```ts
/** Effective/base hitpoints, 1 when the stat isn't readable yet. */
hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}
```
Replace the 7 byte-identical local `hpFraction()` free functions (ArdyFighter.ts:94, ArdyThiever.ts:91, ChaosDruidKiller.ts:267, ChickenKiller.ts:213, RockCrab.ts:240, ThievingBot.ts:35, WildyAgility.ts:154) with `Skills.hpFraction()` at call sites; delete the locals. ABI-additive (safe).
- [ ] New `src/bot/api/tasks/ContinueDialog.ts`:
```ts
import { ChatDialog } from '../hud/ChatDialog.js';
import type { Task } from '../Bot.js';

/** Advance any blocking chat dialog. Shared by every TaskBot script. */
export class ContinueDialog implements Task {
    constructor(private readonly onContinue?: () => void) {}
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        this.onContinue?.();
        await ChatDialog.continue();
    }
}
```
(Match the exact `Task` interface shape from `src/bot/api/Bot.ts` — check whether it's `validate()/execute()` before writing.) Replace the 18 per-script `ContinueDialog` classes: 14 no-arg copies → `new ContinueDialog()`; ChickenKiller/Woodcutter → `new ContinueDialog(() => this.setStatus('continuing dialog'))` equivalent; ChaosDruidKiller/GatheringBot had dead `bot` fields → plain `new ContinueDialog()`. Tutorial's richer `AdvanceDialog` is untouched.
- [ ] New `src/bot/api/hud/Overlay.ts`:
```ts
/** Standard status box every script paints: black backdrop, one accent colour. */
export function drawStatusBox(ctx: CanvasRenderingContext2D, lines: string[], accent: string): void {
    ctx.font = '12px monospace';
    const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(6, 6, width, lines.length * 16 + 10);
    ctx.fillStyle = accent;
    lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
}
```
FIRST diff the 22 `onPaint` scaffolds (`grep -l 'rgba(0, 0, 0, 0.6)' src/bot`) against this shape; if any file deviates (extra bars, second colour, different origin), leave that file's paint inline and note it. Replace only exact-shape matches.
- [ ] New `src/bot/ui/dom.ts` with the generic `el` (move from ParamsModal.ts:96 form):
```ts
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}
```
Replace the 4 local `el()` definitions (paramControls.ts:48, ParamsModal.ts:96, BotPanel.ts:482, ScriptLibrary.ts:165) with imports. All 53 call sites pass literal tags (verified) so the generic signature subsumes the string-typed ones.
- [ ] New `src/bot/api/hud/itemCount.ts` (or add to Inventory.ts if more natural on inspection):
```ts
/** Sum counts of items whose name matches exactly (case-insensitive). */
export function sumCountByName(items: readonly { name: string | null; count: number }[], name: string): number {
    const wanted = name.toLowerCase();
    return items.filter(i => i.name?.toLowerCase() === wanted).reduce((sum, i) => sum + i.count, 0);
}
```
Consume from the 5 sites: ItemAcquisition.ts `held`, hud/Inventory.ts `count`, hud/Bank.ts `count` + `invCount` local, hud/Shop.ts `countHeld`. Diff each site first; only replace exact matches.
- [ ] Add unit tests where a pure helper gained a new home: `test/api/overlay` isn't needed (canvas), but add `test/api/item-count.test.ts` covering sumCountByName (exact-name match, case-insensitivity, null names, summing split stacks).
- [ ] Verify: `bun test` && `bunx tsc --noEmit`.
- [ ] Commit: `refactor: shared Skills.hpFraction, ContinueDialog task, Overlay.drawStatusBox, ui/dom.el, sumCountByName — replace 56 copy-paste sites`

### Task 5: Bank withdraw-op helpers (folds the most-cited copy-paste trap)

**Files:** `src/bot/api/hud/Bank.ts`, `src/bot/scripts/{CookBot,BankFletcher,SmithingBot,FlaxSpinner}.ts`, `src/bot/scripts/EssMinerLogic.ts`, `src/bot/scripts/EssMiner.ts`, plus a new pure test.

- [ ] Read the 4 inline blocks (CookBot.ts:140-154, BankFletcher.ts:194-208, SmithingBot.ts:206-227, FlaxSpinner.ts:186-190) and `EssMinerLogic.withdrawOneOp` (:81). Extract the PURE op-resolution into Bank.ts as a helper (`resolveWithdrawOp(ops, 'all' | 'one'): string | null` — regex `/withdraw[\s-]*all/i` / `/withdraw[\s-]*1\b/i` off the live item's ops) + public `Bank.withdrawAll(name)` / `Bank.withdrawOne(name)` that resolve-then-click, preserving each caller's fallback (Withdraw-10 loop where present) EXACTLY — if fallbacks differ across the 4 sites, keep the fallback at the call site and share only the op resolution.
- [ ] Add `test/api/bank-withdraw-op.test.ts` for the pure resolver: hyphen form, space form, `Withdraw-all` vs `Withdraw all`, absent op → null.
- [ ] Migrate the 4 scripts + EssMinerLogic to the shared resolver. `git diff` each migration against the original logic line-by-line.
- [ ] Verify: `bun test` && `bunx tsc --noEmit`.
- [ ] Commit: `refactor(bank): shared withdraw-op resolver — 5 sites stop re-learning the hyphen/space label trap`

### Task 6: Nav dedups (chebyshev + isOnFarSide) and Settings precedence

- [ ] `src/bot/nav/followMath.ts`: export `chebyshev(a: {x,z}, b: {x,z})` (generalize the existing `cheb` at :10). Consume in `nav/arrival.ts` (delete local :28-30), `nav/WalkExecutor.ts` (delete local :88-90), `api/Traversal.ts:59` and `api/Reachability.ts:35` (replace inline math). Do NOT touch ClientAdapter (adapter→nav would cycle) or PathFinder's delta-form ring filters.
- [ ] `src/bot/nav/WalkExecutor.ts`: extract the byte-identical far-side predicate (closures at :559-562 and :637-645) into one helper `isOnFarSide(me, approach, step)` (pure, in followMath.ts next to chebyshev) and call it from both crossing paths. Preserve the cross-referencing comments' rationale.
- [ ] `src/bot/runtime/Settings.ts`: extract private `winningRaw(name, key, def)` returning the winning raw string + def across the precedence chain (per-script URL → per-script saved → global URL → global saved → global default → schema default); reimplement `displayString` (:195-216) and `resolve` (:219-242) on top of it. The comment at :189-194 currently asks a human to keep them mirrored — the helper enforces it. `test/runtime/settings-global.test.ts` covers both paths; run it specifically.
- [ ] Verify: `bun test` && `bunx tsc --noEmit`.
- [ ] Commit: `refactor: shared chebyshev + far-side predicate in nav; Settings precedence single-sourced`

### Task 7: RandomEvents decomposition (self-contained handlers move home)

- [ ] Move `handleMaze` + its statics (`MAZE_SHRINE_LOC`, `MAZE_DOOR_IDS`, `MAZE_FINAL_TILE`) + `walkTowards`/`walkAdjacent` (RandomEvents.ts:531-650) into `src/bot/api/maze/` as free functions `(log) => Promise<boolean>`; RandomEvents dispatches to them. Preserve tick budgets, swallowed-click re-kick, and log threading VERBATIM (live-tuned).
- [ ] Same for `handleMime` (:487-529) → `solvers/Mime.ts`, and `handleBox` (:796-834) + `handleLamp` (:836-855) → `solvers/StrangeBox.ts`. If any handler turns out to touch instance state on inspection, leave it in place and note it.
- [ ] The dispatcher, detection, cooldown backstop, and state-touching handlers (dialog/pick/evade/hazard/lost-tool/lost-gear) stay in RandomEvents.ts.
- [ ] Verify: `bun test` (RandomEvents + Mime + StrangeBox + maze tests all pass unchanged) && `bunx tsc --noEmit`.
- [ ] Commit: `refactor(events): maze/mime/box/lamp handlers move to their solver modules — RandomEvents keeps detect/dispatch`

### Task 8: ABI ↔ shim ↔ .d.ts additive reconciliation

- [ ] `packages/rs2b0t-api/index.js`: add `Shop`, `Quests`, `AcquireTask`, `hasAll`, `held` to the destructure/exports (abi.ts already installs them — runtime truth).
- [ ] `packages/rs2b0t-api/index.d.ts`: declare those five + add `Traversal.walkResilient` and the Game methods that exist on the installed object but were never typed (`runEnabled`, `animating`, `combatMode`, `setCombatStyle`, `myName`, `openSideTab`, `castOnNpc`), and `AbstractBot.recoveryAnchor`/`grindTargets`. Match the real signatures from source exactly.
- [ ] Additive only — no removals, no API_VERSION bump needed.
- [ ] Verify: `bun test` && `bunx tsc --noEmit`; also `cd templates/script-template && bun install && bunx tsc --noEmit` if the template typechecks against the shim.
- [ ] Commit: `fix(abi): shim + .d.ts catch up to installed ABI — Shop/Quests/Acquire trio, walkResilient, Game extras typed`

### Task 9: Comment pass — archaeology labels out, rationale stays

- [ ] Across `src/bot/nav/*.ts`, `src/bot/adapter/*.ts`, `bot.bundle.ts`: strip process-archaeology labels — `(Slice 5b)`, `(Amendment 1b/1c)`, `(Task 2/4/6/10)`, `(H1/H4/H7/H8)`, `PLAN.md §2` refs — while keeping every attached rationale sentence intact. Grep list: `grep -rn 'Slice [0-9]\|Amendment 1\|Task [0-9]\|(H[0-9])\|PLAN.md' src/bot bot.bundle.ts eslint.config.ts`. eslint.config.ts's `HOOKS.md` references STAY (that doc exists? verify — if HOOKS.md doesn't exist, point the fence messages at the rule's own comment instead).
- [ ] Tools stale-doc scrub: 12 refs to `docs/tutorial-map.md`, 3 to `docs/quest-campaign-map.md`, 1 to `docs/OPERATING.md` (tutorial/harness.ts:6), 2 to `docs/PLAN.md` (login-probe dies in Task 10; bot.bundle.ts). Replace each "see docs/X" with the surviving fact it pointed at, or drop the pointer if the sentence stands alone.
- [ ] Trim the handful of narrate-the-obvious comments flagged: chaosdruid-bank-test.ts:25-26, settings-test.ts:48, e2e-smoke.ts:87 (only if those files are already being touched in Task 10 — don't churn otherwise).
- [ ] KEEP everything else — especially WalkExecutor constants block, tutorial harness varp-281 writeup, Bank hyphen/space note, Quests colour truncation, shop stock math.
- [ ] Verify: `bun test` && `bunx tsc --noEmit`.
- [ ] Commit: `docs: strip plan-archaeology labels from comments, scrub dead doc pointers — rationale kept`

### Task 10: Smoke infrastructure — harness, argv fix, select-migration, sweep hygiene

- [ ] Delete `tools/tutorial-run-test.ts` (deliberately-failing Task-2 scaffold; superseded by `tools/tutorial/full-run-test.ts`; guaranteed 6-min sweep timeout). Delete `tools/login-probe.ts`, `tools/sizing-probe.ts` (spent one-off probes; login handshake covered by e2e-smoke/hosted-proof/proxy-check).
- [ ] `tools/run-all-smokes.ts`: add `rendergate-test` to `SPECIAL` (Electron-based; currently swept as a bun/engine smoke).
- [ ] New `tools/lib/harness.ts` — extract the shared smoke plumbing with signatures:
```ts
export type Rs2b0t = { rs2b0t: { client: unknown; runner: unknown; reader: unknown; registry: unknown; actions?: unknown } };
export const OFF_ISLAND_TELE = '::tele 0,50,50,20,20';
export function fail(msg: string): never;
/** Order-independent: URL-looking arg = base, number-looking = minutes. Both argv orders in the fleet stay valid. */
export function parseArgs(argv: string[], defaults?: { base?: string; minutes?: number }): { base: string; minutes: number; rest: string[] };
export async function launchBrowser(): Promise<Browser>; // channel:'chrome', headless per env — single strategy, kills the 19 hardcoded mac paths
export function boot(page: Page): Promise<void>;
export function login(page: Page, user: string, pass?: string): Promise<void>;
export function type(page: Page, cmd: string, waitMs?: number): Promise<void>; // waitMs PRESERVES each caller's current 1300/1400/1500
export function bringUpOffIsland(page: Page, user: string): Promise<void>;
export function startFromLibrary(page: Page, category: string, script: string): Promise<void>; // Browse… → chip → .rs2b0t-library-card
export function tailLog(page: Page, from: number): Promise<string[]>;
```
Base the bodies on the most common byte-shape (agility/chaosdruid/tollgate family) and the proven Browse-modal sequence from chicken-test.ts/library-test.ts. Add `test/tools/harness-args.test.ts` for `parseArgs` (url-first, minutes-first, flags, defaults).
- [ ] Migrate the 8 `.rs2b0t-select` smokes to `startFromLibrary`: event-test.ts:72, nav-test.ts:77, relogin-test.ts:42, rockcrab-test.ts:81, settings-test.ts:61+95, woodcut-test.ts:106, e2e-smoke.ts:134, desktop-test.ts:64 (desktop-test drives Electron — adapt the same clicks through its page handle).
- [ ] Migrate the 13 minutes-first argv smokes to `parseArgs` (agility, ardyfighter, ardyfighter-death, chaosdruid, chaosdruid-bank, chicken, cow, fishing, fletching, gathering, herblore, rockcrab, woodcut) — un-breaks them under the sweep (they currently parse the base URL as minutes → NaN deadline).
- [ ] While in those files: fix the quote-lint errors (backtick literals in agility:36, chaosdruid:34, herblore:32, chaosdruid-bank:36, tollgate:106, thiever-knight:125, ardyfighter-death:151-154, live-proxy:38+126) and bank-wedge-test.ts's 2-space indentation. Re-run `bunx eslint tools` → 0 errors.
- [ ] Migrate each touched file fully onto the harness (boot/login/type/fail/Rs2b0t) with its ORIGINAL waitMs values; `git diff` per file to confirm timing values survived.
- [ ] Verify: `bun test` && `bunx tsc --noEmit` && `bunx eslint .` (0 errors). NOTE in the final report: smokes are statically migrated to proven patterns but NOT live-verified (needs the local engine).
- [ ] Commit: `fix(tools): smoke harness — order-independent args un-break 13 swept smokes, Browse-modal migration for 8 dead-selector smokes, rendergate to SPECIAL, dead probes deleted`

### Task 11 (stretch — only if Tasks 1-10 all green): fleet-wide harness migration

- [ ] Migrate the remaining ~30 top-level smokes onto `tools/lib/harness.ts` in batches of ~8 (subagent per batch), preserving per-file waitMs and any bespoke steps verbatim. `git diff` review per file; `bunx tsc --noEmit` + `bunx eslint tools` per batch.
- [ ] Commit per batch: `refactor(tools): smoke batch N onto shared harness`

### Task 12: Final verification + review

- [ ] `bun test` (≥390 pass, plus new helper tests), `bunx tsc --noEmit`, `bunx eslint .` → 0 errors, `bun run build` AND `bun run build:bot` both succeed.
- [ ] `bun tools/shops/gen-shopdb.ts --check` and `bun tools/clues/gen-cluedb.ts --check` still pass (drift gates).
- [ ] superpowers:requesting-code-review on the full branch diff; fix findings.
- [ ] Summarize: what changed, what was deliberately deferred (see list above), what needs live smoke verification.
