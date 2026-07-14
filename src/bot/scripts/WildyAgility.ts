import type { WorldTile } from '../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { EventSignal } from '../api/EventSignal.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { drawStatusBox } from '../api/hud/Overlay.js';
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
const PIT_Z_GAP = 2000; // the wolf pit (ropeswing/log-balance fail) sits ~6400 tiles north in world-z; anything this far above the course centre is the pit (mime/maze are only ~600-800 away)
const LAP_RETRY_LIMIT = 4; // retry a failing obstacle this many times (falls happen), then move on to the next so a spot it can't be finished from never wedges the lap

/** Tunable parameters (panel + `?WildyAgility.<key>=...`). */
export const WILDY_AGILITY_SETTINGS: SettingsSchema = {
    food: {
        type: 'string',
        default: 'Lobster',
        label: 'Food (name contains)',
        help: 'carried food eaten while running; also the ONLY thing re-withdrawn after a death, so a wilderness death costs nothing else'
    },
    eatAtHp: { type: 'number', default: 50, min: 1, max: 100, label: 'Eat below HP%' },
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
    pitLadderName: { type: 'string', default: '', label: 'Pit ladder loc name', help: 'failing the ropeswing/log balance drops you in the pit below; blank = climb the nearest loc with a Climb/ladder op, or name it (e.g. Ladder)' },
    pitLadderOp: { type: 'string', default: 'Climb-up', label: 'Pit ladder op' },
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
let PIT_LADDER_NAME = '';
let PIT_LADDER_OP = 'Climb-up';
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

/**
 * True when `here` is outside BOTH the course region and the entrance region —
 * i.e. not at the course at all, so the bot must web-walk to it before it can
 * cross the ridge (EnterCourse) or run the lap (RunLap).
 */
export function awayFromCourse(here: WorldTile, centre: WorldTile, courseRadius: number, entrance: WorldTile, entryRadius: number): boolean {
    return !inRegion(here, centre, courseRadius) && !inRegion(here, entrance, entryRadius);
}

/**
 * True when `here` is inside the course PROPER — in the course region but past
 * the entrance region, i.e. north of the ridge running the lap (not still at the
 * ridge waiting to cross). Used to seed the "entered" latch at start and to
 * confirm a ridge crossing.
 */
export function insideCourseProper(here: WorldTile, centre: WorldTile, courseRadius: number, entrance: WorldTile, entryRadius: number): boolean {
    return inRegion(here, centre, courseRadius) && !inRegion(here, entrance, entryRadius);
}

/**
 * True when `here` is in the wolf pit — the isolated area (~6400 tiles north in
 * world-z, rendered "just below" the course) a ropeswing / log-balance FAIL
 * drops you into. Detected by the large z gap from the course rather than exact
 * pit coords: nothing else the bot visits is that far north (mime/maze stages
 * are only ~600-800 away), and the pit is escapable only by its ladder.
 */
export function inPit(here: WorldTile, courseCentre: WorldTile, zGap: number): boolean {
    return here.level === courseCentre.level && here.z - courseCentre.z > zGap;
}

/**
 * Classify an obstacle attempt from its aftermath. Success is the agility xp
 * every wilderness obstacle awards on completion; a FAILURE awards none but
 * always deals damage (lava/spikes/pit), so an HP drop with no xp is a fall to
 * retry (fast) rather than a stuck step. Neither = the click did nothing.
 */
export function classifyAttempt(xpGained: boolean, tookDamage: boolean): 'cleared' | 'failed' | 'noop' {
    if (xpGained) {
        return 'cleared';
    }
    return tookDamage ? 'failed' : 'noop';
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
 * ridge — so a wilderness death can never cost anything but the food. Failing
 * the ropeswing or log balance drops you into the pit below — PitEscape climbs
 * the ladder back up and the lap resumes at the right obstacle.
 *
 * Start it anywhere: if it isn't at the course it web-walks to the entrance
 * (TravelToCourse), crosses the ridge (EnterCourse), then runs the lap. Needs
 * Agility 52 (the ridge minimum) or it refuses to run rather than spin on a door
 * it can't cross. (Wilderness web-walk reach is the same live-only caveat as the
 * death return.)
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
    // Latched once we've crossed the ridge into the course, so the lap loops
    // rocks -> pipe without EnterCourse re-firing when we pass back through the
    // pipe's south approach (which overlaps the ridge entrance region). Reset on
    // death and whenever we've left the course area (TravelToCourse).
    private entered = false;

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
        PIT_LADDER_NAME = this.settings.str('pitLadderName', '');
        PIT_LADDER_OP = this.settings.str('pitLadderOp', 'Climb-up');
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

        // Already inside the course (past the ridge)? Latch "entered" so we start
        // lapping instead of trying to re-cross. Otherwise EnterCourse/TravelToCourse get us in.
        const here = Game.tile()!;
        this.entered = insideCourseProper(here, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS);

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
                    this.entered = false; // respawned outside — must re-cross the ridge after recovery
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
            new PitEscape(this),
            new TravelToCourse(this),
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
        drawStatusBox(ctx, lines, '#e0a15b');
    }

    /**
     * DeathRecovery.walkBack: after respawn, ALWAYS restock food-only at the
     * bank, then return to the course entrance. Every death walks to the bank,
     * deposits the WHOLE pack and withdraws ONLY food — so the pack is
     * guaranteed food-only when re-entering the wilderness, unconditionally
     * (never contingent on the post-death food count). Returns true once we're
     * back at the entrance.
     */
    private async recoverAndReturn(): Promise<boolean> {
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
    isEntered(): boolean {
        return this.entered;
    }
    /** Latched by EnterCourse once we've crossed the ridge into the course. */
    markEntered(): void {
        this.entered = true;
    }
    /** Cleared when we've left the course area (TravelToCourse) or died. */
    markLeft(): void {
        this.entered = false;
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

/**
 * Eat carried food up to the eat-to target once HP drops below the gate (not
 * just one bite) — ranks above EnterCourse/RunLap so it fires mid-lap too (the
 * stepping stone and log balance both deal damage on a failed roll). Copied
 * from ArdyFighter's EatFood, simplified to a single contains-matched food.
 */
class EatFood implements Task {
    constructor(private bot: WildyAgility) {}

    validate(): boolean {
        return Skills.hpFraction() < EAT_AT && foodCount() > 0;
    }

    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return; // yield to death / dialog / runtime-event handling
            }
            if (Skills.hpFraction() >= EAT_TO || foodCount() === 0) {
                return;
            }
            const food = Inventory.items().find(i => i.name?.toLowerCase().includes(FOOD));
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

/**
 * Climb out of the wolf pit. Failing the ropeswing or log balance drops you into
 * an isolated pit (far north in world-z, rendered "just below" the course); a
 * ladder there climbs you back up. Ranks above TravelToCourse because the pit is
 * isolated — you leave ONLY by the ladder, never by web-walking. After climbing
 * out the lap's own resync picks up the right obstacle (e.g. after a log-balance
 * fall you resume at the log, skipping the stepping stones).
 */
class PitEscape implements Task {
    constructor(private bot: WildyAgility) {}

    private findLadder(): Loc | null {
        if (PIT_LADDER_NAME) {
            return Locs.query().name(PIT_LADDER_NAME).action(PIT_LADDER_OP).nearest();
        }
        // best-effort: the nearest loc offering a climb/ladder op
        return Locs.query()
            .where(l => l.actions().some(a => /climb|ladder/i.test(a)))
            .nearest();
    }

    validate(): boolean {
        const here = Game.tile();
        return here !== null && inPit(here, COURSE_CENTRE, PIT_Z_GAP);
    }

    async execute(): Promise<void> {
        const ladder = this.findLadder();
        if (!ladder) {
            const near = Locs.query().where(l => l.actions().length > 0).nearest();
            this.bot.setStatus('in the pit — no ladder found');
            this.bot.log(`fell into the pit but found no climb/ladder loc — nearest interactable: ${near ? `${near.name} [${near.actions().join(', ')}]` : 'none'} (set pitLadderName/pitLadderOp)`);
            await Execution.delayTicks(3);
            return;
        }

        const op = ladder.actions().find(a => /climb|ladder/i.test(a)) ?? PIT_LADDER_OP;

        // run to the ladder if we fell in away from it, then climb
        const here = Game.tile();
        const lt = ladder.tile();
        if (here && lt.level === here.level && Math.max(Math.abs(here.x - lt.x), Math.abs(here.z - lt.z)) > 2) {
            this.bot.setStatus('in the pit — heading to the ladder');
            await Traversal.walkResilient(lt, { radius: 1, attempts: 3, timeoutMs: 30_000, log: m => this.bot.log(`  ${m}`) });
        }

        this.bot.setStatus(`climbing out of the pit (${op} ${ladder.name})`);
        this.bot.log(`fell into the pit — ${op} ${ladder.name} back up to the course`);
        if (!(await ladder.interact(op, this.bot.menuSelect()))) {
            await Execution.delayTicks(2);
            return;
        }
        await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && !inPit(t, COURSE_CENTRE, PIT_Z_GAP);
        }, 10_000);
    }
}

/**
 * Web-walk to the course when started (or stranded) away from it — i.e. outside
 * both the course region and the entrance region. Walks to the entrance (south
 * of the ridge); EnterCourse then crosses the ridge and RunLap takes over. Ranks
 * below EatFood (heal first) but above EnterCourse/RunLap. Same wilderness
 * web-walk reach caveat as the death return.
 */
class TravelToCourse implements Task {
    constructor(private bot: WildyAgility) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && awayFromCourse(here, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS);
    }

    async execute(): Promise<void> {
        this.bot.markLeft(); // away from the course — must re-cross the ridge to get back in
        this.bot.setStatus('walking to the wilderness agility course');
        await Traversal.walkResilient(COURSE_ENTRANCE, { radius: 2, attempts: 6, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
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
        return here !== null && !this.bot.isEntered() && inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS);
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
            return Skills.xp('agility') > before || (!!t && insideCourseProper(t, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS)) || EventSignal.pending();
        }, 15_000);

        // Latch "entered" once we're across (the ridge awarded agility, or we
        // landed north of the entrance) so the lap loops without re-crossing.
        const after = Game.tile();
        if (Skills.xp('agility') > before || (after !== null && insideCourseProper(after, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS))) {
            this.bot.markEntered();
        }
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
    // consecutive non-clearing attempts at the current step (a fall, or a click
    // with no xp). A few are normal — you retry the obstacle. Past
    // LAP_RETRY_LIMIT we can't complete it from where we are (e.g. up the ladder
    // you land in the pocket between the log and the rocks, where the only way on
    // is the rocks), so we advance to the next obstacle.
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
        // Run the lap once we've crossed the ridge (entered), anywhere in the
        // course area (course region OR the entrance/pipe approach). When truly
        // away (a fail pit, or started far) TravelToCourse handles the walk back.
        return here !== null && this.bot.isEntered() && this.bot.courseNames().length > 0 && (inRegion(here, COURSE_CENTRE, COURSE_RADIUS) || inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS));
    }

    async execute(): Promise<void> {
        let obstacle = this.find(this.bot.currentName());
        if (!obstacle) {
            for (const name of new Set(this.bot.courseNames())) {
                if (this.find(name) && this.bot.resyncTo(name)) {
                    obstacle = this.find(name);
                    this.stuck = 0; // relocated to a fresh obstacle — start its retry count over
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
        const hpBefore = Skills.effective('hitpoints');
        this.bot.setStatus(`${op} ${obstacle.name} at ${obstacle.tile()}`);
        const clicked = await obstacle.interact(op, this.bot.menuSelect());

        // Resolve the attempt fast: success is the agility xp every obstacle
        // awards on completion; a FAILURE never awards xp but always deals damage
        // (lava/spikes/pit) — so break on an HP drop too, instead of burning the
        // full timeout on every fall. Also yield to events / level-up dialogs.
        if (clicked) {
            await Execution.delayUntil(() => Skills.xp('agility') > before || Skills.effective('hitpoints') < hpBefore || EventSignal.pending() || ChatDialog.canContinue(), 15_000);
        } else {
            await Execution.delayTicks(2);
        }

        if (EventSignal.pending()) {
            this.bot.setStatus('random event — handling');
            return;
        }

        const outcome = classifyAttempt(Skills.xp('agility') > before, Skills.effective('hitpoints') < hpBefore);

        // Let any trailing force-move / fall settle before the next click.
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

        if (outcome === 'cleared') {
            this.stuck = 0;
            this.bot.countCleared();
            this.bot.advance();
            return;
        }

        // Not cleared — retry the SAME obstacle (a fall you re-attempt after the
        // ladder, a stepping stone you redo in place). But if it keeps not
        // completing, we're on a spot it can't be finished from — most often the
        // pocket between the log and the rocks reached up the ladder, where the
        // only way on is the rocks — so after a few tries advance to the next
        // obstacle rather than wedge the lap forever.
        if (++this.stuck >= LAP_RETRY_LIMIT) {
            this.bot.log(`'${this.bot.currentName()}' isn't completing from here after ${this.stuck} tries — moving on to the next obstacle`);
            this.stuck = 0;
            this.bot.advance();
        } else {
            const why = outcome === 'failed' ? 'took damage' : 'no progress';
            this.bot.setStatus(`retrying ${obstacle.name}`);
            this.bot.log(`'${this.bot.currentName()}' ${why} — retrying (${this.stuck}/${LAP_RETRY_LIMIT})`);
        }
    }
}
