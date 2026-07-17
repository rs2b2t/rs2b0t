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
import { Locs } from '../api/queries/Locs.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { ARDOUGNE_PICKPOCKET_TARGETS } from './PickpocketTargets.js';
import { chooseTarget, isHostileAttacker, requiredThieving, targetSpot } from './ArdyThieverLogic.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic, slotsMatching } from './ArdyFighterLogic.js';

// East Ardougne market layout — baked in, not settings. Tiles were live-tuned
// in the original bot; per-target anchors come from the packed spawn data (see
// ArdyThieverLogic + the 2026-07-12 design spec). Start the bot anywhere:
// ReturnToAnchor travels to the target's spot.
const STALL_TILE = new Tile(2667, 3310, 0);
// The stall sits behind a counter (like a bank booth), so we can't stand on it —
// walk ONTO this reachable tile beside it and steal from there.
const STALL_STAND = new Tile(2668, 3312, 0);
const STALL_NAME = 'Baker\'s stall';
const BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const STALL_OP = 'Steal from';
const PICKPOCKET_OP = 'Pickpocket';
// On any real combat (a guard caught us stealing from the stall), flee mode
// runs to this fixed tile SW of the market — far enough to drag the guard off
// the stall and break its melee, so the stall clears for the next restock.
const FLEE_TILE = new Tile(2655, 3298, 0);
// A failed pickpocket damages you (health bar shows -> Game.inCombat() true) AND
// stuns you — the target does NOT enter combat (engine: fail_pick_pocket ends on
// npc_setmode(null)). So a caught pickpocket looks like "combat" for as long as
// the health bar lingers: combatCycle = loopCycle + 400, shown while within 300
// client cycles ≈ 6s ≈ 10 server ticks at 50fps. Suppress Flee for a slightly
// longer window (headroom for frame-rate dips) after each stun so a normal miss
// isn't mistaken for a real attacker. Genuine combat never emits a stun message,
// so it still flees once the window lapses.
// A failed pickpocket freezes us for the target's stun_ticks (content
// pickpocket.dbrow — 8 ticks / ~4.8s for every Ardougne market target). We
// suppress Flee/FightBack for exactly that window (so a normal miss isn't
// read as a real attacker) and use it to re-attempt the INSTANT the stun
// clears. It was 17 (~10s) — more than double the real stun — which both
// delayed the next steal and blinded us to a genuine attacker for ~5s too long.
const STUN_COMBAT_TICKS = 8; // matches the engine freeze; the "been stunned" chat lands ~1 tick in, so stunned() clears ~1 tick AFTER the real freeze — late enough not to re-fire mid-freeze, tight enough not to idle
// How close an in-combat market hostile must be to count as "the one attacking
// us" — melee attackers stand adjacent; 5 gives slack for a pathing hostile.
const ENGAGE_RADIUS = 5;
const OBSTACLE = ['door', 'gate'];
// What the Baker's stall gives (content stealing.dbrow) — also what PanicRetreat
// withdraws if the bank holds any.
const FOOD = ['cake', 'bread', 'chocolate slice'];
// Pickpocket loot across all four targets (content pickpocket.dbrow: coins for
// all; Paladin +chaos runes; Hero +death/blood runes, wine, fire orb, gold ore)
// plus guard drops for fight mode (clue, body talisman, steel arrows, runes,
// iron ore). Gems bank via the shared common-junk list.
const LOOT = ['coins', 'chaos rune', 'death rune', 'blood rune', 'nature rune', 'jug of wine', 'fire orb', 'gold ore', 'clue scroll', 'body talisman', 'steel arrow', 'iron ore'];
const TARGET_OPTIONS = ARDOUGNE_PICKPOCKET_TARGETS;

/** minutes → h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

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
    ...PERIODIC_BANK_SETTINGS
};

// Active run config (ADR-0006 single-script module state).
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

function foodCount(): number {
    return countMatching(Inventory.items(), FOOD);
}
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

/** Inside ReturnToAnchor's boundary (LEASH+6 of the anchor) — the market-local
 *  tasks (restock/bank/panic) only run here, so beyond it ReturnToAnchor owns
 *  the travel with the resilient walker. Without this gate a zero-food restock
 *  fired from ANYWHERE and preempted ReturnToAnchor forever with a plain 60s
 *  walk it could never finish (cost-621 route looping 'walk timed out' live). */
function nearMarket(): boolean {
    const here = Game.tile();
    return here !== null && ANCHOR.distanceTo(here) <= LEASH + 6;
}

/**
 * East Ardougne market pickpocket bot. Start it anywhere — it walks to the
 * chosen target's market spot (baked-in layout; nothing to place). Fills up on
 * cake from the Baker's stall, pickpockets the target (Guard/Knight/Paladin/
 * Hero), eats below a threshold, refills cake when low, banks loot + the
 * shared junk list, grabs ground coins. A guard that catches the stall theft
 * is fled (kited off the stall) or fought, per the guardResponse setting.
 */
export default class ArdyThiever extends TaskBot {
    override loopDelay = 600;

    private steals = 0;
    private eats = 0;
    private looted = 0;
    private trips = 0;
    private flees = 0;
    private kills = 0;
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

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('thieving');

        // Gate on the target's pickpocket requirement (subsumes the stall's
        // Thieving 5 — every market target needs 40+): stop with a clear
        // message instead of spamming failed pickpockets.
        const need = requiredThieving(TARGET);
        if (Skills.level('thieving') < need) {
            this.log(`ArdyThiever needs Thieving ${need} to pickpocket ${TARGET} (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error(`ArdyThiever: Thieving ${need} required`);
        }

        this.log(`ArdyThiever starting — target '${TARGET}' at ${ANCHOR} r${LEASH} (Thieving ${need}+), ${RESPONSE.toLowerCase()} mode, stall ${STALL_TILE}, bank ${BANK_STAND}`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
            // a caught pickpocket stuns us and shows the health bar (looks like
            // combat) — mark the stun so Flee ignores the self-inflicted hit.
            if (/been stunned|fail to pick/i.test(e.text)) {
                this.stunnedUntilTick = Game.tick() + STUN_COMBAT_TICKS;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: ANCHOR,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            ...(RESPONSE === 'Fight' ? [] : [new Flee(this)]),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
            ...(RESPONSE === 'Fight' ? [new FightBack(this)] : []),
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

    /** Live target switch from the paint — level-gated; the anchor/leash move
     *  with the target and ReturnToAnchor walks us to the new market spot. */
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
    /** True while a recent thieving stun still explains Game.inCombat() (a caught
     *  pickpocket, not a real attacker). Public so Pickpocket can wait EXACTLY
     *  until the stun clears before re-attempting. */
    stunned(): boolean { return this.inThievingStun(); }
    private inThievingStun(): boolean { return Game.tick() <= this.stunnedUntilTick; }
    /** In combat with an actual attacker — the self-inflicted pickpocket-fail
     *  stun (which also shows the health bar) does NOT count. Every task that
     *  pauses "while in combat" gates on this so a normal miss neither flees nor
     *  freezes the loop. */
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

/** A low-level thief never trades hits: on a REAL attack (a guard that caught us
 *  stealing from the stall), run to the fixed kite tile — far enough to drag the
 *  guard off the stall and break its melee — then wait out combat. Uses the same
 *  door-opening market walk as the bot's other navigation so it doesn't snag on a
 *  market gate en route. Highest non-recovery priority. A caught pickpocket also
 *  shows the health bar, but that self-inflicted stun is not combat —
 *  inThievingStun() keeps us from fleeing a normal miss (we're stunned in place
 *  anyway). */
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

/** Fight mode: kill the guard that caught us instead of kiting it. Triggers on
 *  the same inRealCombat() signal as Flee (the pickpocket-stun suppression is
 *  load-bearing — a failed pickpocket must NOT start a fight). Registered
 *  BELOW EatFood/PanicRetreat so the eat ladder outranks the fight, and above
 *  the bank/restock/pickpocket tasks so nothing else runs mid-combat. Attacks
 *  explicitly (robust even with auto-retaliate off); a second attacker (the
 *  Baker can alert several) is picked up by revalidation after the first kill. */
class FightBack implements Task {
    constructor(private bot: ArdyThiever) {}
    private findAttacker(): Npc | null {
        return Npcs.query()
            .where(n => isHostileAttacker({ name: n.name, inCombat: n.inCombat, distance: n.distance(), actions: n.actions() }, ENGAGE_RADIUS))
            .nearest();
    }
    private track(engaged: Npc): Npc | null {
        return Npcs.all().find(n => n.index === engaged.index && n.name === engaged.name) ?? null;
    }
    validate(): boolean { return this.bot.inRealCombat(); }
    async execute(): Promise<void> {
        const attacker = this.findAttacker();
        if (!attacker) {
            // combat flag with no visible aggressor (it died, or the health bar
            // is lingering) — idle a moment; tasks resume once combat clears
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
                return; // EatFood / PanicRetreat outrank us next loop
            }
            // No displaced-mid-fight leash bail (unlike ArdyFighter's Fight): as the responder the attacker is already adjacent, and any runtime-event displacement is caught by EventSignal.pending() above.
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
                return; // both disengaged — over; revalidation handles re-aggro
            }
            await Execution.delayTicks(2);
        }
    }
}

/** Grab wanted ground drops (coins by default) within the leash — reachable
 *  piles only. Confirmed by quantity (coins stack into one slot). */
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

/** Eat below the gate up to the eat-to target (standard mechanic). */
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

/** Out of food + very low HP: retreat to the bank, withdraw food or wait out regen. */
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

/** Bank loot (+ shared junk) once it fills enough slots. */
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
        await Bank.depositAllMatching(depositMatcher(name => matchesAny(name, LOOT), BANK_COMMON));
        await Execution.delayTicks(1);
        this.bot.countTrip();
        this.bot.setStatus('heading back');
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Fill cake to FOOD_TARGET once food drops to/below RESTOCK_AT (low-water
 *  trigger, high-water fill — so it doesn't shuttle to the stall on every dip). */
class RestockCakes implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean {
        return nearMarket() && !this.bot.inRealCombat() && !Inventory.isFull() && foodCount() <= RESTOCK_AT;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        this.bot.log(`restocking cake (have ${foodCount()})`);
        // Stand on the dedicated stand tile beside the stall and steal from there.
        // A theft caught by the Baker just pulls a guard — the Flee task kites it.
        const here = Game.tile();
        if (!here || STALL_STAND.distanceTo(here) > 0) {
            await Traversal.walkTo(STALL_STAND, { radius: 0, timeoutMs: 60000, log: m => this.bot.log(`  ${m}`) });
        }
        const deadline = performance.now() + 60000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue() || this.bot.inRealCombat()) { return; }
            if (Inventory.isFull() || foodCount() >= FOOD_TARGET) {
                this.bot.log(`stocked ${foodCount()} food`);
                return;
            }
            if (shouldEat(Skills.hpFraction(), EAT_AT, foodCount())) { return; }
            const stall = Locs.query()
                .name(STALL_NAME)
                .action(STALL_OP)
                .where(l => l.tile().distanceTo(STALL_TILE) <= 3)
                .nearest();
            if (!stall) { await Execution.delayTicks(2); continue; }
            const before = foodCount();
            if (!(await stall.interact(STALL_OP))) { await Execution.delayTicks(2); continue; }
            const got = await Execution.delayUntil(() => foodCount() > before || Game.inCombat(), 4000);
            if (got && foodCount() > before) { this.bot.countSteal(); }
        }
    }
}

/** Pickpocket the target while we have food. Success = thieving XP/slot gain;
 *  failure = stun waited out. Combat (a retaliating guard) is handled by Flee. */
class Pickpocket implements Task {
    /** consecutive executes where no in-leash target was reachable — bounds the
     *  path-clear so an un-openable fenced-off wanderer can't wedge us. */
    private unreachableStreak = 0;

    constructor(private bot: ArdyThiever) {}

    /** In-leash targets offering the pickpocket op, nearest first. */
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
        // Reachability-aware: pick the nearest target we can actually stand next
        // to. Fixating on the nearest regardless (the old find().nearest()) is
        // what wedged the bot when the closest knight wandered to a fenced market
        // edge — it looped on walkOpening while reachable knights stood ignored.
        const { target, blocked } = chooseTarget(this.candidates(), n => Reachability.canReach(n.tile(), { adjacentOk: true }));

        if (!target) {
            // Nothing reachable. Try ONE bounded path-clear toward the nearest
            // (covers a genuinely walled-off target / us boxed in a shop), then
            // stop and let it wander back — a fence has no door to open, and
            // grinding walkOpening on it for minutes is the reported "stuck".
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
        // Resolve the attempt: a SUCCESS lands thieving xp/loot within a tick or
        // two; a FAILURE stuns us (chat sets stunned()). Poll briefly for either.
        await Execution.delayUntil(
            () => Skills.xp('thieving') > xpBefore || Inventory.used() > usedBefore || ChatDialog.canContinue() || this.bot.stunned() || Skills.hpFraction() < EAT_AT,
            2500
        );
        if (Skills.xp('thieving') > xpBefore) {
            this.bot.countSteal();
            this.bot.log(`pickpocketed ${TARGET}`);
            return;
        }
        // Stunned: wait EXACTLY until it clears (or HP forces an eat), then return
        // so the next loop re-attempts immediately — no blind idle after the stun.
        // Re-firing opnpc mid-stun is dropped by the engine, so don't; just wait
        // out the real 8-tick freeze precisely instead of a fixed 3s guess.
        if (this.bot.stunned()) {
            await Execution.delayUntil(() => !this.bot.stunned() || Skills.hpFraction() < EAT_AT, 8000);
        }
    }
}

/** Travel task: covers both start-anywhere (launched across the map) and
 *  displacement recovery. Long hauls web-walk first (ArdyFighter's proven
 *  shape); the final market approach always runs walkOpening so a shut market
 *  door/gate can't wedge the arrival. */
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
