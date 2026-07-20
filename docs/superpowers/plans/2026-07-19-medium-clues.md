# Medium Clue Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped easy-clue solver to also solve all 56 medium clues — maps, coordinate/sextant digs, riddles (incl. kill-for-key combat), anagrams/speak-to, and challenge scrolls — reusing the existing obj-id-keyed DB, bank-first prep, and reactive executor.

**Architecture:** Content-derived like easy: extend `gen-cluedb`/`cluesParse` to also parse `trail_medium`, emit medium rows into the same `CLUE_DB` with two additive `ClueRow` fields (`needsSextant`, `keyFrom`). The `ClueExecutor` gets three new branches (coordinate-dig require-items, kill-for-key combat→loot→search, challenge-scroll answer); `SolveClue`'s bank keep-set grows to protect the sextant/watch/chart + a weapon. The offline audit extends to gate every medium clue.

**Tech Stack:** TypeScript (Bun), `bun test`, `bunx tsc --noEmit`, the content pack at `~/code/rs2b2t-content`, Playwright live smokes vs the local engine.

Spec: `docs/superpowers/specs/2026-07-19-medium-clues-design.md`.

## Global Constraints

- **NEVER touch or commit `src/client/GameShell.ts`** (user's WIP).
- Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Typecheck gate per task: `bunx tsc --noEmit 2>&1 | grep -E "clues|cluedb|SolveClue|ClueExecutor|ClueSolver|RockCrab"` must be empty (pre-existing unrelated errors tolerated).
- Unit-test gate: `bun test` passes fully.
- The generated file `src/bot/clues/data/cluedb.ts` is produced by `bun tools/clues/gen-cluedb.ts` — **never hand-edit it**; regenerate. The drift gate `bun tools/clues/gen-cluedb.ts --check` must pass.
- Content root: `$CONTENT_DIR` or `~/code/rs2b2t-content`. Medium content lives under `scripts/minigames/game_trail/{configs/trail_medium.{enum,obj},scripts/medium/}`.
- Live smokes need the local engine on `http://localhost:8890` (`curl -s -o /dev/null -w "%{http_code}" http://localhost:8890/bot.html` → 200). Deploy + freshness before smoking: `bash tools/deploy-local.sh`, sleep 2, `BUILT=$(shasum out/botclient.js|cut -d' ' -f1); SERVED=$(curl -s http://localhost:8890/bot/botclient.js|shasum|cut -d' ' -f1); [ "$BUILT" = "$SERVED" ] && echo FRESH || echo STALE`. macOS has no `timeout`; poll with bounded `until` loops.
- The user commits concurrently on this checkout — before any `git add`, run `git status --short` and stage only the files the task names (never `-A`).
- Easy-clue behavior must NOT regress: the new executor branches are gated on the new fields (`needsSextant`/`keyFrom`) or medium ids, so easy rows take the existing paths untouched.

---

### Task 1: additive `ClueRow` fields

**Files:**
- Modify: `src/bot/clues/types.ts`
- Test: `src/bot/clues/types.test.ts` (create)

**Interfaces:**
- Produces: `ClueRow.needsSextant?: boolean`; `ClueRow.keyFrom?: { npc: string; keyObj: string; keyId: number }`. Consumed by Tasks 2 (generator emits them), 4/5 (executor reads them), 8 (audit checks them).

- [ ] **Step 1: Write the failing test**

Create `src/bot/clues/types.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ClueRow } from './types.js';

describe('ClueRow medium fields', () => {
    test('a sextant dig row carries needsSextant', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_sextant001', id: 1, type: 'dig', coord: { x: 1, z: 2, level: 0 }, casketObj: 'c', casketId: 2, needsSextant: true };
        expect(row.needsSextant).toBe(true);
    });
    test('a kill-for-key search row carries keyFrom', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_riddle001', id: 3, type: 'search', coord: { x: 1, z: 2, level: 0 }, keyFrom: { npc: 'Black Heather', keyObj: 'trail_clue_medium_riddle001_key', keyId: 99 } };
        expect(row.keyFrom?.keyId).toBe(99);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/clues/types.test.ts`
Expected: FAIL — TS errors "Object literal may only specify known properties" for `needsSextant`/`keyFrom`.

- [ ] **Step 3: Add the fields**

In `src/bot/clues/types.ts`, inside the `ClueRow` interface, after the `npc?` line, add:

```ts
    /** dig only: true for coordinate/sextant clues — require sextant+watch+chart
     *  held (in addition to a Spade) before the dig will yield the casket. */
    needsSextant?: boolean;
    /** search only: a kill-for-key riddle. The locked container at `coord` needs
     *  a key that drops when the named NPC is killed while the clue is held. */
    keyFrom?: { npc: string; keyObj: string; keyId: number };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/clues/types.test.ts` → PASS. Then `bun test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bot/clues/types.ts src/bot/clues/types.test.ts
git commit -m "feat(clues): additive ClueRow fields for medium (needsSextant, keyFrom)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: parse the medium content into `CLUE_DB`

**Files:**
- Modify: `tools/clues/cluesParse.ts`
- Modify: `tools/clues/gen-cluedb.ts`
- Modify: `tools/clues/cluesParse.test.ts` (create if absent)
- Regenerate: `src/bot/clues/data/cluedb.ts`

**Interfaces:**
- Consumes: Task 1's `ClueRow` fields.
- Produces: medium rows in `CLUE_DB` (dig with `needsSextant` for sextant clues, search with `keyFrom` for kill-for-key riddles, plain search for other riddles, dig for maps, talk for anagrams); `parseTalkMappings(text, tier: 'easy' | 'medium')`; `parseKillForKey(text): Record<string, { npc: string; keyObj: string }>` keyed by riddle obj; `buildClueDb` accepts `killForKey` + `objIds` to resolve `keyId`.

- [ ] **Step 1: Verify the content shape first (no code yet)**

Run these and read the output — the parser must match the REAL structure:
```bash
C=~/code/rs2b2t-content/scripts/minigames/game_trail
# how each medium kind stores its answer (coord/loc/casket):
for k in map001 sextant001 riddle001 riddle006 anagram001; do echo "== $k =="; awk "/\[trail_clue_medium_$k\]/{f=1} f&&/^\[/&&!/$k\]/{exit} f&&/param=trail_/{print}" $C/configs/trail_medium.obj; done
# the kill-for-key npc→key map:
sed -n '41,58p' $C/scripts/medium/trail_clue_medium.rs2
# medium talk (anagram/speak-to) progress calls + their opnpc owners:
grep -rnE "progress_clue_medium\(\s*trail_clue_medium_anagram|opnpc[0-9]" $C/scripts/medium/*.rs2 | head
# challenge answers (obj param trail_challenge_answer):
grep -rnE "trail_challenge_answer|_challenge0" $C/configs/*.obj $C/scripts/medium/*.rs2 | head
```
Record in the report: which kinds carry `trail_casket` (→ dig) vs `trail_loc=^true` (→ search), and the exact `progress_clue_medium(...)` call form (the generator's talk regex must match it).

- [ ] **Step 2: Write the failing parser tests**

Append to `tools/clues/cluesParse.test.ts` (create with the standard imports if absent — mirror the existing easy tests' structure):

```ts
import { describe, expect, test } from 'bun:test';
import { parseKillForKey, parseTalkMappings } from './cluesParse.js';

describe('parseTalkMappings tier', () => {
    test('matches medium progress calls', () => {
        const src = '[opnpc1,donovan]\n~progress_clue_medium(trail_clue_medium_anagram005, "x");';
        expect(parseTalkMappings(src, 'medium')).toEqual([{ obj: 'trail_clue_medium_anagram005', npc: 'donovan' }]);
    });
    test('easy tier still matches easy calls only', () => {
        const src = '[opnpc1,ned]\n~progress_clue_easy(trail_clue_easy_simple021, "x");';
        expect(parseTalkMappings(src, 'easy')).toEqual([{ obj: 'trail_clue_easy_simple021', npc: 'ned' }]);
    });
});

describe('parseKillForKey', () => {
    test('extracts riddle→npc/key from trail_checkmediumdrop', () => {
        const src = 'if(npc_type = black_heather & inv_total(inv, trail_clue_medium_riddle001) > 0 & ~obj_gettotal(trail_clue_medium_riddle001_key) = 0) {\n    obj_add(npc_coord, trail_clue_medium_riddle001_key, 1, ^lootdrop_duration);\n}';
        expect(parseKillForKey(src)['trail_clue_medium_riddle001']).toEqual({ npc: 'black_heather', keyObj: 'trail_clue_medium_riddle001_key' });
    });
    test('handles npc_name / npc_category forms', () => {
        const src = 'if(compare(npc_name, "Man") = 0 & inv_total(inv, trail_clue_medium_riddle005) > 0) {\n obj_add(npc_coord, trail_clue_medium_riddle005_key, 1, 0);\n}\nif(npc_category = pirate & inv_total(inv, trail_clue_medium_riddle007) > 0) {\n obj_add(npc_coord, trail_clue_medium_riddle007_key, 1, 0);\n}';
        const m = parseKillForKey(src);
        expect(m['trail_clue_medium_riddle005'].npc).toBe('Man');
        expect(m['trail_clue_medium_riddle007'].npc).toBe('pirate');
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tools/clues/cluesParse.test.ts` → FAIL (`parseKillForKey` not exported; `parseTalkMappings` takes 1 arg).

- [ ] **Step 4: Implement the parser changes**

In `tools/clues/cluesParse.ts`:

1. Replace the hardcoded `PROGRESS_RE` and `parseTalkMappings` with a tier-parameterised version:

```ts
const OPNPC_RE = /^\[opnpc\d+,([a-z0-9_]+)\]/;
const progressRe = (tier: 'easy' | 'medium'): RegExp =>
    new RegExp(`~progress_clue_${tier}\\(\\s*(trail_clue_${tier}_[a-z0-9]+)`);

export function parseTalkMappings(scriptText: string, tier: 'easy' | 'medium' = 'easy'): TalkMapping[] {
    const re = progressRe(tier);
    const out: TalkMapping[] = [];
    let npc = '';
    for (const raw of scriptText.split('\n')) {
        const line = raw.trim();
        const h = OPNPC_RE.exec(line);
        if (h) {
            npc = h[1];
        }
        const c = re.exec(line);
        if (c && npc) {
            out.push({ obj: c[1], npc });
        }
    }
    return out;
}
```

2. Add the kill-for-key parser (matches all three NPC forms in `trail_checkmediumdrop`):

```ts
/** Parse trail_clue_medium.rs2's trail_checkmediumdrop: each branch ties a
 *  riddle obj to the NPC whose death drops its `_key`. Returns riddleObj →
 *  { npc, keyObj }. `npc` is the content token (npc_type/npc_category) or the
 *  quoted npc_name (e.g. "Man"); the generator maps it to a display name. */
export function parseKillForKey(scriptText: string): Record<string, { npc: string; keyObj: string }> {
    const out: Record<string, { npc: string; keyObj: string }> = {};
    // e.g.  npc_type = black_heather ... inv_total(inv, trail_clue_medium_riddle001) ... trail_clue_medium_riddle001_key
    const line = /(npc_type|npc_category)\s*=\s*([a-z0-9_]+)[\s\S]*?(trail_clue_medium_riddle\d+)|compare\(npc_name,\s*"([^"]+)"\)[\s\S]*?(trail_clue_medium_riddle\d+)/g;
    for (const m of scriptText.matchAll(line)) {
        const riddle = m[3] ?? m[5];
        const npc = m[2] ?? m[4];
        if (riddle && npc) {
            out[riddle] = { npc, keyObj: `${riddle}_key` };
        }
    }
    return out;
}
```

3. Extend `BuildInput` and `buildClueDb` to classify medium rows. Add to `BuildInput`:

```ts
    /** riddleObj → { npcDisplay, keyObj, keyId } — kill-for-key rows. */
    killForKey?: Record<string, { npc: string; keyObj: string; keyId: number }>;
```

In `buildClueDb`, after the existing `parsed.loc === '^true'` search branch sets `row.type = 'search'` and its coord, add — still inside that branch — the medium enrichments (guarded so easy rows are untouched):

```ts
            const kfk = input.killForKey?.[obj];
            if (kfk) {
                row.keyFrom = { npc: kfk.npc, keyObj: kfk.keyObj, keyId: kfk.keyId };
            }
```

And in the `parsed.casket` dig branch, after setting the casket, flag sextant clues by name:

```ts
            if (/_sextant\d+$/.test(obj)) {
                row.needsSextant = true;
            }
```

(If Step 1 showed sextant clues do NOT carry `trail_casket` — i.e. they classify as talk/search — adjust: give them a `dig`+`needsSextant` row from their `trail_coord` via the same `specials`-style override the generator already supports for `vague003`. Record the chosen path in the report.)

- [ ] **Step 5: Run parser tests → pass**

Run: `bun test tools/clues/cluesParse.test.ts` → PASS.

- [ ] **Step 6: Wire the medium pass into `gen-cluedb.ts`**

In `tools/clues/gen-cluedb.ts`'s `generate()`, after the easy `buildClueDb` call, add a medium pass and merge:

```ts
    const mediumEnum = readFileSync(join(TRAIL, 'trail_medium.enum'), 'utf8');
    const mediumObj = readFileSync(join(TRAIL, 'trail_medium.obj'), 'utf8');
    const mediumTalk = filesUnder(join(CONTENT, 'scripts'), '.rs2').flatMap(f => parseTalkMappings(readFileSync(f, 'utf8'), 'medium'));
    const kfkRaw = parseKillForKey(readFileSync(join(TRAIL, 'scripts', 'medium', 'trail_clue_medium.rs2'), 'utf8'));
    const objIds = loadObjIds();
    const killForKey: Record<string, { npc: string; keyObj: string; keyId: number }> = {};
    const npcTokenDisplay = loadNpcDisplayNames(); // debugname → display; npc_name tokens ("Man") pass through
    for (const [riddle, v] of Object.entries(kfkRaw)) {
        const keyId = objIds.get(v.keyObj);
        if (keyId === undefined) { throw new Error(`no obj id for ${v.keyObj}`); }
        killForKey[riddle] = { npc: npcTokenDisplay.get(v.npc) ?? v.npc, keyObj: v.keyObj, keyId };
    }
    const medium = buildClueDb({
        clueNames: parseEnum(mediumEnum), objs: parseClueObjs(mediumObj), objIds,
        talk: mediumTalk, npcDisplay: loadNpcDisplayNames(), killForKey
    });
    Object.assign(db, medium.db);
    Object.assign(caskets, medium.caskets);
```

(`db`/`caskets` must be `let`/mutable from the easy `buildClueDb` result — destructure then merge. Reuse the existing `loadObjIds`/`loadNpcDisplayNames`.)

- [ ] **Step 7: Regenerate + drift-check**

Run: `bun tools/clues/gen-cluedb.ts` — expect the console line to now report ~122 clues (66 easy + 56 medium). Then `bun tools/clues/gen-cluedb.ts --check` → `ok`. Eyeball `src/bot/clues/data/cluedb.ts`: medium ids present, sextant rows have `needsSextant:true`, the 7 kill-for-key riddles have `keyFrom` with a display npc + a numeric `keyId`, anagram rows are `talk` with an npc.

- [ ] **Step 8: Typecheck + full tests + commit**

`bunx tsc --noEmit 2>&1 | grep -E "clues"` → empty. `bun test` → pass.

```bash
git add tools/clues/cluesParse.ts tools/clues/cluesParse.test.ts tools/clues/gen-cluedb.ts src/bot/clues/data/cluedb.ts
git commit -m "feat(clues): generate the 56 medium clues into CLUE_DB (maps/sextant/riddle/anagram)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: talk anchors for the medium NPCs

**Files:**
- Modify: `src/bot/clues/data/talkAnchors.ts`

**Interfaces:**
- Consumes: the medium `talk` rows from Task 2 (their ids + npc display names).
- Produces: a `TALK_ANCHORS[id]` `Tile` for every medium talk (anagram/speak-to) clue.

- [ ] **Step 1: List the medium talk clues needing anchors**

```bash
node -e "const {CLUE_DB}=require('./src/bot/clues/data/cluedb.ts'); for(const [id,r] of Object.entries(CLUE_DB)) if(r.type==='talk' && r.obj.includes('medium')) console.log(id, r.npc, r.obj)" 2>/dev/null \
  || bun -e "import {CLUE_DB} from './src/bot/clues/data/cluedb.js'; for(const [id,r] of Object.entries(CLUE_DB)) if(r.type==='talk'&&r.obj.includes('medium')) console.log(id,r.npc,r.obj)"
```

- [ ] **Step 2: Resolve each NPC's spawn tile from the content maps**

For each listed NPC, find its spawn: `grep -rn "<npc debugname>" ~/code/rs2b2t-content/maps/*.jm2` (the `==== NPC ====` sections give absolute tiles), cross-checked against the spec's Anagram/Speak-to location column (e.g. Donovan → Sinclair Mansion 2nd floor; Kangai Mau → Brimhaven food store; Party Pete → Seers' bank). Add one entry per id to `TALK_ANCHORS`, matching the existing format:

```ts
    <id>: new Tile(<x>, <z>, <level>), // <NPC> — <place>
```

(No code sample can enumerate all ~20 tiles blindly — resolve each from the map data; the audit in Task 8 fails any anchor that isn't pathable or lacks a matching NPC spawn within `NPC_LEASH`, so a wrong tile is caught offline before commit.)

- [ ] **Step 3: Typecheck + commit**

`bunx tsc --noEmit 2>&1 | grep -E "talkAnchors"` → empty. `bun test` → pass (the audit test may still fail for non-talk medium clues until Task 8 — that's expected; if `test/clues/clue-audit.test.ts` now fails ONLY on anchors, they're wrong; fix them).

```bash
git add src/bot/clues/data/talkAnchors.ts
git commit -m "feat(clues): talk anchors for the 20 medium anagram/speak-to NPCs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: executor — coordinate-dig require-items gate

**Files:**
- Modify: `src/bot/clues/ClueExecutor.ts` (`blockReason`, and the `dig` case comment)

**Interfaces:**
- Consumes: `ClueRow.needsSextant`.
- Produces: a `dig` step with `needsSextant` abandons cleanly when the sextant/watch/chart aren't all held.

- [ ] **Step 1: Add the require-check to `blockReason`**

In `ClueExecutor.ts`, near the top add the item names:

```ts
const COORD_ITEMS = ['Sextant', 'Watch', 'Chart'];
```

In `blockReason(step)`, before the final `return null`, add:

```ts
    if (step.type === 'dig' && (step as ClueRow).needsSextant) {
        const missing = COORD_ITEMS.filter(n => !Inventory.first(n));
        if (missing.length > 0) {
            return `coordinate clue needs ${missing.join('+')} (not held)`;
        }
    }
```

(Import `ClueRow` type at the top: `import type { ClueRow, ClueStep } from '#/bot/clues/types.js';` — replace the existing `ClueStep`-only import.)

- [ ] **Step 2: Verify (no unit test — executor is live-gated like today)**

`bunx tsc --noEmit 2>&1 | grep ClueExecutor` → empty. `bun test` → pass. Confirm by reading: a `needsSextant` dig with no sextant returns the block string → `solveHeldClue` end('abandon', reason) → the clue stays in the pack with a logged reason. A `needsSextant` dig WITH all three held falls through to the normal dig path unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/bot/clues/ClueExecutor.ts
git commit -m "feat(clues): coordinate clues require sextant+watch+chart, else abandon cleanly

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: executor — kill-for-key riddles

**Files:**
- Modify: `src/bot/clues/ClueExecutor.ts` (the `search` case in `dispatch`)

**Interfaces:**
- Consumes: `ClueRow.keyFrom`, `Npcs`, `GroundItems`, `Game.inCombat`.
- Produces: a `search` step with `keyFrom` first kills the NPC + loots the key (idempotent: skipped once the key is held), then searches.

- [ ] **Step 1: Add the imports + kill-for-key helper**

At the top of `ClueExecutor.ts` add:

```ts
import { Game } from '#/bot/api/Game.js';
import { Npcs } from '#/bot/api/queries/Npcs.js';
import { GroundItems } from '#/bot/api/queries/GroundItems.js';
```

Add constants near the others:

```ts
const KILL_WAIT_MS = 20_000; // per fight: attack → NPC dead
const LOOT_WAIT_MS = 3000; // key ground-item to appear + be taken
```

Add a helper above `dispatch`:

```ts
/** Kill-for-key: get the riddle key into the pack. Idempotent — returns true
 *  immediately if already held. Walk to the NPC, Attack, wait for it to die,
 *  then Take the dropped key. Bounded; false if it can't reach/kill/loot. */
async function acquireRiddleKey(kf: NonNullable<ClueRow['keyFrom']>, coord: NavPoint, log: (m: string) => void): Promise<boolean> {
    if (Inventory.items().some(i => i.id === kf.keyId)) {
        return true;
    }
    // The target roams near the container coord (content spawns them there);
    // walkResilient near it, then fight the nearest matching NPC.
    await Traversal.walkResilient(coord, { radius: 5, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log });
    const target = Npcs.query().name(kf.npc).action('Attack').within(NPC_LEASH).nearest();
    if (!target) {
        log(`kill-for-key: no '${kf.npc}' near the container`);
        return false;
    }
    await target.interact('Attack');
    // dead = the key is on the ground OR already in the pack OR the npc is gone and we're out of combat
    await Execution.delayUntil(
        () => Inventory.items().some(i => i.id === kf.keyId)
            || GroundItems.query().where(g => g.name === kf.keyObj || (g.name ?? '').toLowerCase().includes('key')).nearest() !== null,
        KILL_WAIT_MS
    );
    const key = GroundItems.query().where(g => g.name === kf.keyObj || (g.name ?? '').toLowerCase().includes('key')).nearest();
    if (key) {
        await key.interact('Take');
        await Execution.delayUntil(() => Inventory.items().some(i => i.id === kf.keyId), LOOT_WAIT_MS);
    }
    return Inventory.items().some(i => i.id === kf.keyId);
}
```

(If `GroundItem` exposes no `.where`, use `GroundItems.query().results().find(...)` — confirm the query surface in `src/bot/api/queries/Query.ts` and match it.)

- [ ] **Step 2: Call it from the `search` case**

In `dispatch`, at the top of `case 'search':` (before the walk), add:

```ts
            const kf = (step as ClueRow).keyFrom;
            if (kf) {
                if (!(await acquireRiddleKey(kf, step.coord, log))) {
                    return; // no key yet — retry next attempt (or abandon after STEP_ATTEMPTS)
                }
            }
```

(`step.coord` is defined for search rows — the existing `if (!step.coord) return;` guard runs right after; move the `kf` block below that guard so `step.coord` is non-null.)

- [ ] **Step 3: Verify + commit**

`bunx tsc --noEmit 2>&1 | grep ClueExecutor` → empty. `bun test` → pass. Read-through: a `keyFrom` search with the key already held skips straight to the search; without it, one attempt walks+fights+loots, and `solveStep`'s retry loop re-enters (the key persists across attempts) until the container is searched or `STEP_ATTEMPTS` abandons.

```bash
git add src/bot/clues/ClueExecutor.ts
git commit -m "feat(clues): kill-for-key riddles — fight the NPC, loot the key, search the container

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: executor — challenge scrolls

**Files:**
- Modify: `src/bot/clues/ClueExecutor.ts` (the `talk` case / `drainChat`)
- Create: `src/bot/clues/data/challengeAnswers.ts`

**Interfaces:**
- Consumes: the count-dialog answer path (`reader.countDialogOpen()` + the answer action `Bank.withdrawX` uses at `Bank.ts:48-70`).
- Produces: during a talk step, an open challenge (integer-input) is answered from `CHALLENGE_ANSWERS`.

- [ ] **Step 1: Curate the challenge answers**

Create `src/bot/clues/data/challengeAnswers.ts`:

```ts
/** Medium challenge-scroll answers. Some anagram/speak-to NPCs pose a maths
 *  question via a p_countdialog integer input before advancing the trail; the
 *  executor enters the matching number. Keyed by a lowercased substring of the
 *  question text (matched with String.includes). Source: the spec's Challenge
 *  Scrolls table + oc_param(trail_challenge_answer) in the content. */
export const CHALLENGE_ANSWERS: { match: string; answer: number }[] = [
    { match: 'animals in total', answer: 40 },      // zoo animals
    { match: 'cannons does', answer: 9 },           // Lumbridge Castle cannons
    { match: '16 kebabs', answer: 5 },              // share kebabs
    { match: 'x is 15 and y is 3', answer: 48 },    // 3x + y
    { match: '19 to the power of 3', answer: 6859 },
    { match: '57 x 89', answer: 5096 }              // 57*89+23
];

/** The answer for an open challenge whose prompt text is `q`, or null. */
export function challengeAnswer(q: string): number | null {
    const t = q.toLowerCase();
    return CHALLENGE_ANSWERS.find(a => t.includes(a.match))?.answer ?? null;
}
```

- [ ] **Step 2: Answer an open challenge during talk**

In `ClueExecutor.ts`, import at top: `import { challengeAnswer } from '#/bot/clues/data/challengeAnswers.js';` and the reader is already imported.

Add a helper (reads the challenge prompt from the open chat/objbox text, enters the number the same way `Bank.withdrawX` answers its count dialog):

```ts
/** If a challenge integer-input is open, answer it from CHALLENGE_ANSWERS.
 *  Returns true if it handled one. The prompt text comes from the open chat
 *  modal; the numeric entry uses the same count-dialog answer path as
 *  Bank.withdrawX (reader.countDialogOpen() + actions count answer). */
async function answerChallengeIfOpen(log: (m: string) => void): Promise<boolean> {
    if (!reader.countDialogOpen()) {
        return false;
    }
    const prompt = ChatDialog.promptText?.() ?? ''; // the question text; confirm the exact getter on ChatDialog
    const n = challengeAnswer(prompt);
    if (n === null) {
        log(`challenge: no answer for "${prompt.slice(0, 40)}" — abandoning`);
        return false;
    }
    // enter `n` into the count dialog — mirror Bank.withdrawX's answer call (Bank.ts:48-70)
    await actions.answerCountDialog(n); // confirm the exact actions method name used by Bank.withdrawX
    log(`challenge answered: ${n}`);
    return true;
}
```

Call it inside `solveStep`'s loop, right after `await drainChat();` and before `await dispatch(...)`, so an open challenge is answered before the next interact:

```ts
        await drainChat();
        await answerChallengeIfOpen(log);
        await dispatch(step, log);
```

(Confirm the two API names against the codebase: the prompt-text getter on `ChatDialog` and the count-answer action `Bank.withdrawX` uses. If `ChatDialog` has no prompt getter, read the open modal's text via `reader` the way `ChatDialog` does internally, or match on the challenge OBJ id held instead of the text.)

- [ ] **Step 3: Test the pure answer table**

Create `src/bot/clues/data/challengeAnswers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { challengeAnswer } from './challengeAnswers.js';

describe('challengeAnswer', () => {
    test('matches the zoo question', () => { expect(challengeAnswer('How many animals in total are there in the zoo?')).toBe(40); });
    test('matches the power question', () => { expect(challengeAnswer('What is 19 to the power of 3?')).toBe(6859); });
    test('unknown → null', () => { expect(challengeAnswer('What colour is the sky?')).toBeNull(); });
});
```

Run: `bun test src/bot/clues/data/challengeAnswers.test.ts` → PASS.

- [ ] **Step 4: Typecheck + commit**

`bunx tsc --noEmit 2>&1 | grep -E "ClueExecutor|challenge"` → empty. `bun test` → pass.

```bash
git add src/bot/clues/ClueExecutor.ts src/bot/clues/data/challengeAnswers.ts src/bot/clues/data/challengeAnswers.test.ts
git commit -m "feat(clues): answer challenge scrolls via the count-dialog input

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: bank keep-set — sextant/watch/chart + weapon

**Files:**
- Modify: `src/bot/clues/SolveClue.ts` (`SolveClueHost`, `bankFirst` keep-set + withdraws)
- Modify: `src/bot/scripts/ClueSolver.ts` (host wiring)
- Modify: `src/bot/scripts/RockCrab.ts` (host wiring)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SolveClueHost.weaponName?(): string` (optional); `bankFirst` keeps + tries to withdraw Sextant/Watch/Chart and the weapon.

- [ ] **Step 1: Extend the host interface**

In `SolveClue.ts` `SolveClueHost`, after `spadeName()`, add:

```ts
    /** A held weapon name to keep + withdraw for kill-for-key riddles; '' = none. */
    weaponName?(): string;
```

- [ ] **Step 2: Keep + withdraw the coordinate items and weapon**

In `bankFirst`, extend the keep predicate. Replace the `isKeep` body to also protect the coordinate trio + the weapon:

```ts
        const spade = this.host.spadeName().toLowerCase();
        const weapon = (this.host.weaponName?.() ?? '').toLowerCase();
        const coordItems = new Set(['sextant', 'watch', 'chart']);
        const isKeep = (name: string): boolean => {
            const n = name.toLowerCase();
            return protectedNames.has(n) || n.includes('clue') || n.includes('casket') || this.host.isFood(name)
                || n === spade || n === 'coins' || coordItems.has(n) || (weapon !== '' && n === weapon);
        };
```

After the spade withdraw block, add a best-effort weapon withdraw (coordinate items are kept if present but NOT auto-withdrawn — they're player-supplied and only some clues need them; withdrawing a weapon helps the combat riddles):

```ts
        const weaponName = this.host.weaponName?.() ?? '';
        if (weaponName !== '' && !Inventory.first(weaponName)) {
            await Bank.withdraw(weaponName, 'Withdraw-1');
            await Execution.delayUntil(() => Inventory.first(weaponName) !== null, 2500);
        }
```

- [ ] **Step 3: Wire both hosts**

In `src/bot/scripts/ClueSolver.ts`, in the `new SolveClue({...})` object, add:

```ts
            weaponName: () => this.settings.str('weapon', ''),
```

In `src/bot/scripts/RockCrab.ts`, in its `new SolveClue({...})` object, add (RockCrab already has a combat weapon concept — reuse its configured weapon name, or `''` if none):

```ts
            weaponName: () => '',
```

- [ ] **Step 4: Typecheck + tests + commit**

`bunx tsc --noEmit 2>&1 | grep -E "SolveClue|ClueSolver|RockCrab"` → empty. `bun test` → pass.

```bash
git add src/bot/clues/SolveClue.ts src/bot/scripts/ClueSolver.ts src/bot/scripts/RockCrab.ts
git commit -m "feat(clues): keep sextant/watch/chart + a weapon in the clue bank keep-set

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: extend the offline audit to all medium clues

**Files:**
- Modify: `tools/clues/audit-clues.ts`
- Modify: `test/clues/clue-audit.test.ts` (the pack-gated pin — confirm it audits the whole `CLUE_DB`, which now includes medium)

**Interfaces:**
- Consumes: the full `CLUE_DB` (easy + medium), `TALK_ANCHORS`, `CHALLENGE_ANSWERS`.
- Produces: the audit fails on any malformed/unreachable medium clue.

- [ ] **Step 1: Confirm the audit already iterates the whole DB**

Read `tools/clues/audit-clues.ts`'s main loop — it iterates `CLUE_DB`, so medium rows are audited by the existing search/dig/talk checks the moment they exist. Run it: `bun tools/clues/audit-clues.ts` and read the findings — every medium clue is now checked (dig coord standable, search loc present + reachable, talk anchor + spawn).

- [ ] **Step 2: Add the medium-specific assertions**

In `audit-clues.ts`, after the per-type checks, add checks keyed on the new fields (find the loop that builds findings and extend it):

```ts
    // medium: kill-for-key rows must carry a resolved npc + numeric key id
    if (row.type === 'search' && row.keyFrom) {
        if (!row.keyFrom.npc || !Number.isFinite(row.keyFrom.keyId)) {
            findings.push({ id, obj: row.obj, type: row.type, problem: `keyFrom unresolved (${JSON.stringify(row.keyFrom)})` });
        }
    }
    // medium: sextant digs must be flagged + have a coord like any dig
    if (row.type === 'dig' && /_sextant\d+$/.test(row.obj) && !row.needsSextant) {
        findings.push({ id, obj: row.obj, type: row.type, problem: 'sextant clue missing needsSextant flag' });
    }
```

- [ ] **Step 3: Run the audit to zero failures**

Run: `bun tools/clues/audit-clues.ts` → `audited 122 clues: 122 clean, 0 problem(s)` (66 easy + 56 medium). Fix any finding at its source: a bad talk anchor (Task 3), an unreachable dig/search coord (the content coord or a nav-data gap — apply the same `specials`/curated-edge approach easy uses), or an unresolved `keyFrom` (Task 2). Iterate until clean.

- [ ] **Step 4: Run the pack-gated test + commit**

Run: `bun test test/clues/clue-audit.test.ts` → pass (pins the audit to zero). `bun test` → all pass.

```bash
git add tools/clues/audit-clues.ts test/clues/clue-audit.test.ts
git commit -m "test(clues): audit all 122 clues (easy + medium) — kill-for-key + sextant checks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: live smoke — one of each medium mechanic

**Files:**
- Modify: `tools/cluesolve-test.ts` (add a medium mode) OR Create: `tools/clues/mediumsolve-test.ts`

**Interfaces:**
- Consumes: the whole solver end-to-end against the local engine.

- [ ] **Step 1: Read the existing smoke harness**

Read `tools/cluesolve-test.ts` — it gives a bot a clue scroll (`::~item <id>` / a give arg), runs `SolveClue`, and asserts the trail reaches a reward casket. Mirror its structure for a medium sample.

- [ ] **Step 2: Drive a representative sample**

Add a medium run that, for each of these clue objs, gives the scroll (plus the prerequisites) and asserts the solve reaches its casket/next-step within a budget:
- a **map** dig (`trail_clue_medium_map001`) — spade only.
- a **coordinate** dig (`trail_clue_medium_sextant001`) — give `Sextant`, `Watch`, `Chart`, `Spade`. Assert it does NOT abandon on the require-check and digs.
- a **kill-for-key** riddle (`trail_clue_medium_riddle004` — chicken, the easiest fight) — give the scroll + a weapon; assert the key is looted and the container searched.
- an **anagram** talk (`trail_clue_medium_anagram001`).
- (optional) a **challenge** — if a chosen anagram NPC poses one, assert it's answered.

Each sub-case: deploy FRESH, give the items, run one `SolveClue` cycle, poll the log for `step done` / `trail complete` (or the casket id appearing) within ~6 min; PASS if progressed, FAIL with the clue trace tail otherwise. Sequential (shared engine).

- [ ] **Step 3: Run the smoke to green**

Deploy + freshness, then run the medium smoke. Expected: each sample progresses. On a FAIL, read the `==== clue trace ====` block (the executor dumps it on abandon) — fix at the responsible task's code (data → Task 2/3, executor → Task 4/5/6, keep-set → Task 7), redeploy, rerun.

- [ ] **Step 4: Commit**

```bash
git add tools/cluesolve-test.ts   # or tools/clues/mediumsolve-test.ts
git commit -m "test(clues): live smoke over one of each medium mechanic (map/coord/kill/anagram)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Content-discovery tasks (2, 3):** the exact `trail_medium` structure (whether sextant clues carry `trail_casket`, the precise `progress_clue_medium` call form, each NPC's spawn tile) must be read from the real content — the code samples above assume the easy-clue shape and Step 1 of each task verifies it. The offline audit (Task 8) is the correctness gate: nothing ships until all 122 clues audit clean.
- **API-name confirmations (5, 6):** three names are referenced-by-role and must be pinned against the codebase before use — the `GroundItems` query surface (`.where` vs `.results().find`), `ChatDialog`'s prompt-text getter, and the count-dialog answer action `Bank.withdrawX` uses. Each is flagged inline.
- **Ordering:** 1 → 2 → 3 → 8 (audit gates the data) is the critical spine; the executor tasks (4, 5, 6) and keep-set (7) are independent of each other and can be done in any order after 1; the live smoke (9) is last.
