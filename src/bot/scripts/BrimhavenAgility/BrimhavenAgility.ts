import { actions, reader } from '../../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { foodCount as foodCountIn, foodForms } from '../../api/combat/food.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    ARDY_BANK,
    ARENA_ENTRANCE,
    ARENA_VARP,
    CENTRE_PLATFORM,
    DEFAULT_BANK_TICKETS,
    DEFAULT_FOOD_PER_TRIP,
    EAT_AT_HP,
    LADDER_DOWN_STAND,
    PILLARS,
    SPIKE_PLATFORMS,
    TICKET_NAME,
    canStartObstacle,
    coinsToWithdraw,
    edgeApproachCandidates,
    edgeBetween,
    hasPaid,
    inArena,
    inArenaPit,
    CAKE_STEAL_FILL,
    GUARD_THIEVING_MIN,
    STEAL_THIEVING_MIN,
    needsCakeSteal,
    needsCoinsRestock,
    nextHop,
    obstacleOutcome,
    onArenaPlatform,
    onBrimhavenSurface,
    pathPlatforms,
    pillarFromHint,
    pillarTagged,
    platformAt,
    restockShortfall,
    shouldBank,
    shouldEat,
    ticketInventoryGain,
    waitPlatform,
    wantRunForGoal,
    type ArenaEdge
} from './BrimhavenAgilityLogic.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';
import { CAKE_ITEMS, FLEE_TILE } from '../../api/thieving/cakeStallData.js';
import { carriedCakes, stealCakes } from '../../api/thieving/CakeStall.js';
import { matchesAny } from '../../api/inventory/packRules.js';
import { STUN_COMBAT_TICKS } from '../../api/thieving/stealRules.js';
import { targetSpot } from '../../api/thieving/targets.js';

export const BRIMHAVEN_AGILITY_SETTINGS: SettingsSchema = {
    loadout: LOADOUT_SETTING,
    foodWithdraw: {
        type: 'number',
        default: DEFAULT_FOOD_PER_TRIP,
        min: 1,
        max: 27,
        label: 'Food per trip',
        help: 'default 25 leaves one slot for the coin stack (26 used)'
    },
    bankAtTickets: {
        type: 'number',
        default: DEFAULT_BANK_TICKETS,
        min: 1,
        max: 5000,
        label: 'Bank at X tickets',
        help: 'also banks when out of food'
    },
    stealRestock: {
        type: 'boolean',
        default: false,
        label: 'Steal cakes / GP when out',
        help: 'Thieving 20: Baker\'s stall cakes when the selected food is gone. Thieving 40: pickpocket Ardougne guards for boat/entrance coins, eating cakes after stuns'
    }
};

export default class BrimhavenAgility extends TaskBot {
    // One server tick between loops so the next hop can start the tick we go idle.
    override loopDelay = 600;
    override loopCadence = { kind: 'server-tick' as const, ticks: 1 };

    private foodName = 'Lobster';
    private foodPerTrip = DEFAULT_FOOD_PER_TRIP;
    private bankAtTickets = DEFAULT_BANK_TICKETS;
    private stealRestock = false;
    private stunnedUntilTick = 0;

    private ticketsCollected = 0;
    private tags = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private spikeToggle = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.foodName = scriptFood(this.settings, 'Lobster');
        this.foodPerTrip = this.settings.num('foodWithdraw', DEFAULT_FOOD_PER_TRIP);
        this.bankAtTickets = this.settings.num('bankAtTickets', DEFAULT_BANK_TICKETS);
        this.stealRestock = this.settings.bool('stealRestock', false);
        if (this.stealRestock && Skills.level('thieving') < STEAL_THIEVING_MIN) {
            const msg = `steal restock needs Thieving ${STEAL_THIEVING_MIN} (have ${Skills.level('thieving')})`;
            this.log(msg);
            throw new Error(`BrimhavenAgility: ${msg}`);
        }
        this.on('chat.message', e => {
            if (/been stunned|fail to pick/i.test(e.text)) {
                this.stunnedUntilTick = Game.tick() + STUN_COMBAT_TICKS;
            }
        });
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        this.ticketsCollected = 0;
        this.on('inventory.changed', change => {
            const gained = ticketInventoryGain(change, Bank.isOpen());
            if (gained > 0) {
                this.ticketsCollected += gained;
            }
        });

        this.log(
            `BrimhavenAgility — food '${this.foodName}' x${this.foodPerTrip}, bank@${this.bankAtTickets} tickets, eat@${EAT_AT_HP}hp${this.stealRestock ? ', steal restock on' : ''}`
        );

        this.add(
            new ContinueDialog(),
            new Eat(this),
            new ClimbOutOfPit(this),
            new LeaveForSteal(this),
            new StealFood(this),
            new StealCoins(this),
            new BankTrip(this),
            new TravelToArena(this),
            new EnterArena(this),
            new TagPillar(this),
            new CrossObstacle(this),
            new SpikeWait(this)
        );
    }

    setStatus(s: string): void {
        this.status = s;
    }

    cfg() {
        return {
            food: this.foodName,
            foodPerTrip: this.foodPerTrip,
            bankAtTickets: this.bankAtTickets,
            stealRestock: this.stealRestock
        };
    }

    foodInPack(): number {
        return foodCountIn(Inventory.items(), this.foodName);
    }

    cakesInPack(): number {
        return carriedCakes();
    }

    edibleInPack(): number {
        const selected = this.foodInPack();
        const cakes = this.cakesInPack();
        if (foodForms(this.foodName).some(f => f.includes('cake'))) {
            return Math.max(selected, cakes);
        }
        return selected + cakes;
    }

    needsCoinsNow(): boolean {
        const here = this.here();
        const atBrim = here !== null && onBrimhavenSurface(here.x, here.z, here.level);
        return needsCoinsRestock(this.coinCount(), this.paid(), atBrim || this.inArenaNow());
    }

    needsCakesNow(): boolean {
        return needsCakeSteal(this.foodInPack(), this.cakesInPack(), this.stealRestock, this.needsCoinsNow());
    }

    stunned(): boolean {
        return Game.tick() <= this.stunnedUntilTick;
    }

    ticketCount(): number {
        return Inventory.count(TICKET_NAME);
    }

    coinCount(): number {
        return Inventory.count('Coins');
    }

    agility(): number {
        return Skills.level('agility');
    }

    hp(): number {
        return Skills.effective('hitpoints');
    }

    paid(): boolean {
        return hasPaid(reader.varp(ARENA_VARP));
    }

    tagged(): boolean {
        return pillarTagged(reader.varp(ARENA_VARP));
    }

    here(): Tile | null {
        const t = Game.tile();
        return t ? new Tile(t.x, t.z, t.level) : null;
    }

    platform(): number {
        const t = this.here();
        // Only snap to pillars on the live platform plane — the fall pit shares
        // x/z with pillars but has no Rope swing / ledge locs (stuck loop).
        if (!t || !onArenaPlatform(t.level) || !inArena(t.x, t.z)) {
            return -1;
        }
        return platformAt(t.x, t.z);
    }

    inPitNow(): boolean {
        const t = this.here();
        return t !== null && inArenaPit(t.x, t.z, t.level);
    }

    /** Active ticket pillar from the client hint arrow. */
    targetPillar(): number {
        const h = reader.hintTile();
        if (!h) {
            return -1;
        }
        return pillarFromHint(h.x, h.z);
    }

    inArenaNow(): boolean {
        const t = this.here();
        return t !== null && inArena(t.x, t.z);
    }

    // Why: Swarm despawns only after you leave the tile; 5x5 platforms cannot do that, so evade loops forever (#597).
    override ignoredRandoms(): string[] {
        return this.inArenaNow() ? ['swarm'] : [];
    }

    countTag(): void {
        this.tags++;
    }

    nextSpikePlatform(): number {
        const cur = this.platform();
        if (cur === SPIKE_PLATFORMS[0]) {
            return SPIKE_PLATFORMS[1];
        }
        if (cur === SPIKE_PLATFORMS[1]) {
            return SPIKE_PLATFORMS[0];
        }
        return SPIKE_PLATFORMS[this.spikeToggle++ % 2];
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#3bb0b0' });
        p.title(`Brimhaven — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('agility') - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Tags: ${this.tags}`, `XP/hr: ${xph}`);
        p.row(`Tickets earned: ${this.ticketsCollected}`);
        p.row(`Food: ${this.foodInPack()}`, `HP: ${this.hp()}`, `Agility: ${this.agility()}`);
        p.row(`Platform: ${this.platform()}`, `Target: ${this.targetPillar()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

function findEdible(food: string) {
    const selected = Inventory.items().find(i => foodForms(food).includes((i.name ?? '').toLowerCase()));
    if (selected) {
        return selected;
    }
    return Inventory.items().find(i => matchesAny(i.name, CAKE_ITEMS)) ?? null;
}

class LeaveForSteal implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.cfg().stealRestock || !this.bot.inArenaNow()) {
            return false;
        }
        return this.bot.needsCakesNow() || this.bot.needsCoinsNow();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('leaving arena to steal restock');
        await leaveArena(this.bot);
    }
}

class StealFood implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        return this.bot.needsCakesNow() && !this.bot.inArenaNow();
    }
    async execute(): Promise<void> {
        if (Game.inCombat()) {
            this.bot.setStatus('kiting the stall guard');
            await Traversal.walkResilient(FLEE_TILE, { radius: 2, attempts: 2, timeoutMs: 20_000, log: m => this.bot.log(`  ${m}`) });
            await Execution.delayUntil(() => !Game.inCombat(), 15_000);
            return;
        }
        this.bot.setStatus('stealing cakes at the Baker\'s stall');
        const result = await stealCakes({
            fillTo: CAKE_STEAL_FILL,
            abort: () => !this.bot.needsCakesNow(),
            shouldEat: () => shouldEat(this.bot.hp(), this.bot.edibleInPack()),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(`  ${m}`)
        });
        if (result === 'combat') {
            this.bot.setStatus('caught at the stall — kiting');
            await Traversal.walkResilient(FLEE_TILE, { radius: 2, attempts: 2, timeoutMs: 20_000, log: m => this.bot.log(`  ${m}`) });
        }
    }
}

class StealCoins implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        return this.bot.cfg().stealRestock && this.bot.needsCoinsNow() && !this.bot.inArenaNow() && !this.bot.needsCakesNow();
    }
    async execute(): Promise<void> {
        const thieving = Skills.level('thieving');
        if (thieving < GUARD_THIEVING_MIN) {
            const msg = `stealing coins from guards needs Thieving ${GUARD_THIEVING_MIN} (have ${thieving})`;
            this.bot.log(msg);
            ScriptRunner.stop(msg);
            return;
        }
        if (shouldEat(this.bot.hp(), this.bot.edibleInPack())) {
            return;
        }
        if (this.bot.stunned()) {
            this.bot.setStatus('stunned — waiting');
            await Execution.delayUntil(() => !this.bot.stunned() || shouldEat(this.bot.hp(), this.bot.edibleInPack()), 9000);
            return;
        }
        if (Game.inCombat()) {
            this.bot.setStatus('kiting the guard');
            await Traversal.walkResilient(FLEE_TILE, { radius: 2, attempts: 2, timeoutMs: 20_000, log: m => this.bot.log(`  ${m}`) });
            await Execution.delayUntil(() => !Game.inCombat(), 15_000);
            return;
        }
        const spot = targetSpot('Guard');
        const here = Game.tile();
        if (here && spot.anchor.distanceTo(here) > spot.leash) {
            this.bot.setStatus('walking to Ardougne guards');
            await Traversal.walkResilient(spot.anchor, { radius: 4, attempts: 3, timeoutMs: 90_000, log: m => this.bot.log(`  ${m}`) });
            return;
        }
        const guard = Npcs.query()
            .name('Guard')
            .action('Pickpocket')
            .where(n => n.tile().distanceTo(spot.anchor) <= spot.leash)
            .nearest();
        if (!guard) {
            this.bot.setStatus('no guard in range — waiting');
            await Execution.delayTicks(2);
            return;
        }
        if (!Reachability.canReach(guard.tile(), { adjacentOk: true })) {
            await Traversal.walkResilient(guard.tile(), { radius: 1, attempts: 2, timeoutMs: 20_000, log: m => this.bot.log(`  ${m}`) });
            return;
        }
        this.bot.setStatus('pickpocketing a guard');
        const coinsBefore = this.bot.coinCount();
        const xpBefore = Skills.xp('thieving');
        await guard.interact('Pickpocket');
        await Execution.delayUntil(
            () => this.bot.coinCount() > coinsBefore || Skills.xp('thieving') > xpBefore || this.bot.stunned() || ChatDialog.canContinue(),
            2500
        );
        if (this.bot.coinCount() > coinsBefore) {
            this.bot.log(`pickpocketed a guard (${this.bot.coinCount()} coins)`);
        }
        if (this.bot.stunned()) {
            await Execution.delayUntil(() => !this.bot.stunned() || shouldEat(this.bot.hp(), this.bot.edibleInPack()), 9000);
        }
    }
}

class Eat implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        return shouldEat(this.bot.hp(), this.bot.edibleInPack());
    }
    async execute(): Promise<void> {
        const item = findEdible(this.bot.cfg().food);
        if (!item) {
            return;
        }
        this.bot.setStatus(`eating ${item.name} (${this.bot.hp()} hp)`);
        const before = Inventory.used();
        await item.interact('Eat');
        await Execution.delayUntil(() => Inventory.used() < before || this.bot.hp() >= EAT_AT_HP, 3000);
    }
}

class BankTrip implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        const steal = this.bot.cfg().stealRestock;
        if (this.bot.inArenaNow()) {
            return shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets, steal);
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets, steal)) {
            return true;
        }
        if (steal) {
            return false;
        }
        const here = this.bot.here();
        const atBrim = here !== null && onBrimhavenSurface(here.x, here.z, here.level);
        // Do not top up food to foodPerTrip while already on Brimhaven — that
        // alone would ship you back to Ardy after eating a single lobster.
        const needFood =
            this.bot.foodInPack() <= 0 ||
            (!atBrim && this.bot.foodInPack() < this.bot.cfg().foodPerTrip);
        return needFood || needsCoinsRestock(this.bot.coinCount(), this.bot.paid(), atBrim);
    }
    async execute(): Promise<void> {
        const { food, foodPerTrip, bankAtTickets } = this.bot.cfg();

        if (this.bot.inArenaNow()) {
            this.bot.setStatus('leaving arena to bank');
            await leaveArena(this.bot);
            return;
        }

        this.bot.setStatus('banking at Ardougne south');
        if (!(await Traversal.walkResilient(new Tile(ARDY_BANK.x, ARDY_BANK.z, 0), { radius: 3, attempts: 3, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) }))) {
            this.bot.log('could not reach Ardougne south bank');
            return;
        }
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank');
            return;
        }

        const keep = new Set(['coins', ...foodForms(food), ...(this.bot.cfg().stealRestock ? CAKE_ITEMS : [])]);
        await Bank.depositAllMatching(name => !keep.has(name.toLowerCase()));

        // Always fund a full mainland→Brimhaven round-trip when stocking.
        const withdrawCoins = coinsToWithdraw(this.bot.paid(), this.bot.coinCount());
        if (withdrawCoins > 0) {
            await Bank.withdrawX('Coins', withdrawCoins);
        }
        const have = this.bot.foodInPack();
        if (have < foodPerTrip) {
            await Bank.withdrawX(food, foodPerTrip - have);
        }

        // A shortfall here means the next loop banks again for the same reason.
        const shortfall = restockShortfall({
            food,
            foodInPack: this.bot.foodInPack(),
            foodPerTrip,
            coins: this.bot.coinCount(),
            alreadyPaid: this.bot.paid()
        });
        await Bank.close();
        if (shortfall !== null) {
            if (this.bot.cfg().stealRestock) {
                this.bot.log(`bank shortfall (${shortfall}) — steal restock will cover food/coins`);
            } else {
                this.bot.setStatus(`stopped — ${shortfall}`);
                ScriptRunner.stop(shortfall);
                return;
            }
        }
        this.bot.log(`restocked: ${this.bot.foodInPack()} ${food}, ${this.bot.coinCount()} coins, ${this.bot.ticketCount()} tickets banked (threshold ${bankAtTickets})`);
    }
}

class TravelToArena implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (this.bot.inArenaNow()) {
            return false;
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets, this.bot.cfg().stealRestock)) {
            return false;
        }
        if (this.bot.needsCakesNow() || (this.bot.cfg().stealRestock && this.bot.needsCoinsNow())) {
            return false;
        }
        const here = this.bot.here();
        if (!here) {
            return false;
        }
        const atBrim = onBrimhavenSurface(here.x, here.z, here.level);
        // still need food + coins for remaining legs (not full trip if already on Brimhaven)
        if (this.bot.edibleInPack() < 1 || needsCoinsRestock(this.bot.coinCount(), this.bot.paid(), atBrim)) {
            return false;
        }
        const nearEntrance = Math.max(Math.abs(here.x - ARENA_ENTRANCE.x), Math.abs(here.z - ARENA_ENTRANCE.z)) <= 8 && here.level === 0;
        return !nearEntrance;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to Brimhaven arena');
        // web-walk uses the Ardougne↔Brimhaven ship special when needed
        if (!(await Traversal.walkResilient(new Tile(ARENA_ENTRANCE.x, ARENA_ENTRANCE.z, 0), { radius: 4, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            this.bot.log('could not reach the arena entrance');
        }
    }
}

class EnterArena implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (this.bot.inArenaNow()) {
            return false;
        }
        if (this.bot.needsCakesNow() || (this.bot.cfg().stealRestock && this.bot.needsCoinsNow())) {
            return false;
        }
        // On Brimhaven the outbound boat is already paid — only need return + entrance.
        if (this.bot.edibleInPack() < 1 || needsCoinsRestock(this.bot.coinCount(), this.bot.paid(), true)) {
            return false;
        }
        const here = this.bot.here();
        if (!here) {
            return false;
        }
        return Math.max(Math.abs(here.x - ARENA_ENTRANCE.x), Math.abs(here.z - ARENA_ENTRANCE.z)) <= 12 && here.level === 0;
    }
    async execute(): Promise<void> {
        if (!this.bot.paid()) {
            this.bot.setStatus("paying Cap'n Izzy");
            const clerk =
                Npcs.query().name("Cap'n Izzy No-Beard").within(10).nearest() ??
                Npcs.query()
                    .within(10)
                    .where(n => /izzy|no-beard|cap'?n/i.test(n.name ?? ''))
                    .nearest();
            if (!clerk) {
                this.bot.log("Cap'n Izzy not nearby — walking to entrance");
                await Traversal.walkResilient(new Tile(LADDER_DOWN_STAND.x, LADDER_DOWN_STAND.z, 0), {
                    radius: 2,
                    attempts: 2,
                    timeoutMs: 30_000
                });
                return;
            }
            const before = this.bot.coinCount();
            // op3 = Pay (instant 200gp when unpaid); Talk-to otherwise
            if (clerk.actions().some(a => a.toLowerCase() === 'pay')) {
                await clerk.interact('Pay');
            } else {
                await clerk.interact('Talk-to');
                for (let i = 0; i < 10; i++) {
                    if (this.bot.paid() || this.bot.coinCount() < before) {
                        break;
                    }
                    if (ChatDialog.canContinue()) {
                        await ChatDialog.continue();
                    } else if (ChatDialog.options().length > 0) {
                        if (
                            !(await ChatDialog.chooseOption('use the Agility Arena')) &&
                            !(await ChatDialog.chooseOption("Okay, here's 200"))
                        ) {
                            await ChatDialog.chooseOption();
                        }
                    } else {
                        break;
                    }
                    await Execution.delayTicks(1);
                }
            }
            await Execution.delayUntil(() => this.bot.paid() || this.bot.coinCount() < before, 5000);
            if (!this.bot.paid() && this.bot.coinCount() >= before) {
                this.bot.log('payment did not register — retrying');
                return;
            }
            this.bot.log('paid 200 coins entrance');
        }

        this.bot.setStatus('climbing into the arena');
        await Traversal.walkResilient(new Tile(LADDER_DOWN_STAND.x, LADDER_DOWN_STAND.z, 0), {
            radius: 2,
            attempts: 2,
            timeoutMs: 20_000
        });
        const ladder =
            Locs.query().name('Ladder').action('Climb-Down').within(6).nearest() ??
            Locs.query()
                .name('Ladder')
                .within(6)
                .where(l => l.actions().some(a => /climb-down/i.test(a)))
                .nearest();
        if (!ladder) {
            this.bot.log('no ladder down at the entrance');
            return;
        }
        await ladder.interact(ladder.actions().find(a => /climb-down/i.test(a)) ?? 'Climb-Down');
        await Execution.delayUntil(() => this.bot.inArenaNow(), 8000);
    }
}

/** After a failed obstacle the player lands on plane 0 under the arena. */
class ClimbOutOfPit implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        return this.bot.inPitNow();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('climbing out of the pit');
        const rope =
            Locs.query().name('Climbing rope').within(20).nearest() ??
            Locs.query()
                .within(20)
                .where(l => /climbing rope/i.test(l.name ?? ''))
                .nearest();
        if (!rope) {
            this.bot.log('fallen into the pit but no Climbing rope in range — waiting');
            await Execution.delayTicks(2);
            return;
        }
        const op = rope.actions().find(a => /climb/i.test(a)) ?? rope.actions()[0];
        if (!op) {
            this.bot.log(`Climbing rope at ${rope.tile().x},${rope.tile().z} has no climb op`);
            return;
        }
        this.bot.log(`climbing rope at ${rope.tile().x},${rope.tile().z} (${op})`);
        if (!(await rope.interact(op))) {
            this.bot.log('Climbing rope interact failed');
            return;
        }
        // Wait until back on the platform plane and idle so the next hop can fire immediately.
        if (!(await Execution.delayUntil(() => !this.bot.inPitNow() && !Game.animating(), 8000))) {
            this.bot.log('still in the pit after climbing rope');
        }
    }
}

class TagPillar implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.inArenaNow() || this.bot.inPitNow() || this.bot.tagged()) {
            return false;
        }
        const target = this.bot.targetPillar();
        const here = this.bot.platform();
        return target >= 0 && here === target && target < 24;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('tagging ticket dispenser');
        const ticketsBefore = this.bot.ticketCount();
        const taggedBefore = this.bot.tagged();
        const dispenser =
            Locs.query().name('Ticket Dispenser').within(6).nearest() ??
            Locs.query()
                .within(6)
                .where(l => /ticket/i.test(l.name ?? '') && l.actions().some(a => /tag/i.test(a)))
                .nearest();
        if (!dispenser) {
            this.bot.log(`no Ticket Dispenser on platform ${this.bot.platform()}`);
            return;
        }
        const op = dispenser.actions().find(a => /tag/i.test(a)) ?? 'Tag';
        await dispenser.interact(op);
        // first tag shows a mesbox; subsequent give a ticket + objbox
        await Execution.delayUntil(
            () =>
                this.bot.tagged() !== taggedBefore ||
                this.bot.ticketCount() > ticketsBefore ||
                reader.modals().chat !== -1 ||
                reader.modals().main !== -1,
            5000
        );
        // clear mesbox/objbox so ContinueDialog/next task can run
        for (let i = 0; i < 4 && (ChatDialog.canContinue() || reader.modals().main !== -1); i++) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                break;
            }
            await Execution.delayTicks(1);
        }
        if (this.bot.ticketCount() > ticketsBefore || this.bot.tagged()) {
            this.bot.countTag();
            this.bot.log(`tagged pillar ${this.bot.platform()} (tickets ${this.bot.ticketCount()})`);
        }
    }
}

class CrossObstacle implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.inArenaNow() || this.bot.inPitNow()) {
            return false;
        }
        if (!canStartObstacle(Game.animating(), false)) {
            return false;
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets)) {
            return false;
        }
        const here = this.bot.platform();
        if (here < 0) {
            return false;
        }
        const target = this.bot.targetPillar();
        // path to the active pillar unless already tagged and waiting
        if (this.bot.tagged() || target < 0) {
            const wait = waitPlatform(this.bot.agility(), here);
            return here !== wait && pathPlatforms(here, wait, this.bot.agility()) !== null;
        }
        return here !== target && nextHop(here, target, this.bot.agility()) !== null;
    }
    async execute(): Promise<void> {
        const here = this.bot.platform();
        const target = this.bot.targetPillar();
        const chasingTag = !this.bot.tagged() && target >= 0;
        const goal = chasingTag ? target : waitPlatform(this.bot.agility(), here);
        const hop = nextHop(here, goal, this.bot.agility());
        if (hop === null) {
            this.bot.log(`no path from platform ${here} to ${goal} at agility ${this.bot.agility()}`);
            return;
        }
        const edge = edgeBetween(here, hop, this.bot.agility());
        if (!edge) {
            this.bot.log(`no usable edge ${here}->${hop}`);
            return;
        }
        this.bot.log(`crossing ${edge.kind} ${here}→${hop} (goal ${goal})`);
        this.bot.setStatus(`crossing ${edge.kind} ${here}→${hop}`);
        await ensureRun(wantRunForGoal(chasingTag));
        await crossEdge(this.bot, edge, here, hop);
    }
}

class SpikeWait implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.inArenaNow() || this.bot.inPitNow()) {
            return false;
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets)) {
            return false;
        }
        // only idle-grind while the current pillar is already tagged (or no hint yet)
        if (!this.bot.tagged() && this.bot.targetPillar() >= 0 && this.bot.platform() !== this.bot.targetPillar()) {
            return false;
        }
        if (this.bot.agility() < 20) {
            // park near centre without grinding spikes
            return this.bot.platform() === CENTRE_PLATFORM || this.bot.platform() < 0;
        }
        const p = this.bot.platform();
        return p === SPIKE_PLATFORMS[0] || p === SPIKE_PLATFORMS[1];
    }
    async execute(): Promise<void> {
        if (this.bot.agility() < 20) {
            this.bot.setStatus('waiting for next pillar');
            await Execution.delayTicks(1);
            return;
        }
        if (!canStartObstacle(Game.animating(), false)) {
            return;
        }
        // already tagged this round — keep jumping spikes for XP until the arrow moves
        if (!this.bot.tagged() && this.bot.targetPillar() === this.bot.platform()) {
            // should tag first
            return;
        }
        // Spikes / centre wait: walk to save energy for the next pillar chase.
        await ensureRun(false);
        const dest = this.bot.nextSpikePlatform();
        const here = this.bot.platform();
        if (here < 0) {
            return;
        }
        const edge = edgeBetween(here, dest, this.bot.agility());
        if (!edge) {
            // walk onto the other spike platform via path
            const hop = nextHop(here, dest, this.bot.agility());
            if (hop !== null) {
                const e = edgeBetween(here, hop, this.bot.agility());
                if (e) {
                    this.bot.setStatus(`to spikes via ${e.kind}`);
                    await crossEdge(this.bot, e, here, hop);
                }
            }
            return;
        }
        this.bot.setStatus('spike grind');
        await crossEdge(this.bot, edge, here, dest);
    }
}

async function leaveArena(bot: BrimhavenAgility): Promise<void> {
    // climb rope / ladder up from the pit if fallen, then the exit ladder
    if (bot.inPitNow()) {
        const rope = Locs.query().name('Climbing rope').within(20).nearest();
        if (rope) {
            bot.setStatus('climbing rope out of the pit');
            const op = rope.actions().find(a => /climb/i.test(a)) ?? 'Climb';
            await rope.interact(op);
            await Execution.delayUntil(() => !bot.inPitNow() && !Game.animating(), 6000);
        }
    }
    // exit ladder at local 53,54-ish — ladderup near SE of map
    const exit = Locs.query().name('Ladder').action('Climb-up').within(40).nearest()
        ?? Locs.query().name('Ladder').within(40).where(l => l.actions().some(a => /climb-up/i.test(a))).nearest();
    if (!exit) {
        // path toward platform 4 / SE where the exit ladder sits after climb dest 53,54
        const here = bot.platform();
        // ladder up is near platform area 20/SE — walk graph toward platform 4 then search
        if (here >= 0) {
            const hop = nextHop(here, 4, bot.agility()) ?? nextHop(here, 14, bot.agility());
            if (hop !== null) {
                const e = edgeBetween(here, hop, bot.agility());
                if (e) {
                    await crossEdge(bot, e, here, hop);
                }
            }
        }
        return;
    }
    bot.setStatus('climbing out of the arena');
    // may need to path across platforms first if far
    const dest = exit.tile();
    const destPlat = platformAt(dest.x, dest.z, 12);
    const here = bot.platform();
    if (here >= 0 && destPlat >= 0 && here !== destPlat) {
        const hop = nextHop(here, destPlat, bot.agility());
        if (hop !== null) {
            const e = edgeBetween(here, hop, bot.agility());
            if (e) {
                await crossEdge(bot, e, here, hop);
                return;
            }
        }
    }
    await exit.interact(exit.actions().find(a => /climb-up/i.test(a)) ?? 'Climb-up');
    await Execution.delayUntil(() => !bot.inArenaNow(), 8000);
}

/**
 * Override the global runAuto threshold: run while chasing a ticket pillar,
 * walk while returning to centre / grinding spikes (saves energy for the next tag).
 */
async function ensureRun(want: boolean): Promise<void> {
    if (Game.runEnabled() === want) {
        return;
    }
    actions.setRun(want);
    await Execution.delayUntil(() => Game.runEnabled() === want, 1200);
}

// Why: success is arriving on dest, where a residual anim is fine.
// Why: a pit fall or partial progress onto another platform also settles the hop.
// Why: a soft fail engages then goes idle back on start, which is the saws and pressure bounce.
// Why: a few idle ticks on start settle it too, so it never sits out the full timeout.

/** Waits until the hop is done enough to act again. */
async function waitObstacleSettled(bot: BrimhavenAgility, from: number, to: number, timeoutMs: number): Promise<void> {
    let leftStart = false;
    let idleTicks = 0;
    let animStreak = 0;
    let lastTile = bot.here();
    const startPillar = PILLARS[from];
    const start = performance.now();

    while (performance.now() - start < timeoutMs) {
        const platform = bot.platform();
        const anim = Game.animating();
        const pit = bot.inPitNow();
        const tile = bot.here();
        const moved =
            !!tile &&
            !!lastTile &&
            (tile.x !== lastTile.x || tile.z !== lastTile.z || tile.level !== lastTile.level);
        // Why: walk traps keep platform===from until near the dest, so "left" means leaving the start island, falling, or sustaining an anim.
        // Why: 1-frame click flashes would false-fail before the hop starts.
        const distFromStart =
            tile && startPillar
                ? Math.max(Math.abs(tile.x - startPillar.x), Math.abs(tile.z - startPillar.z))
                : 0;
        animStreak = anim ? animStreak + 1 : 0;
        if (pit || distFromStart > 4 || (platform >= 0 && platform !== from) || animStreak >= 2) {
            leftStart = true;
        }

        const outcome = obstacleOutcome(platform, from, to, pit, anim);
        if (outcome === 'arrived' || outcome === 'fallen' || outcome === 'elsewhere') {
            bot.log(
                `  settled ${outcome} platform ${platform} (from ${from}, want ${to}) anim=${anim} pit=${pit}`
            );
            return;
        }

        if (!anim && !moved) {
            idleTicks++;
        } else {
            idleTicks = 0;
        }
        // Soft fail / stuck mid-trap: after a live leave, a few idle ticks without
        // arriving means bounce or stall — retry now (not a 8–12s hang).
        if (leftStart && idleTicks >= 3) {
            bot.log(
                `  settled failed (stalled after leave) platform ${platform} distStart=${distFromStart} (from ${from}, want ${to})`
            );
            return;
        }
        // Click/walk never took — retry without sitting out the full timeout.
        if (!leftStart && platform === from && idleTicks >= 6) {
            bot.log(`  settled failed (never left start) platform ${platform} (from ${from}, want ${to})`);
            return;
        }

        lastTile = tile ?? lastTile;
        await Execution.delayTicks(1);
    }
    bot.log(
        `  settled timeout platform ${bot.platform()} (from ${from}, want ${to}) anim=${Game.animating()} pit=${bot.inPitNow()}`
    );
}

async function crossEdge(bot: BrimhavenAgility, edge: ArenaEdge, from: number, to: number): Promise<void> {
    const dest = PILLARS[to];

    if (edge.mode === 'walk') {
        // traps fire on zone entry. Use the client pathfinder (not the overworld
        // collision pack) so island→island steps stay in the arena scene.
        const local = reader.toLocal(dest.x, dest.z);
        if (!local) {
            bot.log(`  dest ${dest.x},${dest.z} not in scene`);
            return;
        }
        if (!actions.walkTo(local.lx, local.lz)) {
            bot.log(`  walkTo(${local.lx},${local.lz}) refused`);
            return;
        }
        await waitObstacleSettled(bot, from, to, 8_000);
        return;
    }

    const loc = findEdgeLoc(edge, from, to);
    if (!loc) {
        bot.log(`no ${edge.locName ?? edge.kind} loc for edge ${from}->${to}`);
        return;
    }
    const op =
        edge.op && loc.actions().some(a => a.toLowerCase() === edge.op!.toLowerCase())
            ? loc.actions().find(a => a.toLowerCase() === edge.op!.toLowerCase())!
            : loc.actions()[0];
    if (!op) {
        bot.log(`${edge.locName} has no actions at ${loc.tile().x},${loc.tile().z}`);
        return;
    }
    // Why: staging happens on the source side before every interaction.
    // Why: platform membership is not enough — recovery ladders and ticket dispensers can separate the player from the obstacle's usable side while both tiles belong to one island.
    const lt = loc.tile();
    const approach = edgeApproachCandidates(from, to, lt)
        .map(t => new Tile(t.x, t.z, lt.level))
        .find(t => Reachability.walkable(t) && Reachability.canReach(t, { maxSteps: 512 }));
    if (!approach) {
        bot.log(`  no reachable source-side stage for ${edge.kind} ${from}→${to}`);
        return;
    }
    const here0 = bot.here();
    if (!here0?.equals(approach)) {
        bot.log(`  stage ${approach.x},${approach.z} before ${edge.kind} ${from}→${to}`);
        if (!(await DirectNavigator.walkTo(approach, 0, 6000))) {
            bot.log(`  could not reach stage ${approach.x},${approach.z}; interaction skipped`);
            return;
        }
    }

    bot.log(`  ${op} ${edge.locName} @ ${lt.x},${lt.z}`);
    // Click immediately (even mid residual anim). Re-click while still on start
    // until the obstacle engages — no long dead wait after rope/pillar/monkey.
    for (let attempt = 0; attempt < 5; attempt++) {
        if (bot.inPitNow() || bot.platform() === to) {
            break;
        }
        if (bot.platform() >= 0 && bot.platform() !== from) {
            break;
        }
        const live = findEdgeLoc(edge, from, to) ?? loc;
        if (!(await live.interact(op))) {
            bot.log(`  interact failed (attempt ${attempt + 1})`);
        }
        const started = await Execution.delayUntil(
            () =>
                Game.animating()
                || bot.platform() === to
                || bot.inPitNow()
                || (bot.platform() >= 0 && bot.platform() !== from),
            700
        );
        if (started || Game.animating() || bot.platform() !== from) {
            break;
        }
        await Execution.delayTicks(1);
    }
    await waitObstacleSettled(bot, from, to, 10_000);
}

function findEdgeLoc(edge: ArenaEdge, from: number, to: number): Loc | null {
    if (!edge.locName) {
        return null;
    }
    const a = PILLARS[from];
    const b = PILLARS[to];
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    // Prefer the from-side candidate so rope swings face the right way.
    const candidates = Locs.query()
        .name(edge.locName)
        .within(16)
        .where(l => l.actions().length > 0)
        .results();
    if (candidates.length === 0) {
        return Locs.query().name(edge.locName).within(16).nearest();
    }
    let best: Loc | null = null;
    let bestScore = Infinity;
    for (const loc of candidates) {
        const t = loc.tile();
        const midD = Math.hypot(t.x - midX, t.z - midZ);
        const fromD = Math.hypot(t.x - a.x, t.z - a.z);
        const score = midD + fromD * 0.25;
        if (score < bestScore) {
            bestScore = score;
            best = loc;
        }
    }
    return best;
}
