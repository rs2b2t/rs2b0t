import type { WorldTile } from '../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { EventSignal } from '../api/EventSignal.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// Grounded from ~/code/rs2b2t-content (2026-07-08):
// skill_agility/scripts/wilderness_course.rs2 + configs/wilderness_course.loc.
//
// Lap obstacles (display name / op1 — every one calls stat_advance(agility),
// so agility-xp is the completion signal, same as the Gnome course):
//   1. obstical_pipe2        "Obstacle pipe" / "Squeeze-through"  (enter from
//                             the south: the op errors if coordz >= 3939)
//   2. obstical_ropeswing2   "Ropeswing"     / "Swing-on"         (one word)
//   3. wilderness_stepping_stone "Stepping stone" / "Jump-from"   (can fail ->
//                             lava damage: the main food sink)
//   4. wilderness_log_balance1  "Log balance" / "Walk-across"     (can fail ->
//                             spike damage)
//   5. wilderness_rocks      "Rocks"         / "Climb"            (varp==5 ->
//                             +4989 agility lap bonus, drops you back south
//                             near the pipe so the lap loops without the ridge)
//
// Entry ridge (NOT part of the repeating lap): loc_2309, display name "Door",
// op1 "Open" (rs2 requires Agility 52, forcemoves you ~13 tiles north over the
// ridge into the course, awards 150 agility). "Door" is a very generic loc
// name, so the ridge match is a best-effort nearest-Door-near-the-entrance
// (tunable via the ridgeName/ridgeOp settings); flagged for live verification.
const DEFAULT_OBSTACLES = 'Obstacle pipe,Ropeswing,Stepping stone,Log balance,Rocks';
const DEFAULT_CENTRE = new Tile(2998, 3945, 0);
const DEFAULT_ENTRANCE = new Tile(2998, 3924, 0);
const EDGEVILLE = new Tile(3094, 3493, 0); // BankLocations 'Edgeville', the nearest bank
const RIDGE_MIN_AGILITY = 52; // loc_2309 refuses below this; the whole course is gated on it

/** Tunable parameters (panel + `?WildyAgility.<key>=...`). */
export const WILDY_AGILITY_SETTINGS: SettingsSchema = {
    food: {
        type: 'string',
        default: 'Lobster',
        label: 'Food (name contains)',
        help: 'carried food eaten while running; also the ONLY thing re-withdrawn after a death, so a wilderness death costs nothing else'
    },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%', help: 'keep eating until HP reaches this % — 90 avoids the overheal wasted by eating to full' },
    foodWithdraw: { type: 'number', default: 20, min: 1, max: 28, label: 'Food to withdraw after death' },
    obstacles: {
        type: 'string',
        default: DEFAULT_OBSTACLES,
        label: 'Obstacles (lap order)',
        help: 'comma-separated obstacle loc names in lap order; each step uses the nearest matching loc and advances when agility xp is awarded'
    },
    courseCentre: { type: 'tile', default: DEFAULT_CENTRE, label: 'Course centre (x,z)' },
    courseRadius: { type: 'number', default: 25, min: 8, max: 64, label: 'Course region radius (tiles)', help: 'RunLap runs while within this many tiles of the centre' },
    courseEntrance: { type: 'tile', default: DEFAULT_ENTRANCE, label: 'Course entrance (x,z)', help: 'a tile just SOUTH of the ridge; death recovery returns here and EnterCourse crosses the ridge from here' },
    entryRadius: { type: 'number', default: 10, min: 3, max: 20, label: 'Entrance radius (tiles)', help: 'EnterCourse fires within this many tiles of the entrance (must be < the ~13-tile ridge hop so it stops firing once across)' },
    searchRadius: { type: 'number', default: 20, min: 4, max: 64, label: 'Obstacle search radius (tiles)' },
    ridgeName: { type: 'string', default: 'Door', label: 'Ridge/entry loc name', help: 'loc_2309 — display name is a generic "Door"; matched nearest-to-the-entrance so tune if it locks onto the wrong door' },
    ridgeOp: { type: 'string', default: 'Open', label: 'Ridge/entry op' },
    bankTile: { type: 'tile', default: EDGEVILLE, label: 'Bank tile (x,z)', help: 'nearest bank for the food-only restock (default Edgeville)' },
    menuSelect: {
        type: 'boolean',
        default: true,
        label: 'Right-click + menu select',
        help: 'interact via the right-click menu — steadier on thin course models (the ropeswing and log balance)'
    }
};

// Active run config — module state is safe because exactly one script runs at
// a time (ADR-0006), same pattern as ArdyFighter.
let FOOD = 'lobster';
let EAT_AT = 0.5;
let EAT_TO = 0.9;
let FOOD_WITHDRAW = 20;
let COURSE_CENTRE: WorldTile = DEFAULT_CENTRE;
let COURSE_RADIUS = 25;
let COURSE_ENTRANCE: WorldTile = DEFAULT_ENTRANCE;
let ENTRY_RADIUS = 10;
let SEARCH_RADIUS = 20;
let RIDGE_NAME = 'Door';
let RIDGE_OP = 'Open';
let BANK_TILE: WorldTile = EDGEVILLE;
let VIA_MENU = true;

/** Split an obstacle CSV into trimmed, lowercased, non-empty step names. */
export function parseObstacles(csv: string): string[] {
    return csv
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

/** True when `here` is within Chebyshev `radius` of `centre` on the same level. */
export function inRegion(here: WorldTile, centre: WorldTile, radius: number): boolean {
    return here.level === centre.level && Math.max(Math.abs(here.x - centre.x), Math.abs(here.z - centre.z)) <= radius;
}

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}

/** Carried food slots (contains-match on the food name; food is non-stacking). */
function foodCount(): number {
    return Inventory.items().filter(i => i.name?.toLowerCase().includes(FOOD)).length;
}

/**
 * Runs the Wilderness Agility Course: an agility-xp-gated 5-obstacle lap
 * (pipe -> ropeswing -> stepping stone -> log balance -> rocks), eating carried
 * food while it runs. On DEATH it world-walks to Edgeville, deposits the WHOLE
 * pack, re-withdraws ONLY food, walks back to the entrance and re-crosses the
 * ridge — so a wilderness death can never cost anything but the food.
 *
 * Start it standing at the course entrance (just south of the ridge) or already
 * inside past the ridge. Needs Agility 52 (the ridge minimum) or it refuses to
 * run rather than spin on a door it can't cross.
 */
export default class WildyAgility extends TaskBot {
    override loopDelay = 600;

    private course: string[] = [];
    private step = 0;
    private laps = 0;
    private cleared = 0;
    private eats = 0;
    private deaths = 0;
    private status = 'starting';
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        FOOD = this.settings.str('food', 'Lobster').toLowerCase();
        EAT_AT = this.settings.num('eatAtHp', 50) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        COURSE_CENTRE = this.settings.tile('courseCentre', DEFAULT_CENTRE);
        COURSE_RADIUS = this.settings.num('courseRadius', 25);
        COURSE_ENTRANCE = this.settings.tile('courseEntrance', DEFAULT_ENTRANCE);
        ENTRY_RADIUS = this.settings.num('entryRadius', 10);
        SEARCH_RADIUS = this.settings.num('searchRadius', 20);
        RIDGE_NAME = this.settings.str('ridgeName', 'Door');
        RIDGE_OP = this.settings.str('ridgeOp', 'Open');
        BANK_TILE = this.settings.tile('bankTile', EDGEVILLE);
        VIA_MENU = this.settings.bool('menuSelect', true);
        this.course = parseObstacles(this.settings.str('obstacles', DEFAULT_OBSTACLES));

        // The ridge (loc_2309) refuses below Agility 52, and the op is a no-op
        // that never moves you or awards xp — EnterCourse would spin forever.
        // Refuse to run rather than wedge, same shape as ArdyFighter's stat gate.
        const agility = Skills.level('agility');
        if (agility < RIDGE_MIN_AGILITY) {
            this.log(`WildyAgility needs Agility ${RIDGE_MIN_AGILITY} to cross the ridge (have ${agility}) — stopping.`);
            throw new Error(`WildyAgility: Agility ${RIDGE_MIN_AGILITY} required`);
        }

        this.log(`WildyAgility starting — lap [${this.course.join(' -> ')}], food '${FOOD}', bank ${BANK_TILE.x},${BANK_TILE.z}, entrance ${COURSE_ENTRANCE.x},${COURSE_ENTRANCE.z}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: COURSE_ENTRANCE,
                radius: 6,
                // No `needs`: DeathRecovery routes needs through AcquireTask,
                // which has no 'bank' ItemSource and would run BEFORE (instead
                // of) walkBack. The food-only restock lives entirely in walkBack.
                onDeath: () => {
                    this.deaths++;
                    this.setStatus('died — recovering');
                    this.log('died in the wilderness — banking (food-only) then returning');
                },
                onRecovered: () => {
                    this.died = false;
                    this.setStatus('recovered — re-entering the course');
                },
                walkBack: () => this.recoverAndReturn()
            }),
            new EatFood(this),
            new EnterCourse(this),
            new RunLap(this)
        );
    }

    override recoveryAnchor(): Tile {
        return Tile.from(COURSE_ENTRANCE);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [
            `WildyAgility — ${this.status}`,
            `laps ${this.laps}  obstacles ${this.cleared}  ate ${this.eats}${this.deaths ? `  deaths ${this.deaths}` : ''}`,
            `food ${foodCount()}  hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#e0a15b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    /**
     * DeathRecovery.walkBack: after respawn, restock food-only at the bank (if
     * we're short) then return to the course entrance. Guarded on `foodCount()`
     * so a retry (e.g. the return leg timed out) skips straight back to walking
     * rather than re-banking. Returns true once we're back at the entrance.
     */
    private async recoverAndReturn(): Promise<boolean> {
        if (foodCount() < FOOD_WITHDRAW) {
            this.setStatus('recovering: walking to the bank');
            await Traversal.walkResilient(BANK_TILE, { radius: 4, attempts: 4, timeoutMs: 120_000, log: m => this.log(`  ${m}`) });

            if (await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`))) {
                // Food-only guarantee: empty the WHOLE pack, THEN take only food.
                await Bank.depositInventory();
                await Execution.delayTicks(1);
                await this.withdrawFood();
                this.log(`restocked ${foodCount()} '${FOOD}'`);
            } else {
                this.log('could not open the bank — will retry next loop');
                return false;
            }
        }

        this.setStatus('recovering: returning to the course entrance');
        return Traversal.walkResilient(COURSE_ENTRANCE, { radius: 3, attempts: 6, timeoutMs: 120_000, log: m => this.log(`  ${m}`) });
    }

    /** Withdraw food (by its exact bank name) up to foodWithdraw, or until the bank runs out. */
    private async withdrawFood(): Promise<void> {
        for (let i = 0; i < FOOD_WITHDRAW * 2 && foodCount() < FOOD_WITHDRAW; i++) {
            const banked = Bank.items().find(it => it.name?.toLowerCase().includes(FOOD));
            if (!banked?.name) {
                this.log(`no '${FOOD}' left in the bank`);
                return;
            }
            const before = foodCount();
            if (!(await Bank.withdraw(banked.name, 'Withdraw-1'))) {
                return;
            }
            if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                return; // withdraw stalled / bank emptied mid-loop
            }
        }
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countEat(): void {
        this.eats++;
    }
    countCleared(): void {
        this.cleared++;
    }
    searchRadius(): number {
        return SEARCH_RADIUS;
    }
    menuSelect(): boolean {
        return VIA_MENU;
    }
    currentName(): string {
        return this.course[this.step];
    }
    courseNames(): string[] {
        return this.course;
    }
    /** Advance to the next obstacle, counting laps on wrap (rocks -> pipe). */
    advance(): void {
        this.step++;
        if (this.step >= this.course.length) {
            this.step = 0;
            this.laps++;
            this.log(`lap ${this.laps} complete`);
        }
    }
    /** Re-point the lap at the first step whose loc is in range (desync recovery). */
    resyncTo(name: string): boolean {
        const idx = this.course.indexOf(name);
        if (idx === -1) {
            return false;
        }
        this.log(`lap re-sync: step ${this.step} (${this.currentName()}) -> ${idx} (${name})`);
        this.step = idx;
        return true;
    }
}

class ContinueDialog implements Task {
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

/**
 * Eat carried food up to the eat-to target once HP drops below the gate (not
 * just one bite) — ranks above EnterCourse/RunLap so it fires mid-lap too (the
 * stepping stone and log balance both deal damage on a failed roll). Copied
 * from ArdyFighter's EatFood, simplified to a single contains-matched food.
 */
class EatFood implements Task {
    constructor(private bot: WildyAgility) {}

    validate(): boolean {
        return hpFraction() < EAT_AT && foodCount() > 0;
    }

    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return; // yield to death / dialog / runtime-event handling
            }
            if (hpFraction() >= EAT_TO || foodCount() === 0) {
                return;
            }
            const food = Inventory.items().find(i => i.name?.toLowerCase().includes(FOOD));
            if (!food) {
                return;
            }
            this.bot.setStatus(`eating ${food.name} (${Math.round(hpFraction() * 100)}% hp)`);
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

/**
 * Cross the ridge (loc_2309, "Door"/"Open") to get INTO the course from the
 * south — handles the first start and every post-death return. Fires only near
 * the entrance (south of the ridge); the ~13-tile ridge hop then carries us
 * clear of the entrance radius, so this stops firing once we are across and
 * RunLap takes over. Best-effort ridge match: "Door" is a generic name, so we
 * take the nearest one within the search radius after lining up on the entrance.
 */
class EnterCourse implements Task {
    constructor(private bot: WildyAgility) {}

    private findRidge(): Loc | null {
        return Locs.query()
            .name(RIDGE_NAME)
            .action(RIDGE_OP)
            .where(l => l.distance() <= SEARCH_RADIUS)
            .nearest();
    }

    validate(): boolean {
        const here = Game.tile();
        return here !== null && inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS);
    }

    async execute(): Promise<void> {
        // Line up on the entrance tile so the ridge op fires from the right side.
        const here = Game.tile();
        if (here && COURSE_ENTRANCE.level === here.level && Math.max(Math.abs(here.x - COURSE_ENTRANCE.x), Math.abs(here.z - COURSE_ENTRANCE.z)) > 2) {
            this.bot.setStatus('walking to the course entrance');
            await Traversal.walkResilient(COURSE_ENTRANCE, { radius: 1, attempts: 4, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
        }

        const ridge = this.findRidge();
        if (!ridge) {
            this.bot.setStatus(`waiting: no '${RIDGE_NAME}' (ridge) within ${SEARCH_RADIUS} tiles`);
            await Execution.delayTicks(2);
            return;
        }

        this.bot.setStatus(`crossing the ridge (${RIDGE_OP} ${ridge.name})`);
        const before = Skills.xp('agility');
        const clicked = await ridge.interact(RIDGE_OP, this.bot.menuSelect());
        if (!clicked) {
            await Execution.delayTicks(2);
            return;
        }

        // The ridge forcemoves us ~13 tiles north into the course and awards
        // agility on success; wait for that xp OR for us to land in the region.
        await Execution.delayUntil(() => {
            const t = Game.tile();
            return Skills.xp('agility') > before || (!!t && inRegion(t, COURSE_CENTRE, COURSE_RADIUS) && !inRegion(t, COURSE_ENTRANCE, ENTRY_RADIUS)) || EventSignal.pending();
        }, 15_000);
    }
}

/**
 * The agility-xp-gated lap (adapted from AgilityBot.DoObstacle): for each step,
 * use the nearest in-range loc matching that step's name, wait for the agility
 * xp every wilderness obstacle grants on traversal, then advance (wrapping laps
 * on the Rocks climb). Ordered stepping + xp gating survives the directional,
 * same-named-loc hazards the Gnome course also has.
 */
class RunLap implements Task {
    // consecutive xp-less attempts at the current step; obstacles are side-gated
    // (e.g. the pipe rejects the wrong side with no xp), so repeated failure
    // means we are past this step — skip rather than wedge the lap.
    private stuck = 0;

    constructor(private bot: WildyAgility) {}

    private find(name: string): Loc | null {
        const within = this.bot.searchRadius();
        return Locs.query()
            .where(l => l.name?.toLowerCase() === name && l.distance() <= within && l.actions().length > 0)
            .nearest();
    }

    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.courseNames().length > 0 && inRegion(here, COURSE_CENTRE, COURSE_RADIUS);
    }

    async execute(): Promise<void> {
        let obstacle = this.find(this.bot.currentName());
        if (!obstacle) {
            for (const name of new Set(this.bot.courseNames())) {
                if (this.find(name) && this.bot.resyncTo(name)) {
                    obstacle = this.find(name);
                    break;
                }
            }
        }
        if (!obstacle) {
            this.bot.setStatus(`waiting: no ${this.bot.currentName()} within ${this.bot.searchRadius()} tiles`);
            await Execution.delayTicks(2);
            return;
        }

        const op = obstacle.actions()[0];
        if (!op) {
            return;
        }

        const before = Skills.xp('agility');
        this.bot.setStatus(`${op} ${obstacle.name} at ${obstacle.tile()}`);
        const clicked = await obstacle.interact(op, this.bot.menuSelect());

        // Every wilderness obstacle awards agility xp when its traversal script
        // finishes — that's the completion signal. Generous timeout: the pipe is
        // two exact-moves and a telejump.
        const cleared = clicked && (await Execution.delayUntil(() => Skills.xp('agility') > before || EventSignal.pending(), 15_000));
        if (!clicked) {
            await Execution.delayTicks(2);
        }

        if (EventSignal.pending()) {
            this.bot.setStatus('random event — handling');
            return;
        }

        // Let any trailing force-move settle before clicking the next obstacle.
        let last = Game.tile();
        for (let settle = 0; settle < 25; settle++) {
            await Execution.delayTicks(1);
            if (ChatDialog.canContinue()) {
                break; // level-up dialog — ContinueDialog clears it next loop
            }
            const now = Game.tile();
            if (now && last && now.x === last.x && now.z === last.z && !Game.animating()) {
                break;
            }
            last = now;
        }

        if (cleared) {
            this.stuck = 0;
            this.bot.countCleared();
            this.bot.advance();
        } else if (++this.stuck >= 4) {
            this.bot.log(`step '${this.bot.currentName()}' gave no xp after ${this.stuck} attempts — skipping`);
            this.stuck = 0;
            this.bot.advance();
        }
    }
}
