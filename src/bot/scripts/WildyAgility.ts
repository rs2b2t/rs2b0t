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
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { Skills } from '../api/hud/Skills.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { actions, reader } from '../adapter/ClientAdapter.js';

const DEFAULT_CENTRE = new Tile(2998, 3945, 0);
const DEFAULT_ENTRANCE = new Tile(2998, 3924, 0);
const EDGEVILLE = new Tile(3094, 3493, 0);
const RIDGE_MIN_AGILITY = 52;
const PIT_Z_GAP = 2000;
// Lowered this because the default wait is now 24 ticks, since obstacle clears can take up to 20 ticks.
const LAP_RETRY_LIMIT = 2;

// Hardcoded course configuration — known good values for the wilderness agility course
const COURSE_OBSTACLES = ['obstacle pipe', 'ropeswing', 'stepping stone', 'log balance', 'rocks'];
const COURSE_CENTRE: WorldTile = DEFAULT_CENTRE;
const COURSE_RADIUS = 25;
const COURSE_ENTRANCE: WorldTile = DEFAULT_ENTRANCE;
const ENTRY_RADIUS = 10;
const SEARCH_RADIUS = 20;
const RIDGE_NAME = 'Door';
const RIDGE_OP = 'Open';
const PIT_LADDER_NAME = '';
const PIT_LADDER_OP = 'Climb-up';
const BANK_TILE: WorldTile = EDGEVILLE;

// Starting side tiles for each obstacle — used when recovering from a failure
// so the bot approaches from the correct direction before re-attempting.
const OBSTACLE_START: Record<string, WorldTile> = {
    'obstacle pipe':    { x: 3004, z: 3937, level: 0 },
    'ropeswing':        { x: 3005, z: 3952, level: 0 },
    'stepping stone':   { x: 3002, z: 3960, level: 0 },
    'log balance':      { x: 3002, z: 3945, level: 0 },
    'rocks':            { x: 2994, z: 3937, level: 0 },
};

// Chat messages indicating the bot clicked the obstacle from the wrong side.
// These are NOT failures (no damage taken), but the attempt won't succeed until
// the player repositions to the correct starting side.
const WRONG_SIDE = /^(?:you cannot do that from here|you can't? enter the pipe from this side)/i;

// Chat messages that fire immediately when an obstacle is failed — before damage
// is taken or animations complete. Detecting these lets the task scheduler react
// faster (e.g., start pit escape while the fall animation is still playing).
// The stepping stone lava message is also matched here but does NOT result in a
// scene change — it just knocks the player back, so it's handled as a reposition.
const PIT_FALL = /(?:you slip and fall into the pit below|you lose your footing and fall into the lava|you slip and fall onto the spikes below)/i;

function getStartTile(obstacleName: string): WorldTile | null {
    return OBSTACLE_START[obstacleName.toLowerCase()] ?? null;
}

// a human sees the obstacle finish and clicks the next one a beat later, and that
// beat varies; occasionally attention drifts for longer.
// The delay must be long enough for the character to settle after clearing an
// obstacle before clicking the next one — too short and the first click gets
// "no progress" because the character is still animating/moving from the previous.
// One game tick is 600ms; we need at least 1 tick, typically 1-2 ticks.
function reactionMs(): number {
    return Math.random() < 0.1 ? 1200 + Math.random() * 1800 : 600 + Math.random() * 900;
}

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
    obstacleTimeoutTicks: { type: 'number', default: 24, min: 5, max: 60, label: 'Obstacle timeout (ticks)', help: 'max ticks to wait for XP or a known-delaying event before treating as timeout' },
};

let FOOD = 'lobster';
let EAT_AT = 0.5;
let EAT_TO = 0.9;
let FOOD_WITHDRAW = 20;
let OBSTACLE_TIMEOUT_TICKS = 24;

export function parseObstacles(csv: string): string[] {
    return csv
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

export function inRegion(here: WorldTile, centre: WorldTile, radius: number): boolean {
    return here.level === centre.level && Math.max(Math.abs(here.x - centre.x), Math.abs(here.z - centre.z)) <= radius;
}

export function awayFromCourse(here: WorldTile, centre: WorldTile, courseRadius: number, entrance: WorldTile, entryRadius: number): boolean {
    return !inRegion(here, centre, courseRadius) && !inRegion(here, entrance, entryRadius);
}

export function insideCourseProper(here: WorldTile, centre: WorldTile, courseRadius: number, entrance: WorldTile, entryRadius: number): boolean {
    return inRegion(here, centre, courseRadius) && !inRegion(here, entrance, entryRadius);
}

export function inPit(here: WorldTile, courseCentre: WorldTile, zGap: number): boolean {
    return here.level === courseCentre.level && here.z - courseCentre.z > zGap;
}

/** Ensure Auto Retaliate is turned off (prevents fighting back while doing agility). */
async function ensureRetaliateOff(log: (m: string) => void): Promise<void> {
    const controls = reader.retaliateControls();
    if (!controls) {
        log('retaliateControls not available — cannot toggle auto retaliate');
        return;
    }

    const result = actions.ifButton(controls.offComId);
    log(`Auto Retaliate turned off (comId: ${controls.offComId}, result: ${result})`);
}

function foodCount(): number {
    return Inventory.items().filter(i => i.name?.toLowerCase().includes(FOOD)).length;
}

export default class WildyAgility extends TaskBot {
    override loopDelay = 600;

    private course: string[] = [];
    private step = 0;
    private laps = 0;
    private cleared = 0;
    private eats = 0;
    private deaths = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;
    private entered = false;
    justEscapedPit = false;
    // Timing: server ticks since last obstacle clear, and per-obstacle elapsed ticks
    lastClearedTick = 0;
    obstacleTimes: number[] = [];

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        FOOD = this.settings.str('food', 'Lobster').toLowerCase();
        EAT_AT = this.settings.num('eatAtHp', 50) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        OBSTACLE_TIMEOUT_TICKS = this.settings.num('obstacleTimeoutTicks', 18);
        this.course = COURSE_OBSTACLES;

        const agility = Skills.level('agility');
        if (agility < RIDGE_MIN_AGILITY) {
            this.log(`WildyAgility needs Agility ${RIDGE_MIN_AGILITY} to cross the ridge (have ${agility}) — stopping.`);
            throw new Error(`WildyAgility: Agility ${RIDGE_MIN_AGILITY} required`);
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        this.lastClearedTick = Game.tick();

        this.log(`WildyAgility starting — lap [${this.course.join(' -> ')}], food '${FOOD}', bank ${BANK_TILE.x},${BANK_TILE.z}, entrance ${COURSE_ENTRANCE.x},${COURSE_ENTRANCE.z}, timeout ${OBSTACLE_TIMEOUT_TICKS} ticks`);

        const here = Game.tile()!;
        this.entered = insideCourseProper(here, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.lastClearedTick = Game.tick();

        // Ensure Auto Retaliate is off so we don't fight back while doing agility.
        // Skeletons near the rocks obstacle will hit us, and we don't want to waste
        // time attacking them back.
        await ensureRetaliateOff(m => this.log(m));

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: COURSE_ENTRANCE,
                radius: 6,
                onDeath: () => {
                    this.deaths++;
                    this.entered = false;
                    this.justEscapedPit = false;
                    this.lastClearedTick = Game.tick();
                    this.setStatus('died — recovering');
                    this.log('died in the wilderness — escaping pit if needed, then banking (food-only) and returning');
                    // After death, ensure Auto Retaliate is off again.
                    ensureRetaliateOff(m => this.log(m));
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e0a15b' });
        p.title(`WildyAgility — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const tab = p.tabs('wa', ['Overview', 'Survival']);
        if (tab === 'Overview') {
            const xph = mins > 0.5 ? `${(((Skills.xp('agility') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Laps: ${this.laps}`, `XP/hr: ${xph}`);
            p.row(`Obstacles: ${this.cleared}`, `Step: ${this.currentName() ?? '—'}`);
            if (this.obstacleTimes.length > 0) {
                const avg = this.obstacleTimes.reduce((a, b) => a + b, 0) / this.obstacleTimes.length;
                p.row(`Avg obstacle: ${avg.toFixed(1)} ticks`);
            }
        } else {
            p.row(`Food: ${foodCount()}`, `Ate: ${this.eats}`, `Deaths: ${this.deaths}`);
            p.bar('HP', Skills.hpFraction());
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private async recoverAndReturn(): Promise<boolean> {
        this.setStatus('recovering: walking to the bank');
        await Traversal.walkResilient(BANK_TILE, { radius: 4, attempts: 4, timeoutMs: 120_000, log: m => this.log(`  ${m}`) });

        if (await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`))) {
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
                return;
            }
        }
    }

    setStatus(s: string): void {
        this.status = s;
    }
    isEntered(): boolean {
        return this.entered;
    }
    markEntered(): void {
        this.entered = true;
    }
    markLeft(): void {
        this.entered = false;
    }
    markEscapedPit(): void {
        this.justEscapedPit = true;
    }
    clearEscapedPit(): void {
        this.justEscapedPit = false;
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
    currentName(): string {
        return this.course[this.step];
    }
    courseNames(): string[] {
        return this.course;
    }
    advance(): void {
        this.step++;
        if (this.step >= this.course.length) {
            this.step = 0;
            this.laps++;
            this.log(`lap ${this.laps} complete`);
        }
    }
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

class EatFood implements Task {
    constructor(private bot: WildyAgility) {}

    validate(): boolean {
        return Skills.hpFraction() < EAT_AT && foodCount() > 0;
    }

    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return;
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
        // No delay needed here — the game enforces a 3-tick penalty between eating
        // actions, but movement and other tasks are not stalled by eating.
        // The reactionMs() delay in RunLap handles character settle time before
        // the next obstacle click.
    }
}

class PitEscape implements Task {
    constructor(private bot: WildyAgility) {}

    private findLadder(): Loc | null {
        if (PIT_LADDER_NAME) {
            return Locs.query().name(PIT_LADDER_NAME).action(PIT_LADDER_OP).nearest();
        }
        // Prefer ladders with "Climb-up" action to avoid "Climb-down" which keeps us
        // in the pit. Filter for climb-up first, fall back to any climb/ladder.
        let ladder = Locs.query()
            .where(l => l.actions().some(a => /climb[- ]up/i.test(a)))
            .nearest();
        if (!ladder) {
            ladder = Locs.query()
                .where(l => l.actions().some(a => /climb|ladder/i.test(a)))
                .nearest();
        }
        return ladder;
    }

    validate(): boolean {
        // Don't validate if the bot just died — death recovery will handle
        // repositioning, and continuing a pit escape from a dead state causes
        // the traversal to resume after recovery (from Lumbridge) trying to
        // reach the pit ladder which is unreachable.
        if (this.bot.died) {
            return false;
        }
        const here = Game.tile();
        return here !== null && inPit(here, COURSE_CENTRE, PIT_Z_GAP);
    }

    async execute(): Promise<void> {
        // Check died before and during traversal — if death occurs while we're
        // walking to the ladder, abort so death recovery can take over cleanly.
        if (this.bot.died) {
            return;
        }
        const ladder = this.findLadder();
        if (!ladder) {
            const near = Locs.query().where(l => l.actions().length > 0).nearest();
            this.bot.setStatus('in the pit — no ladder found');
            this.bot.log(`fell into the pit but found no climb/ladder loc — nearest interactable: ${near ? `${near.name} [${near.actions().join(', ')}]` : 'none'} (set pitLadderName/pitLadderOp)`);
            await Execution.delayTicks(3);
            return;
        }

        // Prefer "Climb-up" action to avoid "Climb-down" which keeps us in the pit
        const op = ladder.actions().find(a => /climb[- ]up/i.test(a))
            ?? ladder.actions().find(a => /climb|ladder/i.test(a))
            ?? PIT_LADDER_OP;

        const here = Game.tile();
        const lt = ladder.tile();
        if (here && lt.level === here.level && Math.max(Math.abs(here.x - lt.x), Math.abs(here.z - lt.z)) > 2) {
            this.bot.setStatus('in the pit — heading to the ladder');
            // The pit is a small enclosed area — the ladder is only a few tiles away.
            // Use simple walkTo instead of walkResilient to avoid the overhead of
            // scene loading, baked path switching, and unstick recovery which are
            // unnecessary for this short distance.
            await Traversal.walkTo(lt, { radius: 1 });
            // Death may have occurred during the walk — abort if so.
            if (this.bot.died) {
                return;
            }
        }

        this.bot.setStatus(`climbing out of the pit (${op} ${ladder.name})`);
        this.bot.log(`fell into the pit — ${op} ${ladder.name} back up to the course`);
        if (!(await ladder.interact(op))) {
            await Execution.delayTicks(2);
            return;
        }
        await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && !inPit(t, COURSE_CENTRE, PIT_Z_GAP);
        }, 10_000);
        this.bot.markEscapedPit();
    }
}

class TravelToCourse implements Task {
    constructor(private bot: WildyAgility) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && awayFromCourse(here, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS);
    }

    async execute(): Promise<void> {
        this.bot.markLeft();
        this.bot.setStatus('walking to the wilderness agility course');
        await Traversal.walkResilient(COURSE_ENTRANCE, { radius: 2, attempts: 6, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

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
        if (here === null) {
            return false;
        }
        // Once inside the course region, never validate — the bot should stay on
        // the course. The gate at the top of the ridge exits back to the entrance,
        // and clicking it from inside derails the entire script. If the player dies
        // or the operator moves them, DeathRecovery / TravelToCourse will handle it.
        if (inRegion(here, COURSE_CENTRE, COURSE_RADIUS)) {
            return false;
        }
        // Only fire when near the entrance AND outside the course (south of the ridge).
        // The entrance region overlaps with the rocks obstacle (~2994,3932), so a player
        // standing on the rocks would otherwise trigger this task unnecessarily.
        // "Outside" means the player's Z is south of (<=) the entrance Z.
        if (!inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS)) {
            return false;
        }
        if (here.z <= COURSE_ENTRANCE.z) {
            return true;
        }
        // Player is north of the entrance (already on the course side) — don't trigger.
        return false;
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        if (here && COURSE_ENTRANCE.level === here.level && Math.max(Math.abs(here.x - COURSE_ENTRANCE.x), Math.abs(here.z - COURSE_ENTRANCE.z)) > 2) {
            this.bot.setStatus('walking to the course entrance');
            // Same scene as the course — simple walkTo is sufficient.
            await Traversal.walkTo(COURSE_ENTRANCE, { radius: 1 });
        }

        const ridge = this.findRidge();
        if (!ridge) {
            this.bot.setStatus(`waiting: no '${RIDGE_NAME}' (ridge) within ${SEARCH_RADIUS} tiles`);
            await Execution.delayTicks(2);
            return;
        }

        this.bot.setStatus(`crossing the ridge (${RIDGE_OP} ${ridge.name})`);
        const before = Skills.xp('agility');
        const clicked = await ridge.interact(RIDGE_OP);
        if (!clicked) {
            await Execution.delayTicks(2);
            return;
        }

        await Execution.delayUntil(() => {
            const t = Game.tile();
            return Skills.xp('agility') > before || (!!t && insideCourseProper(t, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS)) || EventSignal.pending();
        }, 15_000);

        const after = Game.tile();
        if (Skills.xp('agility') > before || (after !== null && insideCourseProper(after, COURSE_CENTRE, COURSE_RADIUS, COURSE_ENTRANCE, ENTRY_RADIUS))) {
            this.bot.markEntered();
            // The ridge crossing awards agility XP that arrives asynchronously and may
            // still be pending when RunLap captures its XP baseline on the next loop.
            // Update lastClearedTick now so RunLap doesn't attribute the ridge XP to
            // the first obstacle (false "cleared" on obstacle pipe).
            this.bot.lastClearedTick = Game.tick();
        }
    }
}

class RunLap implements Task {
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
        if (here === null || this.bot.courseNames().length === 0) {
            return false;
        }
        // Accept being on the course if either the entered flag is set OR the player
        // is physically within the course region (handles starting on the course
        // without crossing the ridge).
        const onCourse = this.bot.isEntered() || inRegion(here, COURSE_CENTRE, COURSE_RADIUS);
        return onCourse && (inRegion(here, COURSE_CENTRE, COURSE_RADIUS) || inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS));
    }

    async execute(): Promise<void> {
        let obstacle = this.find(this.bot.currentName());
        if (!obstacle) {
            // Search in course order (first → last) so we resync to the earliest
            // visible obstacle rather than the nearest one — after a death recovery
            // the bot is near the entrance where later obstacles (e.g. rocks) live,
            // and we want to start from the beginning of the lap.
            for (const name of this.bot.courseNames()) {
                if (this.find(name) && this.bot.resyncTo(name)) {
                    obstacle = this.find(name);
                    this.stuck = 0;
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

        const mark = GameMessages.mark();
        const startTick = Game.tick();
        this.bot.setStatus(`${op} ${obstacle.name} at ${obstacle.tile()}`);
        const gapTicks = startTick - this.bot.lastClearedTick;
        if (gapTicks > OBSTACLE_TIMEOUT_TICKS) {
            this.bot.log(`gap ${gapTicks} ticks since last obstacle`);
            // After a long gap (e.g., first obstacle after ridge crossing or pit escape),
            // wait a tick for any pending XP to settle before capturing the baseline.
            // Without this, ridge crossing XP can be attributed to the first obstacle.
            await Execution.delayTicks(1);
        }
        const before = Skills.xp('agility');

        // If we just escaped the pit, walk to the starting side before clicking.
        // The ladder exit is far from the obstacle that dropped us in, and clicking
        // immediately gets "wrong side" or "no progress" — walking first is faster.
        // Clear the flag immediately so it doesn't persist if the walk fails or we die.
        if (this.bot.justEscapedPit) {
            this.bot.clearEscapedPit();
            this.bot.log(`just escaped pit — walking to '${this.bot.currentName()}' starting side before clicking`);
            await this.walkToStartTile(obstacle.name?.toLowerCase() ?? this.bot.currentName());
        }

        const clicked = await obstacle.interact(op);
        if (!clicked) {
            await Execution.delayTicks(2);
            return;
        }

        // Wait for the obstacle outcome: agility XP (cleared) or a known-delaying event
        // (pit fall, wrong side, can't reach, event, dialog). Tick-based timeout avoids
        // the need to manually tune per-obstacle delays — if we haven't seen XP or a
        // known event after OBSTACLE_TIMEOUT_TICKS, the click was swallowed or the
        // obstacle is unreachable from this position.
        let ticksWaited = 0;
        let settled = false;
        while (ticksWaited < OBSTACLE_TIMEOUT_TICKS) {
            const t = Game.tile();
            if (Skills.xp('agility') > before) {
                settled = true;
                break;
            }
            if (t !== null && inPit(t, COURSE_CENTRE, PIT_Z_GAP)) {
                settled = true;
                break;
            }
            if (GameMessages.sawSince(mark, CANT_REACH)) {
                settled = true;
                break;
            }
            if (GameMessages.sawSince(mark, WRONG_SIDE)) {
                settled = true;
                break;
            }
            if (GameMessages.sawSince(mark, PIT_FALL)) {
                settled = true;
                break;
            }
            if (EventSignal.pending() || ChatDialog.canContinue()) {
                settled = true;
                break;
            }
            // Yield to higher-priority tasks if HP is low — lets EatFood run
            // while we're waiting (e.g., skeletons near rocks hitting us).
            if (Skills.hpFraction() < EAT_AT) {
                settled = true;
                break;
            }
            await Execution.delayTicks(1);
            ticksWaited++;
        }

        if (EventSignal.pending()) {
            this.bot.setStatus('random event — handling');
            return;
        }

        // If we fell into the pit during the attempt, yield to PitEscape task.
        // Only check position — the PIT_FALL chat message also fires for the
        // stepping stone (which does NOT enter the pit scene), so using the
        // message here would cause false pit escapes. The message is still used
        // in the wait loop above for early settlement, and below for steppingStoneFall.
        {
            const t = Game.tile();
            if (t !== null && inPit(t, COURSE_CENTRE, PIT_Z_GAP)) {
                this.bot.log(`fell into the pit during '${this.bot.currentName()}' — escaping`);
                this.bot.setStatus('in the pit — escaping');
                return;
            }
        }

        const xpGained = Skills.xp('agility') > before;
        const unreachable = !xpGained && GameMessages.sawSince(mark, CANT_REACH);
        const wrongSide = !xpGained && GameMessages.sawSince(mark, WRONG_SIDE);
        // Stepping stone fall fires a PIT_FALL message but doesn't change scenes
        // (no actual pit entry). Treat it like wrong side — walk back to starting side.
        const steppingStoneFall = !xpGained && GameMessages.sawSince(mark, PIT_FALL);

        if (!settled) {
            // Timeout elapsed with no XP and no known-delaying event — the click was
            // swallowed or the obstacle is unreachable from this position.
            this.bot.setStatus(`timeout waiting for ${obstacle.name} (${ticksWaited} ticks)`);
        }

        if (xpGained) {
            this.stuck = 0;
            this.bot.countCleared();
            const elapsed = Game.tick() - startTick;
            this.bot.log(`cleared '${this.bot.currentName()}' in ${elapsed} ticks`);
            this.bot.obstacleTimes.push(elapsed);
            // Keep last 20 obstacle times for stats
            if (this.bot.obstacleTimes.length > 20) {
                this.bot.obstacleTimes.shift();
            }
            this.bot.lastClearedTick = Game.tick();
            this.bot.advance();
            await Execution.delay(reactionMs());
            return;
        }

        // Wrong side — not a failure, just need to walk to the correct starting side
        if (wrongSide) {
            this.bot.log(`'${this.bot.currentName()}' wrong side error — walking to starting side`);
            await this.walkToStartTile(obstacle.name?.toLowerCase() ?? this.bot.currentName());
            return;
        }

        // Stepping stone fall — knocked back without entering the pit scene.
        // The fall already repositions the player, so just delay a tick and retry.
        if (steppingStoneFall) {
            this.bot.log(`'${this.bot.currentName()}' fell (no pit) — retrying`);
            await Execution.delayTicks(1);
            return;
        }

        // don't web-walk at the obstacle to fix this: its tile is deliberately unpathable
        // (you climb it), so pathing at it only burns the A* budget. Retrying is enough.
        if (unreachable) {
            this.bot.setStatus(`out of range for ${obstacle.name} — retrying`);
        }

        if (++this.stuck >= LAP_RETRY_LIMIT) {
            const skipped = this.bot.currentName();
            this.bot.log(`'${skipped}' isn't completing from here after ${this.stuck} tries — moving on to the next obstacle`);
            this.stuck = 0;
            this.bot.advance();
            // If advancing wrapped us to the next lap and the resync would immediately
            // find the same obstacle again, walk to the first obstacle's starting side
            // to break the cycle — this happens when an un-failable obstacle (e.g. rocks)
            // is clicked from the wrong position.
            const nextName = this.bot.currentName();
            if (nextName === skipped || nextName === this.bot.courseNames()[0]) {
                const firstStart = getStartTile(this.bot.courseNames()[0]);
                if (firstStart) {
                    this.bot.log(`obstacle skip wrapped lap — walking to '${this.bot.courseNames()[0]}' starting side`);
                    await this.walkToStartTile(this.bot.courseNames()[0]);
                }
            }
        } else if (this.stuck >= 2) {
            // After repeated "no progress" (likely wrong position, e.g. already past
            // the obstacle or standing on the wrong side), walk back to the starting
            // side before retrying.
            this.bot.log(`'${this.bot.currentName()}' no progress — walking back to starting side (${this.stuck}/${LAP_RETRY_LIMIT})`);
            const walked = await this.walkToStartTile(obstacle.name?.toLowerCase() ?? this.bot.currentName());
            if (!walked) {
                this.bot.log(`'${this.bot.currentName()}' starting side unreachable — advancing to next obstacle`);
                this.bot.advance();
            }
        } else {
            this.bot.setStatus(`retrying ${obstacle.name}`);
            this.bot.log(`'${this.bot.currentName()}' no progress — retrying (${this.stuck}/${LAP_RETRY_LIMIT})`);
            await Execution.delayTicks(2);
        }
    }

    private async walkToStartTile(obstacleName: string): Promise<boolean> {
        const start = getStartTile(obstacleName);
        if (!start) {
            this.bot.log(`no starting side for '${obstacleName}' — retrying in place`);
            this.bot.setStatus(`retrying ${obstacleName}`);
            await Execution.delayTicks(2);
            return false;
        }
        this.bot.setStatus(`walking to ${obstacleName} starting side (${start.x},${start.z})`);
        const here = Game.tile();
        // Only walk if we're more than 1 tile away from the start tile (tight threshold
        // so we reposition after pit escape or when standing past the obstacle)
        if (here && Math.max(Math.abs(here.x - start.x), Math.abs(here.z - start.z)) <= 1) {
            this.bot.log(`already near starting side for '${obstacleName}'`);
            await Execution.delayTicks(1);
            return true;
        }
        // Same scene as the course — simple walkTo is sufficient.
        const result = await Traversal.walkTo(start, { radius: 1 });
        if (!result) {
            this.bot.log(`could not reach starting side for '${obstacleName}' — path unreachable`);
            return false;
        }
        return true;
    }
}
