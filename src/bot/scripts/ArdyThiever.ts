import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import Tile from '../api/Tile.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { PeriodicBank } from '../api/tasks/PeriodicBank.js';
import { PERIODIC_BANK_SETTINGS, parseBankStrategy, depositMatcher } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Traversal } from '../api/Traversal.js';
import { walkOpening } from '../api/walkOpening.js';
import { EventSignal } from '../api/EventSignal.js';
import { Locs } from '../api/queries/Locs.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs } from '../api/queries/Npcs.js';
import { ARDOUGNE_PICKPOCKET_TARGETS } from './PickpocketTargets.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic, slotsMatching } from './ArdyFighterLogic.js';

// East Ardougne, shared with ArdyFighter. Pickpocket targets (Thieving req):
// Guard 40, Knight of Ardougne 55, Hero 80 — all in/near the market. Baker's
// stall feeds the bot; it FLEES any combat (can't fight guards).
const DEFAULT_ANCHOR = new Tile(2661, 3306, 0);
const DEFAULT_STALL = new Tile(2667, 3310, 0);
// The stall sits behind a counter (like a bank booth), so we can't stand on it —
// walk ONTO this reachable tile beside it and steal from there.
const DEFAULT_STALL_STAND = new Tile(2668, 3312, 0);
const DEFAULT_BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const STALL_OP = 'Steal from';
const PICKPOCKET_OP = 'Pickpocket';
// On any real combat (a guard caught us stealing from the stall), run to this
// fixed tile SW of the market — far enough to drag the guard off the stall and
// break its melee, so the stall clears for the next restock.
const DEFAULT_FLEE_TILE = new Tile(2655, 3298, 0);
// A failed pickpocket damages you (health bar shows -> Game.inCombat() true) AND
// stuns you — the target does NOT enter combat (engine: fail_pick_pocket ends on
// npc_setmode(null)). So a caught pickpocket looks like "combat" for as long as
// the health bar lingers: combatCycle = loopCycle + 400, shown while within 300
// client cycles ≈ 6s ≈ 10 server ticks at 50fps. Suppress Flee for a slightly
// longer window (headroom for frame-rate dips) after each stun so a normal miss
// isn't mistaken for a real attacker. Genuine combat never emits a stun message,
// so it still flees once the window lapses.
const STUN_COMBAT_TICKS = 17;
const DEFAULT_FOOD = 'cake, bread, chocolate slice';
const DEFAULT_LOOT = 'coins';
const TARGET_OPTIONS = ARDOUGNE_PICKPOCKET_TARGETS;

export const SETTINGS: SettingsSchema = {
    thieveTarget: { type: 'string', default: 'Guard', options: TARGET_OPTIONS, label: 'Pickpocket target' },
    anchor: { type: 'tile', default: DEFAULT_ANCHOR, label: 'Thieving anchor (x,z)', help: 'stand near your target; place it yourself for Knight/Hero spots' },
    leashRadius: { type: 'number', default: 12, min: 5, max: 25, label: 'Leash radius (tiles)' },
    stallTile: { type: 'tile', default: DEFAULT_STALL, label: 'Baker\'s stall (x,z)' },
    stallStand: { type: 'tile', default: DEFAULT_STALL_STAND, label: 'Stall stand tile (x,z)', help: 'reachable tile beside the stall to steal from (the stall itself is behind a counter)' },
    stallName: { type: 'string', default: 'Baker\'s stall', label: 'Stall loc name' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    stallFleeTile: { type: 'tile', default: DEFAULT_FLEE_TILE, label: 'Flee/kite tile (x,z)', help: 'run here on any guard combat to kite the guard away from the stall' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'open the nearest of these when a target is walled off' },
    food: { type: 'string[]', default: DEFAULT_FOOD.split(',').map(s => s.trim()), label: 'Food names (contains)' },
    eatAtHp: { type: 'number', default: 40, min: 0, max: 100, label: 'Eat below HP%' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    panicHp: { type: 'number', default: 25, min: 0, max: 100, label: 'Panic below HP% (no food)' },
    restUntilHp: { type: 'number', default: 60, min: 0, max: 100, label: 'Regen to HP% when bank empty' },
    foodTarget: { type: 'number', default: 22, min: 1, max: 27, label: 'Fill food to (count)' },
    restockAtFood: { type: 'number', default: 3, min: 0, max: 26, label: 'Restock when food drops to' },
    bankAtLootSlots: { type: 'number', default: 12, min: 1, max: 27, label: 'Bank at loot slots' },
    loot: { type: 'string[]', default: DEFAULT_LOOT.split(',').map(s => s.trim()), label: 'Loot names (contains)' },
    ...PERIODIC_BANK_SETTINGS
};

// Active run config (ADR-0006 single-script module state).
let ANCHOR = DEFAULT_ANCHOR;
let LEASH = 12;
let TARGET = 'Guard';
let STALL_TILE = DEFAULT_STALL;
let STALL_STAND = DEFAULT_STALL_STAND;
let STALL_NAME = 'Baker\'s stall';
let BANK_STAND = DEFAULT_BANK_STAND;
let FLEE_TILE = DEFAULT_FLEE_TILE;
let OBSTACLE: string[] = ['door', 'gate'];
let FOOD = DEFAULT_FOOD.split(',').map(s => s.trim().toLowerCase());
let LOOT = DEFAULT_LOOT.split(',').map(s => s.trim().toLowerCase());
let EAT_AT = 0.4;
let EAT_TO = 0.9;
let PANIC_AT = 0.25;
let REST_UNTIL = 0.6;
let FOOD_TARGET = 22;
let RESTOCK_AT = 3;
let BANK_AT = 12;
let BANK_COMMON = true;

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
}
function foodCount(): number {
    return countMatching(Inventory.items(), FOOD);
}
function lootSlots(): number {
    return slotsMatching(Inventory.items(), LOOT);
}

/**
 * East Ardougne low-level pickpocket bot. Fills up on cake from the Baker's
 * stall, then pickpockets the chosen target (Guard/Knight/Hero), eating below a
 * threshold and refilling cake when it runs low. It never fights: any combat
 * triggers a flee. Banks loot + the shared junk list; grabs ground coins.
 */
export default class ArdyThiever extends TaskBot {
    override loopDelay = 600;

    private steals = 0;
    private eats = 0;
    private looted = 0;
    private trips = 0;
    private flees = 0;
    private status = 'starting';
    private stunnedUntilTick = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        TARGET = this.settings.str('thieveTarget', 'Guard');
        ANCHOR = this.settings.tile('anchor', DEFAULT_ANCHOR);
        LEASH = this.settings.num('leashRadius', 12);
        STALL_TILE = this.settings.tile('stallTile', DEFAULT_STALL);
        STALL_STAND = this.settings.tile('stallStand', DEFAULT_STALL_STAND);
        STALL_NAME = this.settings.str('stallName', 'Baker\'s stall');
        BANK_STAND = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        FLEE_TILE = this.settings.tile('stallFleeTile', DEFAULT_FLEE_TILE);
        OBSTACLE = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        FOOD = this.settings.list('food', FOOD).map(s => s.toLowerCase());
        LOOT = this.settings.list('loot', LOOT).map(s => s.toLowerCase());
        EAT_AT = this.settings.num('eatAtHp', 40) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        PANIC_AT = this.settings.num('panicHp', 25) / 100;
        REST_UNTIL = this.settings.num('restUntilHp', 60) / 100;
        FOOD_TARGET = this.settings.num('foodTarget', 22);
        RESTOCK_AT = this.settings.num('restockAtFood', 3);
        BANK_AT = this.settings.num('bankAtLootSlots', 12);
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);

        if (Skills.level('thieving') < 5) {
            this.log(`ArdyThiever needs Thieving 5 for the Baker's stall (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error('ArdyThiever: Thieving 5 required');
        }

        this.log(`ArdyThiever starting — target '${TARGET}', anchor ${ANCHOR} r${LEASH}, stall ${STALL_TILE}, bank ${BANK_STAND}`);

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
            new Flee(this),
            new LootDrops(this),
            new EatFood(this),
            new PanicRetreat(this),
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
        const lines = [
            `ArdyThiever — ${this.status}`,
            `target ${TARGET}  steals ${this.steals}  ate ${this.eats}  fled ${this.flees}`,
            `loot ${this.looted}  bank trips ${this.trips}  food ${foodCount()}  lootslots ${lootSlots()}`,
            `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    /** True while a recent thieving stun still explains Game.inCombat() (a caught
     *  pickpocket, not a real attacker). */
    private inThievingStun(): boolean { return Game.tick() <= this.stunnedUntilTick; }
    /** In combat with an actual attacker — the self-inflicted pickpocket-fail
     *  stun (which also shows the health bar) does NOT count. Every task that
     *  pauses "while in combat" gates on this so a normal miss neither flees nor
     *  freezes the loop. */
    inRealCombat(): boolean { return Game.inCombat() && !this.inThievingStun(); }
    countSteal(): void { this.steals++; }
    countEat(): void { this.eats++; }
    countLoot(): void { this.looted++; }
    countTrip(): void { this.trips++; }
    countFlee(): void { this.flees++; }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
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
            this.bot.countLoot();
        }
    }
}

/** Eat below the gate up to the eat-to target (standard mechanic). */
class EatFood implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean { return shouldEat(hpFraction(), EAT_AT, foodCount()); }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) { return; }
            if (hpFraction() >= EAT_TO || foodCount() === 0) { return; }
            const food = Inventory.items().find(i => matchesAny(i.name, FOOD));
            if (!food) { return; }
            this.bot.setStatus(`eating ${food.name} (${Math.round(hpFraction() * 100)}% hp)`);
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
    validate(): boolean { return shouldPanic(hpFraction(), PANIC_AT, foodCount()); }
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
            await Execution.delayUntil(() => hpFraction() >= REST_UNTIL || Game.inCombat() || ChatDialog.canContinue() || EventSignal.pending(), 300_000);
        }
        await Traversal.walkResilient(ANCHOR, { radius: 3, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** Bank loot (+ shared junk) once it fills enough slots. */
class BankRun implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean { return shouldBank(lootSlots(), BANK_AT, Inventory.isFull()); }
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
        return !this.bot.inRealCombat() && !Inventory.isFull() && foodCount() <= RESTOCK_AT;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        this.bot.log(`restocking cake (have ${foodCount()})`);
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
            if (shouldEat(hpFraction(), EAT_AT, foodCount())) { return; }
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
    constructor(private bot: ArdyThiever) {}
    private find() {
        return Npcs.query()
            .name(TARGET)
            .action(PICKPOCKET_OP)
            .where(n => n.tile().distanceTo(ANCHOR) <= LEASH)
            .nearest();
    }
    validate(): boolean {
        return !this.bot.inRealCombat() && foodCount() > RESTOCK_AT && !Inventory.isFull() && this.find() !== null;
    }
    async execute(): Promise<void> {
        const npc = this.find();
        if (!npc) { return; }
        if (!Reachability.canReach(npc.tile(), { adjacentOk: true })) {
            this.bot.setStatus(`clearing path to ${TARGET}`);
            await walkOpening(npc.tile(), 1, OBSTACLE, m => this.bot.log(m));
            return;
        }
        this.bot.setStatus(`pickpocketing ${TARGET} at ${npc.tile()}`);
        const xpBefore = Skills.xp('thieving');
        const usedBefore = Inventory.used();
        if (!(await npc.interact(PICKPOCKET_OP))) { await Execution.delayTicks(2); return; }
        // Wait out the attempt: a SUCCESS lands thieving xp/loot within a tick or
        // two; a FAILURE stuns us instead (no xp/loot) — sit it out (yielding to
        // EatFood if the hit dropped us) rather than re-firing opnpc every tick,
        // which the stun ignores anyway. NOT gated on Game.inCombat(): the fail
        // itself shows the health bar, and breaking on it just spins the attempt.
        await Execution.delayUntil(
            () => Skills.xp('thieving') > xpBefore || Inventory.used() > usedBefore || ChatDialog.canContinue() || hpFraction() < EAT_AT,
            3000
        );
        if (Skills.xp('thieving') > xpBefore) { this.bot.countSteal(); this.bot.log(`pickpocketed ${TARGET}`); }
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && ANCHOR.distanceTo(here) > LEASH + 6;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await walkOpening(ANCHOR, 2, OBSTACLE, m => this.bot.log(m));
    }
}
