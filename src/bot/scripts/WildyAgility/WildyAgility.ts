import { foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Skills } from '../../api/skills/Skills.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { CANT_REACH, GameMessages } from '../../api/chatbox/gameMessages.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    COURSE_CENTRE,
    COURSE_OBSTACLES,
    EDGEVILLE_BANK,
    PIT_FALL,
    PIT_LADDER_OP,
    PIT_Z_GAP,
    RIDGE_APPROACH,
    RIDGE_FAIL,
    RIDGE_MIN_AGILITY,
    RIDGE_NAME,
    RIDGE_OP,
    RIDGE_SUCCESS,
    SEARCH_RADIUS,
    WRONG_SIDE,
    atRidgeApproach,
    awayFromCourse,
    classifyObstacle,
    classifyRidge,
    getStartTile,
    inPit,
    nearCourseEntry,
    nearTile,
    onCourse,
    reactionMs,
    southOfRidge,
    type RidgeOutcome
} from './WildyAgilityLogic.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

// Why: the default wait is 24 ticks and obstacle clears can take ~20.
const LAP_RETRY_LIMIT = 2;
const RIDGE_TIMEOUT_MS = 10_000;
const BANK_TILE: WorldTile = EDGEVILLE_BANK;

export const WILDY_AGILITY_SETTINGS: SettingsSchema = {
    loadout: LOADOUT_SETTING,

    foodWithdraw: {
        type: 'number',
        default: 20,
        min: 1,
        max: 28,
        label: 'Food to withdraw',
        help: 'how many to withdraw at startup restock and after death'
    },
    minFood: {
        type: 'number',
        default: 1,
        min: 0,
        max: 28,
        label: 'Bank below food count',
        help: 'at script start (and after death), bank if carrying fewer than this many; 0 = skip the startup food check'
    },
    obstacleTimeoutTicks: {
        type: 'number',
        default: 24,
        min: 5,
        max: 60,
        label: 'Obstacle timeout (ticks)',
        help: 'max ticks to wait for XP or a known-delaying event before treating as timeout'
    }
};

let FOOD = 'lobster';


let FOOD_WITHDRAW = 20;
let MIN_FOOD = 1;
let OBSTACLE_TIMEOUT_TICKS = 24;

/** Ensure Auto Retaliate is off so skeletons near rocks don't pull us into combat. */
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

function needEat(): boolean {
    const n = foodCount();
    if (n <= 0) {
        return false;
    }
    return shouldEatToUseFood({
        hp: Skills.effective('hitpoints'),
        maxHp: Skills.level('hitpoints'),
        heal: foodHealAmount(FOOD),
        foodCount: n
    });
}

function findRidge(): Loc | null {
    return Locs.query()
        .name(RIDGE_NAME)
        .action(RIDGE_OP)
        .where(l => l.distance() <= SEARCH_RADIUS)
        .nearest();
}

// Why: targeting a tile north of the door makes WalkExecutor Open the Door as a multi-tile transport, which steals the ridge attempt from the script.

/** Walks to the south stand of the ridge Door without pathfinding through it. */
async function walkToRidgeApproach(bot: WildyAgility, label: string, attempts = 4, timeoutMs = 60_000): Promise<void> {
    const here = Game.tile();
    if (here && atRidgeApproach(here)) {
        return;
    }
    bot.setStatus(`${label}walking to ridge approach (${RIDGE_APPROACH.x},${RIDGE_APPROACH.z})`);
    await Traversal.walkResilient(RIDGE_APPROACH, {
        radius: 1,
        attempts,
        timeoutMs,
        log: m => bot.log(`  ${m}`)
    });
}

// Why: the outcome is read from GameMessages (MESSAGE_GAME type-0 lines) plus XP.
// Why: success is "You skillfully balance across the ridge...".
// Why: failure is "You lose your footing and fall into the wolf pit." — the same scene, not the high-z obstacle pit that PitEscape handles.
// Why: only ridge.interact may cross the Door, so approach walks stay south of 3917.

/** Crosses the wilderness ridge into the course. */
async function attemptRidgeCrossing(bot: WildyAgility, label: string): Promise<RidgeOutcome> {
    await walkToRidgeApproach(bot, label);

    const ridge = findRidge();
    if (!ridge) {
        bot.setStatus(`${label}waiting: no '${RIDGE_NAME}' (ridge) within ${SEARCH_RADIUS} tiles`);
        await Execution.delayTicks(2);
        return 'timeout';
    }

    // Mark BEFORE the click so only messages produced by this attempt count.
    // Pathfinder must not have already Opened the Door on the way here.
    const mark = GameMessages.mark();
    const beforeXp = Skills.xp('agility');
    bot.setStatus(`${label}crossing the ridge (${RIDGE_OP} ${ridge.name} @ ${ridge.tile().x},${ridge.tile().z})`);

    if (!(await ridge.interact(RIDGE_OP))) {
        await Execution.delayTicks(2);
        return 'timeout';
    }

    // Wolf pit is same-scene: settle on chat / XP / interrupt only — never z-gap inPit.
    await Execution.delayUntil(() => {
        if (EventSignal.pending()) {
            return true;
        }
        if (Skills.xp('agility') > beforeXp) {
            return true;
        }
        if (GameMessages.sawSince(mark, RIDGE_SUCCESS)) {
            return true;
        }
        if (GameMessages.sawSince(mark, RIDGE_FAIL)) {
            return true;
        }
        return false;
    }, RIDGE_TIMEOUT_MS);

    const sawFail = GameMessages.sawSince(mark, RIDGE_FAIL);
    const sawSuccess = GameMessages.sawSince(mark, RIDGE_SUCCESS);
    const gainedXp = Skills.xp('agility') > beforeXp;
    const outcome = classifyRidge({
        xpGained: gainedXp,
        successMessage: sawSuccess,
        failMessage: sawFail,
        // Same-scene wolf pit: chat is the authoritative signal. Position alone
        // is ambiguous (still near the door after a fail or a cancelled click).
        inWolfPit: sawFail,
        interrupted: EventSignal.pending(),
        settled: true
    });

    if (outcome === 'success') {
        bot.markEntered();
        // Ridge XP can arrive slightly after the success line; stamp lastClearedTick
        // so RunLap does not attribute it to the first obstacle.
        bot.lastClearedTick = Game.tick();
        bot.log(`${label}ridge crossed`);
        return outcome;
    }

    if (outcome === 'interrupted') {
        bot.setStatus('random event — handling');
        return outcome;
    }

    // Fail / timeout: recover to the south stand and let the next loop retry immediately.
    // Do NOT walk north of the Door — that re-opens it via the pathfinder.
    bot.log(
        outcome === 'fail'
            ? `${label}fell into the wolf pit — walking back to ridge approach`
            : `${label}ridge crossing timed out — walking back to ridge approach`
    );
    await walkToRidgeApproach(bot, label, 3, 30_000);
    return outcome;
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
    lastClearedTick = 0;
    obstacleTimes: number[] = [];

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        FOOD = scriptFood(this.settings, 'Lobster').toLowerCase();

        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 20);
        MIN_FOOD = this.settings.num('minFood', 1);
        OBSTACLE_TIMEOUT_TICKS = this.settings.num('obstacleTimeoutTicks', 24);
        this.course = [...COURSE_OBSTACLES];

        const agility = Skills.level('agility');
        if (agility < RIDGE_MIN_AGILITY) {
            this.log(`WildyAgility needs Agility ${RIDGE_MIN_AGILITY} to cross the ridge (have ${agility}) — stopping.`);
            throw new Error(`WildyAgility: Agility ${RIDGE_MIN_AGILITY} required`);
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        this.lastClearedTick = Game.tick();

        const here = Game.tile()!;
        this.entered = onCourse(here);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        await ensureRetaliateOff(m => this.log(m));

        // Why: a startup below minFood banks before walking to the wilderness.
        // Why: already on the course or in a pit skips it, since mid-session restock is death-only — there is no safe gate exit from the lap zone.
        const startingFood = foodCount();
        if (MIN_FOOD > 0 && startingFood < MIN_FOOD) {
            if (this.entered || inPit(here, COURSE_CENTRE, PIT_Z_GAP)) {
                this.log(
                    `only ${startingFood} '${FOOD}' (min ${MIN_FOOD}) but already on course — continuing until death`
                );
            } else {
                this.log(
                    `only ${startingFood} '${FOOD}' (min ${MIN_FOOD}) — banking before heading to the course`
                );
                // Retry bank-open failures; only stop once the bank opened and still
                // has fewer than minFood (empty / wrong food name).
                let opened = false;
                for (let attempt = 0; attempt < 6 && foodCount() < MIN_FOOD; attempt++) {
                    opened = await this.bankForFood('startup');
                    if (opened) {
                        break;
                    }
                    this.log(`startup bank open failed (attempt ${attempt + 1}/6) — retrying`);
                    await Execution.delayTicks(2);
                }
                if (!opened || foodCount() < MIN_FOOD) {
                    this.setStatus(`out of '${FOOD}' in bank — stopped`);
                    ScriptRunner.stop(`only ${foodCount()} '${FOOD}' after bank (need ${MIN_FOOD})`);
                    return;
                }
            }
        }

        this.log(
            `WildyAgility starting — lap [${this.course.join(' -> ')}], food '${FOOD}' x${foodCount()} (min ${MIN_FOOD}, withdraw ${FOOD_WITHDRAW}), bank ${BANK_TILE.x},${BANK_TILE.z}, approach ${RIDGE_APPROACH.x},${RIDGE_APPROACH.z}, timeout ${OBSTACLE_TIMEOUT_TICKS} ticks`
        );
        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: RIDGE_APPROACH,
                radius: 6,
                onDeath: () => {
                    this.deaths++;
                    this.entered = false;
                    this.justEscapedPit = false;
                    this.lastClearedTick = Game.tick();
                    this.setStatus('died — recovering');
                    this.log('died in the wilderness — banking (food-only) and returning');
                    ensureRetaliateOff(m => this.log(m));
                },
                onRecovered: () => {
                    this.died = false;
                    this.setStatus('recovered — re-entering the course');
                },
                walkBack: () => this.recoverAndReturn()
            }),
            new EatFood(this),
            // Obstacle pits only (high world-z). Ridge wolf-pit is same-scene and
            // is recovered inside attemptRidgeCrossing — never via this task.
            new PitEscape(this),
            new TravelToCourse(this),
            new EnterCourse(this),
            new RunLap(this)
        );
    }

    override recoveryAnchor(): Tile {
        return Tile.from(RIDGE_APPROACH);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e0a15b' });
        p.title(`WildyAgility — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const tab = p.tabs('wa', ['Overview', 'Survival']);
        if (tab === 'Overview') {
            const xph =
                mins > 0.5
                    ? `${((((Skills.xp('agility') - this.xpAtStart) / mins) * 60) / 1000).toFixed(1)}k`
                    : '—';
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
        if (!(await this.bankForFood('death'))) {
            return false;
        }

        this.setStatus('recovering: returning to the ridge approach');
        // Land south of the Door so the next EnterCourse click owns the ridge.
        return Traversal.walkResilient(RIDGE_APPROACH, {
            radius: 2,
            attempts: 6,
            timeoutMs: 120_000,
            log: m => this.log(`  ${m}`)
        });
    }

    // Why: it runs at startup when below minFood off-course, and after a wilderness death.

    /** Walks to Edgeville bank, deposits inventory and withdraws FOOD_WITHDRAW of FOOD; false when the bank could not be opened. */
    private async bankForFood(reason: 'startup' | 'death'): Promise<boolean> {
        this.setStatus(`${reason}: walking to the bank`);
        await Traversal.walkResilient(BANK_TILE, {
            radius: 4,
            attempts: 4,
            timeoutMs: 120_000,
            log: m => this.log(`  ${m}`)
        });

        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — will retry next loop');
            return false;
        }

        await Bank.depositInventory();
        await Execution.delayTicks(1);
        await this.withdrawFood();
        this.log(`${reason}: restocked ${foodCount()} '${FOOD}'`);
        return true;
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
        // Escape/climb time is not "idle between obstacles" — stamp so gap
        // diagnostics and any residual timeout math start from recovery, not the fall.
        this.lastClearedTick = Game.tick();
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
        return needEat();
    }

    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) {
                return;
            }
            if (!needEat()) {
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
        // Game enforces a 3-tick eat penalty; movement/other tasks are not stalled.
        // RunLap's reactionMs handles settle time before the next obstacle click.
    }
}

/**
 * Escape high-z obstacle pits (ropeswing / log balance / pipe).
 * Ridge wolf-pit fails stay in the same scene and are handled by attemptRidgeCrossing.
 */
class PitEscape implements Task {
    constructor(private bot: WildyAgility) {}

    private findLadder(): Loc | null {
        // Prefer Climb-up so we don't keep climbing down into the pit.
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
        // Death recovery owns repositioning after death; continuing a pit escape
        // from a dead state resumes traversal from Lumbridge toward an unreachable ladder.
        if (this.bot.died) {
            return false;
        }
        const here = Game.tile();
        // z-gap only — same-scene wolf pit must not enter this task.
        return here !== null && inPit(here, COURSE_CENTRE, PIT_Z_GAP);
    }

    async execute(): Promise<void> {
        if (this.bot.died) {
            return;
        }
        const ladder = this.findLadder();
        if (!ladder) {
            const near = Locs.query()
                .where(l => l.actions().length > 0)
                .nearest();
            this.bot.setStatus('in the pit — no ladder found');
            this.bot.log(
                `fell into the pit but found no climb/ladder loc — nearest interactable: ${
                    near ? `${near.name} [${near.actions().join(', ')}]` : 'none'
                }`
            );
            await Execution.delayTicks(3);
            return;
        }

        const op =
            ladder.actions().find(a => /climb[- ]up/i.test(a)) ??
            ladder.actions().find(a => /climb|ladder/i.test(a)) ??
            PIT_LADDER_OP;

        const here = Game.tile();
        const lt = ladder.tile();
        if (here && !nearTile(here, lt, 2)) {
            this.bot.setStatus('in the pit — heading to the ladder');
            // Short enclosed walk — walkTo is enough; walkResilient is overkill.
            await Traversal.walkTo(lt, { radius: 1 });
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
        return here !== null && awayFromCourse(here);
    }

    async execute(): Promise<void> {
        this.bot.markLeft();
        this.bot.setStatus('walking to the wilderness agility course');
        // Approach south of the ridge Door — never north of it (pathfinder Opens Door).
        await Traversal.walkResilient(RIDGE_APPROACH, {
            radius: 2,
            attempts: 6,
            timeoutMs: 120_000,
            log: m => this.bot.log(`  ${m}`)
        });
    }
}

class EnterCourse implements Task {
    constructor(private bot: WildyAgility) {}

    validate(): boolean {
        const here = Game.tile();
        if (here === null) {
            return false;
        }
        // Once north of the Gate, never validate — the gate exits back south and
        // clicking the ridge from inside derails the script.
        if (onCourse(here)) {
            return false;
        }
        // Ridge approach / gate corridor, still south of the ridge Door.
        // southOfRidge keeps us from re-entering while standing on rocks / north of door.
        if (!nearCourseEntry(here) && !atRidgeApproach(here, RIDGE_APPROACH, 4)) {
            return false;
        }
        return southOfRidge(here);
    }

    async execute(): Promise<void> {
        await attemptRidgeCrossing(this.bot, '');
    }
}

class RunLap implements Task {
    private stuck = 0;
    private loggedOutOfFood = false;

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
        // Why: the lap zone is north of the Gate, and the entered flag covers the brief post-ridge settle.
        // Why: it stays active after a pit climb so the walk to the next start tile happens even when the ladder exit briefly reads outside onCourse.
        if (this.bot.justEscapedPit) {
            return true;
        }
        return this.bot.isEntered() || onCourse(here);
    }

    async execute(): Promise<void> {
        const name = this.bot.currentName();

        // Food is expected to run out mid-session; restock is death-only. Keep
        // running obstacles and only yield the wait loop when EatFood can act.
        if (foodCount() === 0) {
            if (!this.loggedOutOfFood) {
                this.loggedOutOfFood = true;
                this.bot.log(`out of '${FOOD}' — continuing course until death (death recovery restocks)`);
            }
        } else {
            this.loggedOutOfFood = false;
        }

        // Why: the approach happens before finding, clicking and timing.
        // Why: pit ladder exits and lap wraps (rocks → pipe) are far from the next start tile, and counting that walk against OBSTACLE_TIMEOUT_TICKS causes false "no progress" retries and inflates the "cleared in N ticks" and gap logs mid-recovery.
        const escapedPit = this.bot.justEscapedPit;
        if (escapedPit) {
            this.bot.clearEscapedPit();
            this.bot.log(`just escaped pit — walking to '${name}' starting side before clicking`);
        }
        if (escapedPit || !this.nearStart(name, 2)) {
            // Why: mid-obstacle after an aborted wait can leave the bot on an unpathable tile.
            // Why: an interactable loc is clicked from here rather than spinning on walkTo(start) failures.
            const alreadyHere = !escapedPit && this.find(name);
            if (!alreadyHere) {
                this.bot.log(`walking to '${name}' starting side`);
                const walked = await this.walkToStartTile(name);
                if (this.bot.died || EventSignal.pending() || ChatDialog.canContinue()) {
                    return;
                }
                // Still in a high-z pit (failed climb / re-fell) — let PitEscape own it.
                const here = Game.tile();
                if (here !== null && inPit(here, COURSE_CENTRE, PIT_Z_GAP)) {
                    return;
                }
                if (!walked && !this.nearStart(name, 2) && !this.find(name)) {
                    if (++this.stuck >= LAP_RETRY_LIMIT) {
                        this.bot.log(
                            `'${name}' start unreachable after ${this.stuck} tries — moving on to the next obstacle`
                        );
                        this.stuck = 0;
                        this.bot.advance();
                    } else {
                        this.bot.log(
                            `could not reach '${name}' start — will retry (${this.stuck}/${LAP_RETRY_LIMIT})`
                        );
                        await Execution.delayTicks(2);
                    }
                    return;
                }
            }
        }

        let obstacle = this.find(name);
        if (!obstacle) {
            // Resync earliest-visible obstacle in course order (not nearest) so
            // death recovery near the entrance doesn't jump to rocks.
            for (const courseName of this.bot.courseNames()) {
                if (this.find(courseName) && this.bot.resyncTo(courseName)) {
                    obstacle = this.find(courseName);
                    this.stuck = 0;
                    break;
                }
            }
        }
        if (!obstacle) {
            this.bot.setStatus(`waiting: no ${this.bot.currentName()} within ${this.bot.searchRadius()} tiles`);
            this.bot.log(`waiting: no '${this.bot.currentName()}' within ${this.bot.searchRadius()} tiles`);
            await Execution.delayTicks(2);
            return;
        }

        const op = obstacle.actions()[0];
        if (!op) {
            this.bot.log(`'${obstacle.name}' has no actions — retrying`);
            await Execution.delayTicks(2);
            return;
        }

        // Soft diagnostic only — never delay the click for a gap after recovery walks.
        const gapTicks = Game.tick() - this.bot.lastClearedTick;
        if (!escapedPit && gapTicks > OBSTACLE_TIMEOUT_TICKS * 2) {
            this.bot.log(`gap ${gapTicks} ticks since last obstacle`);
        }

        const mark = GameMessages.mark();
        const before = Skills.xp('agility');
        const ot = obstacle.tile();
        this.bot.setStatus(`${op} ${obstacle.name} at ${ot.x},${ot.z}`);
        this.bot.log(`${op} '${this.bot.currentName()}' @ ${ot.x},${ot.z}`);

        if (!(await obstacle.interact(op))) {
            this.bot.log(`interact('${op}') on '${this.bot.currentName()}' failed — retrying`);
            await Execution.delayTicks(2);
            return;
        }

        // Why: the timeout starts at the click, not at task entry or approach.
        // Why: a hard wall-clock bound is needed because idle-only counting stalls forever when the client keeps reporting animation or movement from combat or pathing jitter.
        // Why: waitedTicks is diagnostic and the low-HP gate only, since the wall clock already bounds total wait.
        const clickTick = Game.tick();
        const waitDeadline = performance.now() + OBSTACLE_TIMEOUT_TICKS * 600 + 3_000;
        let idleTicks = 0;
        let waitedTicks = 0;
        let lowHp = false;
        let settled = false;
        let lastTile = Game.tile();
        while (idleTicks < OBSTACLE_TIMEOUT_TICKS) {
            if (performance.now() >= waitDeadline) {
                break;
            }
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
            // Why: yielding lets EatFood run while skeletons near the rocks hit us.
            // Why: it waits a few ticks first, so residual damage does not abort the click.
            // Why: it never yields on an empty inventory — EatFood will not validate, and aborting mid-obstacle leaves the bot on unpathable tiles such as the log or pipe.
            if (waitedTicks >= 3 && needEat()) {
                lowHp = true;
                settled = true;
                break;
            }

            await Execution.delayTicks(1);
            waitedTicks++;

            // Prefer idle time for timeout; wall clock covers perpetual anim/move.
            const now = Game.tile();
            const moved =
                !!now && !!lastTile && (now.x !== lastTile.x || now.z !== lastTile.z || now.level !== lastTile.level);
            if (!Game.animating() && !moved) {
                idleTicks++;
            }
            lastTile = now ?? lastTile;
        }

        const hereAfter = Game.tile();
        const reason = classifyObstacle({
            xpGained: Skills.xp('agility') > before,
            // Position-only pit: PIT_FALL also fires for stepping stone (no scene change).
            inPit: hereAfter !== null && inPit(hereAfter, COURSE_CENTRE, PIT_Z_GAP),
            cantReach: GameMessages.sawSince(mark, CANT_REACH),
            wrongSide: GameMessages.sawSince(mark, WRONG_SIDE),
            // Stepping-stone fall: PIT_FALL message without scene change.
            pitFallMessage: GameMessages.sawSince(mark, PIT_FALL),
            interrupted: EventSignal.pending() || ChatDialog.canContinue(),
            lowHp,
            settled
        });

        if (reason === 'interrupted') {
            this.bot.setStatus('random event — handling');
            return;
        }

        if (reason === 'pit') {
            this.bot.log(`fell into the pit during '${this.bot.currentName()}' — escaping`);
            this.bot.setStatus('in the pit — escaping');
            // Fall is a live outcome, not a stuck click — reset so recovery
            // does not inherit a half-spent retry counter.
            this.stuck = 0;
            return;
        }

        if (reason === 'timeout') {
            this.bot.setStatus(`timeout waiting for ${obstacle.name} (${idleTicks} idle / ${waitedTicks} total ticks)`);
            this.bot.log(
                `'${this.bot.currentName()}' timed out after ${waitedTicks} ticks (${idleTicks} idle) — no xp/chat`
            );
        }

        if (reason === 'xp') {
            this.stuck = 0;
            this.bot.countCleared();
            const elapsed = Game.tick() - clickTick;
            this.bot.log(`cleared '${this.bot.currentName()}' in ${elapsed} ticks`);
            this.bot.obstacleTimes.push(elapsed);
            if (this.bot.obstacleTimes.length > 20) {
                this.bot.obstacleTimes.shift();
            }
            this.bot.lastClearedTick = Game.tick();
            this.bot.advance();
            // Short humanized pause only — do not block on animation (combat/path
            // jitter can keep animating and previously hung the next lap silently).
            await Execution.delay(reactionMs());
            return;
        }

        // low_hp: yield to EatFood without burning a retry — combat damage is not
        // an obstacle failure. Only reached when foodCount() > 0 (see wait loop).
        if (reason === 'low_hp') {
            this.bot.log(
                `yielding '${this.bot.currentName()}' for food (${Math.round(Skills.hpFraction() * 100)}% hp, ${foodCount()} left)`
            );
            return;
        }

        if (reason === 'wrong_side') {
            this.bot.log(`'${this.bot.currentName()}' wrong side error — walking to starting side`);
            await this.walkToStartTile(obstacle.name?.toLowerCase() ?? this.bot.currentName());
            return;
        }

        if (reason === 'pit_fall_msg') {
            this.bot.log(`'${this.bot.currentName()}' fell (no pit) — retrying`);
            this.stuck = 0;
            await Execution.delayTicks(1);
            return;
        }

        // Don't web-walk at the obstacle: its tile is deliberately unpathable.
        if (reason === 'cant_reach') {
            this.bot.setStatus(`out of range for ${obstacle.name} — retrying`);
            this.bot.log(`'${this.bot.currentName()}' can't reach — retrying`);
        }

        // stuck=1: in-place retry; stuck=2: walk back to start; stuck>limit: skip.
        // Use > so the walk-back branch is reachable ( >= limit would skip it).
        if (++this.stuck > LAP_RETRY_LIMIT) {
            const skipped = this.bot.currentName();
            this.bot.log(
                `'${skipped}' isn't completing from here after ${this.stuck} tries — moving on to the next obstacle`
            );
            this.stuck = 0;
            this.bot.advance();
            // If advance wrapped the lap onto the same / first obstacle, walk to
            // the first start tile to break a wrong-position loop (e.g. rocks).
            const nextName = this.bot.currentName();
            if (nextName === skipped || nextName === this.bot.courseNames()[0]) {
                if (getStartTile(this.bot.courseNames()[0])) {
                    this.bot.log(`obstacle skip wrapped lap — walking to '${this.bot.courseNames()[0]}' starting side`);
                    await this.walkToStartTile(this.bot.courseNames()[0]);
                }
            }
        } else if (this.stuck >= 2) {
            this.bot.log(
                `'${this.bot.currentName()}' no progress — walking back to starting side (${this.stuck}/${LAP_RETRY_LIMIT})`
            );
            const walked = await this.walkToStartTile(obstacle.name?.toLowerCase() ?? this.bot.currentName());
            if (!walked) {
                this.bot.log(`'${this.bot.currentName()}' starting side unreachable — advancing to next obstacle`);
                this.stuck = 0;
                this.bot.advance();
            }
        } else {
            this.bot.setStatus(`retrying ${obstacle.name}`);
            this.bot.log(`'${this.bot.currentName()}' no progress — retrying (${this.stuck}/${LAP_RETRY_LIMIT})`);
            await Execution.delayTicks(2);
        }
    }

    private nearStart(obstacleName: string, radius: number): boolean {
        const start = getStartTile(obstacleName);
        const here = Game.tile();
        return !!start && !!here && nearTile(here, start, radius);
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
        if (here && nearTile(here, start, 1)) {
            this.bot.log(`already near starting side for '${obstacleName}'`);
            await Execution.delayTicks(1);
            return true;
        }
        // Bound the walk so a bad path cannot hang the lap with no further logs.
        const result = await Traversal.walkTo(start, { radius: 1, timeoutMs: 45_000 });
        if (!result) {
            this.bot.log(`could not reach starting side for '${obstacleName}' — path unreachable`);
            return false;
        }
        return true;
    }
}
