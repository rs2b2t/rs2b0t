import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { depositMatcher } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { Traversal } from '../api/Traversal.js';
import { walkOpening } from '../api/walkOpening.js';
import { EventSignal } from '../api/EventSignal.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { matchesAny, shouldEat } from './ArdyFighterLogic.js';
import { HOSTILE_NAMES, isHostileAttacker } from './ArdyThieverLogic.js';
import { CAKE_ITEMS, LOCKOUT_TICKS, STAND } from './CakeStallLogic.js';
import { carriedCakes, stealCakes } from './CakeStall.js';

// East Ardougne layout — baked in (see the 2026-07-20 cakethiever design).
// The bot lives on the golden stand; everything else is a short fixed walk.
const BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
// Kite tile SW of the market — far enough to drag a guard off the stall and
// break its melee (proven by ArdyThiever's Flee).
const FLEE_TILE = new Tile(2655, 3298, 0);
// Market-local boundary: covers the stand AND the south bank (cheb 26 apart),
// so bank trips never fight ReturnToStall for control.
const MARKET_RADIUS = 40;
const OBSTACLE = ['door', 'gate'];
const ENGAGE_RADIUS = 5;

/** minutes -> h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const SETTINGS: SettingsSchema = {
    guardResponse: { type: 'string', default: 'Flee', options: ['Flee', 'Fight'], label: 'Guard response', help: 'caught at the stall: Flee kites the guard off the market; Fight kills it (bring combat stats)' },
    eatAtHp: { type: 'number', default: 40, min: 0, max: 100, label: 'Eat below HP%', help: 'eats the stolen cakes — they are free' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank common junk too' }
};

// Active run config (ADR-0006 single-script module state).
let RESPONSE = 'Flee';
let EAT_AT = 0.4;
let EAT_TO = 0.9;
let BANK_COMMON = true;

function nearMarket(): boolean {
    const here = Game.tile();
    return here !== null && STAND.distanceTo(here) <= MARKET_RADIUS;
}

/**
 * Baker's-stall cake thiever. Stands on THE stand (2668,3312), steals cakes
 * via the shared outcome-classified driver (no Baker line-of-sight
 * prediction — refusals are free; a streak resets nearby until he drifts),
 * banks full packs at the south bank, and answers a guard catch with Flee
 * (kite) or Fight per the guardResponse setting. Thieving 5 required.
 */
export default class CakeThiever extends TaskBot {
    override loopDelay = 600;

    private steals = 0;
    private resets = 0;
    private eats = 0;
    private banked = 0;
    private trips = 0;
    private flees = 0;
    private kills = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private combatEndTick = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        RESPONSE = this.settings.str('guardResponse', 'Flee');
        EAT_AT = this.settings.num('eatAtHp', 40) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('thieving');

        if (Skills.level('thieving') < 5) {
            this.log(`CakeThiever needs Thieving 5 for the Baker's stall (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error('CakeThiever: Thieving 5 required');
        }

        this.log(`CakeThiever starting — stand ${STAND}, bank ${BANK_STAND}, ${RESPONSE.toLowerCase()} mode`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: STAND,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            ...(RESPONSE === 'Fight' ? [new FightBack(this)] : [new Flee(this)]),
            new EatCake(this),
            new BankRun(this),
            new StealCakes(this),
            new ReturnToStall(this)
        );
    }

    override grindTargets(): string[] {
        // In Fight mode the retaliating market hostiles are legitimate targets,
        // not random events; harmless in Flee mode (we never attack them).
        return HOSTILE_NAMES.map(n => n.toLowerCase());
    }
    override recoveryAnchor(): Tile | null {
        return STAND;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#f2a6c9' });
        p.title(`CakeThiever — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('thieving') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        const sph = mins > 0.5 ? `${Math.round((this.steals / mins) * 60)}` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Steals: ${this.steals}`, `Steals/hr: ${sph}`);
        p.row(`XP/hr: ${xph}`, `Carried: ${carriedCakes()}`, `Banked: ${this.banked}`);
        p.row(`Resets: ${this.resets}`, RESPONSE === 'Fight' ? `Fought: ${this.kills}` : `Fled: ${this.flees}`, `Trips: ${this.trips}`);
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
    /** Called by Flee/FightBack the moment combat clears — feeds the driver's
     *  10-tick engine lockout so the first post-fight click isn't wasted. */
    markCombatEnd(): void { this.combatEndTick = Game.tick(); }
    lockedOutUntil(): number { return this.combatEndTick + LOCKOUT_TICKS; }
    countSteal(): void { this.steals++; }
    countReset(): void { this.resets++; }
    countEat(): void { this.eats++; }
    countBanked(n: number): void { this.banked += n; }
    countTrip(): void { this.trips++; }
    countFlee(): void { this.flees++; }
    countKill(): void { this.kills++; }
}

/** Flee mode: on any combat, kite the guard to the fixed SW tile (drags it off
 *  the stall + breaks melee), wait out combat, record the end tick for the
 *  driver's lockout. ArdyThiever's proven shape, minus its pickpocket-stun
 *  ambiguity — CakeThiever never pickpockets, so combat is always real. */
class Flee implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean { return Game.inCombat(); }
    async execute(): Promise<void> {
        this.bot.setStatus(`kiting the guard to ${FLEE_TILE.x},${FLEE_TILE.z}`);
        this.bot.log(`combat — kiting the guard to ${FLEE_TILE.x},${FLEE_TILE.z}`);
        this.bot.countFlee();
        await walkOpening(FLEE_TILE, 0, OBSTACLE, m => this.bot.log(`  ${m}`));
        await Execution.delayUntil(() => !Game.inCombat(), 15000);
        if (!Game.inCombat()) {
            this.bot.markCombatEnd();
        }
    }
}

/** Fight mode: kill the market hostile that caught us (auto-retaliate-proof —
 *  attacks explicitly). ArdyThiever's FightBack shape with cake-eating gates. */
class FightBack implements Task {
    constructor(private bot: CakeThiever) {}
    private findAttacker(): Npc | null {
        return Npcs.query()
            .where(n => isHostileAttacker({ name: n.name, inCombat: n.inCombat, distance: n.distance(), actions: n.actions(), targetsAnotherPlayer: n.targetsAnotherPlayer() }, ENGAGE_RADIUS))
            .nearest();
    }
    private track(engaged: Npc): Npc | null {
        return Npcs.all().find(n => n.index === engaged.index && n.name === engaged.name) ?? null;
    }
    validate(): boolean { return Game.inCombat(); }
    async execute(): Promise<void> {
        const attacker = this.findAttacker();
        if (!attacker) {
            await Execution.delayTicks(2);
            if (!Game.inCombat()) {
                this.bot.markCombatEnd();
            }
            return;
        }
        this.bot.setStatus(`fighting back: ${attacker.name} at ${attacker.tile()}`);
        this.bot.log(`combat — fighting back against ${attacker.name}`);
        if (!(await attacker.interact('Attack'))) { await Execution.delayTicks(2); return; }
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) { return; }
            if (shouldEat(Skills.hpFraction(), EAT_AT, carriedCakes())) {
                return; // EatCake outranks us next loop; combat resumes after
            }
            const target = this.track(attacker);
            if (!target || (target.health === 0 && target.snap.totalHealth > 0)) {
                if (target) {
                    await Execution.delayUntil(() => this.track(attacker) === null, 10_000);
                }
                this.bot.countKill();
                this.bot.log(`killed the ${attacker.name}`);
                this.bot.markCombatEnd();
                return;
            }
            if (!Game.inCombat() && !target.inCombat) {
                this.bot.markCombatEnd();
                return;
            }
            await Execution.delayTicks(2);
        }
    }
}

/** Eat stolen cakes below the gate up to the eat-to target — they're free. */
class EatCake implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean { return shouldEat(Skills.hpFraction(), EAT_AT, carriedCakes()); }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) { return; }
            if (Skills.hpFraction() >= EAT_TO || carriedCakes() === 0) { return; }
            const food = Inventory.items().find(i => matchesAny(i.name, CAKE_ITEMS));
            if (!food) { return; }
            this.bot.setStatus(`eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
            const before = Skills.effective('hitpoints');
            if (!(await food.interact('Eat'))) { return; }
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before || carriedCakes() === 0, 3000);
            if (Skills.effective('hitpoints') > before) { this.bot.countEat(); }
        }
    }
}

/** Full pack -> south bank: deposit the cakes (+ common junk), walk back. */
class BankRun implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean { return nearMarket() && !Game.inCombat() && Inventory.isFull(); }
    async execute(): Promise<void> {
        this.bot.setStatus('banking the cakes');
        await Traversal.walkTo(BANK_STAND, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        const before = carriedCakes();
        await Bank.depositAllMatching(depositMatcher(name => matchesAny(name, CAKE_ITEMS), BANK_COMMON), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        const shed = before - carriedCakes();
        this.bot.countBanked(Math.max(0, shed));
        this.bot.log(`banked ${shed} cakes${shed <= 0 ? ' (nothing deposited!)' : ''}`);
        this.bot.countTrip();
        this.bot.setStatus('heading back to the stall');
        await Traversal.walkResilient(STAND, { radius: 1, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** The main loop: run the shared steal driver until the pack fills. */
class StealCakes implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean {
        return nearMarket() && !Game.inCombat() && !Inventory.isFull() && !this.bot.died;
    }
    async execute(): Promise<void> {
        const result = await stealCakes({
            fillTo: 28, // Inventory.isFull() is the real stop; 28 = never early
            abort: () => this.bot.died || EventSignal.pending() || ChatDialog.canContinue(),
            shouldEat: () => shouldEat(Skills.hpFraction(), EAT_AT, carriedCakes()),
            lockedOutUntil: () => this.bot.lockedOutUntil(),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            onSteal: () => this.bot.countSteal(),
            onReset: () => this.bot.countReset()
        });
        if (result === 'combat') {
            this.bot.log('guard caught the steal — handling per guardResponse');
        } else if (result === 'no-progress') {
            this.bot.log('steal pass made no progress — re-entering');
        }
    }
}

/** Start-anywhere travel + displacement recovery (ArdyThiever shape). */
class ReturnToStall implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && STAND.distanceTo(here) > MARKET_RADIUS;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the Baker\'s stall');
        const here = Game.tile();
        if (here && STAND.distanceTo(here) > 30) {
            await Traversal.walkResilient(STAND, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
        }
        await walkOpening(STAND, 2, OBSTACLE, m => this.bot.log(m));
    }
}
