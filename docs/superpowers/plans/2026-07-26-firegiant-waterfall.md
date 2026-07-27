# FireGiant (Waterfall Dungeon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `FireGiant` bot that kills the 10 fire giants in the Waterfall Dungeon with melee, range, or magic, banking by teleporting out and re-running the raft/rope/amulet entry chain.

**Architecture:** Third clone in the MossGiant lineage. `FireGiant.ts` is `MossGiant.ts` with a position-derived entry ladder, an escape-teleport bank trip, and two style-specific fight tiles. All coords, loc names, ops, and the leg resolver live in a pure sibling `FireGiantLogic.ts` so they can be unit-tested with no client attached.

**Tech Stack:** TypeScript, Bun (`bun test`), the repo's `TaskBot` framework. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-firegiant-waterfall-design.md`

## Global Constraints

- Branch is `firegiant`, already cut from `main` at `a186a4c`. Do not create another.
- No new dependencies.
- `bun test` must not gain failures. **Baseline measured on `main` at `a186a4c`: 953 pass, 1 skip, 1 fail.** The one failure is `test/clues/AcquireTools.test.ts › ensureSpade › walks to the NEARER spawn and takes the spade`, which passes in isolation and only fails in a full run — the known `bun mock.module` cross-file ordering gotcha. Pre-existing and out of scope here. Any task that sees a *second* failure has broken something.
- `bunx tsc --noEmit` must not gain new errors.
- `bunx eslint <changed files>` must add zero new warnings.
- Comments are terse. The repo is deliberately near-comment-free: no rationale, history, or citations in code. A comment earns its place only when the line would otherwise read as a bug.
- Never use `op1` on `Dead tree` or `Ledge` without first asserting the required item. Both misfires cost 8 HP and teleport the player to 2527,3413.
- All engine facts in this plan were verified against `~/code/rs2b2t-content` (the content served by `localhost:8890`, which the live smokes target). Do not "correct" a coord or loc name from memory.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/bot/scripts/FireGiantLogic.ts` | **Create.** Pure: coords, loc names/ops, the throw zone, the escape-teleport table, `legFor()`. No client imports. |
| `test/scripts/FireGiantLogic.test.ts` | **Create.** Unit tests for `legFor()` and the teleport table. |
| `src/bot/scripts/FireGiant.ts` | **Create.** The bot. Copied from `MossGiant.ts`, then diffed. |
| `src/bot/scripts/index.ts` | **Modify.** Import + `ScriptRegistry.register` entry. |
| `tools/firegiant-test.ts` | **Create.** Live smoke. |

---

### Task 1: FireGiantLogic — coords and the leg resolver

**Files:**
- Create: `src/bot/scripts/FireGiantLogic.ts`
- Test: `test/scripts/FireGiantLogic.test.ts`

**Interfaces:**
- Consumes: `Tile` from `../api/Tile.js`
- Produces: `RAFT_STAND`, `RAFT_LANDING`, `ROCK_TILE`, `POST_ROCK`, `TREE_STAND`, `LEDGE`, `LEDGE_DOOR`, `DUNGEON_ENTRY`, `WASHED_OUT`, `DEFAULT_SAFESPOT`, `DEFAULT_MELEE_TILE` (all `Tile`); `RAFT_LOC`/`RAFT_OP`/`ROCK_LOC`/`TREE_LOC`/`LEDGE_LOC`/`LEDGE_OP`/`AMULET`/`ROPE` (all `string`); `THROW_ZONE`; `DUNGEON_MIN_Z: number`; `type Leg`; `legFor(t: PointLike | null): Leg`; `ESCAPE_TELES: Record<string, EscapeTele>`; `type EscapeTele`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/FireGiantLogic.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { ESCAPE_TELES, legFor, LEDGE, POST_ROCK, RAFT_STAND, WASHED_OUT } from '#/bot/scripts/FireGiantLogic.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('legFor', () => {
    test('anywhere underground is InDungeon', () => {
        expect(legFor(at(2575, 9861))).toBe('InDungeon');
        expect(legFor(at(2568, 9893))).toBe('InDungeon');
    });
    test('the exact ledge tile is AtLedge', () => {
        expect(legFor(at(LEDGE.x, LEDGE.z))).toBe('AtLedge');
    });
    test('the post-rock landing and the tree stand are both PastRock', () => {
        expect(legFor(at(POST_ROCK.x, POST_ROCK.z))).toBe('PastRock');
        expect(legFor(at(2512, 3466))).toBe('PastRock');
    });
    test('the engine throw zone is AtLanding, inclusive at every edge', () => {
        expect(legFor(at(2512, 3481))).toBe('AtLanding'); // where the raft drops you
        expect(legFor(at(2510, 3476))).toBe('AtLanding');
        expect(legFor(at(2514, 3481))).toBe('AtLanding');
        expect(legFor(at(2509, 3478))).not.toBe('AtLanding'); // one west of the zone
        expect(legFor(at(2512, 3482))).not.toBe('AtLanding'); // one north of the zone
    });
    test('the shared failure coord is WashedOut', () => {
        expect(legFor(at(WASHED_OUT.x, WASHED_OUT.z))).toBe('WashedOut');
        expect(legFor(at(WASHED_OUT.x + 4, WASHED_OUT.z - 4))).toBe('WashedOut');
    });
    test('near the raft is AtRaft', () => {
        expect(legFor(at(RAFT_STAND.x, RAFT_STAND.z))).toBe('AtRaft');
        expect(legFor(at(RAFT_STAND.x + 3, RAFT_STAND.z + 3))).toBe('AtRaft');
    });
    test('everything else, and an unknown position, is Surface', () => {
        expect(legFor(at(2725, 3491))).toBe('Surface');
        expect(legFor(null)).toBe('Surface');
    });
    test('AtLedge wins over PastRock even though the ledge is close to the rock', () => {
        expect(legFor(at(2511, 3463))).toBe('AtLedge');
    });
});

describe('ESCAPE_TELES', () => {
    test('every entry carries a component, a level, runes, and a paired bank', () => {
        for (const [key, tele] of Object.entries(ESCAPE_TELES)) {
            expect(tele.name).toBe(key);
            expect(tele.com).toBeGreaterThan(0);
            expect(tele.level).toBeGreaterThan(0);
            expect(tele.runes.length).toBeGreaterThan(0);
            expect(tele.bank.level).toBe(0);
        }
    });
    test('Camelot is the documented default pairing', () => {
        expect(ESCAPE_TELES.Camelot.com).toBe(1174);
        expect(ESCAPE_TELES.Camelot.level).toBe(45);
        expect(ESCAPE_TELES.Camelot.bank.x).toBe(2725);
        expect(ESCAPE_TELES.Camelot.bank.z).toBe(3491);
    });
    test('Ardougne costs 2 law and 2 water', () => {
        const runes = Object.fromEntries(ESCAPE_TELES.Ardougne.runes.map(r => [r.rune, r.count]));
        expect(runes['Law rune']).toBe(2);
        expect(runes['Water rune']).toBe(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/scripts/FireGiantLogic.test.ts`
Expected: FAIL — `Cannot find module '#/bot/scripts/FireGiantLogic.js'`

- [ ] **Step 3: Write the implementation**

Create `src/bot/scripts/FireGiantLogic.ts`:

```ts
import Tile from '../api/Tile.js';

export const RAFT_STAND = new Tile(2510, 3493, 0);
export const RAFT_LANDING = new Tile(2512, 3481, 0);
export const ROCK_TILE = new Tile(2512, 3468, 0);
export const POST_ROCK = new Tile(2513, 3468, 0);
export const TREE_STAND = new Tile(2512, 3466, 0);
export const LEDGE = new Tile(2511, 3463, 0);
export const LEDGE_DOOR = new Tile(2511, 3464, 0);
export const DUNGEON_ENTRY = new Tile(2575, 9861, 0);
export const WASHED_OUT = new Tile(2527, 3413, 0);

export const DEFAULT_SAFESPOT = new Tile(2568, 9893, 0);
export const DEFAULT_MELEE_TILE = new Tile(2575, 9893, 0);

export const RAFT_LOC = 'Log raft';
export const RAFT_OP = 'Board';
export const ROCK_LOC = 'Rock';
export const TREE_LOC = 'Dead tree';
export const LEDGE_LOC = 'Ledge';
export const LEDGE_OP = 'Open';
export const AMULET = "Glarial's amulet";
export const ROPE = 'Rope';

// engine: inzone(0_39_54_14_20, 0_39_54_18_25) — the rope throw is refused outside it
export const THROW_ZONE = { minX: 2510, maxX: 2514, minZ: 3476, maxZ: 3481 };

export const DUNGEON_MIN_Z = 9000;

export interface PointLike {
    x: number;
    z: number;
    level: number;
}

export type Leg = 'InDungeon' | 'AtLedge' | 'PastRock' | 'AtLanding' | 'WashedOut' | 'AtRaft' | 'Surface';

function cheb(a: PointLike, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function legFor(t: PointLike | null): Leg {
    if (t === null) {
        return 'Surface';
    }
    if (t.z > DUNGEON_MIN_Z) {
        return 'InDungeon';
    }
    if (t.x === LEDGE.x && t.z === LEDGE.z) {
        return 'AtLedge';
    }
    if (cheb(t, POST_ROCK) <= 3) {
        return 'PastRock';
    }
    if (t.x >= THROW_ZONE.minX && t.x <= THROW_ZONE.maxX && t.z >= THROW_ZONE.minZ && t.z <= THROW_ZONE.maxZ) {
        return 'AtLanding';
    }
    if (cheb(t, WASHED_OUT) <= 6) {
        return 'WashedOut';
    }
    if (cheb(t, RAFT_STAND) <= 5) {
        return 'AtRaft';
    }
    return 'Surface';
}

export interface EscapeTele {
    name: string;
    com: number;
    level: number;
    runes: { rune: string; count: number }[];
    lands: Tile;
    bank: Tile;
}

export const ESCAPE_TELES: Record<string, EscapeTele> = {
    Camelot: {
        name: 'Camelot', com: 1174, level: 45,
        runes: [{ rune: 'Air rune', count: 5 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(2757, 3478, 0), bank: new Tile(2725, 3491, 0)
    },
    Ardougne: {
        name: 'Ardougne', com: 1540, level: 51,
        runes: [{ rune: 'Water rune', count: 2 }, { rune: 'Law rune', count: 2 }],
        lands: new Tile(2661, 3301, 0), bank: new Tile(2616, 3332, 0)
    },
    Falador: {
        name: 'Falador', com: 1170, level: 37,
        runes: [{ rune: 'Water rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(2965, 3378, 0), bank: new Tile(2946, 3369, 0)
    },
    Varrock: {
        name: 'Varrock', com: 1164, level: 25,
        runes: [{ rune: 'Fire rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(3213, 3424, 0), bank: new Tile(3185, 3440, 0)
    }
};

export const ESCAPE_TELE_OPTIONS = Object.keys(ESCAPE_TELES);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/scripts/FireGiantLogic.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Typecheck and lint**

Run: `bunx tsc --noEmit 2>&1 | tail -3`
Expected: no errors mentioning `FireGiantLogic`

Run: `bunx eslint src/bot/scripts/FireGiantLogic.ts test/scripts/FireGiantLogic.test.ts`
Expected: no warnings

- [ ] **Step 6: Commit**

```bash
git add src/bot/scripts/FireGiantLogic.ts test/scripts/FireGiantLogic.test.ts
git commit -m "feat(firegiant): waterfall coords, loc names, and the leg resolver"
```

---

### Task 2: FireGiant scaffold — settings and registry

**Files:**
- Create: `src/bot/scripts/FireGiant.ts` (copied from `MossGiant.ts`)
- Modify: `src/bot/scripts/index.ts`
- Test: `test/scripts/FireGiantLogic.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 1 produced
- Produces: `export default class FireGiant extends TaskBot` with `parked: boolean` and `parkFor(reason: string): void`; `export const SETTINGS: SettingsSchema`. Module-level mutable config `STYLE`, `SAFESPOT`, `MELEE_TILE`, `BANK_TILE`, `TELE: EscapeTele`, `TELE_STOCK: number`, and helpers `inDungeon(): boolean`, `anchor(): Tile`, `hasAmulet(): boolean`, `hasRope(): boolean` — later tasks call these by exactly these names.

- [ ] **Step 1: Copy the template**

```bash
cp src/bot/scripts/MossGiant.ts src/bot/scripts/FireGiant.ts
```

- [ ] **Step 2: Rename the class and target**

In `src/bot/scripts/FireGiant.ts`, replace every occurrence of `MossGiant` with `FireGiant` (the class name, the constructor type annotations on every task class, and the paint title). Then change the header constants:

```ts
const TARGET = 'Fire giant';
const FIELD_RADIUS = 10;
```

Delete the `DEFAULT_SAFESPOT` and `DEFAULT_BANK` consts — they now come from `FireGiantLogic`.

Change the paint accent and title:

```ts
const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e08b5a' });
p.title(`FireGiant — ${this.status}`);
```

and the tab key `p.tabs('mg', …)` becomes `p.tabs('fg', …)`.

- [ ] **Step 3: Add the imports**

Add to the import block in `src/bot/scripts/FireGiant.ts`:

```ts
import { actions } from '../adapter/ClientAdapter.js';
import { Quests } from '../api/hud/Quests.js';
import { Locs } from '../api/queries/Locs.js';
import {
    AMULET, DEFAULT_MELEE_TILE, DEFAULT_SAFESPOT, DUNGEON_MIN_Z, ESCAPE_TELE_OPTIONS, ESCAPE_TELES,
    LEDGE_DOOR, LEDGE_LOC, LEDGE_OP, legFor, RAFT_LOC, RAFT_OP, RAFT_STAND,
    ROCK_LOC, ROPE, TREE_LOC, TREE_STAND, type EscapeTele
} from './FireGiantLogic.js';
```

Leave the `DeathRecovery` import in place for now — Task 5 removes both it and its usage together.

- [ ] **Step 4: Replace the location settings**

In `SETTINGS`, delete the `safespotTile` and `bankTile` entries and add these five in their place:

```ts
    safespotTile: { type: 'tile', default: DEFAULT_SAFESPOT, label: 'Safespot tile (west room)', group: 'Location', showIf: { key: 'combatStyle', anyOf: ['mage', 'range'] }, help: 'north nook of the west room; giants are 2x2 and leash 5 tiles from spawn, so they cannot reach it' },
    meleeTile: { type: 'tile', default: DEFAULT_MELEE_TILE, label: 'Melee anchor tile (centre room)', group: 'Location', showIf: SHOW_MELEE, help: 'centre of the east chamber — 7 giants within 6 tiles' },
    escapeTele: { type: 'string', default: 'Camelot', options: ESCAPE_TELE_OPTIONS, label: 'Escape teleport', group: 'Location', help: 'the dungeon has no walk-out, so banking always teleports. Walk back to the raft: Camelot 352 tiles, Ardougne 274, Falador 771, Varrock 910' },
    teleStock: { type: 'number', default: 2, min: 1, max: 10, label: 'Spare escape casts', group: 'Location', help: 'casts carried on top of the one needed to leave' },
    bankTile: { type: 'tile', default: ESCAPE_TELES.Camelot.bank, label: 'Bank stand tile', group: 'Location', help: 'left at the Seers default, this follows the escape teleport' }
```

Also add the range/mage `showIf` const next to the existing ones near the top:

```ts
const SHOW_SAFESPOT = { key: 'combatStyle', anyOf: ['mage', 'range'] };
```

and use `SHOW_SAFESPOT` in the `safespotTile` entry rather than repeating the literal.

Finally, fix the inherited `loot` help text, which still names the wrong monster:

```ts
    loot: { type: 'string[]', default: DEFAULT_LOOT, options: DROPS, label: 'Loot to pick up (drop table)', group: 'Banking & loot', help: 'the fire giant drop table; ticked drops get grabbed. Everything picked up is banked — the bank keeps only food/runes/ammo/weapon plus the amulet, rope, and escape runes.' },
```

`TARGET` is now `'Fire giant'`, so the inherited `DROPS` / `DEFAULT_LOOT` lines pick up the fire
giant table with no further change — the existing filter already strips the arrow drops.

- [ ] **Step 5: Replace the module state and the loader**

Replace the `let SAFESPOT = …` / `let BANK_TILE = …` declarations with:

```ts
let SAFESPOT = DEFAULT_SAFESPOT;
let MELEE_TILE = DEFAULT_MELEE_TILE;
let BANK_TILE = ESCAPE_TELES.Camelot.bank;
let TELE: EscapeTele = ESCAPE_TELES.Camelot;
let TELE_STOCK = 2;
```

In `onStart()`, replace the two settings lines that loaded `SAFESPOT` and `BANK_TILE` with:

```ts
        SAFESPOT = this.settings.tile('safespotTile', DEFAULT_SAFESPOT);
        MELEE_TILE = this.settings.tile('meleeTile', DEFAULT_MELEE_TILE);
        TELE = ESCAPE_TELES[this.settings.str('escapeTele', 'Camelot')] ?? ESCAPE_TELES.Camelot;
        TELE_STOCK = this.settings.num('teleStock', 2);
        const chosenBank = this.settings.tile('bankTile', ESCAPE_TELES.Camelot.bank);
        const bankIsDefault = chosenBank.x === ESCAPE_TELES.Camelot.bank.x && chosenBank.z === ESCAPE_TELES.Camelot.bank.z;
        BANK_TILE = bankIsDefault ? TELE.bank : chosenBank;
```

- [ ] **Step 6: Add the shared helpers**

Add next to the existing `atSafespot` / `usesSafespot` helpers:

```ts
function inDungeon(): boolean {
    const here = Game.tile();
    return here !== null && here.z > DUNGEON_MIN_Z;
}
function anchor(): Tile {
    return usesSafespot() ? SAFESPOT : MELEE_TILE;
}
function hasAmulet(): boolean {
    return Inventory.count(AMULET) > 0 || Equipment.contains(AMULET);
}
function hasRope(): boolean {
    return Inventory.count(ROPE) > 0;
}
```

Add the parking state to the `FireGiant` class body next to `died`. Tasks 3, 4, and 5 all call it,
so it lands here to keep every task compiling on its own:

```ts
    parked = false;
    private parkReason = '';

    parkFor(reason: string): void {
        if (this.parked) {
            return;
        }
        this.parked = true;
        this.parkReason = reason;
        this.setStatus('parked');
        this.log(`PARKED: ${reason}`);
    }
```

Change `inField` and `atSafespot` to key off `anchor()` instead of `SAFESPOT`:

```ts
function inField(tile: Tile): boolean {
    return anchor().distanceTo(tile) <= FIELD_RADIUS;
}
function atSafespot(): boolean {
    const here = Game.tile();
    return here !== null && SAFESPOT.x === here.x && SAFESPOT.z === here.z && SAFESPOT.level === here.level;
}
```

Update `recoveryAnchor()` to `return anchor();` and the opening log line to:

```ts
        this.log(`FireGiant — style ${STYLE}${STYLE !== 'melee' ? ` w/ ${WEAPON}` : ''}${STYLE === 'mage' ? ` (${SPELL})` : ''}, food '${FOOD_NAME}' (eat<${Math.round(EAT_HP * 100)}%, panic<${Math.round(PANIC_HP * 100)}%), spot ${anchor()}, escape ${TELE.name} tele, bank ${BANK_TILE}`);
```

- [ ] **Step 7: Register the script**

In `src/bot/scripts/index.ts`, add the import next to the `GreenDragon` import (line 22):

```ts
import FireGiant, { SETTINGS as FIREGIANT_SETTINGS } from './FireGiant.js';
```

and add a registration block immediately after the `GreenDragon` block (which ends at line 120):

```ts
ScriptRegistry.register({
    name: 'FireGiant',
    description: 'Waterfall Dungeon fire giants: range/mage safespot or melee, enters by raft + rope + Glarial\'s amulet, teleports out to bank',
    category: 'Combat',
    tags: ['waterfall', 'safespot', 'members', 'banking'],
    settingsSchema: FIREGIANT_SETTINGS,
    create: () => new FireGiant()
});
```

- [ ] **Step 8: Write the registry test**

Append to `test/scripts/FireGiantLogic.test.ts`:

```ts
describe('registry', () => {
    test('FireGiant registers under Combat with its settings schema', async () => {
        const { ScriptRegistry } = await import('#/bot/runtime/ScriptRegistry.js');
        await import('#/bot/scripts/index.js');
        const entry = ScriptRegistry.get('FireGiant');
        expect(entry?.category).toBe('Combat');
        expect(entry?.settingsSchema?.escapeTele?.default).toBe('Camelot');
        expect(entry?.settingsSchema?.combatStyle?.options).toEqual(['melee', 'mage', 'range']);
    });
});
```

- [ ] **Step 9: Run the tests**

Run: `bun test test/scripts/FireGiantLogic.test.ts`
Expected: PASS, 11 tests

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: no errors mentioning `FireGiant`

- [ ] **Step 10: Commit**

```bash
git add src/bot/scripts/FireGiant.ts src/bot/scripts/FireGiantLogic.ts src/bot/scripts/index.ts test/scripts/FireGiantLogic.test.ts
git commit -m "feat(firegiant): bot scaffold, settings, and registry entry"
```

---

### Task 3: Escape teleport and the bank trip

**Files:**
- Modify: `src/bot/scripts/FireGiant.ts`

**Interfaces:**
- Consumes: `TELE`, `TELE_STOCK`, `BANK_TILE`, `inDungeon()`, `hasAmulet()`, `hasRope()` from Task 2
- Produces: `castEscape(bot: FireGiant): Promise<boolean>`, `hasEscapeRunes(): boolean`, and a `bankRoutine` whose signature stays `(bot: FireGiant, withdrawFood: boolean): Promise<void>`

- [ ] **Step 1: Add the teleport helpers**

Add above `bankRoutine` in `src/bot/scripts/FireGiant.ts`:

```ts
const MAGIC_TAB = 6;

function hasEscapeRunes(): boolean {
    return TELE.runes.every(r => Inventory.count(r.rune) >= r.count);
}

async function castEscape(bot: FireGiant): Promise<boolean> {
    if (!hasEscapeRunes()) {
        bot.log(`no ${TELE.name}-teleport runes — cannot leave the dungeon`);
        return false;
    }
    if (Skills.level('magic') < TELE.level) {
        bot.log(`magic ${Skills.level('magic')} is below the ${TELE.level} needed for the ${TELE.name} teleport`);
        return false;
    }
    bot.setStatus(`teleporting to ${TELE.name}`);
    if (!(await Game.openSideTab(MAGIC_TAB))) {
        return false;
    }
    actions.ifButton(TELE.com);
    return Execution.delayUntil(() => !inDungeon(), 8000);
}
```

- [ ] **Step 2: Make the bank trip teleport out first**

Replace the opening of `bankRoutine` — the `Traversal.walkResilient(BANK_TILE, …)` call and its failure branch — with:

```ts
async function bankRoutine(bot: FireGiant, withdrawFood: boolean): Promise<void> {
    if (inDungeon()) {
        for (let i = 0; i < 3 && inDungeon(); i++) {
            if (await castEscape(bot)) {
                bot.log(`teleported out to ${TELE.name}`);
                break;
            }
            await Execution.delayTicks(3);
        }
        if (inDungeon()) {
            bot.parkFor(`stuck in the dungeon: the ${TELE.name} teleport will not fire. Bank ${TELE.runes.map(r => `${r.count} ${r.rune}`).join(' + ')} and check magic level ${TELE.level}.`);
            return;
        }
    }
    if (!(await Traversal.walkResilient(BANK_TILE, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) }))) {
        bot.log('walk to the bank failed — will retry');
        return;
    }
```

The rest of `bankRoutine` (open bank, deposit, withdraw food, `withdrawStyleSupplies`) is unchanged up to the tail.

- [ ] **Step 3: Replace the bank-trip tail**

Replace the last three lines of `bankRoutine` (`bot.countBankTrip()`, the `setStatus`, and the `Traversal.walkResilient(SAFESPOT, …)` call) with:

```ts
    await withdrawEscapeRunes(bot);
    await withdrawEntryKit(bot);

    bot.countBankTrip();
    bot.setStatus('restocked — heading back to the waterfall');
}

async function withdrawEscapeRunes(bot: FireGiant): Promise<void> {
    for (const { rune, count } of TELE.runes) {
        const target = count * (TELE_STOCK + 1);
        if (Inventory.count(rune) < target) {
            await withdrawTo(rune, target);
        }
    }
    if (!hasEscapeRunes()) {
        bot.log(`WARNING: bank is short of ${TELE.name}-teleport runes — the next trip cannot leave the dungeon.`);
    }
}

async function withdrawEntryKit(bot: FireGiant): Promise<void> {
    if (!hasAmulet()) {
        await withdrawTo(AMULET, 1);
    }
    if (!hasRope()) {
        await withdrawTo(ROPE, 1);
    }
}
```

Note the walk back to the fight tile is deliberately gone: the entry ladder in Task 4 owns everything from the bank to the safespot.

- [ ] **Step 4: Extend the keep-list**

Replace `keepNames()`:

```ts
function keepNames(): string[] {
    return combatKeepNames({
        food: FOOD_NAME, style: STYLE, spell: SPELL, ammo: AMMO, weapon: WEAPON,
        extra: ['Coins', AMULET, ROPE, ...TELE.runes.map(r => r.rune)]
    });
}
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit 2>&1 | grep -i firegiant | head -5`
Expected: no output

Run: `bun test`
Expected: same pass count as before this task, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/bot/scripts/FireGiant.ts
git commit -m "feat(firegiant): escape teleport and the bank trip"
```

---

### Task 4: The entry ladder

**Files:**
- Modify: `src/bot/scripts/FireGiant.ts`

**Interfaces:**
- Consumes: `legFor`, all the coord/name constants, `inDungeon()`, `hasAmulet()`, `hasRope()`
- Produces: `class EnterDungeon implements Task` — added to the task list in Task 6

- [ ] **Step 1: Add the leg helpers**

Add above the task classes in `src/bot/scripts/FireGiant.ts`:

```ts
function ledgeDoor() {
    return Locs.query()
        .name(LEDGE_LOC)
        .action(LEDGE_OP)
        .where(l => l.tile().x === LEDGE_DOOR.x && l.tile().z === LEDGE_DOOR.z)
        .first();
}

async function useRopeOn(locName: string): Promise<boolean> {
    const rope = Inventory.first(ROPE);
    if (rope === null) {
        return false;
    }
    const target = Locs.query().name(locName).nearest();
    if (target === null) {
        return false;
    }
    return Boolean(await rope.useOn(target));
}
```

`ledgeDoor()` filters by tile on purpose. Three locs named `Ledge` are spawned at 2510, 2511, and
2512 on z3464 and all three advertise `Open`, but only 2511 has a script behind it — a `nearest()`
query can pick an outer leaf and the click silently does nothing, wedging the bot on the ledge
forever.

`useRopeOn` goes through the item-on-loc path (`InvItem.useOn`), never `interact`. The `op1` on both
`Rock` (`Swim to`) and `Dead tree` (`Climb`) is the failure path.

- [ ] **Step 2: Write the EnterDungeon task**

Add after the other task classes:

```ts
class EnterDungeon implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return !inDungeon() && hasAmulet() && hasRope() && !this.bot.parked;
    }
    async execute(): Promise<void> {
        const leg = legFor(Game.tile());
        switch (leg) {
            case 'AtLedge':
                await this.openLedge();
                return;
            case 'PastRock':
                await this.ropeTree();
                return;
            case 'AtLanding':
                await this.ropeRock();
                return;
            case 'AtRaft':
                await this.boardRaft();
                return;
            case 'WashedOut':
                this.bot.log('washed downstream — walking back to the raft');
                await this.walkToRaft();
                return;
            default:
                await this.walkToRaft();
        }
    }

    private async walkToRaft(): Promise<void> {
        this.bot.setStatus('walking to the log raft');
        await Traversal.walkResilient(RAFT_STAND, { radius: 2, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }

    private async boardRaft(): Promise<void> {
        const raft = Locs.query().name(RAFT_LOC).action(RAFT_OP).nearest();
        if (!raft) {
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus('boarding the log raft');
        if (!(await raft.interact(RAFT_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => legFor(Game.tile()) === 'AtLanding', 12_000)) {
            this.bot.log('rafted down to the landing');
        }
    }

    private async ropeRock(): Promise<void> {
        this.bot.setStatus('roping across to the rock');
        if (!(await useRopeOn(ROCK_LOC))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => legFor(Game.tile()) === 'PastRock', 12_000)) {
            this.bot.log('crossed to the rock');
        }
    }

    private async ropeTree(): Promise<void> {
        const here = Game.tile();
        if (here === null || here.x !== TREE_STAND.x || here.z !== TREE_STAND.z) {
            this.bot.setStatus('walking to the dead tree');
            await Traversal.walkResilient(TREE_STAND, { radius: 0, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
            return;
        }
        this.bot.setStatus('roping down the dead tree');
        if (!(await useRopeOn(TREE_LOC))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => legFor(Game.tile()) === 'AtLedge', 12_000)) {
            this.bot.log('down on the ledge');
        }
    }

    private async openLedge(): Promise<void> {
        if (!hasAmulet()) {
            return;
        }
        // locs read empty for a tick after the p_teleport onto the ledge
        let door = ledgeDoor();
        for (let i = 0; i < 5 && door === null; i++) {
            await Execution.delayTicks(1);
            door = ledgeDoor();
        }
        if (door === null) {
            this.bot.log('the ledge door is not in the scene yet — retrying');
            return;
        }
        this.bot.setStatus('opening the ledge door');
        if (!(await door.interact(LEDGE_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => inDungeon(), 12_000)) {
            this.bot.log('inside the Waterfall Dungeon');
        }
    }
}
```

The `openLedge` poll matters: every leg before it ends in a `p_teleport`, and a `Locs` query reads empty for about a tick after any position jump. Without the poll the bot would decide the door is absent and loop.

- [ ] **Step 3: Add the walk-to-spot task**

Add after `EnterDungeon`:

```ts
class WalkToSpot implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        const here = Game.tile();
        return inDungeon() && here !== null && anchor().distanceTo(here) > FIELD_RADIUS;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to the fight spot');
        await Traversal.walkResilient(anchor(), { radius: usesSafespot() ? 0 : 3, attempts: 6, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) });
    }
}
```

- [ ] **Step 4: Gate the combat tasks on being underground**

Add `inDungeon() && ` to the front of the `validate()` return in `Fight`, `LootCorpse`, and `ReturnToSafespot`:

```ts
// Fight
    validate(): boolean {
        if (!inDungeon() || hpFrac() < PANIC_HP) {
            return false;
        }
        if (usesSafespot() && !atSafespot()) {
            return false;
        }
        return fieldGiants().length > 0;
    }
```

```ts
// LootCorpse
    validate(): boolean {
        return inDungeon() && !Inventory.isFull() && findLoot() !== null;
    }
```

```ts
// ReturnToSafespot
    validate(): boolean {
        return inDungeon() && usesSafespot() && !atSafespot() && hpFrac() >= PANIC_HP;
    }
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit 2>&1 | grep -i firegiant | head -5`
Expected: no output

Run: `bun test`
Expected: 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/bot/scripts/FireGiant.ts
git commit -m "feat(firegiant): position-derived entry ladder and fight-spot walk"
```

---

### Task 5: Preconditions and parking

**Files:**
- Modify: `src/bot/scripts/FireGiant.ts`

**Interfaces:**
- Consumes: `hasAmulet()`, `hasRope()`, `Quests`, and `FireGiant.parkFor` from Task 2
- Produces: `checkPrereqs(bot: FireGiant): boolean`, `class Parked implements Task`

- [ ] **Step 1: Add the prerequisite check**

Add above the task classes:

```ts
function checkPrereqs(bot: FireGiant): boolean {
    if (Quests.status('Waterfall Quest') === 'notStarted') {
        bot.parkFor('the Waterfall Quest is not started — the log raft refuses to launch. Talk to Almera at 2515,3495, then restart.');
        return false;
    }
    if (!hasAmulet() && Inventory.isFull()) {
        bot.parkFor(`no ${AMULET} and the pack is full — free a slot so it can be withdrawn.`);
        return false;
    }
    return true;
}
```

- [ ] **Step 2: Park when the entry kit cannot be restocked**

At the end of `withdrawEntryKit`, add:

```ts
    if (!hasAmulet()) {
        bot.parkFor(`no ${AMULET} in the bank or on the player — it is required to open the ledge door and cannot be re-obtained without redoing the Waterfall Quest chain.`);
        return;
    }
    if (!hasRope()) {
        bot.parkFor('no Rope in the bank or on the player — it is required for both the rock and the dead tree. Bank a rope and restart.');
    }
```

- [ ] **Step 3: Replace DeathRecovery with a parking death handler**

Delete the `new DeathRecovery(this, {…})` entry from the `this.add(…)` list and delete its import. Replace the death listener in `onStart()` with:

```ts
        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
                const where = Game.tile();
                this.parkFor(`died${where ? ` at ${where.x},${where.z}` : ''}. Gear is on the death pile in the Waterfall Dungeon and ${AMULET} may be with it — re-entry is impossible without it, so the bot stopped rather than burn bank stock.`);
            }
        });
```

- [ ] **Step 4: Add the Parked task and wire the list**

Add a task class that swallows the loop once parked:

```ts
class Parked implements Task {
    constructor(private bot: FireGiant) {}
    validate(): boolean {
        return this.bot.parked;
    }
    async execute(): Promise<void> {
        await Execution.delayTicks(10);
    }
}
```

Replace the `this.add(…)` call with:

```ts
        this.add(
            new Parked(this),
            new ContinueDialog(),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new PanicBank(this),
            new BuryBones(this),
            new BankRun(this),
            new LootCorpse(this),
            new EnterDungeon(this),
            new WalkToSpot(this),
            new ReturnToSafespot(this),
            new Fight(this)
        );
```

`Parked` is first so nothing else runs after a park. `EnterDungeon` sits after `BankRun` so a restock always completes before the trip back in.

- [ ] **Step 5: Call the prerequisite check at startup**

At the end of `onStart()`, after `this.add(…)`:

```ts
        checkPrereqs(this);
```

- [ ] **Step 6: Show the park reason in the paint**

In `onPaint`, immediately after `p.title(…)`:

```ts
        if (this.parked) {
            p.text(this.parkReason, '#e0705a');
        }
```

- [ ] **Step 7: Typecheck, test, lint**

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

Run: `bun test`
Expected: 0 fail

Run: `bunx eslint src/bot/scripts/FireGiant.ts src/bot/scripts/FireGiantLogic.ts`
Expected: no warnings

- [ ] **Step 8: Commit**

```bash
git add src/bot/scripts/FireGiant.ts
git commit -m "feat(firegiant): prerequisite checks, parking, and death handling"
```

---

### Task 6: Live smoke

**Files:**
- Create: `tools/firegiant-test.ts`

**Interfaces:**
- Consumes: `launchBrowser` from `./lib/harness.js`; `cheat`, `mainlandAccount`, `startScript` from `./tutorial/harness.js`

- [ ] **Step 1: Write the smoke**

Three seeding/instrumentation traps, all hit during implementation. The committed
`tools/firegiant-test.ts` is the corrected reference — prefer it over the sketch below:

1. **`~completequests` does nothing.** `complete_all_quests` opens two blocking `p_choice2`
   dialogs and waits for clicks that never arrive, so no quest completes *and* the pending
   modal swallows every cheat sent after it. Use `setvar waterfall_quest 10` instead.
2. **The client never receives varp 65.** `reader.varp(65)` reads 0 even when the server holds
   10 — do not use it to verify. `Quests.status()` reads the quest journal colour, which the
   server pushes **only at login**, so the setvar must be followed by `relog()`. Verified: the
   colour flips `f80000` → `f800` and the status becomes `complete` only after the relog.
   Seed items *after* that final relog, or they are rolled back.
3. **`Bot.log()` never reaches the console.** `ScriptRunner.ts:52` calls
   `bot.bindLog(msg => ctx.addLog('info', msg))`, so a `page.on('console')` filter for `[bot]`
   matches nothing and the smoke is blind. Poll `rs2b0t.runner.ctx.log` and print new entries,
   and abort on the first `PARKED:` line or a `crashed`/`stopped` runner rather than running
   out the clock. (The same dead filter exists in `tools/runecrafter-test.ts`.)

Sketch:

```ts
// Live smoke for FireGiant. Mainland account -> complete quests (the raft refuses
// to launch otherwise) -> bank Glarial's amulet, a rope, food and teleport runes ->
// run FireGiant -> watch it walk to Almera's raft, board, rope the rock, rope the
// dead tree, open the ledge door, and fight. PASS when it reaches the dungeon
// (z > 9000) and lands a kill (combat XP gained).
//
// Usage: bun tools/firegiant-test.ts [base] [user] [budget-min]

import { launchBrowser } from './lib/harness.js';
import { cheat, mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `fg${Date.now().toString(36).slice(-6)}`;
const budgetMin = Number(process.argv[4]) || 40;
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    __rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        Skills: { xp(n: string): number };
    };
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => { const t = m.text(); if (t.startsWith('[bot]')) { console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${t}`); } });

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    // Seed AFTER mainlandAccount's relog — a pre-relog seed is rolled back.
    await cheat(page, '~completequests');
    await cheat(page, '~maxme');
    await cheat(page, '~bankitem glarials_amulet_waterfall_quest 1');
    await cheat(page, '~bankitem rope 1');
    await cheat(page, '~bankitem lobster 200');
    await cheat(page, '~bankitem airrune 1000');
    await cheat(page, '~bankitem lawrune 200');
    await cheat(page, '~bankitem rune_scimitar 1');
    console.log('seeded: quests complete, maxed stats, amulet + rope + food + Camelot runes + scimitar');

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:FireGiant:combatStyle', 'melee');
        sessionStorage.setItem('rs2b0t:set:FireGiant:escapeTele', 'Camelot');
        sessionStorage.setItem('rs2b0t:set:FireGiant:food', 'Lobster');
    });
    await startScript(page, 'FireGiant');
    console.log('started FireGiant (melee) — watching for the dungeon and a kill');

    const snap = () => page.evaluate(() => {
        const g = globalThis as never as R;
        const t = g.__rs2b0t.reader.worldTile();
        const xp = ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0);
        return { t, xp };
    });

    const start = await snap();
    let reachedDungeon = false;
    let killed = false;

    while (Date.now() - t0 < BUDGET_MS) {
        await new Promise(r => setTimeout(r, 10_000));
        const s = await snap();
        if (!reachedDungeon && s.t !== null && s.t.z > 9000) {
            reachedDungeon = true;
            console.log(`PASS(entry): reached the dungeon at ${s.t.x},${s.t.z} after ${Math.round((Date.now() - t0) / 1000)}s`);
        }
        if (reachedDungeon && s.xp > start.xp + 500) {
            killed = true;
            console.log(`PASS(combat): gained ${s.xp - start.xp} combat xp`);
            break;
        }
    }

    if (!reachedDungeon) { fail('never reached the Waterfall Dungeon (z > 9000)'); }
    if (!killed) { fail('reached the dungeon but never gained combat xp'); }
    console.log('PASS');
} finally {
    await browser.close();
}
```

- [ ] **Step 2: Lint and typecheck**

Run: `bunx tsc --noEmit 2>&1 | tail -3`
Expected: no errors

Run: `bunx eslint tools/firegiant-test.ts`
Expected: no warnings

- [ ] **Step 3: Verify the cheat names against the smoke-target content**

Run:
```bash
grep -n "debugproc,\(completequests\|maxme\|bankitem\)\]" ~/code/rs2b2t-content/scripts/_test/scripts/cheats/*.rs2
grep -n "glarials_amulet_waterfall_quest\|^[0-9]*=rope$" ~/code/rs2b2t-content/pack/obj.pack
```
Expected: all four debugprocs found, and both obj debugnames present. If a name differs, fix the smoke to match the content — the content is authoritative.

- [ ] **Step 4: Deploy the bot bundle**

The sim serves a prebuilt `botclient.js`; a newly registered script is invisible to
`startScript` until the bundle is rebuilt and copied into the engine's `public/`. Skipping this
fails with `TypeError: Cannot read properties of undefined (reading 'create')` inside
`ScriptRegistry`, which reads like a registry bug but is a stale-bundle problem.

Run: `sh tools/deploy-local.sh`
Expected: `deployed: …/public/bot.html (+ /bot, /client refreshed)`

This **overwrites the bundle any running bot session is using**. Check for one first
(`cat .b0t-launch.lock/owner.pid` and `ps -p <pid>`) and confirm before clobbering it.

- [ ] **Step 5: Run the smoke**

Start the sim first if it is not already up, then:

Run: `bun tools/firegiant-test.ts http://localhost:8890 fgsmoke 40`
Expected: `PASS(entry)` then `PASS(combat)` then `PASS`

If it hangs on a leg, the `[bot]` log lines name the leg. The two most likely failures and their causes:
- stuck on the ledge → the door query picked an outer `Ledge` leaf; confirm the `.where()` tile filter is present
- stuck at the landing → the throw zone check; confirm the player is inside x2510-2514 / z3476-3481

- [ ] **Step 6: Commit**

```bash
git add tools/firegiant-test.ts
git commit -m "test(firegiant): live smoke for the entry chain and first kill"
```

---

### Task 7: Confirm the safespot live

**Files:**
- Modify: `src/bot/scripts/FireGiantLogic.ts` (only if the default proves wrong)

This is the one thing the static analysis could not settle: whether `2568,9893` holds as a safespot in a real fight. The leash and footprint maths say yes, but engine line-of-sight has corner rules the static check does not model.

- [ ] **Step 1: Run the smoke in range mode**

```bash
bun tools/firegiant-test.ts http://localhost:8890 fgrange 40
```

before which, change the settings block in `tools/firegiant-test.ts` to:

```ts
        sessionStorage.setItem('rs2b0t:set:FireGiant:combatStyle', 'range');
        sessionStorage.setItem('rs2b0t:set:FireGiant:bow', 'Maple shortbow');
        sessionStorage.setItem('rs2b0t:set:FireGiant:ammo', 'Iron arrow');
```

and add `~bankitem maple_shortbow 1` and `~bankitem iron_arrow 2000` to the seeds.

- [ ] **Step 2: Judge the result**

Watch the `[bot]` log for `returning to the safespot` lines. Expected: the bot holds `2568,9893` and kills without being dragged off.

- If it holds and kills → the default is correct. Nothing to change.
- If it is repeatedly pulled off the tile or takes melee damage → change `DEFAULT_SAFESPOT` in `src/bot/scripts/FireGiantLogic.ts` to `new Tile(2568, 9884, 0)` (the documented fallback: 2 giants in LoS, nearest at 3) and re-run.
- If it holds but never lands a hit → it is out of line of sight; the fallback applies for the same reason.

- [ ] **Step 3: Commit only if the default changed**

```bash
git add src/bot/scripts/FireGiantLogic.ts
git commit -m "fix(firegiant): move the default safespot to the verified tile"
```

- [ ] **Step 4: Record the outcome in the spec**

Replace the "Open question for live verification" section of `docs/superpowers/specs/2026-07-26-firegiant-waterfall-design.md` with a one-line statement of which tile was verified and on what date.

```bash
git add docs/superpowers/specs/2026-07-26-firegiant-waterfall-design.md
git commit -m "docs(firegiant): record the live-verified safespot"
```

---

## Final verification

- [ ] `bun test` — 0 fail
- [ ] `bunx tsc --noEmit` — no errors
- [ ] `bunx eslint src/bot/scripts/FireGiant.ts src/bot/scripts/FireGiantLogic.ts tools/firegiant-test.ts` — no warnings
- [ ] `bun tools/firegiant-test.ts` — PASS in both melee and range mode
- [ ] `git log --oneline main..firegiant` shows one commit per task
