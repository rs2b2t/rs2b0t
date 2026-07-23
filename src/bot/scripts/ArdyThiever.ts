import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, parseBankStrategy, depositMatcher } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import { Traversal } from '../api/Traversal.js';
import { walkOpening } from '../api/walkOpening.js';
import { EventSignal } from '../api/EventSignal.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { ARDOUGNE_PICKPOCKET_TARGETS } from './PickpocketTargets.js';
import { chooseTarget, isHostileAttacker, requiredThieving, targetSpot } from './ArdyThieverLogic.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic, slotsMatching } from './ArdyFighterLogic.js';
import { CAKE_ITEMS } from './CakeStallLogic.js';
import { stealCakes } from './CakeStall.js';
import { SolveClue } from '../clues/SolveClue.js';
import { Sustain } from '../api/Sustain.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const PICKPOCKET_OP = 'Pickpocket';
const FLEE_TILE = new Tile(2655, 3298, 0);
const STUN_COMBAT_TICKS = 8;
const ENGAGE_RADIUS = 5;
const OBSTACLE = ['door', 'gate'];
const FOOD = CAKE_ITEMS;
const LOOT = ['coins', 'chaos rune', 'death rune', 'blood rune', 'nature rune', 'jug of wine', 'fire orb', 'gold ore', 'clue scroll', 'body talisman', 'steel arrow', 'iron ore'];
const TARGET_OPTIONS = ARDOUGNE_PICKPOCKET_TARGETS;

export const SETTINGS: SettingsSchema = {
    thieveTarget: { type: 'string', default: 'Guard', options: TARGET_OPTIONS, label: 'Pickpocket target', help: 'the bot knows each target\'s market spot — no anchor to place' },
    guardResponse: { type: 'string', default: 'Flee', options: ['Flee', 'Fight'], label: 'Guard response', help: 'caught at the stall: Flee kites the guard off the market; Fight kills it (bring combat stats)' },
    eatAtHp: { type: 'number', default: 40, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    restUntilHp: { type: 'number', default: 60, min: 0, max: 100, label: 'Regen to HP% when bank empty' },
    foodTarget: { type: 'number', default: 22, min: 1, max: 27, label: 'Fill food to (count)' },
    restockAtFood: { type: 'number', default: 3, min: 0, max: 26, label: 'Restock when food drops to' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots' },
    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues' },
    ...PERIODIC_BANK_SETTINGS
};

let TARGET = 'Guard';
let RESPONSE = 'Flee';
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
let SOLVE_CLUES = true;

function foodCount(): number {
    return countMatching(Inventory.items(), FOOD);
}
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

function nearMarket(): boolean {
    const here = Game.tile();
    return here !== null && ANCHOR.distanceTo(here) <= LEASH + 6;
}

export default class ArdyThiever extends TaskBot {
    override loopDelay = 600;

    private steals = 0;
    private eats = 0;
    private looted = 0;
    private trips = 0;
    private flees = 0;
    private kills = 0;
    private cluesSolved = 0;
    private solveClue: SolveClue | undefined;
    private status = 'starting';
    private stunnedUntilTick = 0;
    private startedAt = Date.now();
    private xpAtStart = 0;
    private lootCounts = new Map<string, number>();
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        TARGET = this.settings.str('thieveTarget', 'Guard');
        RESPONSE = this.settings.str('guardResponse', 'Flee');
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

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('thieving');

        const need = requiredThieving(TARGET);
        if (Skills.level('thieving') < need) {
            this.log(`ArdyThiever needs Thieving ${need} to pickpocket ${TARGET} (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error(`ArdyThiever: Thieving ${need} required`);
        }

        this.log(`ArdyThiever starting — target '${TARGET}' at ${ANCHOR} r${LEASH} (Thieving ${need}+), ${RESPONSE.toLowerCase()} mode, stall via shared driver, bank ${BANK_STAND}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
            if (/been stunned|fail to pick/i.test(e.text)) {
                this.stunnedUntilTick = Game.tick() + STUN_COMBAT_TICKS;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.solveClue?.noteDeath(); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            ...(RESPONSE === 'Fight' ? [] : [new Flee(this)]),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
            ...(RESPONSE === 'Fight' ? [new FightBack(this)] : []),
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
            new Pickpocket(this),
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`ArdyThiever — ${this.status}`);

        const tab = p.tabs('at', ['Overview', 'Loot', 'Combat']);
        const mins = (Date.now() - this.startedAt) / 60_000;
        if (tab === 'Overview') {
            const xph = mins > 0.5 ? `${(((Skills.xp('thieving') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
            const sph = mins > 0.5 ? `${Math.round((this.steals / mins) * 60)}` : '—';
            p.row(`Runtime: ${fmtDuration(mins)}`, `Steals: ${this.steals}`, `Steals/hr: ${sph}`);
            p.row(`XP/hr: ${xph}`, `Food: ${foodCount()}`, `Loot slots: ${lootSlots()}`);
            p.row(`Clues: ${this.cluesSolved}`, `Clue: ${this.solveClue?.clueStatus() ?? 'idle'}`);
            p.bar('HP', Skills.hpFraction());
        } else if (tab === 'Loot') {
            p.row(`Looted: ${this.looted}`, `Bank trips: ${this.trips}`);
            const top = [...this.lootCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
            if (top.length === 0) {
                p.text('nothing yet', '#8a919a');
            }
            for (let i = 0; i < top.length; i += 2) {
                p.row(...top.slice(i, i + 2).map(([name, n]) => `${name} × ${n}`));
            }
        } else {
            p.row(`Response: ${RESPONSE}`, `Fled: ${this.flees}`, `Fought: ${this.kills}`);
            p.row(`Ate: ${this.eats}`, `Stunned: ${this.inThievingStun() ? 'yes' : 'no'}`, `In combat: ${this.inRealCombat() ? 'yes' : 'no'}`);
        }

        p.gap();
        const picked = p.select('target', 'target', TARGET_OPTIONS, TARGET);
        if (picked && picked !== TARGET) {
            this.switchTarget(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchTarget(target: string): void {
        const need = requiredThieving(target);
        if (Skills.level('thieving') < need) {
            this.log(`can't switch to ${target}: needs Thieving ${need} (have ${Skills.level('thieving')})`);
            return;
        }
        TARGET = target;
        const spot = targetSpot(target);
        ANCHOR = spot.anchor;
        LEASH = spot.leash;
        SettingsStore.save('ArdyThiever', 'thieveTarget', target);
        this.log(`pickpocket target switched to ${target} (from the paint)`);
    }

    setStatus(s: string): void { this.status = s; }
    stunned(): boolean { return this.inThievingStun(); }
    private inThievingStun(): boolean { return Game.tick() <= this.stunnedUntilTick; }
    inRealCombat(): boolean { return Game.inCombat() && !this.inThievingStun(); }
    countSteal(): void { this.steals++; }
    countEat(): void { this.eats++; }
    countLoot(name?: string | null): void {
        this.looted++;
        if (name) {
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + 1);
        }
    }
    countTrip(): void { this.trips++; }
    countFlee(): void { this.flees++; }
    countKill(): void { this.kills++; }
}

class Flee implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean { return this.bot.inRealCombat(); }
    async execute(): Promise<void> {
        this.bot.setStatus(`kiting the guard to ${FLEE_TILE.x},${FLEE_TILE.z}`);
        this.bot.log(`combat — kiting the guard to ${FLEE_TILE.x},${FLEE_TILE.z}`);
        this.bot.countFlee();
        await walkOpening(FLEE_TILE, 0, OBSTACLE, m => this.bot.log(`  ${m}`));
        await Execution.delayUntil(() => !Game.inCombat(), 15000);
    }
}

class FightBack implements Task {
    constructor(private bot: ArdyThiever) {}
    private findAttacker(): Npc | null {
        return Npcs.query()
            .where(n => isHostileAttacker({ name: n.name, inCombat: n.inCombat, distance: n.distance(), actions: n.actions(), targetsAnotherPlayer: n.targetsAnotherPlayer() }, ENGAGE_RADIUS))
            .nearest();
    }
    private track(engaged: Npc): Npc | null {
        return Npcs.all().find(n => n.index === engaged.index && n.name === engaged.name) ?? null;
    }
    validate(): boolean { return this.bot.inRealCombat(); }
    async execute(): Promise<void> {
        const attacker = this.findAttacker();
        if (!attacker) {
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus(`fighting back: ${attacker.name} at ${attacker.tile()}`);
        this.bot.log(`combat — fighting back against ${attacker.name}`);
        if (!(await attacker.interact('Attack'))) { await Execution.delayTicks(2); return; }
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) { return; }
            if (shouldEat(Skills.hpFraction(), EAT_AT, foodCount()) || shouldPanic(Skills.hpFraction(), PANIC_AT, foodCount())) {
                return;
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
                return;
            }
            await Execution.delayTicks(2);
        }
    }
}

class LootDrops implements Task {
    constructor(private bot: ArdyThiever) {}
    private find() {
        return GroundItems.query()
            .where(g => matchesAny(g.name, LOOT))
            .where(g => g.tile().distanceTo(ANCHOR) <= LEASH + 4 && Reachability.canReach(g.tile()))
            .nearest();
    }
    validate(): boolean { return !this.bot.inRealCombat() && !Inventory.isFull() && this.find() !== null; }
    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) { return; }
        const name = drop.name ?? '';
        this.bot.setStatus(`picking up ${name}`);
        const before = Inventory.count(name);
        if (!(await drop.interact('Take'))) { await Execution.delayTicks(2); return; }
        if (await Execution.delayUntil(() => Inventory.count(name) > before, 3000)) {
            this.bot.countLoot(name);
        }
    }
}

class EatFood implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean { return shouldEat(Skills.hpFraction(), EAT_AT, foodCount()); }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) { return; }
            if (Skills.hpFraction() >= EAT_TO || foodCount() === 0) { return; }
            const food = Inventory.items().find(i => matchesAny(i.name, FOOD));
            if (!food) { return; }
            this.bot.setStatus(`eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
            const before = Skills.effective('hitpoints');
            if (!(await food.interact('Eat'))) { return; }
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before || foodCount() === 0, 3000);
            if (Skills.effective('hitpoints') > before) { this.bot.countEat(); }
        }
    }
}

class PanicRetreat implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean { return nearMarket() && shouldPanic(Skills.hpFraction(), PANIC_AT, foodCount()); }
    async execute(): Promise<void> {
        this.bot.setStatus('panic: no food — retreating to the bank');
        await Traversal.walkTo(BANK_STAND, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });
        if (await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`))) {
            const banked = Bank.items().find(i => matchesAny(i.name, FOOD));
            if (banked?.name) {
                for (let i = 0; i < FOOD_TARGET && !Inventory.isFull(); i++) {
                    const before = foodCount();
                    if (!(await Bank.withdraw(banked.name, 'Withdraw-1'))) { break; }
                    if (!(await Execution.delayUntil(() => foodCount() > before, 2000))) { break; }
                }
            }
        }
        if (foodCount() === 0) {
            this.bot.setStatus('panic: bank empty — waiting for regen');
            await Execution.delayUntil(() => Skills.hpFraction() >= REST_UNTIL || Game.inCombat() || ChatDialog.canContinue() || EventSignal.pending(), 300_000);
        }
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class BankRun implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean { return nearMarket() && shouldBank(lootSlots(), BANK_AT, Inventory.isFull()); }
    async execute(): Promise<void> {
        this.bot.setStatus('banking the loot');
        await Traversal.walkTo(BANK_STAND, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        const before = lootSlots();
        await Bank.depositAllMatching(depositMatcher(name => matchesAny(name, LOOT), BANK_COMMON), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        const after = lootSlots();
        this.bot.log(`banked: loot slots ${before}->${after}${after >= before ? ' (nothing deposited!)' : ''}`);
        this.bot.countTrip();
        this.bot.setStatus('heading back');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

class RestockCakes implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean {
        return nearMarket() && !this.bot.inRealCombat() && !Inventory.isFull() && foodCount() <= RESTOCK_AT;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        this.bot.log(`restocking cake (have ${foodCount()})`);
        await stealCakes({
            fillTo: FOOD_TARGET,
            abort: () => EventSignal.pending() || this.bot.died || ChatDialog.canContinue() || this.bot.inRealCombat(),
            shouldEat: () => shouldEat(Skills.hpFraction(), EAT_AT, foodCount()),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            onSteal: () => this.bot.countSteal()
        });
    }
}

class Pickpocket implements Task {
    private unreachableStreak = 0;

    constructor(private bot: ArdyThiever) {}

    private candidates(): Npc[] {
        return Npcs.query()
            .name(TARGET)
            .action(PICKPOCKET_OP)
            .where(n => n.tile().distanceTo(ANCHOR) <= LEASH)
            .results()
            .sort((a, b) => a.distance() - b.distance());
    }

    validate(): boolean {
        return !this.bot.inRealCombat() && foodCount() > RESTOCK_AT && !Inventory.isFull() && this.candidates().length > 0;
    }

    async execute(): Promise<void> {
        const { target, blocked } = chooseTarget(this.candidates(), n => Reachability.canReach(n.tile(), { adjacentOk: true }));

        if (!target) {
            if (blocked && this.unreachableStreak++ < 2) {
                this.bot.setStatus(`clearing path to ${TARGET}`);
                await walkOpening(blocked.tile(), 1, OBSTACLE, m => this.bot.log(m));
            } else {
                this.bot.setStatus(`${TARGET} out of reach — waiting for it to wander back`);
                await Execution.delayTicks(2);
            }
            return;
        }
        this.unreachableStreak = 0;

        this.bot.setStatus(`pickpocketing ${TARGET} at ${target.tile()}`);
        const xpBefore = Skills.xp('thieving');
        const usedBefore = Inventory.used();
        if (!(await target.interact(PICKPOCKET_OP))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(
            () => Skills.xp('thieving') > xpBefore || Inventory.used() > usedBefore || ChatDialog.canContinue() || this.bot.stunned() || Skills.hpFraction() < EAT_AT,
            2500
        );
        if (Skills.xp('thieving') > xpBefore) {
            this.bot.countSteal();
            this.bot.log(`pickpocketed ${TARGET}`);
            return;
        }
        if (this.bot.stunned()) {
            await Execution.delayUntil(() => !this.bot.stunned() || Skills.hpFraction() < EAT_AT, 8000);
        }
    }
}

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
