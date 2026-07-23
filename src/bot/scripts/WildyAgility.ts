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
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const DEFAULT_OBSTACLES = 'Obstacle pipe,Ropeswing,Stepping stone,Log balance,Rocks';
const DEFAULT_CENTRE = new Tile(2998, 3945, 0);
const DEFAULT_ENTRANCE = new Tile(2998, 3924, 0);
const EDGEVILLE = new Tile(3094, 3493, 0);
const RIDGE_MIN_AGILITY = 52;
const PIT_Z_GAP = 2000;
const LAP_RETRY_LIMIT = 4;

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
};

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

export function classifyAttempt(xpGained: boolean, tookDamage: boolean): 'cleared' | 'failed' | 'noop' {
    if (xpGained) {
        return 'cleared';
    }
    return tookDamage ? 'failed' : 'noop';
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
        this.course = parseObstacles(this.settings.str('obstacles', DEFAULT_OBSTACLES));

        const agility = Skills.level('agility');
        if (agility < RIDGE_MIN_AGILITY) {
            this.log(`WildyAgility needs Agility ${RIDGE_MIN_AGILITY} to cross the ridge (have ${agility}) — stopping.`);
            throw new Error(`WildyAgility: Agility ${RIDGE_MIN_AGILITY} required`);
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');

        this.log(`WildyAgility starting — lap [${this.course.join(' -> ')}], food '${FOOD}', bank ${BANK_TILE.x},${BANK_TILE.z}, entrance ${COURSE_ENTRANCE.x},${COURSE_ENTRANCE.z}`);

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
                onDeath: () => {
                    this.deaths++;
                    this.entered = false;
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e0a15b' });
        p.title(`WildyAgility — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const tab = p.tabs('wa', ['Overview', 'Survival']);
        if (tab === 'Overview') {
            const xph = mins > 0.5 ? `${(((Skills.xp('agility') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Laps: ${this.laps}`, `XP/hr: ${xph}`);
            p.row(`Obstacles: ${this.cleared}`, `Step: ${this.currentName() ?? '—'}`);
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
    }
}

class PitEscape implements Task {
    constructor(private bot: WildyAgility) {}

    private findLadder(): Loc | null {
        if (PIT_LADDER_NAME) {
            return Locs.query().name(PIT_LADDER_NAME).action(PIT_LADDER_OP).nearest();
        }
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

        const here = Game.tile();
        const lt = ladder.tile();
        if (here && lt.level === here.level && Math.max(Math.abs(here.x - lt.x), Math.abs(here.z - lt.z)) > 2) {
            this.bot.setStatus('in the pit — heading to the ladder');
            await Traversal.walkResilient(lt, { radius: 1, attempts: 3, timeoutMs: 30_000, log: m => this.bot.log(`  ${m}`) });
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
        return here !== null && !this.bot.isEntered() && inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS);
    }

    async execute(): Promise<void> {
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
        return here !== null && this.bot.isEntered() && this.bot.courseNames().length > 0 && (inRegion(here, COURSE_CENTRE, COURSE_RADIUS) || inRegion(here, COURSE_ENTRANCE, ENTRY_RADIUS));
    }

    async execute(): Promise<void> {
        let obstacle = this.find(this.bot.currentName());
        if (!obstacle) {
            for (const name of new Set(this.bot.courseNames())) {
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

        const before = Skills.xp('agility');
        const hpBefore = Skills.effective('hitpoints');
        this.bot.setStatus(`${op} ${obstacle.name} at ${obstacle.tile()}`);
        const clicked = await obstacle.interact(op);

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

        let last = Game.tile();
        for (let settle = 0; settle < 25; settle++) {
            await Execution.delayTicks(1);
            if (ChatDialog.canContinue()) {
                break;
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
