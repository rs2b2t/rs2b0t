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
import { fmtDuration } from '../api/hud/paintLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
/** Bank keep-set beyond food/coins: the trail kit stays for future clues. */
const KIT = ['spade', 'sextant', 'watch', 'chart'];
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'];

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
/** Pack slots holding loot-list items (clue rewards included via 'clue'/'casket'). */
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

/**
 * AutoFighter — anchor-based target killer that farms and solves clues
 * (2026-07-20 design). Kills the selected target at the selected spot, loots
 * ONLY gem-table items + clue scrolls (guards never roll the gem table in
 * this engine — the list is future-proofing for targets that do), invokes
 * the shared SolveClue the moment a clue is looted, banks the loot when the
 * clue finishes (plus full-pack/foodless safeties), and returns to killing.
 * Start it anywhere — it walks to the spot first. Food comes from the bank.
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
    /** Set when a solve completes; BankRun consumes it (the user loop:
     *  clue done -> bank the loot -> back to killing). */
    bankAfterSolve = false;
    /** The bank had no food last trip — disarms the foodless safety bank so
     *  an empty bank can't hot-loop bank<->spot (live smoke find); re-arms
     *  the moment food is seen in the pack again. */
    bankFoodEmpty = false;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        TARGET = this.settings.str('target', 'Guard');
        const spotName = this.settings.str('spot', 'Varrock East gate');
        const spot = SPOTS[spotName] ?? SPOTS['Varrock East gate'];
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
                    this.bankAfterSolve = true;
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
        this.xpAtStart = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);
        this.log(`AutoFighter starting — '${TARGET}' at ${spotName} ${ANCHOR} r${LEASH}, food '${FOOD}'x${FOOD_WITHDRAW}, loot [${LOOT.join(', ')}]`);

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
                    this.solveClue?.noteDeath(); // died mid-solve: food re-bank before resuming
                    this.log('died! waiting for respawn, then walking back to the spot');
                },
                onRecovered: () => {
                    this.died = false;
                }
            }),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
            this.solveClue!, // a looted clue preempts banking/fighting (RockCrab shape)
            new BankRun(this),
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#7fd07f' });
        p.title(`AutoFighter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = COMBAT_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0) - this.xpAtStart;
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

/** No food + low HP: retreat to the nearest bank, restock or regen. */
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
        if (foodCount() > 0) {
            this.bot.bankFoodEmpty = false; // food came from somewhere — re-arm the safety
        }
        return this.bot.bankAfterSolve || lootSlots() >= BANK_AT
            || (foodCount() === 0 && FOOD_WITHDRAW > 0 && !this.bot.bankFoodEmpty);
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.bot.bankAfterSolve = false;
            return;
        }
        this.bot.setStatus(this.bot.bankAfterSolve ? 'clue done — banking the loot' : 'banking');
        this.bot.log(`banking at the ${bank.name} bank (${bank.tile})`);
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
                break;
            }
            if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) {
                break;
            }
        }
        if (foodCount() === 0 && FOOD_WITHDRAW > 0) {
            this.bot.bankFoodEmpty = true;
            this.bot.log(`no '${FOOD}' in the bank — fighting on without food (foodless safety disarmed)`);
        }
        this.bot.bankAfterSolve = false;
        this.bot.countTrip();
        this.bot.setStatus('heading back to the spot');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Re-apply the combat style whenever com_mode drifts (not saved by the engine). */
class SetStyle implements Task {
    private announced = false;
    constructor(private bot: AutoFighter) {}
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

/** Attack the nearest free target in leash; see the fight through, yielding
 *  below the eat gate so EatFood can fire mid-combat (ArdyFighter shape). */
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
