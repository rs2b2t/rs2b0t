import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { COMBAT_STYLE_OPTIONS, describeCombatStyle, parseCombatStyle, type MeleeCombatStyle } from '../api/CombatStyle.js';
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
import { matchesEntityName } from '../api/queries/Query.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import Tile from '../api/Tile.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic, slotsMatching } from './ArdyFighterLogic.js';
import {
    autoBankEnabled,
    BANKING_OPTIONS,
    CUSTOM_COORDINATES,
    DEFAULT_CUSTOM_SPOT,
    DEFAULT_LOOT,
    resolveKillingSpot,
    SPOT_OPTIONS,
    START_POSITION
} from './AutoFighterData.js';
import { SolveClue } from '../clues/SolveClue.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { Reach } from '../api/Reach.js';
import { RANDOM_EVENT_CASKET_ID } from '../api/Banking.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const KIT = ['spade', 'sextant', 'watch', 'chart'];
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'];

export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Guard', label: 'Target NPC name', help: 'exact in-game name, e.g. Guard, Chicken, or Moss giant' },
    spot: { type: 'string', default: START_POSITION, options: SPOT_OPTIONS, label: 'Killing spot', help: 'use the tile where the script starts, or walk to custom coordinates' },
    coordinates: { type: 'tile', default: DEFAULT_CUSTOM_SPOT, label: 'Killing coordinates (x,z)', showIf: { key: 'spot', anyOf: [CUSTOM_COORDINATES] } },
    leashRadius: { type: 'number', default: 8, min: 2, max: 30, label: 'Leash radius (tiles)' },
    combatStyle: { type: 'string', default: 'strength', options: COMBAT_STYLE_OPTIONS, label: 'Combat style' },
    food: { type: 'string', default: 'Trout', label: 'Food (withdrawn from bank)' },
    foodWithdraw: { type: 'number', default: 10, min: 0, max: 27, label: 'Food to carry' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    loot: { type: 'string[]', default: DEFAULT_LOOT, label: 'Loot item names (contains)', help: 'defaults to gem-table items + clue scrolls, nothing else' },
    solveClues: { type: 'boolean', default: true, label: 'Solve clue drops', group: 'Clues' },
    banking: { type: 'string', default: 'Auto', options: BANKING_OPTIONS, label: 'Banking', help: 'Auto = bank loot at the nearest bank and return; None = no loot-only bank trips' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots', showIf: { key: 'banking', anyOf: ['Auto'] } },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank common junk too' }
};

let TARGET = 'Guard';
let ANCHOR = DEFAULT_CUSTOM_SPOT;
let LEASH = 8;
let FOOD = 'Trout';
let FOOD_WITHDRAW = 10;
let EAT_AT = 0.5;
let EAT_TO = 0.9;
let PANIC_AT = 0.25;
let LOOT = DEFAULT_LOOT;
let SOLVE_CLUES = true;
let BANK_AT = 12;
let AUTO_BANK = true;
let BANK_COMMON = true;
let COMBAT_STYLE: MeleeCombatStyle = 'strength';

function foodCount(): number {
    return countMatching(Inventory.items(), [FOOD]);
}
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

export function shouldKeepBankItem(name: string, id: number, food: string, bankCommon: boolean): boolean {
    const n = name.toLowerCase();
    const genericCasket = id === RANDOM_EVENT_CASKET_ID;
    return matchesAny(name, [food]) || n === 'coins' || KIT.includes(n) || n.includes('clue')
        || (n.includes('casket') && !genericCasket) || (genericCasket && !bankCommon);
}

export default class AutoFighter extends TaskBot {
    override loopDelay = 600;

    private kills = 0;
    private looted = 0;
    private eats = 0;
    private trips = 0;
    private deaths = 0;
    private cluesSolved = 0;
    private solveClue: SolveClue | undefined;
    bankAfterSolve = false;
    bankFoodEmpty = false;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        TARGET = this.settings.str('target', 'Guard').trim() || 'Guard';
        const spotMode = this.settings.str('spot', START_POSITION);
        ANCHOR = resolveKillingSpot(spotMode, Tile.from(Game.tile()!), this.settings.tile('coordinates', DEFAULT_CUSTOM_SPOT));
        LEASH = this.settings.num('leashRadius', 8);
        FOOD = this.settings.str('food', 'Trout');
        FOOD_WITHDRAW = this.settings.num('foodWithdraw', 10);
        EAT_AT = this.settings.num('eatAtHp', 50) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        LOOT = this.settings.list('loot', DEFAULT_LOOT).map(s => s.trim().toLowerCase());
        SOLVE_CLUES = this.settings.bool('solveClues', true);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        AUTO_BANK = autoBankEnabled(this.settings.str('banking', 'Auto'));
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);
        COMBAT_STYLE = parseCombatStyle(this.settings.str('combatStyle', 'strength'));

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
        this.log(`AutoFighter starting — '${TARGET}' at ${spotMode} ${ANCHOR} r${LEASH}, banking ${AUTO_BANK ? 'auto' : 'none'}, food '${FOOD}'x${FOOD_WITHDRAW}, loot [${LOOT.join(', ')}]`);

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
            this.solveClue!,
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
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    countKill(): void { this.kills++; }
    countLoot(): void { this.looted++; }
    countEat(): void { this.eats++; }
    countTrip(): void { this.trips++; }
}

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
        const id = drop.id;
        const tile = drop.tile();
        const find = () => GroundItems.query()
            .where(item => item.id === id && item.tile().equals(tile))
            .nearest();
        const before = countMatching(Inventory.items(), LOOT);
        const status = await Reach.entityOp({
            find,
            op: 'Take',
            expect: () => countMatching(Inventory.items(), LOOT) > before,
            expectMs: 5000,
            what: drop.name ?? 'loot',
            log: message => this.bot.log(message)
        });
        if (status === 'done' && countMatching(Inventory.items(), LOOT) > before) {
            this.bot.countLoot();
        }
    }
}

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

class BankRun implements Task {
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        if (Game.inCombat()) {
            return false;
        }
        if (foodCount() > 0) {
            this.bot.bankFoodEmpty = false;
        }
        return this.bot.bankAfterSolve || (AUTO_BANK && shouldBank(lootSlots(), BANK_AT, Inventory.isFull()))
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
            return;
        }
        if (!(await Bank.openNearest(BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            return;
        }
        await Bank.depositAllMatching((name, id) => !shouldKeepBankItem(name, id, FOOD, BANK_COMMON), m => this.bot.log(`  ${m}`));
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

class SetStyle implements Task {
    private announced = false;
    constructor(private bot: AutoFighter) {}
    validate(): boolean {
        return !Game.inCombat() && !Game.hasCombatStyle(COMBAT_STYLE);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        Game.setCombatStyle(COMBAT_STYLE);
        const ok = await Execution.delayUntil(() => Game.hasCombatStyle(COMBAT_STYLE), 3000);
        const resolution = Game.combatStyleResolution(COMBAT_STYLE);
        if (ok && resolution && !this.announced) {
            this.announced = true;
            this.bot.log(`combat style: ${describeCombatStyle(resolution)}`);
        }
    }
}

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
        return Npcs.all().find(n => n.index === engaged.index && matchesEntityName(n.name, TARGET)) ?? null;
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
        const status = await Reach.entityOp({
            find: () => this.track(target),
            op: 'Attack',
            expect: () => Game.inCombat() || ChatDialog.canContinue(),
            expectMs: 5000,
            what: TARGET,
            log: message => this.bot.log(message)
        });
        if (status !== 'done' || ChatDialog.canContinue()) {
            return;
        }
        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) {
                return;
            }
            if (shouldEat(Skills.hpFraction(), EAT_AT, foodCount()) || Skills.hpFraction() < PANIC_AT) {
                return;
            }
            const cur = this.track(target);
            if (!cur || (cur.health === 0 && cur.snap.totalHealth > 0)) {
                if (cur) {
                    await Execution.delayUntil(() => this.track(target) === null, 10_000);
                }
                this.bot.countKill();
                await Execution.delayTicks(2);
                return;
            }
            if (!Game.inCombat() && !cur.inCombat) {
                return;
            }
            await Execution.delayTicks(2);
        }
    }
}

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
