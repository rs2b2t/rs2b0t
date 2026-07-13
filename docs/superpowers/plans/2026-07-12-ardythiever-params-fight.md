# ArdyThiever Baked Market Layout + Fight/Flee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip ArdyThiever's 10 location/name params (the bot bakes in the East Ardougne market layout, anchor derived from the pickpocket target, start-anywhere travel) and add a `guardResponse` Fight/Flee dropdown where Fight kills the guard that caught the stall theft instead of kiting it across the map.

**Architecture:** A new pure, client-free `ArdyThieverLogic.ts` holds the per-target spot table (anchor+leash from decoded map spawn data), the per-target Thieving-level requirement, and the attacker-selection predicate — all unit-testable under plain `bun test`. `ArdyThiever.ts` consumes them: constants replace the removed settings, `onStart` derives the anchor from `thieveTarget` and gates on the target's Thieving requirement, `ReturnToAnchor` web-walks long distances before the door-opening market approach, and `onStart` registers either the existing `Flee` task or a new `FightBack` task per the dropdown. Spec: `docs/superpowers/specs/2026-07-12-ardythiever-params-fight-design.md`.

**Tech Stack:** TypeScript (bun), bun:test (happy-dom preload via `bunfig.toml`), Playwright-driven live smokes against the local 2004scape engine on :8890.

## Global Constraints

- Scope: only `src/bot/scripts/ArdyThiever.ts`, the new `src/bot/scripts/ArdyThieverLogic.ts`, tests, and `tools/ardythiever-*` smokes. **ArdyFighter, ThievingBot, StallOwner, walkOpening, Banking, and all shared APIs are untouched.**
- Module-level `let` run-config is the house pattern (ADR-0006, exactly one script runs at a time) — keep it.
- Every code task must leave `bunx tsc --noEmit`, `bunx eslint <touched files>`, and `bun test` clean before its commit.
- Commit straight to `main` (repo convention), conventional-commit style subjects (`feat(ardythiever): ...`), and end every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Comments state constraints the code can't show (house style) — no "changed X" narration.
- Live smokes need the local engine (`cd ~/code/rs2b2t-engine && npm run quickstart`, web on :8890) and a deployed client (`ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`). Run smokes sequentially, never in parallel (shared engine + headless WebGL).

## File Structure

- **Create** `src/bot/scripts/ArdyThieverLogic.ts` — pure module (imports only `Tile` and `PickpocketTargets`, both client-free): `TargetSpot` table + `targetSpot()`, `requiredThieving()`, `HOSTILE_NAMES`, `isHostileAttacker()`.
- **Create** `test/scripts/ardythiever-logic.test.ts` — bun:test unit tests incl. a spawn-coverage table pinning the anchors to the decoded map data.
- **Modify** `src/bot/scripts/ArdyThiever.ts` — constants replace 10 settings; spot-derived anchor; level gate; start-anywhere `ReturnToAnchor`; `guardResponse` dropdown; `FightBack` task; kills in the overlay.
- **Create** `tools/ardythiever-fight-test.ts` — live smoke for fight mode (kite-test shape, URL-param settings).
- **Modify** `tools/ardythiever-test.ts` — one stale informational regex (`/fleeing combat/i` → `/kiting the guard/i`).

---

### Task 1: Pure helpers — `ArdyThieverLogic.ts` (TDD)

**Files:**
- Create: `src/bot/scripts/ArdyThieverLogic.ts`
- Test: `test/scripts/ardythiever-logic.test.ts`

**Interfaces:**
- Consumes: `Tile` (`src/bot/api/Tile.ts`, pure — Chebyshev `distanceTo`), `PICKPOCKET_TARGETS` + `ARDOUGNE_PICKPOCKET_TARGETS` (`src/bot/scripts/PickpocketTargets.ts`, pure).
- Produces (Task 2 and 3 rely on these exact signatures):
  - `interface TargetSpot { anchor: Tile; leash: number }`
  - `function targetSpot(target: string): TargetSpot` (unknown target → the Guard spot)
  - `function requiredThieving(target: string): number` (unknown target → 1)
  - `const HOSTILE_NAMES: readonly string[]`
  - `interface AttackerCandidate { name: string | null; inCombat: boolean; distance: number; actions: string[] }`
  - `function isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/ardythiever-logic.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { ARDOUGNE_PICKPOCKET_TARGETS } from '#/bot/scripts/PickpocketTargets.js';
import { HOSTILE_NAMES, isHostileAttacker, requiredThieving, targetSpot } from '#/bot/scripts/ArdyThieverLogic.js';

// Spawn tiles decoded from the engine's packed server maps (n40_51/n41_51) —
// the source data behind the anchor table. Hero's far-SW spawn (2630,3288) is
// deliberately out of scope (spec: market-side heroes only).
const SPAWNS: Record<string, [number, number][]> = {
    'Guard': [[2651, 3307], [2659, 3309], [2660, 3309], [2661, 3309], [2663, 3301], [2665, 3300], [2664, 3318]],
    'Knight of Ardougne': [[2652, 3318], [2653, 3300], [2669, 3298], [2671, 3313]],
    'Paladin': [[2653, 3315], [2657, 3307]],
    'Hero': [[2647, 3306], [2667, 3316]]
};

describe('targetSpot', () => {
    test('resolves a spot for every Ardougne dropdown target', () => {
        for (const name of ARDOUGNE_PICKPOCKET_TARGETS) {
            const spot = targetSpot(name);
            expect(spot.anchor.level).toBe(0);
            expect(spot.leash).toBeGreaterThanOrEqual(12);
        }
    });
    test('every known spawn sits within its target leash (Chebyshev)', () => {
        for (const [name, spawns] of Object.entries(SPAWNS)) {
            const spot = targetSpot(name);
            for (const [x, z] of spawns) {
                expect(spot.anchor.distanceTo({ x, z, level: 0 })).toBeLessThanOrEqual(spot.leash);
            }
        }
    });
    test('unknown target falls back to the Guard spot', () => {
        expect(targetSpot('Nonexistent')).toEqual(targetSpot('Guard'));
    });
});

describe('requiredThieving', () => {
    test('per-target pickpocket requirements from the content table', () => {
        expect(requiredThieving('Guard')).toBe(40);
        expect(requiredThieving('Knight of Ardougne')).toBe(55);
        expect(requiredThieving('Paladin')).toBe(70);
        expect(requiredThieving('Hero')).toBe(80);
    });
    test('unknown target does not gate (level 1)', () => {
        expect(requiredThieving('Nonexistent')).toBe(1);
    });
});

describe('isHostileAttacker', () => {
    const guard = { name: 'Guard', inCombat: true, distance: 1, actions: ['Pickpocket', 'Attack'] };
    test('accepts an in-combat adjacent market hostile with an Attack op', () => {
        expect(isHostileAttacker(guard, 5)).toBe(true);
    });
    test('every fight-mode hostile is an Ardougne dropdown target and vice versa', () => {
        expect([...HOSTILE_NAMES].sort()).toEqual([...ARDOUGNE_PICKPOCKET_TARGETS].sort());
    });
    test('rejects a bystander not in combat', () => {
        expect(isHostileAttacker({ ...guard, inCombat: false }, 5)).toBe(false);
    });
    test('rejects a hostile beyond the engage radius', () => {
        expect(isHostileAttacker({ ...guard, distance: 6 }, 5)).toBe(false);
    });
    test('rejects non-hostile NPCs (the Baker) and null names', () => {
        expect(isHostileAttacker({ ...guard, name: 'Baker' }, 5)).toBe(false);
        expect(isHostileAttacker({ ...guard, name: null }, 5)).toBe(false);
    });
    test('rejects a hostile with no Attack op (mid-death / op-less variant)', () => {
        expect(isHostileAttacker({ ...guard, actions: ['Pickpocket'] }, 5)).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/scripts/ardythiever-logic.test.ts`
Expected: FAIL — `Cannot find module '#/bot/scripts/ArdyThieverLogic.js'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/bot/scripts/ArdyThieverLogic.ts`:

```ts
import Tile from '../api/Tile.js';
import { PICKPOCKET_TARGETS } from './PickpocketTargets.js';

/**
 * Pure ArdyThiever knowledge — no client imports so it runs under plain
 * `bun test` (ArdyFighterLogic pattern). Encodes the East Ardougne market
 * layout the bot used to take as settings: where each pickpocket target
 * hangs out, what Thieving level it needs, and which NPCs a caught stall
 * theft can turn hostile.
 */

export interface TargetSpot {
    anchor: Tile;
    leash: number;
}

// Anchors/leashes derived from the engine's packed spawn data (n40_51/n41_51):
// Guard x7 and Knight x4 all wander within 12 of the market centre; the two
// market Paladins sit a nudge south-west; the two market-side Heroes
// ((2647,3306) + (2667,3316)) need a wider ring from a midpoint anchor. All
// four spots are a short walk from the Baker's stall (2667,3310) and the
// south bank (2655,3286).
const SPOTS: Record<string, TargetSpot> = {
    'Guard': { anchor: new Tile(2661, 3306, 0), leash: 12 },
    'Knight of Ardougne': { anchor: new Tile(2661, 3306, 0), leash: 12 },
    'Paladin': { anchor: new Tile(2655, 3311, 0), leash: 12 },
    'Hero': { anchor: new Tile(2657, 3311, 0), leash: 14 }
};

/** The thieving spot for a dropdown target; unknown names get the Guard spot. */
export function targetSpot(target: string): TargetSpot {
    return SPOTS[target] ?? SPOTS['Guard'];
}

/** Thieving level the pickpocket needs (content pickpocket table); unknown → 1. */
export function requiredThieving(target: string): number {
    return PICKPOCKET_TARGETS.find(t => t.name === target)?.level ?? 1;
}

// A caught stall theft retaliates with the market's human hostiles: the
// stall's LOS-blocker is always an Ardougne Guard, and the Baker's
// "Guards guards!" alert additionally pulls any Knight/Paladin/Hero within 5
// tiles of him (content stall_owner_alert_guards).
export const HOSTILE_NAMES: readonly string[] = ['Guard', 'Knight of Ardougne', 'Paladin', 'Hero'];

export interface AttackerCandidate {
    name: string | null;
    inCombat: boolean;
    distance: number;
    actions: string[];
}

/** Is this NPC plausibly the one attacking us — a market hostile, currently in
 *  combat, close enough to be meleeing us, and actually attackable? */
export function isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean {
    return c.name !== null
        && HOSTILE_NAMES.includes(c.name)
        && c.inCombat
        && c.distance <= maxDistance
        && c.actions.includes('Attack');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/scripts/ardythiever-logic.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Full check + commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/scripts/ArdyThieverLogic.ts test/scripts/ardythiever-logic.test.ts && bun test`
Expected: all clean, full suite green.

```bash
git add src/bot/scripts/ArdyThieverLogic.ts test/scripts/ardythiever-logic.test.ts
git commit -m "feat(ardythiever): pure market-spot/level/attacker helpers + tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Bake the market layout — drop 10 params, start anywhere, level gate

**Files:**
- Modify: `src/bot/scripts/ArdyThiever.ts`

**Interfaces:**
- Consumes: `targetSpot(target: string): TargetSpot`, `requiredThieving(target: string): number` from `./ArdyThieverLogic.js` (Task 1).
- Produces: `SETTINGS` schema with exactly these keys: `thieveTarget`, `eatAtHp`, `eatToHp`, `panicHp`, `restUntilHp`, `foodTarget`, `restockAtFood`, `bankAtLootSlots`, plus the `...PERIODIC_BANK_SETTINGS` spread. Module constants `STALL_TILE`, `STALL_STAND`, `STALL_NAME`, `BANK_STAND`, `FLEE_TILE`, `OBSTACLE`, `FOOD`, `LOOT` and module lets `ANCHOR`, `LEASH`, `TARGET` (Task 3 builds on this exact file state).

- [ ] **Step 1: Replace the constants + settings + module-state header**

In `src/bot/scripts/ArdyThiever.ts`, add the import (with the other `./` imports, after the `ARDOUGNE_PICKPOCKET_TARGETS` line):

```ts
import { requiredThieving, targetSpot } from './ArdyThieverLogic.js';
```

Replace everything from the `// East Ardougne, shared with ArdyFighter. ...` comment block (directly above `const DEFAULT_ANCHOR` — it ends with the now-stale "it FLEES any combat (can't fight guards)") down to (and including) `let BANK_COMMON = true;` with:

```ts
// East Ardougne market layout — baked in, not settings. Tiles were live-tuned
// in the original bot; per-target anchors come from the packed spawn data (see
// ArdyThieverLogic + the 2026-07-12 design spec). Start the bot anywhere:
// ReturnToAnchor travels to the target's spot.
const STALL_TILE = new Tile(2667, 3310, 0);
// The stall sits behind a counter (like a bank booth), so we can't stand on it —
// walk ONTO this reachable tile beside it and steal from there.
const STALL_STAND = new Tile(2668, 3312, 0);
const STALL_NAME = 'Baker\'s stall';
const BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const STALL_OP = 'Steal from';
const PICKPOCKET_OP = 'Pickpocket';
// On any real combat (a guard caught us stealing from the stall), flee mode
// runs to this fixed tile SW of the market — far enough to drag the guard off
// the stall and break its melee, so the stall clears for the next restock.
const FLEE_TILE = new Tile(2655, 3298, 0);
// A failed pickpocket damages you (health bar shows -> Game.inCombat() true) AND
// stuns you — the target does NOT enter combat (engine: fail_pick_pocket ends on
// npc_setmode(null)). So a caught pickpocket looks like "combat" for as long as
// the health bar lingers: combatCycle = loopCycle + 400, shown while within 300
// client cycles ≈ 6s ≈ 10 server ticks at 50fps. Suppress Flee for a slightly
// longer window (headroom for frame-rate dips) after each stun so a normal miss
// isn't mistaken for a real attacker. Genuine combat never emits a stun message,
// so it still flees once the window lapses.
const STUN_COMBAT_TICKS = 17;
const OBSTACLE = ['door', 'gate'];
// What the Baker's stall gives (content stealing.dbrow) — also what PanicRetreat
// withdraws if the bank holds any.
const FOOD = ['cake', 'bread', 'chocolate slice'];
// Pickpocket loot across all four targets (content pickpocket.dbrow: coins for
// all; Paladin +chaos runes; Hero +death/blood runes, wine, fire orb, gold ore)
// plus guard drops for fight mode (clue, body talisman, steel arrows, runes,
// iron ore). Gems bank via the shared common-junk list.
const LOOT = ['coins', 'chaos rune', 'death rune', 'blood rune', 'nature rune', 'jug of wine', 'fire orb', 'gold ore', 'clue scroll', 'body talisman', 'steel arrow', 'iron ore'];
const TARGET_OPTIONS = ARDOUGNE_PICKPOCKET_TARGETS;

export const SETTINGS: SettingsSchema = {
    thieveTarget: { type: 'string', default: 'Guard', options: TARGET_OPTIONS, label: 'Pickpocket target', help: 'the bot knows each target\'s market spot — no anchor to place' },
    eatAtHp: { type: 'number', default: 40, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    restUntilHp: { type: 'number', default: 60, min: 0, max: 100, label: 'Regen to HP% when bank empty' },
    foodTarget: { type: 'number', default: 22, min: 1, max: 27, label: 'Fill food to (count)' },
    restockAtFood: { type: 'number', default: 3, min: 0, max: 26, label: 'Restock when food drops to' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots' },
    ...PERIODIC_BANK_SETTINGS
};

// Active run config (ADR-0006 single-script module state).
let TARGET = 'Guard';
let ANCHOR = targetSpot(TARGET).anchor;
let LEASH = targetSpot(TARGET).leash;
let EAT_AT = 0.4;
let EAT_TO = 0.9;
let PANIC_AT = 0.25;
let REST_UNTIL = 0.6;
let FOOD_TARGET = 22;
let RESTOCK_AT = 3;
let BANK_AT = 12;
let BANK_COMMON = true;
```

(Deleted: `DEFAULT_ANCHOR`, `DEFAULT_STALL`, `DEFAULT_STALL_STAND`, `DEFAULT_BANK_STAND`, `DEFAULT_FLEE_TILE`, `DEFAULT_FOOD`, `DEFAULT_LOOT` constants; the `anchor`, `leashRadius`, `stallTile`, `stallStand`, `stallName`, `bankStand`, `stallFleeTile`, `obstacle`, `food`, `loot` schema keys; the `STALL_TILE`/`STALL_STAND`/`STALL_NAME`/`BANK_STAND`/`FLEE_TILE`/`OBSTACLE`/`FOOD`/`LOOT` `let` mirrors — they are consts now. `DEFAULT_FOOD`/`DEFAULT_LOOT` string-split dance is gone.)

- [ ] **Step 2: Rewrite `onStart`'s settings block + level gate**

Replace the block in `onStart` from `TARGET = this.settings.str('thieveTarget', 'Guard');` through the existing Thieving-5 check and the `this.log('ArdyThiever starting — ...')` line with:

```ts
        TARGET = this.settings.str('thieveTarget', 'Guard');
        const spot = targetSpot(TARGET);
        ANCHOR = spot.anchor;
        LEASH = spot.leash;
        FOOD_TARGET = this.settings.num('foodTarget', 22);
        RESTOCK_AT = this.settings.num('restockAtFood', 3);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        EAT_AT = this.settings.num('eatAtHp', 40) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        REST_UNTIL = this.settings.num('restUntilHp', 60) / 100;
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);

        // Gate on the target's pickpocket requirement (subsumes the stall's
        // Thieving 5 — every market target needs 40+): stop with a clear
        // message instead of spamming failed pickpockets.
        const need = requiredThieving(TARGET);
        if (Skills.level('thieving') < need) {
            this.log(`ArdyThiever needs Thieving ${need} to pickpocket ${TARGET} (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error(`ArdyThiever: Thieving ${need} required`);
        }

        this.log(`ArdyThiever starting — target '${TARGET}' at ${ANCHOR} r${LEASH} (Thieving ${need}+), stall ${STALL_TILE}, bank ${BANK_STAND}`);
```

(The reads for the ten removed settings are deleted with it; the `chat.message` handler and `this.add(...)` registration below stay untouched in this task.)

- [ ] **Step 3: Start-anywhere `ReturnToAnchor`**

Replace the `ReturnToAnchor` class at the bottom of the file with:

```ts
/** Travel task: covers both start-anywhere (launched across the map) and
 *  displacement recovery. Long hauls web-walk first (ArdyFighter's proven
 *  shape); the final market approach always runs walkOpening so a shut market
 *  door/gate can't wedge the arrival. */
class ReturnToAnchor implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the market');
        const here = Game.tile();
        if (here && ANCHOR.distanceTo(here) > 30) {
            await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
        }
        await walkOpening(ANCHOR, 2, OBSTACLE, m => this.bot.log(m));
    }
}
```

- [ ] **Step 4: Update the class docstring**

Replace the `ArdyThiever` class JSDoc (the `/** East Ardougne low-level pickpocket bot...*/` block) with:

```ts
/**
 * East Ardougne market pickpocket bot. Start it anywhere — it walks to the
 * chosen target's market spot (baked-in layout; nothing to place). Fills up on
 * cake from the Baker's stall, pickpockets the target (Guard/Knight/Paladin/
 * Hero), eats below a threshold, refills cake when low, banks loot + the
 * shared junk list, grabs ground coins. A guard that catches the stall theft
 * is fled (kited off the stall) or fought, per the guardResponse setting.
 */
```

- [ ] **Step 5: Verify clean + existing behavior intact**

Run: `bunx tsc --noEmit && bunx eslint src/bot/scripts/ArdyThiever.ts && bun test`
Expected: all clean (the Flee task still compiles against the `FLEE_TILE` const; `guardResponse` does not exist yet — Flee is still registered unconditionally).

- [ ] **Step 6: Commit**

```bash
git add src/bot/scripts/ArdyThiever.ts
git commit -m "feat(ardythiever): bake market layout — drop 10 location params, start anywhere

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `guardResponse` dropdown + FightBack task

**Files:**
- Modify: `src/bot/scripts/ArdyThiever.ts`

**Interfaces:**
- Consumes: `isHostileAttacker(c: AttackerCandidate, maxDistance: number): boolean` from `./ArdyThieverLogic.js` (Task 1); file state from Task 2.
- Produces: `guardResponse` schema key (`'Flee' | 'Fight'`, default `'Flee'`); log lines `combat — fighting back against <name>` and `killed the <name>` (Task 4's smoke asserts these exact shapes).

- [ ] **Step 1: Schema + run-config + imports**

Add `isHostileAttacker` to the Task-1 import and the `Npc` type to the queries import:

```ts
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { isHostileAttacker, requiredThieving, targetSpot } from './ArdyThieverLogic.js';
```

In `SETTINGS`, insert directly after the `thieveTarget` line:

```ts
    guardResponse: { type: 'string', default: 'Flee', options: ['Flee', 'Fight'], label: 'Guard response', help: 'caught at the stall: Flee kites the guard off the market; Fight kills it (bring combat stats)' },
```

In the module run-config block, add after `let TARGET = 'Guard';`:

```ts
let RESPONSE = 'Flee';
```

And add the engage radius with the other constants (after `STUN_COMBAT_TICKS`):

```ts
// How close an in-combat market hostile must be to count as "the one attacking
// us" — melee attackers stand adjacent; 5 gives slack for a pathing hostile.
const ENGAGE_RADIUS = 5;
```

- [ ] **Step 2: onStart — read the mode, register Flee or FightBack**

In `onStart`, add after the `TARGET = ...` line:

```ts
        RESPONSE = this.settings.str('guardResponse', 'Flee');
```

Extend the start banner to include the mode (replace the `this.log('ArdyThiever starting — ...')` line from Task 2):

```ts
        this.log(`ArdyThiever starting — target '${TARGET}' at ${ANCHOR} r${LEASH} (Thieving ${need}+), ${RESPONSE.toLowerCase()} mode, stall ${STALL_TILE}, bank ${BANK_STAND}`);
```

Replace the `this.add(` registration so the combat response is mode-selected. FightBack must sit BELOW EatFood/PanicRetreat (the eat ladder outranks fighting) and above the bank/restock/pickpocket tasks:

```ts
        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            ...(RESPONSE === 'Fight' ? [] : [new Flee(this)]),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
            ...(RESPONSE === 'Fight' ? [new FightBack(this)] : []),
            new PeriodicBank({
                strategy: () => parseBankStrategy(this.settings.str('bankStrategy', 'Off')),
                itemsThreshold: () => this.settings.num('bankEveryItems', 15),
                minutesThreshold: () => this.settings.num('bankEveryMinutes', 10),
                countLoot: () => lootSlots(),
                deposit: (name) => matchesAny(name, LOOT),
                commonJunk: () => BANK_COMMON,
                returnTo: () => ANCHOR,
                setStatus: (s) => this.setStatus(s),
                log: (m) => this.log(m)
            }),
            new BankRun(this),
            new RestockCakes(this),
            new Pickpocket(this),
            new ReturnToAnchor(this)
        );
```

- [ ] **Step 3: Kills counter + overlay**

In the `ArdyThiever` class, add a field next to `private flees = 0;`:

```ts
    private kills = 0;
```

Add a counter method next to `countFlee()`:

```ts
    countKill(): void { this.kills++; }
```

Replace the second `onPaint` line (`target ${TARGET}  steals ...`) with:

```ts
            `target ${TARGET}  steals ${this.steals}  ate ${this.eats}  fled ${this.flees}  fought ${this.kills}`,
```

- [ ] **Step 4: The FightBack task**

Add the class directly after the `Flee` class:

```ts
/** Fight mode: kill the guard that caught us instead of kiting it. Triggers on
 *  the same inRealCombat() signal as Flee (the pickpocket-stun suppression is
 *  load-bearing — a failed pickpocket must NOT start a fight). Registered
 *  BELOW EatFood/PanicRetreat so the eat ladder outranks the fight, and above
 *  the bank/restock/pickpocket tasks so nothing else runs mid-combat. Attacks
 *  explicitly (robust even with auto-retaliate off); a second attacker (the
 *  Baker can alert several) is picked up by revalidation after the first kill. */
class FightBack implements Task {
    constructor(private bot: ArdyThiever) {}
    private findAttacker(): Npc | null {
        return Npcs.query()
            .where(n => isHostileAttacker({ name: n.name, inCombat: n.inCombat, distance: n.distance(), actions: n.actions() }, ENGAGE_RADIUS))
            .nearest();
    }
    private track(engaged: Npc): Npc | null {
        return Npcs.all().find(n => n.index === engaged.index && n.name === engaged.name) ?? null;
    }
    validate(): boolean { return this.bot.inRealCombat(); }
    async execute(): Promise<void> {
        const attacker = this.findAttacker();
        if (!attacker) {
            // combat flag with no visible aggressor (it died, or the health bar
            // is lingering) — idle a moment; tasks resume once combat clears
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus(`fighting back: ${attacker.name} at ${attacker.tile()}`);
        this.bot.log(`combat — fighting back against ${attacker.name}`);
        if (!(await attacker.interact('Attack'))) { await Execution.delayTicks(2); return; }
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) { return; }
            if (shouldEat(hpFraction(), EAT_AT, foodCount()) || shouldPanic(hpFraction(), PANIC_AT, foodCount())) {
                return; // EatFood / PanicRetreat outrank us next loop
            }
            const target = this.track(attacker);
            if (!target) {
                this.bot.countKill();
                this.bot.log(`killed the ${attacker.name}`);
                return;
            }
            if (target.health === 0 && target.snap.totalHealth > 0) {
                await Execution.delayUntil(() => this.track(attacker) === null, 10_000);
                this.bot.countKill();
                this.bot.log(`killed the ${attacker.name}`);
                return;
            }
            if (!Game.inCombat() && !target.inCombat) {
                return; // both disengaged — over; revalidation handles re-aggro
            }
            await Execution.delayTicks(2);
        }
    }
}
```

(`shouldPanic` is already imported by ArdyThiever; `Execution`, `EventSignal`, `ChatDialog`, `Game` likewise.)

- [ ] **Step 5: Verify clean**

Run: `bunx tsc --noEmit && bunx eslint src/bot/scripts/ArdyThiever.ts && bun test`
Expected: all clean, suite green.

- [ ] **Step 6: Commit**

```bash
git add src/bot/scripts/ArdyThiever.ts
git commit -m "feat(ardythiever): fight/flee guard response — FightBack task + kills overlay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Fight-mode live smoke + stale-regex tidy

**Files:**
- Create: `tools/ardythiever-fight-test.ts`
- Modify: `tools/ardythiever-test.ts` (one line)

**Interfaces:**
- Consumes: log lines `combat — fighting back against <name>` / `killed the <name>` (Task 3), URL-first settings resolution (`bot.html?ArdyThiever.guardResponse=Fight`), and the dev handle `globalThis.rs2b0t` (client/runner/registry/reader).
- Produces: `tools/ardythiever-fight-test.ts`, picked up automatically by `bun run smoke` (it sweeps `tools/*-test.ts`).

- [ ] **Step 1: Fix the stale informational regex in the default smoke**

In `tools/ardythiever-test.ts`, the flee flag greps a log line that no longer exists (Flee logs "kiting the guard" since the kite-flee change; the flag is informational — PASS only requires restock+steal). Replace:

```ts
            if (/fleeing combat/i.test(l)) { seen.flee = true; }
```

with:

```ts
            if (/kiting the guard/i.test(l)) { seen.flee = true; }
```

- [ ] **Step 2: Write the fight smoke**

Create `tools/ardythiever-fight-test.ts`:

```ts
// Headless live smoke for ArdyThiever's FIGHT mode: with
// ?ArdyThiever.guardResponse=Fight, a guard that catches the bot stealing from
// the Baker's stall must be fought and killed IN PLACE — the bot must log the
// fight + the kill, never travel to the kite tile (2655,3298), and resume
// thieving afterwards. Uses a maxme'd account so the level-20 guard dies fast.
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/ardythiever-fight-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `af${Date.now().toString(36).slice(-7)}`;
const KITE = { x: 2655, z: 3298 };

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        actions?: { continueDialog?: () => boolean };
    };
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); } });

    // URL param = URL-first settings resolution: guardResponse=Fight for this run
    await page.goto(`${base}/bot.html?ArdyThiever.guardResponse=Fight`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload(); // keeps the query string
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    await type('::~maxme');
    await clearDialogs();

    // Tele onto the stall stand; the bot restocks cake there. A patrolling
    // guard that wanders within 5 tiles with LOS blocks the steal and attacks
    // ("Hey! Get your hands off there!") — fight mode must kill it in place.
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,41,51,44,48'); // (2668,3312) stall stand
        await page.waitForTimeout(1500);
        at = await tile();
        if (at && Math.abs(at.x - 2668) <= 8 && Math.abs(at.z - 3312) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 2668) > 8) { fail(`stall tele failed (at ${JSON.stringify(at)})`); }
    console.log(`at stall: ${JSON.stringify(at)}`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyThiever')); });
    console.log('started ArdyThiever (fight mode) — waiting (up to ~12 min) for a guard to catch it...');

    let sawFight = false;
    let sawKill = false;
    let killAt = -1;          // log index of the first kill line
    let resumed = false;      // restock/pickpocket AFTER the kill
    let kited = false;        // must stay false
    let closestToKite = 999;  // must stay > 3
    let lastNote = 0;
    for (let i = 0; i < 360; i++) { // ~720s — a patrolling guard must wander over
        await page.waitForTimeout(2000);
        const lines = await logLines();
        lines.forEach((l, idx) => {
            if (/fighting back against/i.test(l)) { sawFight = true; }
            if (killAt < 0 && /killed the/i.test(l)) { sawKill = true; killAt = idx; }
            if (/kiting the guard/i.test(l)) { kited = true; }
            if (killAt >= 0 && idx > killAt && /restocking|stocked \d+ food|pickpocketed/i.test(l)) { resumed = true; }
        });
        const t = await tile();
        if (t) { closestToKite = Math.min(closestToKite, Math.max(Math.abs(t.x - KITE.x), Math.abs(t.z - KITE.z))); }
        if (i - lastNote >= 30) { lastNote = i; console.log(`  ...${i * 2}s: fight=${sawFight} kill=${sawKill} resumed=${resumed} kiteDist>=${closestToKite} at=${JSON.stringify(t)}`); }
        if (sawKill && resumed) { break; }
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-18)) { console.log(`  ${l}`); }
    console.log(`fight=${sawFight} kill=${sawKill} resumed=${resumed} kited=${kited} closestToKite=${closestToKite}`);
    if (!sawFight) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail('no guard combat / never logged the fight within the window'); }
    if (!sawKill) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail('fought but never logged the kill'); }
    if (kited || closestToKite <= 3) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail(`fled instead of fighting (kited=${kited}, closestToKite=${closestToKite})`); }
    if (!resumed) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail('killed the guard but never resumed thieving'); }
    console.log('PASS');
} finally {
    await browser.close();
}
```

- [ ] **Step 3: Verify clean**

Run: `bunx tsc --noEmit && bunx eslint tools/ardythiever-fight-test.ts tools/ardythiever-test.ts && bun test`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add tools/ardythiever-fight-test.ts tools/ardythiever-test.ts
git commit -m "test(smoke): ardythiever fight-mode smoke + stale flee-regex tidy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Live verification (engine + all three smokes)

**Files:** none (verification only; any fixes found get their own `fix(ardythiever): ...` commits).

- [ ] **Step 1: Engine + deploy**

If the engine isn't already serving :8890 (`curl -s -o /dev/null -w '%{http_code}' http://localhost:8890/` → `200`), start it in the background:

```bash
cd ~/code/rs2b2t-engine && npm run quickstart
```

Then deploy the current build:

```bash
cd ~/code/rs2b0t && ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
```

- [ ] **Step 2: Default smoke (params removed, defaults still work)**

Run: `bun tools/ardythiever-test.ts` (allow ~10 min)
Expected: `PASS` with `restock=true pickpocket=true`.

- [ ] **Step 3: Kite smoke (flee default unchanged)**

Run: `bun tools/ardythiever-kite-test.ts` (allow ~15 min — waits for a patrolling guard)
Expected: `PASS` with `kiteLog=true reachedKiteTile=true`.

- [ ] **Step 4: Fight smoke**

Run: `bun tools/ardythiever-fight-test.ts` (allow ~15 min)
Expected: `PASS` with `fight=true kill=true resumed=true kited=false`.

- [ ] **Step 5: Full unit suite one last time**

Run: `bun test`
Expected: green.
