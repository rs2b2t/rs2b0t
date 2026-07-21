# AutoFighter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone TaskBot that camps a selectable guard spot, kills the selectable target, loots only gem-table items + clues, solves clues via the shared SolveClue task, banks after each solve, and returns to killing.

**Architecture:** One new pure data module (spots + default loot), one new client-coupled script composing the fleet's proven task shapes (ArdyFighter's Fight/EatFood/PanicRetreat/LootDrops, RockCrab's SolveClue host + bank-food pattern, nearestBank BankRun), a registry entry, and a live smoke. Spec: `docs/superpowers/specs/2026-07-20-autofighter-design.md`.

**Tech Stack:** TypeScript (bun), existing bot API (`TaskBot`, `SolveClue`, `Traversal`, `Bank`, `Npcs`, `GroundItems`), Playwright smoke harness.

## Global Constraints

- Loot DEFAULTS to exactly gems + clues (spec list); a `string[]` setting, no code change to alter.
- The trio/spade/coins keep-set at banks must survive every deposit (future clues need them).
- Anchor tiles must be pack-walkable and pathable from their nearest bank (offline probe before commit).
- Task order: ContinueDialog, DeathRecovery, LootDrops, EatFood, PanicRetreat, SolveClue, BankRun, Fight, ReturnToAnchor.
- Fleet norms: ADR-0006 module-state settings, `grindTargets()` for the target, chatbox Paint with pause/stop.

---

### Task 1: Spot + loot data (pure) with tests and offline anchor probe

**Files:**
- Create: `src/bot/scripts/AutoFighterData.ts`
- Create: `src/bot/scripts/AutoFighterData.test.ts`
- Scratch: `<scratchpad>/autofighter-anchors-probe.ts` (not committed)

**Interfaces:**
- Produces: `SPOTS: Record<string, { tile: Tile; leash: number }>`, `SPOT_OPTIONS: string[]`, `DEFAULT_LOOT: string[]`, `TARGET_OPTIONS: string[]` — consumed by Task 2's script and settings schema.

- [ ] **Step 1: Verify gem display names in the engine pack** (adjust DEFAULT_LOOT below if they differ)

Run: `rg -n "^name=" ~/code/lostcity-dev/content/scripts/_unpack/225/all.obj | rg -i "uncut|half of|talisman" | head -20`
Expected: `Uncut sapphire`, `Uncut emerald`, `Uncut ruby`, `Uncut diamond`, `Loop half of a key`, `Tooth half of a key`, `Chaos talisman`, `Nature talisman` (case as shown; loot matching is case-insensitive contains, so `uncut sapphire` etc. is fine either way).

- [ ] **Step 2: Write the failing test**

`src/bot/scripts/AutoFighterData.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_LOOT, SPOTS, SPOT_OPTIONS, TARGET_OPTIONS } from './AutoFighterData.js';

describe('AutoFighter data', () => {
    test('loot defaults to exactly gems + clues (the spec set)', () => {
        expect(DEFAULT_LOOT).toEqual([
            'clue scroll',
            'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
            'loop half of a key', 'tooth half of a key',
            'chaos talisman', 'nature talisman'
        ]);
    });
    test('every spot option resolves to a spot with a sane leash', () => {
        expect(SPOT_OPTIONS.length).toBe(10);
        for (const name of SPOT_OPTIONS) {
            const s = SPOTS[name];
            expect(s).toBeDefined();
            expect(s.leash).toBeGreaterThanOrEqual(6);
            expect(s.leash).toBeLessThanOrEqual(14);
        }
    });
    test('Guard is the only target for now', () => {
        expect(TARGET_OPTIONS).toEqual(['Guard']);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/bot/scripts/AutoFighterData.test.ts`
Expected: FAIL — export not found.

- [ ] **Step 4: Write the data module**

`src/bot/scripts/AutoFighterData.ts`:
```ts
import Tile from '../api/Tile.js';

/**
 * Pure data for AutoFighter — no client imports (plain `bun test`).
 * Spots are guard spawn clusters measured from maps/*.jm2 (npc ids 9/10
 * generic Guard, 32 ardougne_guard; see the 2026-07-20 design doc). Anchor
 * tiles are pack-walkable stands near each cluster centroid (offline-probed);
 * leash covers the cluster spread.
 */
export const TARGET_OPTIONS = ['Guard'];

export const SPOTS: Record<string, { tile: Tile; leash: number }> = {
    'Varrock East gate': { tile: new Tile(3273, 3427, 0), leash: 8 },
    'Varrock West gate': { tile: new Tile(3174, 3426, 0), leash: 8 },
    'Varrock Palace': { tile: new Tile(3212, 3462, 0), leash: 10 },
    'Varrock south entrance': { tile: new Tile(3209, 3379, 0), leash: 8 },
    'Ardougne market': { tile: new Tile(2661, 3306, 0), leash: 12 },
    'Ardougne north gate': { tile: new Tile(2636, 3339, 0), leash: 8 },
    'Falador east gate': { tile: new Tile(2951, 3380, 0), leash: 8 },
    'Falador park': { tile: new Tile(2965, 3390, 0), leash: 12 },
    'Port Sarim jail': { tile: new Tile(3006, 3322, 0), leash: 8 },
    'Edgeville south road': { tile: new Tile(3104, 3515, 0), leash: 14 }
};
export const SPOT_OPTIONS = Object.keys(SPOTS);

/** Gems + clues, nothing else (user spec). Contains-matched, case-insensitive. */
export const DEFAULT_LOOT = [
    'clue scroll',
    'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
    'loop half of a key', 'tooth half of a key',
    'chaos talisman', 'nature talisman'
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/bot/scripts/AutoFighterData.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Offline anchor probe — every anchor pack-walkable + bank-pathable**

Write to scratchpad (NOT the repo) `autofighter-anchors-probe.ts`:
```ts
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import doorsJson from '/Users/elliottriplett/code/rs2b0t/src/bot/nav/data/doors.json';
import transportsJson from '/Users/elliottriplett/code/rs2b0t/src/bot/nav/data/transports.json';
import stairsJson from '/Users/elliottriplett/code/rs2b0t/src/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData } from '/Users/elliottriplett/code/rs2b0t/src/bot/nav/PathFinder.js';
import { SPOTS } from '/Users/elliottriplett/code/rs2b0t/src/bot/scripts/AutoFighterData.js';
import { nearestBank } from '/Users/elliottriplett/code/rs2b0t/src/bot/api/BankLocations.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('/Users/elliottriplett/code/rs2b0t/out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);

let bad = 0;
for (const [name, s] of Object.entries(SPOTS)) {
    const w = finder.walkable(s.tile.x, s.tile.z, 0);
    const bank = nearestBank(s.tile);
    const p = bank ? finder.findPath(s.tile, bank.tile) : null;
    const ok = w && p?.ok;
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'BAD '} ${name} (${s.tile.x},${s.tile.z}) walkable=${w} bank=${bank?.name ?? 'none'} path=${p?.ok ? `cost ${p.cost}` : (p?.reason ?? 'n/a')}`);
}
process.exit(bad === 0 ? 0 : 1);
```
Run: `bun <scratchpad>/autofighter-anchors-probe.ts`
Expected: 10× OK. If any BAD: nudge that anchor tile to an adjacent walkable tile (re-run until OK), keeping it within ~4 tiles of the centroid.

- [ ] **Step 7: Commit**

```bash
git add src/bot/scripts/AutoFighterData.ts src/bot/scripts/AutoFighterData.test.ts
git commit -m "feat(autofighter): spot + loot data (10 probed guard anchors, gems+clues loot)"
```

---

### Task 2: The AutoFighter script + registry entry

**Files:**
- Create: `src/bot/scripts/AutoFighter.ts`
- Modify: `src/bot/scripts/index.ts` (import + `ScriptRegistry.register` block, alongside ArdyFighter's)

**Interfaces:**
- Consumes: Task 1's `SPOTS/SPOT_OPTIONS/DEFAULT_LOOT/TARGET_OPTIONS`; shared `SolveClue` (host contract from `SolveClue.ts`), `nearestBank`, ArdyFighterLogic pure helpers (`matchesAny`, `shouldEat`, `shouldPanic`, `countMatching`, `slotsMatching`), `COMBAT_STYLE_OPTIONS`/`parseCombatStyle`.
- Produces: registry script named `AutoFighter`.

- [ ] **Step 1: Write the script**

`src/bot/scripts/AutoFighter.ts` (complete file):
```ts
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { COMBAT_STYLE_OPTIONS, parseCombatStyle } from '../api/CombatStyle.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { Traversal } from '../api/Traversal.js';
import { EventSignal } from '../api/EventSignal.js';
import { Sustain } from '../api/Sustain.js';
import { nearestBank } from '../api/BankLocations.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import type Tile from '../api/Tile.js';
import { countMatching, matchesAny, shouldEat, shouldPanic, slotsMatching } from './ArdyFighterLogic.js';
import { DEFAULT_LOOT, SPOTS, SPOT_OPTIONS, TARGET_OPTIONS } from './AutoFighterData.js';
import { SolveClue } from '../clues/SolveClue.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const KIT = ['spade', 'sextant', 'watch', 'chart']; // bank keep-set (future clues)

function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Guard', options: TARGET_OPTIONS, label: 'Target to kill' },
    spot: { type: 'string', default: 'Varrock East gate', options: SPOT_OPTIONS, label: 'Killing spot', help: 'guard spawn clusters measured from the map data' },
    combatStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Combat style' },
    food: { type: 'string', default: 'Trout', label: 'Food (withdrawn from bank)' },
    foodWithdraw: { type: 'number', default: 10, min: 0, max: 27, label: 'Food to carry' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, label: 'Loot item names (contains)', help: 'defaults to gem-table items + clue scrolls, nothing else' },
    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Safety-bank at loot slots' }
};

// Active run config (ADR-0006 single-script module state).
let TARGET = 'Guard';
let ANCHOR = SPOTS['Varrock East gate'].tile;
let LEASH = 8;
let FOOD = 'Trout';
let FOOD_WITHDRAW = 10;
let EAT_AT = 0.5;
let EAT_TO = 0.9;
let PANIC_AT = 0.25;
let LOOT = DEFAULT_LOOT;
let SOLVE_CLUES = true;
let BANK_AT = 12;
let COMBAT_MODE = 1;

function foodCount(): number {
    return countMatching(Inventory.items(), [FOOD]);
}
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

/**
 * AutoFighter — anchor-based target killer that farms and solves clues
 * (2026-07-20 design). Kills the selected target at the selected spot,
 * loots ONLY gem-table items + clue scrolls, invokes the shared SolveClue
 * on pickup, banks the loot when the clue finishes (plus a full-pack
 * safety), and returns to killing. Start it anywhere — it walks to the
 * spot first. Food comes from the bank, so stock some.
 */
export default class AutoFighter extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private looted = 0;
    private eats = 0;
    private trips = 0;
    private deaths = 0;
    private cluesSolved = 0;
    private solveClue: SolveClue | undefined;
    /** Set when a solve completes; BankRun consumes it (bank-after-clue). */
    bankAfterSolve = false;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        TARGET = this.settings.str('target', 'Guard');
        const spot = SPOTS[this.settings.str('spot', 'Varrock East gate')] ?? SPOTS['Varrock East gate'];
        ANCHOR = spot.tile;
        LEASH = spot.leash;
        FOOD = this.settings.str('food', 'Trout');
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 10);
        EAT_AT = this.settings.num('eatAtHp', 50) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        LOOT = this.settings.list('loot', DEFAULT_LOOT).map(s => s.trim().toLowerCase());
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        COMBAT_MODE = parseCombatStyle(this.settings.str('combatStyle', 'strength'));

        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.cluesSolved++;
                    this.bankAfterSolve = true; // the user loop: bank, then back to killing
                }
                this.setStatus(s);
            },
            isFood: n => matchesAny(n, [FOOD]),
            foodName: () => FOOD,
            foodWithdraw: () => FOOD_WITHDRAW,
            spadeName: () => 'Spade',
            enabled: () => SOLVE_CLUES
        });

        // Eat mid-walk: clue trails leave the spot and the Eat task can't run
        // while a walk or solve holds the task loop (RockCrab's proven shape).
        Sustain.set(async () => {
            if (Skills.hpFraction() < EAT_AT && foodCount() > 0) {
                const food = Inventory.items().find(i => matchesAny(i.name, [FOOD]));
                if (food) {
                    const before = Skills.effective('hitpoints');
                    if (await food.interact('Eat')) {
                        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
                    }
                }
            }
        });

        this.startedAt = Date.now();
        this.xpAtStart = ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, sk) => n + Skills.xp(sk), 0);
        this.log(`AutoFighter starting — '${TARGET}' at ${this.settings.str('spot', 'Varrock East gate')} ${ANCHOR} r${LEASH}, food '${FOOD}'x${FOOD_WITHDRAW}, loot [${LOOT.join(', ')}]`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => {
                    this.setStatus('died — recovering');
                    this.deaths++;
                    this.solveClue?.noteDeath();
                    this.log('died! waiting for respawn, then walking back to the spot');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
            this.solveClue!, // a looted clue preempts banking/fighting
            new BankRun(this),
            new SetStyle(),
            new Fight(this),
            new ReturnToAnchor(this)
        );
    }

    override grindTargets(): string[] {
        return [TARGET.toLowerCase()];
    }
    override recoveryAnchor(): Tile | null {
        return ANCHOR;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fd07f' });
        p.title(`AutoFighter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, sk) => n + Skills.xp(sk), 0) - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
        p.row(`Looted: ${this.looted}`, `Food: ${foodCount()}`, this.deaths ? `Deaths: ${this.deaths}` : `Trips: ${this.trips}`);
        p.row(`Clues: ${this.cluesSolved}`, `Clue: ${this.solveClue?.clueStatus() ?? 'idle'}`);
        p.bar('HP', Skills.hpFraction());
        p.gap();
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    countKill(): void { this.kills++; }
    countLoot(): void { this.looted++; }
    countEat(): void { this.eats++; }
    countTrip(): void { this.trips++; }
}

/** Ground gem/clue within leash+4, out of combat -> Take (ArdyFighter shape). */
class LootDrops implements Task {
    constructor(private bot: AutoFighter) {}
    private find() {
        return GroundItems.query()
            .where(g => matchesAny(g.name, LOOT))
            .within(LEASH + 4)
            .nearest();
    }
    validate(): boolean {
        return !Game.inCombat() && !Inventory.isFull() && this.find() !== null;
    }
    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        this.bot.setStatus(`looting ${drop.name} at ${drop.tile()}`);
        const before = countMatching(Inventory.items(), LOOT);
        if (!(await drop.interact('Take'))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => countMatching(Inventory.items(), LOOT) > before, 5000)) {
            this.bot.countLoot();
        }
    }
}

/** Eat below the gate up to the target (ArdyFighter shape). */
class EatFood implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return shouldEat(Skills.hpFraction(), EAT_AT, foodCount());
    }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return;
            }
            if (Skills.hpFraction() >= EAT_TO || foodCount() === 0) {
                return;
            }
            const food = Inventory.items().find(i => matchesAny(i.name, [FOOD]));
            if (!food) {
                return;
            }
            this.bot.setStatus(`eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
            const before = Skills.effective('hitpoints');
            if (!(await food.interact('Eat'))) {
                return;
            }
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before || foodCount() === 0, 3000);
            if (Skills.effective('hitpoints') > before) {
                this.bot.countEat();
            }
        }
    }
}

/** No food + low HP: run to the bank, restock or regen (ArdyFighter shape). */
class PanicRetreat implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return shouldPanic(Skills.hpFraction(), PANIC_AT, foodCount());
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            return;
        }
        this.bot.setStatus('panic: no food — retreating to the bank');
        this.bot.log(`panic retreat at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
        await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) });
        if (await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`))) {
            for (let i = 0; i < FOOD_WITHDRAW && !Inventory.isFull(); i++) {
                const before = foodCount();
                if (!(await Bank.withdraw(FOOD, 'Withdraw-1'))) {
                    break;
                }
                if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                    break;
                }
            }
        }
        if (foodCount() === 0) {
            this.bot.setStatus('panic: bank empty — waiting for regen');
            await Execution.delayUntil(() => Skills.hpFraction() >= EAT_TO || Game.inCombat() || ChatDialog.canContinue() || EventSignal.pending(), 300_000);
        }
    }
}

/** Bank after a solved clue (the user loop) or on the full-pack/foodless
 *  safeties: deposit everything except food + kit + coins, top food up,
 *  walk back to the spot. */
class BankRun implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        if (Game.inCombat()) {
            return false;
        }
        return this.bot.bankAfterSolve || lootSlots() >= BANK_AT || (foodCount() === 0 && FOOD_WITHDRAW > 0);
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.bot.bankAfterSolve = false;
            return;
        }
        this.bot.setStatus(this.bot.bankAfterSolve ? 'clue done — banking the loot' : 'banking');
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            return; // walk failed — revalidate next loop
        }
        if (!(await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            return;
        }
        const keep = (name: string): boolean => {
            const n = name.toLowerCase();
            return matchesAny(name, [FOOD]) || n === 'coins' || KIT.includes(n) || n.includes('clue') || n.includes('casket');
        };
        await Bank.depositAllMatching(name => !keep(name), m => this.bot.log(`  ${m}`));
        for (let guard = 0; guard < FOOD_WITHDRAW && foodCount() < FOOD_WITHDRAW && !Inventory.isFull(); guard++) {
            const before = foodCount();
            if (!(await Bank.withdraw(FOOD, 'Withdraw-1'))) {
                this.bot.log(`no '${FOOD}' in the bank — fighting on without food`);
                break;
            }
            if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                break;
            }
        }
        this.bot.bankAfterSolve = false;
        this.bot.countTrip();
        this.bot.setStatus('heading back to the spot');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Re-apply the combat style each validate-miss (com_mode is not saved). */
class SetStyle implements Task {
    private applied = false;
    validate(): boolean {
        return !this.applied;
    }
    async execute(): Promise<void> {
        this.applied = Game.setCombatStyle(COMBAT_MODE);
        await Execution.delayTicks(1);
    }
}

/** Attack the nearest target in leash; track the kill (ArdyFighter shape). */
class Fight implements Task {
    constructor(private bot: AutoFighter) {}
    private findTarget() {
        return Npcs.query()
            .name(TARGET)
            .action('Attack')
            .where(n => !n.inCombat && n.tile().distanceTo(ANCHOR) <= LEASH)
            .nearest();
    }
    private track(engaged: Npc): Npc | null {
        return Npcs.all().find(n => n.index === engaged.index && n.name === TARGET) ?? null;
    }
    validate(): boolean {
        return !Game.inCombat() && Skills.hpFraction() >= EAT_AT && this.findTarget() !== null;
    }
    async execute(): Promise<void> {
        const target = this.findTarget();
        if (!target) {
            return;
        }
        this.bot.setStatus(`attacking ${TARGET} at ${target.tile()}`);
        if (!(await target.interact('Attack'))) {
            await Execution.delayTicks(2);
            return;
        }
        if (!(await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000)) || ChatDialog.canContinue()) {
            return;
        }
        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) {
                return;
            }
            if (shouldEat(Skills.hpFraction(), EAT_AT, foodCount()) || Skills.hpFraction() < PANIC_AT) {
                return; // EatFood / PanicRetreat outrank us next loop
            }
            const cur = this.track(target);
            if (!cur || (cur.health === 0 && cur.snap.totalHealth > 0)) {
                if (cur) {
                    await Execution.delayUntil(() => this.track(target) === null, 10_000);
                }
                this.bot.countKill();
                await Execution.delayTicks(2); // let the drop land for LootDrops
                return;
            }
            if (!Game.inCombat() && !cur.inCombat) {
                return;
            }
            await Execution.delayTicks(2);
        }
    }
}

/** Start-anywhere travel + drift recovery. */
class ReturnToAnchor implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6 && !Game.inCombat();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the spot');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }
}
```

NOTE for the implementer: `SetStyle`/`Game.setCombatStyle` — check how ArdyFighter applies `COMBAT_MODE` (its `SetStyle` task) and copy that exact call; if the API is `Game.setCombatStyle(mode)` elsewhere named differently (e.g. `actions.setCombatStyle`), mirror ArdyFighter verbatim.

- [ ] **Step 2: Register in the script index**

In `src/bot/scripts/index.ts`, next to ArdyFighter's import:
```ts
import AutoFighter, { SETTINGS as AUTOFIGHTER_SETTINGS } from './AutoFighter.js';
```
and next to ArdyFighter's register block:
```ts
ScriptRegistry.register({
    name: 'AutoFighter',
    description: 'Anchor-based clue farmer — kills the chosen target at a chosen guard spot, loots ONLY gem-table items + clue scrolls, solves clues on pickup (shared SolveClue), banks after each solve, returns to killing',
    category: 'Combat',
    tags: ['combat', 'clues', 'banking', 'afk'],
    settingsSchema: AUTOFIGHTER_SETTINGS,
    create: () => new AutoFighter()
});
```

- [ ] **Step 3: Full test suite + build**

Run: `bun test` — expected: all pass (data tests included).
Run: `sh tools/deploy-local.sh` — expected: bundle builds + deploys (compile gate for the new script).

- [ ] **Step 4: Commit**

```bash
git add src/bot/scripts/AutoFighter.ts src/bot/scripts/index.ts
git commit -m "feat(autofighter): anchor guard killer + in-grind clue solving"
```

---

### Task 3: Live smoke

**Files:**
- Create: `tools/autofighter-test.ts`

**Interfaces:**
- Consumes: registry name `AutoFighter`; log markers `[clue] banking loot at the`, `[clue] leg N — solving`, `clue done — banking the loot` (BankRun status is not logged — assert via the `banked`→return flow below), kill evidence via the paint counter is unavailable — use log line `AutoFighter starting` + a `Kills:`-free proxy: watch `runner.ctx.log` for the fight loop is silent, so kill evidence = the staged clue drop appearing in the pack implies looting worked… **Simplest reliable markers:** (a) bot reaches the anchor, (b) `::give` clue → `[clue] banking loot at the` + `[clue] leg`, (c) after solve completes or is abandoned, log `clue done — banking the loot` does NOT exist as a log line — so instead assert the bot RETURNS to within leash of the anchor after the solve leg starts to wander. Keep the smoke to: anchor arrival, kill observed (hp/xp of a Guard drops — via `Npcs` poll from the page: a Guard near the anchor whose health hits 0), clue preemption markers, and final return-to-anchor.

- [ ] **Step 1: Write the smoke** (mirror `tools/ardycakes-clue-test.ts`'s boot; differences shown)

```ts
// Headless live smoke for AutoFighter: boots at Varrock East gate, maxme,
// watches for a Guard kill (a Guard within the leash reaching health 0),
// ::give's an easy clue -> asserts SolveClue preempts (bank-first + trail
// start), then watches the bot return to within leash of the anchor.
// Usage: bun tools/autofighter-test.ts [base-url]
```
Boot exactly like ardycakes-clue-test (login, tutorial-exit, `::~maxme`, then
`::tele 0,51,53,33,35` — Varrock East gate (3273,3427): mx 51, mz 53, lx 33,
lz 35). Start via `runner.start(registry.get('AutoFighter'))`. Then:
1. Wait for anchor proximity (worldTile within 10 of 3273,3427; up to 60s).
2. Kill watch (up to 120s): poll `__rs2b0t.Npcs.query().name('Guard')...results()` for any guard whose `health === 0` OR watch two consecutive polls where a guard disappears while the player `Game.inCombat()` was true — simpler: poll `rs2b0t.reader`-side `inCombat` true at least once, then false with no death → kill assumed; log it.
3. `::give trail_clue_easy_map001` (canvas type helper).
4. Watch runner log for `[clue] banking loot at the` and `[clue] leg` (up to 240s) — clue preemption PASS.
5. Watch (up to 240s) for worldTile back within 12 of the anchor after step 4 markers (post-solve/abandon BankRun + return). The easy clue's dig is remote; the solve may legitimately abandon on a missing requirement mid-smoke — RETURN is what we assert, not solve completion.
6. Print log tail + PASS/FAIL.

- [ ] **Step 2: Run it**

Run: `bun tools/autofighter-test.ts` (engine running, build deployed)
Expected: `PASS: AutoFighter — anchor, kill, clue preemption, return`. Iterate on failures (this is the live gate).

- [ ] **Step 3: Commit**

```bash
git add tools/autofighter-test.ts
git commit -m "test(autofighter): live smoke — anchor, kill, clue preemption, return"
```

## Self-review notes

- Spec coverage: settings ✓ (target/spot/style/food/loot/solveClues/bankAt), task order ✓, bank-after-solve flag ✓, Sustain ✓, grindTargets ✓, paint ✓, offline anchor probe ✓, live smoke ✓. Spot table = 10 spots ✓.
- Type consistency: `bankAfterSolve` public field consumed by BankRun ✓; data module exports match test imports ✓.
- Open item deliberately deferred to implementation: exact `SetStyle` API call (mirror ArdyFighter's), gem display names (Step 1 grep).
