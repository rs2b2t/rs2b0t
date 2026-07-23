import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, parseBankStrategy, depositMatcher } from '../api/Banking.js';
import { COMBAT_STYLE_OPTIONS, parseCombatStyle } from '../api/CombatStyle.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import { Traversal } from '../api/Traversal.js';
import { EventSignal } from '../api/EventSignal.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic, shouldRestock, slotsMatching } from './ArdyFighterLogic.js';
import { stealCakes } from './CakeStall.js';
import { SolveClue } from '../clues/SolveClue.js';
import { Sustain } from '../api/Sustain.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const DEFAULT_ANCHOR = new Tile(2661, 3306, 0);
const DEFAULT_BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const DEFAULT_FOOD = 'cake, bread, chocolate slice';
const DEFAULT_LOOT = 'clue scroll, blood rune, nature rune, chaos rune, body talisman, steel arrow, iron ore';

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'];

export const SETTINGS: SettingsSchema = {
    anchor: { type: 'tile', default: DEFAULT_ANCHOR, label: 'Market anchor (x,z)' },
    leashRadius: { type: 'number', default: 12, min: 5, max: 25, label: 'Leash radius (tiles)' },
    target: { type: 'string', default: 'Guard', label: 'NPC to fight (name)' },
    combatStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Combat style', help: 'which melee stat to train; re-applied each login since com_mode is not saved' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    food: { type: 'string[]', default: DEFAULT_FOOD.split(',').map(s => s.trim()), label: 'Food names (contains)' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%', help: 'keep eating until HP reaches this % — 90 avoids the overheal wasted by eating to full' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    restUntilHp: { type: 'number', default: 60, min: 0, max: 100, label: 'Regen to HP% when bank empty' },
    foodTarget: { type: 'number', default: 8, min: 1, max: 27, label: 'Keep food stocked to (count)', help: 'after eating to full, restock the Baker\'s stall back up to this many' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots' },
    loot: { type: 'string[]', default: DEFAULT_LOOT.split(',').map(s => s.trim()), label: 'Loot item names (contains)' },
    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues' },
    ...PERIODIC_BANK_SETTINGS
};

let ANCHOR = DEFAULT_ANCHOR;
let LEASH = 12;
let TARGET = 'Guard';
let BANK_STAND = DEFAULT_BANK_STAND;
let FOOD = DEFAULT_FOOD.split(',').map(s => s.trim().toLowerCase());
let LOOT = DEFAULT_LOOT.split(',').map(s => s.trim().toLowerCase());
let EAT_AT = 0.5;
let EAT_TO = 0.9;
let PANIC_AT = 0.25;
let REST_UNTIL = 0.6;
let FOOD_TARGET = 8;
let BANK_AT = 12;
let BANK_COMMON = true;
let COMBAT_MODE = 1;
let SOLVE_CLUES = true;

function foodCount(): number {
    return countMatching(Inventory.items(), FOOD);
}

function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

export default class ArdyFighter extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private steals = 0;
    private eats = 0;
    private looted = 0;
    private trips = 0;
    private deaths = 0;
    private cluesSolved = 0;
    private solveClue: SolveClue | undefined;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        ANCHOR = this.settings.tile('anchor', DEFAULT_ANCHOR);
        LEASH = this.settings.num('leashRadius', 12);
        TARGET = this.settings.str('target', 'Guard');
        BANK_STAND = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        FOOD = this.settings.list('food', FOOD).map(s => s.toLowerCase());
        LOOT = this.settings.list('loot', LOOT).map(s => s.toLowerCase());
        EAT_AT = this.settings.num('eatAtHp', 50) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        REST_UNTIL = this.settings.num('restUntilHp', 60) / 100;
        FOOD_TARGET = this.settings.num('foodTarget', 8);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        COMBAT_MODE = parseCombatStyle(this.settings.str('combatStyle', 'strength'));
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.cluesSolved++;
                }
                this.setStatus(s);
            },
            isFood: n => matchesAny(n, FOOD),
            foodName: () => 'Cake',
            foodWithdraw: () => FOOD_TARGET,
            spadeName: () => 'Spade',
            enabled: () => SOLVE_CLUES
        });
        Sustain.set(async () => {
            if (Skills.hpFraction() < EAT_AT && foodCount() > 0) {
                const food = Inventory.items().find(i => matchesAny(i.name, FOOD));
                if (food) {
                    const before = Skills.effective('hitpoints');
                    if (await food.interact('Eat')) {
                        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
                    }
                }
            }
        });

        if (Skills.level('thieving') < 5) {
            this.log(`ArdyFighter needs Thieving 5 for the Baker's stall (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error('ArdyFighter: Thieving 5 required');
        }

        this.startedAt = Date.now();
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);

        this.log(`ArdyFighter starting — anchor ${ANCHOR} r${LEASH}, target '${TARGET}', stall via shared driver, bank ${BANK_STAND}`);

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
                    this.countDeath();
                    this.solveClue?.noteDeath();
                    this.log('died! waiting for respawn, then walking back to the market');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
            this.solveClue!,
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
            new SetStyle(this),
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffb86c' });
        p.title(`ArdyFighter — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const tab = p.tabs('af', ['Overview', 'Loot']);
        if (tab === 'Overview') {
            const xpGained = COMBAT_SKILLS.reduce((n, s) => n + Skills.xp(s), 0) - this.xpAtStart;
            const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.kills}`, `XP/hr: ${xph}`);
            p.row(`Food: ${foodCount()}`, `Steals: ${this.steals}`, this.deaths ? `Deaths: ${this.deaths}` : `Ate: ${this.eats}`);
            p.row(`Clues: ${this.cluesSolved}`, `Clue: ${this.solveClue?.clueStatus() ?? 'idle'}`);
            p.bar('HP', Skills.hpFraction());
        } else {
            p.row(`Looted: ${this.looted}`, `Loot slots: ${lootSlots()}`);
            p.row(`Bank trips: ${this.trips}`, `Ate: ${this.eats}`, `Deaths: ${this.deaths}`);
        }

        p.gap();
        const styleNow = this.settings.str('combatStyle', 'strength');
        const picked = p.select('style', 'style', COMBAT_STYLE_OPTIONS, styleNow);
        if (picked && picked !== styleNow) {
            this.switchStyle(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchStyle(style: string): void {
        COMBAT_MODE = parseCombatStyle(style);
        SettingsStore.save('ArdyFighter', 'combatStyle', style);
        this.log(`combat style switched to ${style} (from the paint)`);
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countKill(): void {
        this.kills++;
    }
    countSteal(): void {
        this.steals++;
    }
    countEat(): void {
        this.eats++;
    }
    countLoot(): void {
        this.looted++;
    }
    countTrip(): void {
        this.trips++;
    }
    tripsTotal(): number {
        return this.trips;
    }
    countDeath(): void {
        this.deaths++;
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ArdyFighter) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to the market');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class EatFood implements Task {
    constructor(private bot: ArdyFighter) {}

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
            const food = Inventory.items().find(i => matchesAny(i.name, FOOD));
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

class RestockCakes implements Task {
    constructor(private bot: ArdyFighter) {}

    validate(): boolean {
        return !Game.inCombat() && !Inventory.isFull() && shouldRestock(foodCount(), FOOD_TARGET);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        await stealCakes({
            fillTo: FOOD_TARGET,
            abort: () => EventSignal.pending() || this.bot.died || ChatDialog.canContinue(),
            shouldEat: () => shouldEat(Skills.hpFraction(), EAT_AT, foodCount()),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            onSteal: () => this.bot.countSteal()
        });
    }
}

class LootDrops implements Task {
    constructor(private bot: ArdyFighter) {}

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

class BankRun implements Task {
    constructor(private bot: ArdyFighter) {}

    validate(): boolean {
        return shouldBank(lootSlots(), BANK_AT, Inventory.isFull());
    }

    async execute(): Promise<void> {
        this.bot.setStatus('banking the loot');
        await Traversal.walkTo(BANK_STAND, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });

        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }

        await Bank.depositAllMatching(depositMatcher(name => matchesAny(name, LOOT), BANK_COMMON));
        await Execution.delayTicks(1);
        this.bot.countTrip();
        this.bot.log(`deposited the loot (trip ${this.bot.tripsTotal()})`);

        this.bot.setStatus('heading back to the market');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class PanicRetreat implements Task {
    constructor(private bot: ArdyFighter) {}

    validate(): boolean {
        return shouldPanic(Skills.hpFraction(), PANIC_AT, foodCount());
    }

    async execute(): Promise<void> {
        this.bot.setStatus('panic: no food — retreating to the bank');
        this.bot.log(`panic retreat at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
        await Traversal.walkTo(BANK_STAND, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });

        if (await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`))) {
            const banked = Bank.items().find(i => matchesAny(i.name, FOOD));
            if (banked?.name) {
                for (let i = 0; i < FOOD_TARGET && !Inventory.isFull(); i++) {
                    const before = foodCount();
                    if (!(await Bank.withdraw(banked.name, 'Withdraw-1'))) {
                        break;
                    }
                    if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                        break;
                    }
                }
                this.bot.log(`withdrew ${foodCount()} food from the bank`);
            }
        }

        if (foodCount() === 0) {
            this.bot.setStatus('panic: bank empty — waiting for regen');
            await Execution.delayUntil(() => Skills.hpFraction() >= REST_UNTIL || Game.inCombat() || ChatDialog.canContinue() || EventSignal.pending(), 300_000);
        }

        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class SetStyle implements Task {
    private announced = false;
    constructor(private bot: ArdyFighter) {}

    validate(): boolean {
        return !Game.inCombat() && Game.combatMode() !== COMBAT_MODE;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(COMBAT_MODE);
        const ok = await Execution.delayUntil(() => Game.combatMode() === COMBAT_MODE, 3000);
        if (ok && !this.announced) {
            this.announced = true;
            this.bot.log(`combat style: ${['accurate', 'aggressive', 'defensive'][COMBAT_MODE] ?? '?'} (training ${['Attack', 'Strength', 'Defence'][COMBAT_MODE] ?? '?'})`);
        }
    }
}

class Fight implements Task {
    constructor(private bot: ArdyFighter) {}

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
        const guard = this.findTarget();
        if (!guard) {
            return;
        }

        this.bot.setStatus(`attacking ${TARGET} at ${guard.tile()}`);
        if (!(await guard.interact('Attack'))) {
            await Execution.delayTicks(2);
            return;
        }

        const engaged = await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
        if (!engaged || ChatDialog.canContinue()) {
            return;
        }

        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90000;
        let reattacks = 0;

        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died || Inventory.isFull()) {
                return;
            }
            if (shouldEat(Skills.hpFraction(), EAT_AT, foodCount()) || Skills.hpFraction() < PANIC_AT) {
                return;
            }

            const me = Game.tile();
            if (!me || guard.tile().distanceTo(me) > LEASH + 10) {
                this.bot.log('displaced mid-fight — abandoning target');
                return;
            }

            const target = this.track(guard);
            if (!target) {
                this.bot.countKill();
                return;
            }
            if (target.health === 0 && target.snap.totalHealth > 0) {
                await Execution.delayUntil(() => this.track(guard) === null, 10000);
                this.bot.countKill();
                return;
            }
            if (!Game.inCombat() && !target.inCombat) {
                if (reattacks >= 2) {
                    return;
                }
                reattacks++;
                await target.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
                continue;
            }
            await Execution.delayTicks(2);
        }
    }
}
