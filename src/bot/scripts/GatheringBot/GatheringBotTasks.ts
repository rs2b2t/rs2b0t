/**
 * GatheringBot task implementations (combat, mule, bank, cook, tools, gather).
 * Separated from the bot class for maintainability; behavior is unchanged.
 */
import { beyondLeash, shouldSoftHomeFromGatherMiss, tileWithinLeash } from '../../api/tasks/Anchor.js';
import type { Task } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import Tile from '../../geometry/Tile.js';
import type { Npc } from '../../api/model/Npc.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { isOpenableObstacle, openOp, walkOpening } from '../../event/webwalk/walkOpening.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import {
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    resourceWithinCamp,
    spotWithinGatherRange
} from './GatherCamp.js';
import { LOCAL_MINE_PREFER_RADIUS, shouldCooldownGatherTile } from './TargetPick.js';
import { Trade } from '../../api/trade/Trade.js';
import {
    DEFAULT_TRADE_RANGE,
    countOfferMatching,
    isConfiguredPartner
} from '../../api/trade/PartnerTrade.js';
import { driveActivePartnerTrade } from '../../api/trade/drivePartnerTrade.js';
import { BROKEN_PICKAXE, GAS_ROCK_IDS, GAS_ROCK_TICKS } from '../../data/miningRocks.js';
import { bestPickaxe } from '../../api/acquisition/Tools.js';
import { WHIRLPOOL_IDS, fishingRestockPlan } from '../../data/fishingMethods.js';
import {
    bankPaceTicks,
    cookFilterLabel,
    cookPaceTicks,
    isBurntFishName,
    isCookedFishName,
    shouldCookThenBank
} from './FishCookLogic.js';
import {
    TICK_MANIP_KNIFE,
    combatBreaksGather,
    extraDelayLogsToDrop,
    farmerWillowPhase,
    isFletchableLogName,
    isShortbowName,
    knifeDelayPhase,
    nextGatherClickTick,
    shouldCookForTannerfish,
    shouldEatForTannerfish
} from './TickManipLogic.js';
import { Banking } from '../../api/bank/Banking.js';
import { parseRangeStyle } from '../../api/combat/CombatStyle.js';
import { BROKEN_AXE, COINS, buyPlansCost, fishingGearShopCart, planGatherToolAcquire } from '../../api/acquisition/ToolAcquire.js';
import {
    fishingSessionBroken,
    hostileAttackerNearby,
    shouldFleeCombat
} from './GatheringBotLogic.js';
import type GatheringBot from './GatheringBot.js';

function keyOf(t: { x: number; z: number }): string {
    return `${t.x},${t.z}`;
}

/** First kite step away from a mob (named camps only — Auto skips FleeCombat). */
const FLEE_STEP = 12;
/** Second kite if still stuck after the first walk. */
const FLEE_STEP_HARD = 20;

/**
 * Keep empty shortbow equipped + rapid style for 3t shortbow retaliate WC (#160).
 * Re-applies after login (combat-mode varp is not persisted).
 */
export class EnsureShortbowRapid implements Task {
    private fails = 0;
    private retryAtTick = 0;
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.tickManipProfile().shortbowRapid) {
            return false;
        }
        if (Game.tick() < this.retryAtTick) {
            return false;
        }
        const rapid = parseRangeStyle('rapid');
        const needStyle = Game.combatMode() !== rapid;
        const needBow = !Equipment.items().some(i => isShortbowName(i.name));
        return needStyle || needBow;
    }

    async execute(): Promise<void> {
        if (!(await this.bot.ensureShortbowEquipped())) {
            if (++this.fails >= 3) {
                this.fails = 0;
                this.retryAtTick = Game.tick() + 25;
                this.bot.log('combat: no shortbow in pack — bring one for 3t rapid');
            }
            return;
        }
        const rapid = parseRangeStyle('rapid');
        if (Game.combatMode() === rapid) {
            this.fails = 0;
            return;
        }
        this.bot.setStatus('tick: set rapid style');
        Game.setCombatMode(rapid);
        if (await Execution.delayUntilTicks(() => Game.combatMode() === rapid, 5)) {
            this.fails = 0;
            this.bot.log('combat: range style → rapid (3t shortbow)');
        } else if (++this.fails >= 3) {
            this.fails = 0;
            this.retryAtTick = Game.tick() + 25;
            this.bot.log('combat: could not set rapid style — retrying later');
        }
    }
}

/** Keep knife-delay pack at one fletchable log so Make-X does not multi-queue. */
export class TrimKnifeDelayLogs implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.tickManipProfile().useKnifeDelay || EventSignal.pending() || Bank.isOpen()) {
            return false;
        }
        const logs = Inventory.items().filter(i => isFletchableLogName(i.name));
        const total = logs.reduce((s, i) => s + Math.max(1, i.count), 0);
        return extraDelayLogsToDrop(total, 1) > 0;
    }

    async execute(): Promise<void> {
        await this.bot.trimDelayLogs(1);
    }
}

// Why: it runs above Gather so combat ticks can still heal without leaving the pier.
// Why: it yields to DropProduct when the pack is full and no oven is in scene.

/** Tannerfishing sustain: eats cooked catch at low HP and cooks raw on a nearby Fire or Range. */
export class TannerfishSustain implements Task {
    constructor(private bot: GatheringBot) {}

    private nearestOven() {
        return (
            Locs.query()
                .name('Fire', 'Range', 'Cooking range')
                .where(l => l.distance() <= 8)
                .nearest() ??
            Locs.query().name('Fire', 'Range', 'Cooking range').nearest()
        );
    }

    validate(): boolean {
        if (!this.bot.tickManipProfile().cookEatInterleave) {
            return false;
        }
        if (EventSignal.pending() || Bank.isOpen() || ChatDialog.canContinue()) {
            return false;
        }
        const cooked = this.bot.cookedFishCount() > 0;
        if (shouldEatForTannerfish(Skills.hpFraction(), cooked)) {
            return true;
        }
        if (ChatDialog.isMakeMenu() && this.bot.cookableRawCount() > 0) {
            return true;
        }
        if (
            !shouldCookForTannerfish({
                rawCount: this.bot.cookableRawCount(),
                cookedCount: this.bot.cookedFishCount(),
                freeSlots: Inventory.free(),
                hpFraction: Skills.hpFraction()
            })
        ) {
            return false;
        }
        // Need an oven to cook — if pack is full and none in scene, let DropProduct run.
        if (!this.nearestOven()) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const cooked = this.bot.cookedFishCount() > 0;
        if (shouldEatForTannerfish(Skills.hpFraction(), cooked)) {
            await this.bot.tannerEatOne();
            return;
        }
        // Drop burnt so pack stays usable.
        if (this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }
        await this.bot.tannerCookOne();
    }
}

/** Miner-only smart eating: full-heal boundary or one more ore slot. */
export class MinerEatFood implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return (
            this.bot.minerFoodEnabled()
            && !Bank.isOpen()
            && !EventSignal.pending()
            && !ChatDialog.canContinue()
            && this.bot.shouldEatMinerFood()
        );
    }

    async execute(): Promise<void> {
        await this.bot.eatMinerFood();
    }
}

/** Own every non-bank leg of the gated Desert Mining Camp round trip. */
export class DesertMiningCampTravel implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return this.bot.desertMiningCampTravelNeeded();
    }

    async execute(): Promise<void> {
        await this.bot.runDesertMiningCampTravel();
    }
}

/** Keep hostile-camp Miner from retaliating after zone entry or relogin. */
export class MaintainWildernessMinerStance implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return this.bot.wildernessMinerStanceNeeded();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('combat: Auto Retaliate off');
        if (Game.setAutoRetaliate(false)) {
            this.bot.log('combat: Miner re-asserted Auto Retaliate off');
        }
        // One toggle is enough for this execution; wait for its varp before the
        // scheduler can validate the task again.
        await Execution.delayUntilTicks(() => !Game.autoRetaliateOn(), 3);
    }
}

/**
 * Sticky combatCycle with no face-target attacker: wait (do not east-kite).
 * Lets burn/gather resume once the cycle drains instead of deadlocking the loop.
 */
export class WaitStickyCombat implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return (
            this.bot.mobFleeEnabled()
            && Game.inCombat()
            && !EventSignal.pending()
            && !shouldFleeCombat({
                inCombat: true,
                eventPending: false,
                hasAttacker: this.hasAttacker() || this.bot.wildernessMinerPlayerAttack()
            })
        );
    }

    private hasAttacker(): boolean {
        return (
            Npcs.query()
                .where(n => n.inCombat && n.targetsMe() && n.actions().includes('Attack'))
                .nearest() !== null
            || Npcs.query()
                .where(
                    n =>
                        n.inCombat
                        && !n.targetsAnotherPlayer()
                        && n.actions().includes('Attack')
                        && n.distance() <= 2
                )
                .nearest() !== null
        );
    }

    async execute(): Promise<void> {
        Game.setAutoRetaliate(false);
        this.bot.setStatus('combat: waiting clear (no attacker)');
        await Execution.delayUntilTicks(() => !Game.inCombat() || this.hasAttacker(), 5);
    }
}

// Why: random events are handled by Supervisor and RandomEvents first, so this is not for them.
// Why: Auto Retaliate is off at start, so walking away ends the fight instead of trading hits.
// Why: the kite always heads away from the attacker, never back onto the camp anchor while spiders sit on it.
// Why: east is preferred when the vector is ambiguous, which is the Lava Maze exit.
// Why: a sticky combatCycle with no face target goes to {@link WaitStickyCombat}, since blind-kiting east freezes chop-then-burn and pier gather for 60–90s.

/** Breaks multi-combat pulls from aggressive NPCs such as lava-maze spiders and dark wizards. */
export class FleeCombat implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.mobFleeEnabled()) {
            return false;
        }
        return shouldFleeCombat({
            inCombat: Game.inCombat(),
            eventPending: EventSignal.pending(),
            hasAttacker: this.attacker() !== null || this.bot.wildernessMinerPlayerAttack()
        });
    }

    private attacker(): Npc | null {
        return (
            Npcs.query()
                .where(n => n.inCombat && n.targetsMe() && n.actions().includes('Attack'))
                .nearest() ??
            Npcs.query()
                .where(n => n.inCombat && !n.targetsAnotherPlayer() && n.actions().includes('Attack') && n.distance() <= 2)
                .nearest()
        );
    }

    private fleeTile(
        here: { x: number; z: number; level: number },
        attacker: Npc | null,
        step: number
    ): Tile {
        if (!attacker) {
            // No face target — east first (Lava Maze spiders / wildy approach), then south.
            return new Tile(here.x + step, here.z, here.level);
        }
        const at = attacker.tile();
        let dx = here.x - at.x;
        let dz = here.z - at.z;
        // Stacked on the attacker or zero vector — default east (named wildy camps).
        if (dx === 0 && dz === 0) {
            dx = 1;
            dz = 0;
        }
        const sx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
        const sz = dz === 0 ? 0 : dz > 0 ? 1 : -1;
        // Pure north/south kite: bias a half-step east so we don't re-enter spider packs.
        const ox = sx === 0 ? 1 : sx;
        const oz = sz;
        return new Tile(here.x + ox * step, here.z + oz * step, here.level);
    }

    async execute(): Promise<void> {
        // Re-assert off in case a death/relog restored the default.
        Game.setAutoRetaliate(false);

        // Chop-then-burn: leave the fire load when kiting (Jail guard, spiders).
        // Soft-lock was burningLoad=true with no lights while walking off-plot.
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            this.bot.log('burn: combat flee — ending fire load to re-camp after clear');
            this.bot.endBurningLoad();
        }

        const here = Game.tile();
        if (!here) {
            await Execution.delayTicks(1);
            return;
        }
        const playerAttack = this.bot.wildernessMinerPlayerAttack();
        // The policy exposes a live incoming-player target as a boolean; this task
        // does not retain that player's tile, so use the direction-neutral escape step.
        const attacker = playerAttack ? null : this.attacker();
        if (!attacker && !playerAttack) {
            // validate should have filtered this; still avoid a blind kite.
            this.bot.setStatus('combat: waiting clear (no attacker)');
            await Execution.delayUntilTicks(() => !Game.inCombat() || this.attacker() !== null, 7);
            return;
        }

        // Hold ReturnToAnchor / gather re-entry so we don't walk back onto the pack.
        this.bot.noteCombatFlee(20);

        const dest = this.fleeTile(here, attacker, FLEE_STEP);
        const who = playerAttack ? 'player attacker' : (attacker?.name ?? 'attacker');
        this.bot.setStatus(`combat: fleeing ${who} → ${dest.x},${dest.z}`);
        this.bot.log(`combat: under attack by ${who} — walking off to ${dest.x},${dest.z}`);

        await Traversal.walkTo(dest, { radius: 2, timeoutMs: 16_000 });
        await Execution.delayUntilTicks(() => !Game.inCombat(), 17);
        if (Game.inCombat()) {
            // Still stuck — longer kite away from whoever is on us.
            const still = Game.tile();
            const againAtk = this.attacker();
            if (still && againAtk) {
                const again = this.fleeTile(still, againAtk, FLEE_STEP_HARD);
                this.bot.log(`combat: still in combat — second kite to ${again.x},${again.z}`);
                this.bot.noteCombatFlee(24);
                await Traversal.walkTo(again, { radius: 2, timeoutMs: 12_000 });
                await Execution.delayUntilTicks(() => !Game.inCombat(), 14);
            }
        }
        // If hostiles are still stacked on us after the kite, hold camp longer.
        if (
            Game.inCombat() ||
            hostileAttackerNearby(Npcs.query().action('Attack').within(6).results(), 6)
        ) {
            this.bot.noteCombatFlee(17);
        }
    }
}

/** Fletch leftovers from knife-delay / farmer Make-X (not product logs). */
function isFletchByproductName(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    return (
        n.includes('shaft') ||
        n.includes('arrow shaft') ||
        n === 'headless arrow' ||
        n.includes('stock') ||
        (n.includes('shortbow') && n.includes('(u)')) ||
        (n.includes('longbow') && n.includes('(u)'))
    );
}

// ── Mule / partner trade (shared policy: api/trade/PartnerTrade) ───────────────

export class HandleGatherMuleTrade implements Task {
    private partnerWait = 0;

    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        return this.bot.getMuleMode() !== 'off' && Trade.active();
    }

    async execute(): Promise<void> {
        const receiver = this.bot.isMuleReceiver() || this.bot.isMuleCooker();
        const giver = !receiver;
        await driveActivePartnerTrade({
            role: receiver ? 'receiver' : 'giver',
            partners: this.bot.getMulePartners(),
            theirProductMatch: n =>
                this.bot.isMuleCooker()
                    ? this.bot.shouldDepositRawCatch(n) || this.bot.shouldDeposit(n)
                    : this.bot.shouldDeposit(n),
            productNamesToOffer: () => this.bot.depositableProductNames(),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            // Decline non-partners when header is known; wait (then timeout) on blank header.
            verifyGiverPartner: giver,
            onMissingPartner: () => {
                this.partnerWait++;
                if (this.partnerWait > 8) {
                    this.partnerWait = 0;
                    return 'decline';
                }
                return 'wait';
            },
            // Bank mule / cooker must have free slots or the transfer is a no-op thrash.
            receiverCanAccept: receiver
                ? () => {
                    if (Inventory.free() > 0) {
                        return true;
                    }
                    return {
                        ok: false as const,
                        reason: 'mule: pack full — cannot accept product (bank/cook first)'
                    };
                }
                : undefined,
            myOfferReady: giver
                ? () =>
                    countOfferMatching(Trade.myOffer(), n => this.bot.shouldDeposit(n)) > 0
                : undefined,
            onComplete: delta => {
                // Role-aware success: receiver gains slots used; giver loses product.
                const ok = receiver ? delta > 0 : delta < 0;
                if (!ok) {
                    this.bot.log(
                        `mule: trade closed without transfer (inv Δ${delta >= 0 ? '+' : ''}${delta}) — not counting`
                    );
                    return;
                }
                this.bot.noteMuleTrade();
                this.bot.log(
                    `mule: trade complete (inv Δ${delta >= 0 ? '+' : ''}${delta}, trades=${this.bot.muleTradeCount()})`
                );
            },
            labels: {
                accepting: this.bot.isMuleCooker() ? 'mule: accepting raw for cook' : 'mule: accepting product'
            }
        });
        if (Trade.partner() !== null) {
            this.partnerWait = 0;
        }
    }
}

export class MuleGoMeet implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (Trade.active() || EventSignal.pending()) {
            return false;
        }
        if (this.bot.atMuleMeet()) {
            return false;
        }
        if (this.bot.isMuleGatherer() || this.bot.isMuleSupplier()) {
            return Inventory.isFull() && this.bot.hasDepositable();
        }
        if (this.bot.isMuleReceiver()) {
            // Mule returns to meet when pack empty (after bank) or still empty.
            return !this.bot.hasDepositable() || !Inventory.isFull();
        }
        if (this.bot.isMuleCooker()) {
            // Idle empty → meet; if holding cookable raw, cook tasks own the loop.
            return this.bot.cookableRawCount() === 0 && this.bot.cookedFishCount() === 0;
        }
        return false;
    }

    async execute(): Promise<void> {
        const meet = this.bot.getMeetTile();
        this.bot.setStatus(`mule: walking to meet ${meet}`);
        await Traversal.walkResilient(meet, {
            radius: 2,
            timeoutMs: 90_000,
            log: m => this.bot.log(`  ${m}`)
        });
    }
}

export class MuleRequestOrWait implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (Trade.active() || EventSignal.pending()) {
            return false;
        }
        if (!this.bot.atMuleMeet()) {
            return false;
        }
        if (this.bot.isMuleGatherer() || this.bot.isMuleSupplier()) {
            return Inventory.isFull() && this.bot.hasDepositable();
        }
        if (this.bot.isMuleReceiver() || this.bot.isMuleCooker()) {
            // Idle at meet waiting for gatherer/supplier (cook when we hold raw).
            if (this.bot.isMuleCooker() && this.bot.cookableRawCount() > 0) {
                return false;
            }
            return !this.bot.hasDepositable() || this.bot.isMuleCooker();
        }
        return false;
    }

    async execute(): Promise<void> {
        const partner = this.bot.nearestMulePartner();
        if (!partner || partner.distance() > DEFAULT_TRADE_RANGE) {
            let msg = 'mule: waiting for gatherer';
            if (this.bot.isMuleGatherer() || this.bot.isMuleSupplier()) {
                msg = 'mule: waiting for partner at meet';
            } else if (this.bot.isMuleCooker()) {
                msg = 'mule: cooker waiting for raw';
            }
            this.bot.setStatus(msg);
            // Log once every few waits so harness/single-account smokes can assert.
            this.bot.log(msg);
            await Execution.delayTicks(2);
            return;
        }
        const name = partner.name ?? this.bot.getMulePartners()[0] ?? '';
        if (!isConfiguredPartner(name, this.bot.getMulePartners()) && name) {
            // name from query should match
        }
        this.bot.setStatus(`mule: requesting trade with ${name || 'partner'}`);
        await Trade.request(name);
        // Wall-clock: multiplayer Trade-with is not tied to this client's tick rate.
        await Execution.delayUntil(() => Trade.active() || EventSignal.pending(), 5_000);
    }
}

/**
 * Supplier: bank holds raw → withdraw a pack → meet → trade (pairs with Cooker).
 * bankRawBeforeCook is the "N ready" gate (default 28) before a trip starts.
 */
export class SupplierWithdrawRaw implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isMuleSupplier() || Trade.active() || EventSignal.pending()) {
            return false;
        }
        // Already carrying raw for the handoff.
        if (this.bot.rawFishCount() > 0) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        const target = Math.max(1, this.bot.getBankRawTarget() || 28);
        this.bot.setStatus(`mule: supplier withdraw raw (need bank ≥${target})`);
        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('mule: supplier bank open failed — retry');
            return;
        }
        await Execution.delayTicks(1);
        // Count raw stacks in open bank (same filter as cook).
        const bankRaw = Bank.items()
            .filter(i => this.bot.isCookableRaw(i.name))
            .reduce((s, i) => s + Math.max(1, i.count), 0);
        if (bankRaw < target) {
            this.bot.log(`mule: supplier bank raw ${bankRaw} < ${target} — waiting`);
            if (Bank.isOpen()) {
                await Bank.close();
            }
            await Execution.delayTicks(8);
            return;
        }
        this.bot.log(`mule: supplier withdrawing raw (bank ${bankRaw})`);
        for (let i = 0; i < 40 && Inventory.free() > 0; i++) {
            const stack = Bank.items().find(it => this.bot.isCookableRaw(it.name) && it.count > 0);
            if (!stack?.name) {
                break;
            }
            const before = this.bot.rawFishCount();
            await Bank.withdraw(stack.name, 'Withdraw-All');
            await Execution.delayUntilTicks(() => this.bot.rawFishCount() > before || Inventory.isFull(), 5);
            if (this.bot.rawFishCount() === before) {
                // Try single withdraw if All failed.
                await Bank.withdraw(stack.name, 'Withdraw-1');
                await Execution.delayUntilTicks(() => this.bot.rawFishCount() > before || Inventory.isFull(), 4);
                if (this.bot.rawFishCount() === before) {
                    break;
                }
            }
        }
        if (Bank.isOpen()) {
            await Bank.close();
        }
        this.bot.log(`mule: supplier pack raw=${this.bot.rawFishCount()} free=${Inventory.free()}`);
    }
}

export class MuleBankHaul implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isMuleReceiver() || Trade.active() || EventSignal.pending()) {
            return false;
        }
        return this.bot.hasDepositable();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        const had = this.bot.products().length;
        this.bot.setStatus('mule: banking haul');
        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('mule: bank open failed — will retry');
            return;
        }
        await Execution.delayTicks(1);
        await Bank.depositAllMatching(name => this.bot.shouldDeposit(name));
        await Execution.delayUntilTicks(() => !this.bot.hasDepositable() || !Bank.isOpen(), 9);
        if (Bank.isOpen()) {
            await Bank.close();
        }
        this.bot.countTrip(had);
        this.bot.log(`mule: deposited haul (${had} stacks, trades=${this.bot.muleTradeCount()})`);
        // Walk back toward meet (camp).
        await this.bot.walkHomeIfNeeded(log);
    }
}

// Why: BankCatch is deferred while a log load is pending, so under chop-then-burn caskets, gems and fruit permanently shrink free space for logs on long AFK runs.
// Why: the default is to bank at the camp, with drop kept for power/None or preference.

/** Clears random-event leftovers that steal pack slots. */
export class ClearPackJunk implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (EventSignal.pending()) {
            return false;
        }
        if (this.bot.packJunkPolicyMode() === 'off') {
            return false;
        }
        // Power + burn do not bank every full pack of product with the haul.
        // Normal bank-mode gather already deposits junk via depositAllExcept(gear).
        if (!this.bot.burnEnabled() && !this.bot.isPowerMode()) {
            return false;
        }
        const junk = this.bot.packJunkItems();
        if (junk.length === 0) {
            return false;
        }
        const free = Inventory.free();
        if (this.bot.burnEnabled()) {
            return free <= 6 || Inventory.isFull();
        }
        return free <= 2 || Inventory.isFull();
    }

    async execute(): Promise<void> {
        const junkN = this.bot.packJunkItems().length;
        const preferBank = this.bot.packJunkPolicyMode() === 'bank' && !this.bot.isPowerMode();
        if (preferBank) {
            this.bot.setStatus('bank: event junk');
            const log = (m: string) => this.bot.log(`  ${m}`);
            if (await this.bot.openScriptBank(log)) {
                await Bank.depositAllMatching((name, id) => this.bot.isPackJunk(name, id));
                await Execution.delayTicks(1);
                if (Bank.isOpen()) {
                    await this.bot.closeScriptBank(log);
                }
                const left = this.bot.packJunkItems().length;
                this.bot.log(
                    `bank: deposited event junk (${junkN - left} stack(s); ${left} left)`
                );
                if (left === 0) {
                    return;
                }
                this.bot.log('bank: some junk still held — falling back to drop');
            } else {
                this.bot.log('bank: could not open for event junk — falling back to drop');
            }
        }

        this.bot.setStatus('dropping junk');
        let dropped = 0;
        for (let guard = 0; guard < 28; guard++) {
            const item = this.bot.packJunkItems()[0];
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            if (await Execution.delayUntilTicks(() => Inventory.used() < before, 5)) {
                dropped += before - Inventory.used();
            } else {
                break;
            }
        }
        if (dropped > 0) {
            this.bot.log(`drop: cleared ${dropped} random/common junk stack(s) (pack space)`);
        }
    }
}

export class DropProduct implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!Inventory.isFull()) {
            return false;
        }
        if (this.bot.tickManipProfile().cookEatInterleave) {
            // Burnt always goes; raw haul drops; excess cooked beyond food buffer.
            return (
                this.bot.burntFishCount() > 0 ||
                this.bot.products().length > 0 ||
                this.bot.cookedFishCount() > 4
            );
        }
        if (
            (this.bot.tickManipProfile().useKnifeDelay ||
                this.bot.tickManipProfile().farmerWillowCycle) &&
            Inventory.items().some(i => isFletchByproductName(i.name))
        ) {
            return true;
        }
        return this.bot.products().length > 0;
    }

    async execute(): Promise<void> {
        // Drop burnt first during Tannerfishing so pack space opens for cook/eat.
        if (this.bot.tickManipProfile().cookEatInterleave && this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }
        // Knife/farmer: clear Make-X leftovers so the pack cannot soft-lock on shafts.
        if (
            this.bot.tickManipProfile().useKnifeDelay ||
            this.bot.tickManipProfile().farmerWillowCycle
        ) {
            await dropFletchByproducts(this.bot);
        }
        await dropAll(this.bot);
        // Tannerfishing: if still full of cooked food, trim to a small buffer.
        if (this.bot.tickManipProfile().cookEatInterleave && Inventory.isFull()) {
            await dropExcessCooked(this.bot, 3);
        }
    }
}

async function dropAll(bot: GatheringBot): Promise<void> {
    bot.setStatus('dropping');
    // Tannerfishing keeps cooked catch as food — products() is raw-only for Fisher.
    for (let guard = 0; guard < 30; guard++) {
        const item = bot.products()[0];
        if (!item) {
            break;
        }
        // Knife-delay: never drop the last fletchable delay log.
        if (
            bot.tickManipProfile().useKnifeDelay &&
            isFletchableLogName(item.name)
        ) {
            const logs = Inventory.items().filter(i => isFletchableLogName(i.name));
            const total = logs.reduce((s, i) => s + Math.max(1, i.count), 0);
            if (total <= 1) {
                // Only the delay log left among products — stop.
                const other = bot.products().find(i => !isFletchableLogName(i.name));
                if (!other) {
                    break;
                }
                const beforeOther = Inventory.used();
                await other.interact('Drop');
                await Execution.delayUntilTicks(() => Inventory.used() < beforeOther, 5);
                continue;
            }
        }
        const before = Inventory.used();
        await item.interact('Drop');
        await Execution.delayUntilTicks(() => Inventory.used() < before, 5);
    }
    bot.log('drop: haul cleared');
}

/** Drop cooked fish above `keep` (Tannerfishing food buffer). */
async function dropExcessCooked(bot: GatheringBot, keep = 3): Promise<void> {
    let dropped = 0;
    for (let guard = 0; guard < 28; guard++) {
        if (bot.cookedFishCount() <= keep) {
            break;
        }
        const item = Inventory.items().find(i => isCookedFishName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        if (await Execution.delayUntilTicks(() => Inventory.used() < before, 5)) {
            dropped += before - Inventory.used();
        } else {
            break;
        }
    }
    if (dropped > 0) {
        bot.log(`tick: dropped ${dropped} excess cooked (keep ${keep})`);
    }
}

/** Drop arrow shafts / unstrung bows from knife Make-X so knife-delay cannot soft-lock. */
async function dropFletchByproducts(bot: GatheringBot): Promise<void> {
    let dropped = 0;
    for (let guard = 0; guard < 28; guard++) {
        const item = Inventory.items().find(i => isFletchByproductName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        if (await Execution.delayUntilTicks(() => Inventory.used() < before, 5)) {
            dropped += before - Inventory.used();
        } else {
            break;
        }
    }
    if (dropped > 0) {
        bot.log(`tick: dropped ${dropped} fletch byproduct(s)`);
    }
}

export class BankCatch implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.bankCatchBlockedByCook() || this.bot.bankCatchBlockedByBurn()) {
            return false;
        }
        // Partner modes: hand off / cooker / supplier — not BankCatch.
        if (
            this.bot.isMuleGatherer()
            || this.bot.isMuleReceiver()
            || this.bot.isMuleCooker()
            || this.bot.isMuleSupplier()
        ) {
            return false;
        }
        if (this.bot.strictDesertCampBanking() && Bank.isOpen()) {
            return true;
        }
        if (this.bot.strictDesertCampBanking()) {
            return this.bot.desertCampBankCatchNeeded();
        }
        if (this.bot.minerFoodRestockNeeded()) {
            return true;
        }
        return Inventory.isFull() && this.bot.hasDepositable();
    }

    async execute(): Promise<void> {
        // Prefer cook-result count when banking after cook-then-bank (products() is raw-only).
        const had = Math.max(
            this.bot.products().length,
            this.bot.cookedFishCount() + (this.bot.getBurntPolicy() === 'bank' ? this.bot.burntFishCount() : 0)
        );
        const log = (m: string) => this.bot.log(`  ${m}`);
        const deposit = (name: string) => this.bot.shouldDeposit(name);
        const strict = this.bot.strictDesertCampBanking();
        const beforeOpen = strict ? await this.bot.shantayBackpackBeforeOpen(log) : null;
        if (strict && beforeOpen === null) {
            this.bot.stopStrictBankFailure('desert camp: normal backpack was unreadable before Shantay bank');
            return;
        }
        const expectedAfterDeposit = beforeOpen?.filter(item => !deposit(item.name ?? '')) ?? null;
        const refreshRaw = async () => {
            if (!(this.bot.isFishing() && this.bot.getCookMode() === 'bank-raw-then-cook')) {
                return;
            }

            await Execution.delayUntilTicks(() => Bank.loaded(), 5);
            await Execution.delayTicks(1);
            const total = this.bot.refreshBankRawTotal();
            this.bot.log(`bank: raw ${cookFilterLabel(this.bot.getCookFishFilter())} ${total}/${this.bot.getBankRawTarget()}`);
        };

        this.bot.setStatus('bank: heading to bank');
        if (!(await this.bot.openScriptBank(log))) {
            if (strict) {
                this.bot.stopStrictBankFailure('desert camp: Shantay chest is unreachable');
                return;
            }
            this.bot.setStatus('bank: nearest bank');
            const banked = await Banking.bankNearest({
                deposit,
                log,
                afterDeposit: async () => {
                    await refreshRaw();
                }
            });
            if (!banked) {
                this.bot.setStatus('bank: unreachable — dropping');
                this.bot.log('bank: unreachable — dropping');
                await dropAll(this.bot);
                return;
            }
        } else {
            if (strict) {
                if (!(await this.bot.waitBankReady(log))) {
                    this.bot.stopStrictBankFailure('desert camp: Shantay bank item list did not load');
                    return;
                }
                if (!(await Bank.backpackReady(beforeOpen!, log))) {
                    this.bot.stopStrictBankFailure('desert camp: Shantay side backpack did not load');
                    return;
                }
            }
            await Execution.delayTicks(bankPaceTicks());
            const bankGenerationBeforeDeposit = strict ? Bank.snapshotGeneration() : -1;
            try {
                await Bank.depositAllMatching(deposit, log);
            } catch (error) {
                if (this.bot.strictDesertCampBanking()) {
                    this.bot.stopStrictBankFailure(`desert camp: Shantay deposit failed: ${error instanceof Error ? error.message : String(error)}`);
                    return;
                }
                throw error;
            }
            if (strict) {
                if (!(await Bank.backpackReady(expectedAfterDeposit!, log))) {
                    this.bot.stopStrictBankFailure('desert camp: Shantay deposit did not produce the expected backpack');
                    return;
                }
                if (expectedAfterDeposit!.length < beforeOpen!.length && !(await Bank.waitSnapshotAfter(bankGenerationBeforeDeposit))) {
                    this.bot.stopStrictBankFailure('desert camp: Shantay bank stock did not update after deposit');
                    return;
                }
            }
            await Execution.delayTicks(1);
            await refreshRaw();
        }
        if (strict) {
            await Execution.delayUntilTicks(() => this.bot.desertCampDepositResidue().length === 0 || !Bank.isOpen(), 9);
            const residue = this.bot.desertCampDepositResidue();
            if (residue.length > 0) {
                this.bot.stopStrictBankFailure(`desert camp: Shantay deposit incomplete; still holding ${residue.join(', ')}`);
                return;
            }
            if (!(await this.bot.waitBankReady(log))) {
                this.bot.stopStrictBankFailure('desert camp: Shantay bank item list did not reload after deposit');
                return;
            }
        }
        const routePlan = this.bot.desertCampSupplyPlanAtOpenBank();
        if (routePlan && !routePlan.ok) {
            this.bot.stopStrictBankFailure(`desert camp: missing supplies: ${routePlan.missing.join(', ')}`);
            return;
        }
        // The Shantay crossing swaps a pass for a disclaimer, so provisioning
        // must leave its own ore slot instead of expecting the pass to free one.
        const reservedRouteSlots = routePlan
            ? this.bot.desertCampFoodReservedSlots(routePlan.requiredSlots)
            : 0;
        if (reservedRouteSlots > 0) {
            this.bot.log(`desert camp: reserving ${reservedRouteSlots} pack slot(s) for route supplies`);
        }

        if (had > 0) {
            this.bot.countTrip(had);
            this.bot.log(`bank: deposited ${had} ${this.bot.productLabel()}`);
        } else if (this.bot.minerFoodEnabled()) {
            this.bot.log('bank: preparing Miner food trip (no haul to deposit)');
        }

        // Same bank open: top up bait/feathers toward baitQty before heading back.
        if (this.bot.isFishing() && this.bot.needsFishingBaitTopUp()) {
            await this.bot.topUpFishingBaitAtBank(log);
        }

        if (this.bot.minerFoodEnabled() && !(await this.bot.topUpMinerFoodAtBank(log, reservedRouteSlots))) {
            return;
        }

        if (routePlan && !(await this.bot.desertCampWithdrawSuppliesAtOpenBank(routePlan))) {
            return;
        }
        // Opportunistic tool upgrade while already banking — never yank mid-chop.
        if (await this.bot.tryUpgradeGatherToolAtBank(log)) {
            return;
        }

        if (Bank.isOpen() && !(await this.bot.closeScriptBank(log, strict ? { allowForgetful: false } : undefined))) {
            if (strict) {
                this.bot.stopStrictBankFailure('desert camp: Shantay bank did not close');
                return;
            }
        }
        this.bot.completeDesertCampBankTrip();
        // Why: after depositing, long bank-to-mine legs need the full resilient-walk budget unless a cook batch intentionally stays.
        if (!this.bot.isCookBatchReady()) {
            this.bot.setStatus('bank: returning to camp');
            const home = await this.bot.walkHomeIfNeeded(log);
            if (!home) {
                this.bot.log('bank: walk home incomplete — will retry via gather/return');
            }
        }
    }
}

export class FishCookDialog implements Task {
    constructor(private bot: GatheringBot) {}
    validate(): boolean {
        return this.bot.cookEnabled() && ChatDialog.isMakeMenu();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('cook: choosing product');

        const raw = this.bot.lastRawFish();
        const hint = raw?.name ?? undefined;
        // This revision has no Make-X — pick the highest fixed qty button (often 1).
        if (!(await ChatDialog.make(hint))) {
            await ChatDialog.make();
        }
        await Execution.delayTicks(1);
    }
}

export class FishCookLoad implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || ChatDialog.isOpen() || EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        const cookable = this.bot.cookableRawCount();
        if (cookable <= 0) {
            return false;
        }

        if (this.bot.isCookingLoad()) {
            return true;
        }

        if (
            this.bot.getCookMode() === 'cook-then-bank' &&
            shouldCookThenBank(this.bot.getCookMode(), Inventory.isFull(), cookable)
        ) {
            return true;
        }

        if (this.bot.getCookMode() === 'bank-raw-then-cook' && this.bot.isCookBatchReady() && cookable > 0) {
            return true;
        }
        // Cooker mule: cook any received raw even when the pack is not full.
        if (this.bot.isMuleCooker() && cookable > 0) {
            return true;
        }
        return false;
    }

    async execute(): Promise<void> {
        const rangeTile = this.bot.rangeTile();
        if (!rangeTile) {
            return;
        }
        this.bot.beginCookingLoad();

        const findRange = () =>
            Locs.query()
                .name(this.bot.rangeLocName(), 'Range', 'Cooking range', 'Fire', 'Fireplace')
                .where(l => l.tile().distanceTo(rangeTile) <= this.bot.rangeLeash())
                .nearest() ??
            Locs.query()
                .name(this.bot.rangeLocName(), 'Range', 'Cooking range', 'Fire', 'Fireplace')
                .nearest();

        // Two-step path when curated: approach (door exterior) then interior stand.
        // Street-side stands path without doors; useOn then clicks the oven through a wall.
        const approach = this.bot.rangeApproachTile();
        const obs = this.bot.cookObstacleList();

        const walkToOven = async (why: string): Promise<void> => {
            const tag = why ? ` (${why})` : '';
            this.bot.setStatus(`cook: walking to range${tag}`);
            if (approach) {
                const at = Game.tile();
                if (!at || approach.distanceTo(at) > 2) {
                    this.bot.log(`cook: walking to approach ${approach}${why ? ` — ${why}` : ''}`);
                    await walkOpening(approach, 1, obs, m => this.bot.log(m));
                }
                // Proactively open Large door / house Door at the approach tile.
                const shut = Locs.query()
                    .where(l => isOpenableObstacle(l.name, l.actions(), obs))
                    .where(l => l.distance() <= 3)
                    .nearest();
                if (shut) {
                    const op = openOp(shut.actions());
                    if (op) {
                        this.bot.log(`cook: opening ${shut.name} at approach`);
                        await shut.interact(op);
                        await Execution.delayTicks(2);
                    }
                }
            }
            await walkOpening(rangeTile, 0, obs, m => this.bot.log(m));
            if (!findRange()) {
                const loc = this.bot.rangeLocMapTile();
                if (loc) {
                    this.bot.log(`cook: no oven in leash — closing on loc ${loc}`);
                    await walkOpening(loc, 1, obs, m => this.bot.log(m));
                }
            }
            // Open any still-shut door next to us (street-side stand → house door).
            const nearDoor = Locs.query()
                .where(l => isOpenableObstacle(l.name, l.actions(), obs))
                .where(l => l.distance() <= 3)
                .nearest();
            if (nearDoor) {
                const op = openOp(nearDoor.actions());
                if (op) {
                    this.bot.log(`cook: opening ${nearDoor.name} near stand`);
                    await nearDoor.interact(op);
                    await Execution.delayTicks(2);
                    await walkOpening(rangeTile, 0, obs, m => this.bot.log(m));
                }
            }
        };

        const here = Game.tile();
        if (!here || rangeTile.distanceTo(here) > 1 || !findRange()) {
            await walkToOven(approach ? 'approach→stand' : '');
            // Door hops leave the range unready for a tick or two (Sinclair).
            await Execution.delayTicks(2);
        }

        // This revision has no Make-X: each useOn (+ optional make-menu qty button)
        // cooks one fish. All waits are tick-based — re-useOn mid-anim cancels the cook.
        let wallRecoveries = 0;
        // After finishing a fish in this execute(), next click skips the in-flight probe.
        let skipInFlightProbe = false;
        // Bound by attempts (one fish / stall each), not wall-clock.
        for (let attempt = 0; attempt < 48 && this.bot.cookableRawCount() > 0; attempt++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) {
                return;
            }
            if (EventSignal.pending() || Game.inCombat()) {
                return;
            }

            // Re-entry after make-menu: cook may already be animating — drain on ticks.
            if (!skipInFlightProbe) {
                const idleRaw = this.bot.cookableRawCount();
                const idleXp = Skills.xp('cooking');
                let sawProgress = false;
                for (let t = 0; t < 4; t++) {
                    if (
                        this.bot.cookableRawCount() < idleRaw
                        || Skills.xp('cooking') > idleXp
                        || this.bot.cookableRawCount() === 0
                        || ChatDialog.isMakeMenu()
                        || ChatDialog.canContinue()
                        || EventSignal.pending()
                        || Game.inCombat()
                    ) {
                        sawProgress = true;
                        break;
                    }
                    await Execution.delayTicks(1);
                }
                if (this.bot.cookableRawCount() === 0) {
                    break;
                }
                if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) {
                    return;
                }
                if (EventSignal.pending() || Game.inCombat()) {
                    return;
                }
                if (
                    sawProgress
                    || this.bot.cookableRawCount() < idleRaw
                    || Skills.xp('cooking') > idleXp
                ) {
                    // Finish this single fish (raw drop) if only XP moved so far.
                    for (
                        let t = 0;
                        t < 10
                        && this.bot.cookableRawCount() >= idleRaw
                        && !ChatDialog.isMakeMenu()
                        && !EventSignal.pending()
                        && !Game.inCombat();
                        t++
                    ) {
                        await Execution.delayTicks(1);
                    }
                    wallRecoveries = 0;
                    await Execution.delayTicks(1);
                    skipInFlightProbe = true;
                    continue;
                }
            }
            skipInFlightProbe = false;

            const raw = this.bot.lastRawFish();
            const oven = findRange();
            if (!raw || !oven) {
                this.bot.log(
                    `cook: cannot cook (raw=${raw?.name ?? 'none'} oven=${oven ? 'yes' : 'no'})`
                );
                if (wallRecoveries < 3) {
                    wallRecoveries++;
                    await walkToOven('no oven');
                    continue;
                }
                await Execution.delayTicks(2);
                return;
            }

            this.bot.setStatus(`cook: ${raw.name} (${this.bot.cookableRawCount()} left)`);
            const beforeRaw = this.bot.cookableRawCount();
            const beforeXp = Skills.xp('cooking');
            if (!(await raw.useOn(oven))) {
                await Execution.delayTicks(2);
                continue;
            }

            // Fail-fast on street-side stands; allow a bit longer after door hops
            // (Sinclair range) before treating useOn as a wrong-room stall.
            let reacted = false;
            for (let t = 0; t < 8; t++) {
                if (
                    this.bot.cookableRawCount() < beforeRaw
                    || Skills.xp('cooking') > beforeXp
                    || ChatDialog.isMakeMenu()
                    || ChatDialog.canContinue()
                ) {
                    reacted = true;
                    break;
                }
                await Execution.delayTicks(1);
            }
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) {
                // Dialog picks product; next execute() drains in-flight cook above.
                return;
            }
            if (!reacted) {
                const at = Game.tile();
                const atStand = at !== null && rangeTile.distanceTo(at) <= 2;
                // Soft retry at stand before a full approach→stand repath (Seers
                // log burned ~80s thrashing doors on three re-paths).
                if (atStand && wallRecoveries < 2) {
                    wallRecoveries++;
                    this.bot.log(
                        `cook: useOn no progress at stand — soft re-click (try ${wallRecoveries})`
                    );
                    await Execution.delayTicks(2);
                    continue;
                }
                if (atStand && wallRecoveries < 4) {
                    wallRecoveries++;
                    this.bot.log(
                        `cook: useOn produced no cook progress at stand — re-path (try ${wallRecoveries})`
                    );
                    await walkToOven('useOn stall');
                    continue;
                }
                await Execution.delayTicks(1);
                continue;
            }

            // Direct cook (no menu) — wait this fish out on ticks, then next click.
            wallRecoveries = 0;
            for (
                let t = 0;
                t < 10
                && this.bot.cookableRawCount() >= beforeRaw
                && !ChatDialog.isMakeMenu()
                && !ChatDialog.canContinue()
                && !EventSignal.pending()
                && !Game.inCombat();
                t++
            ) {
                await Execution.delayTicks(1);
            }
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) {
                return;
            }
            if (EventSignal.pending() || Game.inCombat()) {
                return;
            }
            if (this.bot.cookableRawCount() < beforeRaw) {
                await Execution.delayTicks(1);
                skipInFlightProbe = true;
            }
        }

        if (this.bot.cookableRawCount() === 0) {
            if (this.bot.getBurntPolicy() === 'drop' && this.bot.burntFishCount() > 0) {
                await dropBurnt(this.bot);
            }
            await Execution.delayTicks(1);
        }
    }
}

export class FishBankCooked implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || EventSignal.pending() || Game.inCombat()) {
            return false;
        }

        if (!this.bot.isCookingLoad()) {
            return false;
        }
        return this.bot.cookableRawCount() === 0;
    }

    async execute(): Promise<void> {

        if (this.bot.getBurntPolicy() === 'drop' && this.bot.burntFishCount() > 0) {
            await dropBurnt(this.bot);
        }

        const cooked = this.bot.cookedFishCount();
        const hasDeposit = Inventory.items().some(i => this.bot.shouldDepositCookResult(i.name ?? ''));
        const log = (m: string) => this.bot.log(`  ${m}`);
        const deposit = (name: string) => this.bot.shouldDepositCookResult(name);

        if (hasDeposit) {
            this.bot.setStatus('bank: cooked fish');
            let deposited = false;
            if (await this.bot.openScriptBank(log)) {
                await Execution.delayTicks(bankPaceTicks());
                await Bank.depositAllMatching(deposit);
                await Execution.delayUntilTicks(() => Bank.loaded(), 5);
                await Execution.delayTicks(1);
                if (this.bot.getCookMode() === 'bank-raw-then-cook') {
                    this.bot.refreshBankRawTotal();
                }
                deposited = true;
                this.bot.countTrip(cooked);
                this.bot.log(`bank: deposited ${cooked} cooked (burnt=${this.bot.getBurntPolicy()})`);
            } else {
                // Long cook→bank legs (Sinclair→Seers) sometimes fail openScriptBank once;
                // fall back to nearest booth so we do not soft-lock cookingLoad forever.
                this.bot.log('bank: script bank open failed — trying nearest');
                const nearestOk = await Banking.bankNearest({
                    deposit,
                    // Match openScriptBank path: only cook-result matcher, not common junk.
                    commonJunk: false,
                    log,
                    afterDeposit: async () => {
                        if (this.bot.getCookMode() === 'bank-raw-then-cook') {
                            this.bot.refreshBankRawTotal();
                        }
                    }
                });
                if (nearestOk) {
                    deposited = true;
                    this.bot.countTrip(cooked);
                    this.bot.log(
                        `bank: deposited ${cooked} cooked via nearest (burnt=${this.bot.getBurntPolicy()})`
                    );
                } else {
                    this.bot.log('bank: could not open for cooked — will retry');
                    return;
                }
            }
            if (!deposited) {
                return;
            }
        } else {
            this.bot.log('cook: load finished, nothing to bank');
        }


        if (this.bot.getCookMode() === 'bank-raw-then-cook') {
            this.bot.finishCookCycle();
            if (this.bot.isCookBatchReady()) {

                return;
            }
            if (this.bot.getAfterCook() === 'stop') {

                return;
            }

        } else {
            this.bot.endCookingLoad();
        }
        await this.bot.walkHomeIfNeeded(log);
    }
}

export class FishWithdrawCookBatch implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.cookEnabled() || this.bot.getCookMode() !== 'bank-raw-then-cook') {
            return false;
        }
        if (!this.bot.isCookBatchReady() || this.bot.isCookingLoad()) {
            return false;
        }

        return this.bot.cookableRawCount() === 0 && !EventSignal.pending() && !Game.inCombat();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        this.bot.setStatus('cook: withdrawing raw');

        if (!(await this.bot.openScriptBank(log))) {
            this.bot.log('cook: could not open bank for withdraw — will retry');
            return;
        }
        await Execution.delayUntilTicks(() => Bank.loaded(), 5);
        await Execution.delayTicks(1);

        this.bot.refreshBankRawTotal();


        const rawItem = Bank.items().find(i => i.name !== null && this.bot.isCookableRaw(i.name));
        if (!rawItem || rawItem.name === null) {
            this.bot.log(
                `cook: no ${cookFilterLabel(this.bot.getCookFishFilter())} left in bank — ending batch`
            );

            this.bot.forceBankRawEmpty();
            this.bot.finishCookCycle();
            if (!this.bot.isCookBatchReady() && this.bot.getAfterCook() === 'continue') {
                await this.bot.walkHomeIfNeeded(log);
            }
            return;
        }
        const bankName = rawItem.name;
        const allOp = withdrawOp(rawItem.ops, 'all');
        if (allOp) {
            this.bot.log(`cook: withdraw all ${bankName} (bank had ${this.bot.getBankRawInBank()})`);
            await Bank.withdraw(bankName, allOp);
            await Execution.delayUntilTicks(() => this.bot.cookableRawCount() > 0 || Bank.count(bankName) === 0, 7);
        } else {
            const tenOp = withdrawOp(rawItem.ops, '10') ?? withdrawOp(rawItem.ops, 'any') ?? 'Withdraw-10';
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(bankName) > 0; n++) {
                const before = this.bot.cookableRawCount();
                await Bank.withdraw(bankName, tenOp);
                if (!(await Execution.delayUntilTicks(() => this.bot.cookableRawCount() > before || Inventory.isFull(), 5))) {
                    break;
                }
                await Execution.delayTicks(cookPaceTicks());
            }
        }


        await Execution.delayUntilTicks(() => Bank.loaded(), 4);
        this.bot.refreshBankRawTotal();

        if (this.bot.cookableRawCount() === 0) {
            this.bot.log('cook: withdraw empty — ending batch');

            this.bot.refreshBankRawTotal();
            if (this.bot.getBankRawInBank() === 0 || !Bank.items().some(i => i.name !== null && this.bot.isCookableRaw(i.name))) {
                this.bot.forceBankRawEmpty();
            }
            this.bot.finishCookCycle();
            if (!this.bot.isCookBatchReady() && this.bot.getAfterCook() === 'continue') {
                await this.bot.walkHomeIfNeeded(log);
            }
            return;
        }


        this.bot.beginCookingLoad();
        this.bot.log(
            `cook: withdrew ${this.bot.cookableRawCount()} ${bankName} (bank left ${this.bot.getBankRawInBank()})`
        );
    }
}

async function dropBurnt(bot: GatheringBot): Promise<void> {
    bot.setStatus('cook: dropping burnt');
    let dropped = 0;
    for (let guard = 0; guard < 30; guard++) {
        const item = Inventory.items().find(i => isBurntFishName(i.name));
        if (!item) {
            break;
        }
        const before = Inventory.used();
        await item.interact('Drop');
        if (await Execution.delayUntilTicks(() => Inventory.used() < before, 5)) {
            dropped += before - Inventory.used();
        }
        await Execution.delayTicks(1);
    }
    if (dropped > 0) {
        bot.log(`cook: dropped ${dropped} burnt (session ${bot.burntTotal()})`);
    }
}

/**
 * Broken pick/axe: prefer Nurmof/Bob repair when Acquire tools is on; else bank
 * for a replacement pick (legacy). Broken axe without acquire falls through to restock.
 */
export class RepairBrokenGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        return this.bot.hasBrokenGatherTool();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        const brokenPick = Equipment.contains(BROKEN_PICKAXE) || Inventory.first(BROKEN_PICKAXE) !== null;
        const brokenAxe = Equipment.contains(BROKEN_AXE) || Inventory.first(BROKEN_AXE) !== null;

        if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
            const plan = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorld(), { upgrade: false });
            if (plan?.kind === 'repair') {
                const ok = await this.bot.executeToolAcquirePlan(plan, log);
                if (ok) {
                    await this.bot.walkHomeIfNeeded(log);
                    return;
                }
                this.bot.log('acquire: repair failed — falling back to bank/buy');
            }
        }

        // Bank replacement for broken pick (deposit broken, withdraw best).
        if (brokenPick) {
            this.bot.setStatus('pickaxe: fetching replacement');
            this.bot.log(
                this.bot.isPowerMode()
                    ? 'pickaxe: broken — power mode nearest-bank replacement'
                    : 'pickaxe: broken — banking for best replacement'
            );

            if (Equipment.contains(BROKEN_PICKAXE) && !Inventory.isFull()) {
                await Equipment.unequip(BROKEN_PICKAXE);
            }

            const strict = this.bot.strictDesertCampBanking();
            const beforeOpen = strict ? await this.bot.shantayBackpackBeforeOpen(log) : null;
            if (strict && beforeOpen === null) {
                this.bot.stopMissingGear('normal backpack unreadable before Shantay bank', ['pickaxe']);
                return;
            }

            if (!(await this.bot.openScriptBank(log))) {
                if (this.bot.isPowerMode() || this.bot.strictDesertCampBanking()) {
                    this.bot.stopMissingGear('could not open nearest bank for pickaxe', ['pickaxe']);
                    return;
                }
                this.bot.log('pickaxe: could not open bank — will retry');
                return;
            }

            if (strict && (!(await this.bot.waitBankReady(log)) || !(await Bank.backpackReady(beforeOpen!, log)))) {
                this.bot.stopMissingGear('Shantay bank did not become transaction-ready', ['pickaxe']);
                return;
            }

            const restockDeposit = this.bot.restockDepositMatcher();
            const deposit = (name: string): boolean => restockDeposit(name) || name.toLowerCase() === BROKEN_PICKAXE.toLowerCase();
            const expectedAfterDeposit = beforeOpen?.filter(item => !deposit(item.name ?? '')) ?? null;
            const bankGenerationBeforeDeposit = strict ? Bank.snapshotGeneration() : -1;
            await Bank.depositAllMatching(deposit);
            if (strict) {
                if (!(await Bank.backpackReady(expectedAfterDeposit!, log))) {
                    this.bot.stopMissingGear('Shantay replacement deposit did not produce the expected backpack', ['pickaxe']);
                    return;
                }
                if (expectedAfterDeposit!.length < beforeOpen!.length && !(await Bank.waitSnapshotAfter(bankGenerationBeforeDeposit))) {
                    this.bot.stopMissingGear('Shantay bank stock did not update after replacement deposit', ['pickaxe']);
                    return;
                }
            }
            await Execution.delayUntilTicks(() => Bank.loaded(), 5);
            const pick = bestPickaxe(Skills.level('mining'), name => Bank.count(name) > 0);
            if (!pick) {
                if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                    const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                        upgrade: false
                    });
                    if (buy && buy.kind !== 'repair') {
                        if (Bank.isOpen()) {
                            await this.bot.closeScriptBank(log, { allowForgetful: false });
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log);
                        if (ok) {
                            await this.bot.walkHomeIfNeeded(log);
                            return;
                        }
                    }
                }
                ScriptRunner.stop('pickaxe: no usable pick in bank');
                return;
            }
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === pick.toLowerCase());
            const one = item ? withdrawOp(item.ops, '1') ?? 'Withdraw-1' : 'Withdraw-1';
            await Bank.withdraw(pick, one);
            if (!(await Execution.delayUntilTicks(() => Inventory.first(pick) !== null, 5))) {
                if (this.bot.isPowerMode()) {
                    this.bot.stopMissingGear('pickaxe withdraw failed', [pick]);
                    return;
                }
                if (this.bot.strictDesertCampBanking()) {
                    this.bot.stopMissingGear('pickaxe withdraw failed', [pick]);
                    return;
                }
                this.bot.log('pickaxe: withdraw did not land — will retry');
                return;
            }
            this.bot.log(`pickaxe: replaced with ${pick}`);
            // Close once, then equip offline (replacement may displace broken/other gear).
            if (Bank.isOpen()) {
                await this.bot.closeScriptBank(log);
            }
            await this.bot.equipTools([pick], log, { bankDisplaced: true });
            await this.bot.walkHomeIfNeeded(log);
            return;
        }

        if (brokenAxe) {
            if (Equipment.contains(BROKEN_AXE) && !Inventory.isFull()) {
                await Equipment.unequip(BROKEN_AXE);
            }
            if (await this.bot.openScriptBank(log)) {
                await Bank.depositAllMatching(n => n.toLowerCase() === BROKEN_AXE.toLowerCase());
                await Execution.delayUntilTicks(() => Bank.loaded(), 4);
                if (Bank.isOpen()) {
                    await this.bot.closeScriptBank(log);
                }
            }
            this.bot.log('axe: deposited broken — restock/acquire will fetch a usable axe');
        }
    }
}

/** Wield axes/picks already in the pack (hasGear is true when held unworn). */
export class EnsureGatherToolEquipped implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.isFishing() || this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        if (this.bot.hasBrokenGatherTool()) {
            return false;
        }
        return this.bot.toolsToEquip().length > 0;
    }

    async execute(): Promise<void> {
        const need = this.bot.toolsToEquip();
        this.bot.setStatus(`equip: ${need.join(' + ')}`);
        this.bot.log(`equip: wielding ${need.join(', ')}`);
        await this.bot.equipTools(need);
    }
}

export class RestockFishingGear implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.isFishing() || this.bot.hasGear()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.cookEnabled() && (this.bot.isCookingLoad() || this.bot.isCookBatchReady())) {
            return false;
        }
        // Power mode only leaves the spot for tools when already away, or at start with no gear.
        // If somehow gear is lost on-spot, still allow the trip (missing gear is fatal otherwise).
        return this.bot.fishMethodDef() !== null;
    }

    async execute(): Promise<void> {
        const method = this.bot.fishMethodDef();
        if (!method) {
            return;
        }
        const missing = this.bot.missingGearNames();
        const power = this.bot.isPowerMode();
        this.bot.setStatus(`restock: ${missing.join(' + ') || this.bot.gearLabel()}`);
        this.bot.log(
            power
                ? `restock: power mode — nearest bank for ${missing.join(', ') || this.bot.gearLabel()}`
                : `restock: missing ${missing.join(', ') || this.bot.gearLabel()}`
        );
        const log = (m: string) => this.bot.log(`  ${m}`);

        // Why: when coins already cover the shop cart, the bank is skipped and the walk goes straight to Gerrant or Harry.
        // Why: held GP must not force Edgeville from Draynor to glance at an empty booth, though prefer-nearby Banking still helps when the bank is needed.
        if (this.bot.toolAcquireEnabled() && this.bot.acquireReady() && missing.length > 0) {
            const preCart = fishingGearShopCart(
                method,
                this.bot.acquireWorldWithBank(),
                this.bot.fishingAcquireOpts()
            );
            if (preCart.length > 0 && Inventory.count(COINS) >= buyPlansCost(preCart)) {
                this.bot.log('restock: coins held for shop cart — skipping bank, heading to vendor');
                const ok = await this.bot.executeFishingGearShopCart(preCart, log, {
                    bankPrepared: true
                });
                // Always leave the shop toward camp after any successful buy —
                // partial carts used to soft-lock on Gerrant's tile.
                if (ok) {
                    this.bot.setStatus('restock: returning to camp');
                    await this.bot.walkHomeIfNeeded(log);
                    return;
                }
                // Shop failed — fall through to bank path for a normal retry.
            }
        }

        if (!(await this.bot.openScriptBank(log))) {
            if (power) {
                this.bot.stopMissingGear('could not open nearest bank', missing);
                return;
            }
            this.bot.log('restock: could not open bank — will retry');
            await Execution.delayTicks(3);
            return;
        }
        await Execution.delayTicks(bankPaceTicks());
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);

        // Deposit everything that is not required gear (clears haul / junk before tool withdraw).
        if (power || this.bot.awayFromGatherSpot()) {
            this.bot.log('restock: depositing non-gear first');
        }
        await Bank.depositAllMatching(this.bot.restockDepositMatcher());
        await Execution.delayUntilTicks(() => Bank.loaded(), 5);
        await Execution.delayTicks(1);

        const plan = fishingRestockPlan(
            method,
            name => Inventory.count(name),
            name => Bank.count(name)
        );
        if (plan.length === 0) {
            const still = this.bot.missingGearNames();
            if (still.length > 0) {
                if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                    // Same-vendor cart (rod + feathers at Gerrant) — one bank fund + one shop.
                    const cart = fishingGearShopCart(
                        method,
                        this.bot.acquireWorldWithBank(),
                        this.bot.fishingAcquireOpts()
                    );
                    if (cart.length > 0) {
                        const cartCost = buyPlansCost(cart);
                        // Why: coins kept through the deposit already cover the cart, so a second bank open is skipped and the walk goes straight to Gerrant or Harry.
                        // Why: otherwise executeBuyPlans funds at vendor.bankStand itself.
                        const invFunded = Inventory.count(COINS) >= cartCost;
                        if (Bank.isOpen()) {
                            await this.bot.closeScriptBank(log, { allowForgetful: false });
                        }
                        const ok = await this.bot.executeFishingGearShopCart(cart, log, {
                            bankPrepared: invFunded
                        });
                        if (ok) {
                            // Full or partial cart — leave the shop toward camp either way.
                            this.bot.setStatus('restock: returning to camp');
                            await this.bot.walkHomeIfNeeded(log);
                            return;
                        }
                    } else {
                        this.bot.log(
                            `restock: acquire on but cannot fund/shop ${still.join(' / ')} — need coins or stock`
                        );
                        this.bot.markAcquireBackoff(50);
                    }
                }
                if (power) {
                    this.bot.stopMissingGear('bank has no required fishing gear', still);
                    return;
                }
                this.bot.setStatus(`restock: missing in bank ${still.join(' + ')}`);
                this.bot.log(`restock: bank has no ${still.join(' / ')} — deposit gear or switch method`);
                await Execution.delayTicks(8);
                return;
            }
            this.bot.log('restock: gear already topped up');
            if (Bank.isOpen()) {
                await this.bot.closeScriptBank(log);
            }
            return;
        }

        for (const step of plan) {
            const before = Inventory.count(step.name);
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === step.name.toLowerCase());
            if (!item) {
                continue;
            }
            if (step.qty === 1) {
                const one = withdrawOp(item.ops, '1') ?? 'Withdraw-1';
                this.bot.log(`restock: withdraw 1× ${step.name}`);
                await Bank.withdraw(step.name, one);
            } else if (step.qty >= 50) {
                const all = withdrawOp(item.ops, 'all');
                if (all && Bank.count(step.name) <= step.qty) {
                    this.bot.log(`restock: withdraw all ${step.name} (${Bank.count(step.name)})`);
                    await Bank.withdraw(step.name, all);
                } else {
                    this.bot.log(`restock: withdraw ${step.qty}× ${step.name}`);
                    await Bank.withdrawX(step.name, step.qty);
                }
            } else {
                this.bot.log(`restock: withdraw ${step.qty}× ${step.name}`);
                await Bank.withdrawX(step.name, step.qty);
            }
            await Execution.delayUntilTicks(() => Inventory.count(step.name) > before || Bank.count(step.name) === 0, 7);
            await Execution.delayTicks(bankPaceTicks());
        }

        if (!this.bot.hasGear()) {
            const still = this.bot.missingGearNames();
            if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                const cart = fishingGearShopCart(
                    method,
                    this.bot.acquireWorldWithBank(),
                    this.bot.fishingAcquireOpts()
                );
                if (cart.length > 0) {
                    const cartCost = buyPlansCost(cart);
                    const invFunded = Inventory.count(COINS) >= cartCost;
                    if (Bank.isOpen()) {
                        await this.bot.closeScriptBank(log, { allowForgetful: false });
                    }
                    const ok = await this.bot.executeFishingGearShopCart(cart, log, {
                        bankPrepared: invFunded
                    });
                    if (ok) {
                        this.bot.setStatus('restock: returning to camp');
                        await this.bot.walkHomeIfNeeded(log);
                        return;
                    }
                }
            }
            if (power) {
                this.bot.stopMissingGear('incomplete after withdraw', still);
                return;
            }
            this.bot.setStatus(`restock: still missing ${still.join(' + ')}`);
            this.bot.log(`restock: incomplete — need ${still.join(', ')}`);
            await Execution.delayTicks(5);
            return;
        }

        if (Bank.isOpen()) {
            await this.bot.closeScriptBank(log);
        }
        this.bot.log(`restock: gear ok (${this.bot.gearLabel()})`);
        this.bot.setStatus('restock: returning to camp');
        await this.bot.walkHomeIfNeeded(log);
    }
}

export class RestockGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (this.bot.isFishing() || this.bot.hasGear()) {
            return false;
        }
        if (this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.hasBrokenGatherTool()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        return true;
    }

    async execute(): Promise<void> {
        const missing = this.bot.missingGearNames();
        const label = missing.join(' + ') || this.bot.gearLabel();
        const power = this.bot.isPowerMode();
        this.bot.setStatus(`restock: ${label}`);
        this.bot.log(
            power
                ? `restock: power mode — nearest bank for ${label}`
                : `restock: missing ${label}`
        );
        const log = (m: string) => this.bot.log(`  ${m}`);
        // Why: with hammer and bar — or shop GP, or a broken tool — already in the pack, the camp-bank hop is skipped.
        // Why: the suite seeds materials at Varrock West, so walking Draynor first burns the budget before the anvil walk starts.
        if (this.bot.toolAcquireEnabled() && this.bot.acquireReady() && missing.length > 0) {
            const preBuy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                upgrade: false
            });
            if (preBuy && this.bot.acquireMaterialsHeld(preBuy)) {
                this.bot.log(`restock: materials held for ${preBuy.kind} — skipping bank`);
                const ok = await this.bot.executeToolAcquirePlan(preBuy, log, { bankPrepared: true });
                if (ok) {
                    await this.bot.walkHomeIfNeeded(log);
                    return;
                }
                // Why: a path or random-event failure with coins or smith materials still held must not thrash the camp bank — buy-pick mid-random-event spends minutes on "no Bank booth".
                // Why: acquire backoff stays off, so the next Restock tick retries preBuy.
                this.bot.log(
                    `restock: ${preBuy.kind} failed with materials still held — retry without bank`
                );
                await Execution.delayTicks(3);
                return;
            }
        }

        const strict = this.bot.strictDesertCampBanking();
        const beforeOpen = strict ? await this.bot.shantayBackpackBeforeOpen(log) : null;
        if (strict && beforeOpen === null) {
            this.bot.stopMissingGear('normal backpack unreadable before Shantay bank', missing);
            return;
        }

        if (!(await this.bot.openScriptBank(log))) {
            if (power || this.bot.strictDesertCampBanking()) {
                this.bot.stopMissingGear('could not open nearest bank', missing);
                return;
            }
            this.bot.log(`restock: could not open bank for ${label} — will retry`);
            await Execution.delayTicks(3);
            return;
        }
        if (strict && (!(await this.bot.waitBankReady(log)) || !(await Bank.backpackReady(beforeOpen!, log)))) {
            this.bot.stopMissingGear('Shantay bank did not become transaction-ready', missing);
            return;
        }
        await Execution.delayTicks(bankPaceTicks());
        await Execution.delayUntilTicks(() => Bank.loaded() || !Bank.isOpen(), 5);

        if (power || this.bot.awayFromGatherSpot()) {
            this.bot.log('restock: depositing non-gear first');
        }
        const deposit = this.bot.restockDepositMatcher();
        const expectedAfterDeposit = beforeOpen?.filter(item => !deposit(item.name ?? '')) ?? null;
        const bankGenerationBeforeDeposit = strict ? Bank.snapshotGeneration() : -1;
        await Bank.depositAllMatching(deposit);
        if (strict) {
            if (!(await Bank.backpackReady(expectedAfterDeposit!, log))) {
                this.bot.stopMissingGear('Shantay restock deposit did not produce the expected backpack', missing);
                return;
            }
            if (expectedAfterDeposit!.length < beforeOpen!.length && !(await Bank.waitSnapshotAfter(bankGenerationBeforeDeposit))) {
                this.bot.stopMissingGear('Shantay bank stock did not update after restock deposit', missing);
                return;
            }
        }
        await Execution.delayUntilTicks(() => Bank.loaded(), 5);
        await Execution.delayTicks(1);

        const plan = this.bot.gatherToolRestockPlan();
        if (plan.length === 0) {
            const still = this.bot.missingGearNames();
            if (still.length > 0) {
                if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                    const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                        upgrade: false
                    });
                    if (buy) {
                        // After deposit-except-gear, smith bars/hammer (or shop GP)
                        // stay in pack when gearKeep includes them — hand off prepared.
                        const bankPrepared = this.bot.acquireMaterialsHeld(buy);
                        if (Bank.isOpen()) {
                            await this.bot.closeScriptBank(log, { allowForgetful: false });
                        }
                        const ok = await this.bot.executeToolAcquirePlan(buy, log, { bankPrepared });
                        if (ok) {
                            await this.bot.walkHomeIfNeeded(log);
                            return;
                        }
                    } else {
                        this.bot.log(
                            `restock: acquire on but cannot fund/shop ${still.join(' / ')} — need coins or materials`
                        );
                        this.bot.markAcquireBackoff(50);
                    }
                }
                if (power || this.bot.strictDesertCampBanking()) {
                    this.bot.stopMissingGear('bank has no required tools', still);
                    return;
                }
                this.bot.setStatus(`restock: no ${still.join(' / ') || label} in bank`);
                this.bot.log(`restock: bank has no ${still.join(' / ')} — deposit tools and restart`);
                await Execution.delayTicks(8);
                return;
            }
            this.bot.log('restock: tools already topped up');
            // Still try to equip anything held but unworn, then leave bank.
            const leftover = this.bot.toolsToEquip();
            if (Bank.isOpen()) {
                await this.bot.prepareWornSurplusForDeposit(log);
                await this.bot.depositSurplusGatherTools(log);
                await this.bot.closeScriptBank(log);
            }
            if (leftover.length > 0) {
                await this.bot.equipTools(leftover, log, { bankDisplaced: false });
            }
            return;
        }

        for (const step of plan) {
            const before = Inventory.count(step.name);
            const item = Bank.items().find(i => (i.name ?? '').toLowerCase() === step.name.toLowerCase());
            if (!item) {
                continue;
            }
            if (step.qty === 1) {
                const one = withdrawOp(item.ops, '1') ?? 'Withdraw-1';
                this.bot.log(`restock: withdraw 1× ${step.name}`);
                await Bank.withdraw(step.name, one);
            } else {
                this.bot.log(`restock: withdraw ${step.qty}× ${step.name}`);
                await Bank.withdrawX(step.name, step.qty);
            }
            await Execution.delayUntilTicks(() => Inventory.count(step.name) > before || Bank.count(step.name) === 0, 7);
            await Execution.delayTicks(bankPaceTicks());
        }

        // Same open: unequip/deposit surplus, close once, then Wield offline.
        await this.bot.prepareWornSurplusForDeposit(log);
        await this.bot.depositSurplusGatherTools(log);
        const toEquip = [
            ...plan.filter(s => s.equip).map(s => s.name),
            ...this.bot.toolsToEquip()
        ];
        if (Bank.isOpen()) {
            await this.bot.closeScriptBank(log);
        }
        if (toEquip.length > 0) {
            await this.bot.equipTools(toEquip, log, { bankDisplaced: false });
        }

        if (!this.bot.hasGear()) {
            const still = this.bot.missingGearNames();
            if (this.bot.toolAcquireEnabled() && this.bot.acquireReady()) {
                const buy = planGatherToolAcquire(this.bot.toolReqsList(), this.bot.acquireWorldWithBank(), {
                    upgrade: false
                });
                if (buy) {
                    const bankPrepared = this.bot.acquireMaterialsHeld(buy);
                    if (Bank.isOpen()) {
                        await this.bot.closeScriptBank(log, { allowForgetful: false });
                    }
                    const ok = await this.bot.executeToolAcquirePlan(buy, log, { bankPrepared });
                    if (ok) {
                        await this.bot.walkHomeIfNeeded(log);
                        return;
                    }
                }
            }
            if (power || this.bot.strictDesertCampBanking()) {
                this.bot.stopMissingGear('incomplete after withdraw', still);
                return;
            }
            this.bot.setStatus(`restock: still missing ${still.join(' + ')}`);
            this.bot.log(`restock: incomplete — need ${still.join(', ')}`);
            await Execution.delayTicks(5);
            return;
        }

        this.bot.log(`restock: tools ok (${this.bot.gearLabel()})`);
        await this.bot.walkHomeIfNeeded(log);
    }
}

// Why: the one-shot startup walks to the bank once to withdraw a better banked tier — steel while bronze is equipped — even under chop-then-burn, which has no BankCatch.
// Why: ongoing upgrades only run when already at or near the script bank, or with the bank UI open.
// Why: it never walks to the bank solely for a shop upgrade mid-run, which reads as a hang on cold start and yanks players off trees.
// Why: BankCatch also calls tryUpgradeGatherToolAtBank after deposits.

/** Optional bank, shop or smith upgrade when Acquire tools is on. */
export class UpgradeGatherTool implements Task {
    constructor(private bot: GatheringBot) {}

    validate(): boolean {
        if (!this.bot.toolAcquireEnabled()) {
            return false;
        }
        if (this.bot.isFishing() || this.bot.toolReqsList().length === 0) {
            return false;
        }
        if (this.bot.hasBrokenGatherTool()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }
        // Cold start: allow one bank trip from the tree line for banked better tools.
        if (this.bot.startupToolBankSyncNeeded()) {
            return this.bot.hasGear() || this.bot.toolAcquireEnabled();
        }
        if (!this.bot.acquireReady()) {
            return false;
        }
        if (!this.bot.hasGear()) {
            return false;
        }
        // Bank-side only after startup — do not open bank from the tree line for shop upgrades.
        return this.bot.nearScriptBank();
    }

    async execute(): Promise<void> {
        const log = (m: string) => this.bot.log(`  ${m}`);
        await this.bot.tryUpgradeGatherToolAtBank(log);
    }
}

export class Gather implements Task {
    constructor(private bot: GatheringBot) {}

    /** NPC index of the spot we last successfully started fishing on (null = no active session). */
    private activeFishIndex: number | null = null;

    /**
     * Distance origin for ranking fishing spots (prefer nearest to player).
     * Game.tile() is a plain WorldTile — wrap with Tile.from for distanceTo.
     */
    private fishSpotOrigin(): Tile {
        const freeformFish = this.bot.isNpc() && this.bot.isFreeformCamp();
        const namedCamp = this.bot.isNamedCamp();
        const here = Game.tile();
        if (gatherSpotRangeOrigin(freeformFish, here !== null, namedCamp) === 'player' && here) {
            return Tile.from(here);
        }
        return this.bot.getAnchor();
    }

    /** Freeform primary disk = UI/start leash; hunt extends past it. */
    private freeformHuntRadius(): number {
        return gatherHuntRadius(this.bot.leashRadius());
    }

    /** Shared filters: usable, not whirlpool, method matches. */
    private fishSpotBaseOk(n: { id: number; tile: () => Tile; actions: () => string[] }): boolean {
        return (
            this.bot.usable(keyOf(n.tile())) &&
            !WHIRLPOOL_IDS.has(n.id) &&
            this.bot.matchesSpot(n.actions())
        );
    }

    // Why: named and Auto-snap accept any spot inside camp membership from the home pin, with no player-distance wall.
    // Why: freeform accepts a spot within hunt of the player, or still within hunt of the start-tile anchor, so a river hop can be walked without idling on "within 40 of you".

    /** Whether a fishing spot is in range for this camp mode. */
    private fishSpotInRange(spotTile: Tile): boolean {
        if (this.bot.isNamedCamp()) {
            return resourceWithinCamp(this.bot.getAnchor().distanceTo(spotTile), this.bot.leashRadius());
        }
        const origin = this.fishSpotOrigin();
        const hunt = this.freeformHuntRadius();
        if (spotWithinGatherRange(origin.distanceTo(spotTile), hunt)) {
            return true;
        }
        // Spot still near the freeform start pin — walk the river even if far from the player.
        return spotWithinGatherRange(this.bot.getAnchor().distanceTo(spotTile), hunt);
    }

    // Why: named camps search the membership disk, which fixes "no spots within 40 of you" mid-pier.
    // Why: freeform searches the player and start hunt disks.

    /** Nearest matching fishing spot in scene for this mode. */
    private findFishSpot() {
        return Npcs.query()
            .name(this.bot.targetName())
            .where(n => this.fishSpotBaseOk(n) && this.fishSpotInRange(n.tile()))
            .nearest();
    }

    private findRock() {
        // Why: the camp membership fence (anchor leash) and the ore or tree type filters come first.
        // Why: rocks near the player are preferred, so the bot does not path across Dwarven tunnels or SE Varrock while a matching ore is underfoot.
        return Locs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            .where(
                l =>
                    // Allow distance 0 (standing on multi-tile tree/rock footprint).
                    tileWithinLeash(this.bot, l.tile()) &&
                    this.bot.matchesRock(l.id) &&
                    !GAS_ROCK_IDS.has(l.id) &&
                    this.bot.usable(keyOf(l.tile()))
            )
            .nearestPreferLocal(LOCAL_MINE_PREFER_RADIUS);
    }

    validate(): boolean {
        // Combat only blocks AFK gather — retaliate tick-manip keeps gathering.
        if (Inventory.isFull() || EventSignal.pending()) {
            return false;
        }
        if (combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())) {
            return false;
        }
        // After FleeCombat, don't walk back onto spiders while the hold is active.
        if (this.bot.shouldSuppressCampReentry()) {
            return false;
        }

        if (this.bot.cookEnabled() && (this.bot.isCookingLoad() || this.bot.isCookBatchReady())) {
            return false;
        }

        if (this.bot.burnEnabled() && this.bot.isBurningLoad()) {
            return false;
        }

        if (!this.bot.hasGear()) {
            return this.bot.isPowerMode();
        }

        if (this.bot.isFishing() && Game.animating()) {
            return true;
        }
        if (this.bot.isNpc()) {
            // Freeform fish measures spots from the player — still yield past the start-tile
            // leash so ReturnToAnchor bounds wander (don't chase the river).
            if (this.bot.isFreeformCamp() && beyondLeash(this.bot, Game.tile(), 4)) {
                return false;
            }
            // Named: any matching spot in camp membership. Freeform: player/start hunt disks.
            if (this.findFishSpot() !== null) {
                return true;
            }
            // No spots in range: keep-alive near the pier so status updates, but yield
            // to ReturnToAnchor when we've wandered off (e.g. after bank / whirlpool flee).
            return !beyondLeash(this.bot, Game.tile(), 4);
        }
        // Why: loc gather stays active near the anchor, so it logs "no trees/rocks" instead of idling silently.
        // Why: it yields past leash plus slack so ReturnToAnchor can pull the bot back — the Draynor bank is only ~12 from the willows.
        if (this.findRock() !== null) {
            return true;
        }
        return !beyondLeash(this.bot, Game.tile(), 4);
    }

    private gasAt(t: Tile): boolean {
        // Tile-local filter first so we do not scan the scene for name/action.
        return (
            Locs.query()
                .withinOf(t, 0)
                .where(l => GAS_ROCK_IDS.has(l.id))
                .nearest() !== null
        );
    }

    private spotByIndex(index: number) {
        return Npcs.query()
            .where(n => n.index === index)
            .nearest();
    }

    private fishingBroken(index: number, startTile: Tile): boolean {
        const live = this.spotByIndex(index);
        const spotGone = live === null;
        const spotMoved = live !== null && !live.tile().equals(startTile);
        const becameWhirlpool = live !== null && WHIRLPOOL_IDS.has(live.id);
        return fishingSessionBroken({
            eventPending: EventSignal.pending(),
            inventoryFull: Inventory.isFull(),
            dialogPending: ChatDialog.canContinue(),
            inCombat: Game.inCombat(),
            spotGone,
            spotMoved,
            becameWhirlpool,
            allowCombat: this.bot.allowCombatGather()
        });
    }

    // Why: JS evaluates call args eagerly, so shouldYieldGathering(... findRock() ...) rescans every Loc on every delayUntil poll even when the pack is full.

    /** Short-circuits cheap checks before scene queries. */
    private shouldYieldMine(tile: Tile): boolean {
        if (EventSignal.pending() || Inventory.isFull() || ChatDialog.canContinue()) {
            return true;
        }
        if (this.bot.minerFoodEnabled() && this.bot.shouldEatMinerFood()) {
            return true;
        }
        if (combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())) {
            return true;
        }
        // Gas is cheaper/more local than a full camp rock scan.
        if (this.gasAt(tile)) {
            return true;
        }
        return this.findRock() === null;
    }

    private async fleeGas(key: string, tile: Tile): Promise<void> {
        this.bot.log(`mine: smoking rock @ ${tile} — backing off`);
        this.bot.setStatus('mine: smoking rock');
        this.bot.cooldown(key, GAS_ROCK_TICKS + 10);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    private async fleeWhirlpool(tile: Tile): Promise<void> {
        this.bot.log(`fish: whirlpool @ ${tile} — stepping off`);
        this.bot.setStatus('fish: whirlpool');
        this.bot.cooldown(keyOf(tile), 70);
        DirectNavigator.walk(this.bot.getAnchor());
        await Execution.delayTicks(2);
    }

    async execute(): Promise<void> {
        if (!this.bot.hasGear()) {
            this.bot.setStatus(`gather: missing ${this.bot.gearLabel()}`);
            this.bot.log(`gather: missing ${this.bot.gearLabel()}`);
            await Execution.delayTicks(5);
            return;
        }

        if (EventSignal.pending()) {
            return;
        }
        if (combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())) {
            return;
        }

        if (this.bot.isFishing()) {
            await this.executeFish();
            return;
        }
        await this.executeMine();
    }

    /**
     * After a resource roll, optionally arm knife delay or schedule timed reclick.
     * Returns true when the caller should skip the normal AFK wait loop this beat.
     */
    private async afterRollTickManip(reclick: () => Promise<boolean>): Promise<boolean> {
        const profile = this.bot.tickManipProfile();
        if (profile.method === 'off') {
            return false;
        }
        this.bot.noteGatherRoll();

        if (profile.useKnifeDelay) {
            if (!this.bot.hasKnifeDelayKit() && !ChatDialog.isMakeMenu()) {
                this.bot.log('tick: knife delay needs Knife + 1 fletchable log');
                return false;
            }
            // t1: knife+Make-1 arms +2. t2: reclick gather. t3: delay expires / roll window.
            const phase = knifeDelayPhase(Game.tick(), this.bot.lastGatherRollTick());
            if (phase === 'delay-action' || ChatDialog.isMakeMenu()) {
                const armed = await this.bot.armKnifeDelay();
                if (!armed && !ChatDialog.isMakeMenu()) {
                    this.bot.log('tick: knife delay arm failed');
                    return false;
                }
            }
            // Do not wait for fletch product — reclick on the next game tick.
            await Execution.delayUntilTicks(() => Game.tick() >= this.bot.lastGatherRollTick() + 1, 2);
            await reclick();
            return true;
        }

        // Farmer 6t is driven by executeFarmerWillow — only stamp the roll here.
        if (profile.farmerWillowCycle) {
            return false;
        }

        // Timed reclick: fly 4t, iron pick-rate, and retaliate methods with a known
        // native cycle (2t oaks / 3t shortbow / tannerfish fly). Combat allowed.
        const cycle = this.bot.gatherCycleTicks();
        if (
            cycle != null &&
            cycle >= 1 &&
            (profile.timedReclick ||
                profile.method === 'iron-cadence' ||
                profile.allowCombat ||
                profile.nativeCycleTicks != null)
        ) {
            const due = nextGatherClickTick(this.bot.lastGatherRollTick(), cycle);
            this.bot.setStatus(`tick: wait ${cycle}t reclick`);
            await Execution.delayUntilTicks(
                () =>
                    Game.tick() >= due ||
                    Inventory.isFull() ||
                    EventSignal.pending() ||
                    combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather()),
                Math.max(1, due - Game.tick() + 2)
            );
            if (
                Inventory.isFull() ||
                EventSignal.pending() ||
                combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather())
            ) {
                return true;
            }
            await reclick();
            return true;
        }

        // Unknown cycle retaliate: stamp the roll; keep AFK wait (combat allowed).
        return false;
    }

    private async reclickFish(index: number, _startTile: Tile): Promise<boolean> {
        const live = this.spotByIndex(index);
        if (!live || WHIRLPOOL_IDS.has(live.id)) {
            return false;
        }
        this.bot.setStatus(`tick: reclick ${this.bot.actionName()}`);
        return live.interact(this.bot.actionName());
    }

    private async reclickMine(tile: Tile): Promise<boolean> {
        const rock = this.findRock();
        if (!rock) {
            return false;
        }
        // Prefer same tile when still up; otherwise nearest in leash.
        const same =
            Locs.query()
                .name(this.bot.targetName())
                .action(this.bot.actionName())
                .where(
                    l =>
                        l.tile().equals(tile) &&
                        this.bot.matchesRock(l.id) &&
                        !GAS_ROCK_IDS.has(l.id) &&
                        this.bot.usable(keyOf(l.tile()))
                )
                .nearest() ?? rock;
        this.bot.setStatus(`tick: reclick ${this.bot.actionName()}`);
        return same.interact(this.bot.actionName());
    }

    private async executeFish(): Promise<void> {
        // Named: nearest matching spot in camp membership. Freeform: player/start hunt.
        // If the spot is far, interact will path; we still walk when beyond a short step.
        const target = this.findFishSpot();

        if (!target) {
            this.activeFishIndex = null;
            // No target. Short finishing-cast wait, waking if a spot reappears.
            if (Game.animating()) {
                this.bot.setStatus('fish: finishing cast (no spot)');
                await Execution.delayUntilTicks(
                    () =>
                        !Game.animating() ||
                        this.findFishSpot() !== null ||
                        EventSignal.pending() ||
                        Inventory.isFull() ||
                        combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather()) ||
                        ChatDialog.canContinue(),
                    5
                );
                return;
            }
            // Scene-local query found nothing. Soft-home only when clearly off-camp
            // (bank square / long wander) — not the tight 8-tile disk (hunt thrash).
            const here = Game.tile();
            const anchor = this.bot.getAnchor();
            if (
                here &&
                shouldSoftHomeFromGatherMiss(anchor.distanceTo(here), this.bot.leashRadius())
            ) {
                this.bot.setStatus('fish: returning to camp');
                await this.bot.walkHomeIfNeeded(m => this.bot.log(`  ${m}`));
                return;
            }
            // Named: membership disk from home. Freeform: hunt from player/start.
            if (this.bot.isNamedCamp()) {
                this.bot.setStatus(`fish: no spots in camp (r${this.bot.leashRadius()} of home)`);
            } else {
                this.bot.setStatus(`fish: no spots within ${this.freeformHuntRadius()} of you/start`);
            }
            await Execution.delayTicks(2);
            return;
        }

        // Walk when the spot is more than a few tiles away (pier hop / camp scan).
        const here0 = Game.tile();
        const spotTile = target.tile();
        if (here0 && Tile.from(here0).distanceTo(spotTile) > 2) {
            this.bot.setStatus(`fish: walking to spot @ ${spotTile}`);
            await Traversal.walkTo(spotTile, { radius: 1, timeoutMs: 20_000 });
            // Re-resolve after walk — hop may have moved.
            const again = this.findFishSpot();
            if (!again) {
                this.activeFishIndex = null;
                return;
            }
            // Fall through to interact with the (possibly new) nearest spot.
            return this.executeFishAfterArrive(again);
        }

        await this.executeFishAfterArrive(target);
    }

    private async executeFishAfterArrive(target: {
        index: number;
        tile: () => Tile;
        actions: () => string[];
        interact: (op: string) => boolean | Promise<boolean>;
        id: number;
    }): Promise<void> {

        const index = target.index;
        const startTile = target.tile();
        const key = keyOf(startTile);

        // Why: a fresh interact cancels a leftover cast anim, so there is no need to wait it out before re-clicking.
        const needsClick = !Game.animating() || this.activeFishIndex !== index;
        if (needsClick) {
            this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${startTile}`);
            const before = Inventory.used();
            if (!(await target.interact(this.bot.actionName()))) {
                this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
                this.activeFishIndex = null;
                await Execution.delayTicks(2);
                return;
            }

            await Execution.delayUntilTicks(() => Inventory.used() > before || Game.animating() || this.fishingBroken(index, startTile), 20);

            const live = this.spotByIndex(index);
            if (live && WHIRLPOOL_IDS.has(live.id)) {
                this.activeFishIndex = null;
                await this.fleeWhirlpool(live.tile());
                return;
            }
            if (this.fishingBroken(index, startTile) && Inventory.used() === before && !Game.animating()) {
                this.activeFishIndex = null;
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key);
                }
                return;
            }
            if (Inventory.used() === before && !Game.animating()) {
                this.activeFishIndex = null;
                this.bot.cooldown(key, 4);
                return;
            }
            this.activeFishIndex = index;
            if (Inventory.used() > before) {
                if (await this.afterRollTickManip(() => this.reclickFish(index, startTile))) {
                    return;
                }
            }
        }

        for (let guard = 0; guard < 200; guard++) {
            if (this.fishingBroken(index, startTile)) {
                this.activeFishIndex = null;
                const live = this.spotByIndex(index);
                if (live && WHIRLPOOL_IDS.has(live.id)) {
                    await this.fleeWhirlpool(live.tile());
                }
                return;
            }
            const mark = Inventory.used();
            await Execution.delayUntilTicks(() => Inventory.used() > mark || !Game.animating() || this.fishingBroken(index, startTile), 14);
            if (this.fishingBroken(index, startTile)) {
                this.activeFishIndex = null;
                const live = this.spotByIndex(index);
                if (live && WHIRLPOOL_IDS.has(live.id)) {
                    await this.fleeWhirlpool(live.tile());
                }
                return;
            }
            if (Inventory.used() > mark) {
                if (await this.afterRollTickManip(() => this.reclickFish(index, startTile))) {
                    return;
                }
                continue;
            }
            if (!Game.animating()) {
                this.activeFishIndex = null;
                return;
            }
        }
        this.activeFishIndex = null;
    }

    private async executeMine(): Promise<void> {
        // Farmer willows 6-tick machine (#160) — dedicated phase loop.
        if (this.bot.tickManipProfile().farmerWillowCycle) {
            await this.executeFarmerWillow();
            return;
        }

        const target = this.findRock();
        if (!target) {
            // Keep-alive when near anchor with no matching loc — surface why we idle.
            if (Game.animating()) {
                this.bot.setStatus(`${this.bot.actionName()}: finishing`);
                await Execution.delayUntilTicks(
                    () =>
                        !Game.animating() ||
                        this.findRock() !== null ||
                        EventSignal.pending() ||
                        Inventory.isFull() ||
                        combatBreaksGather(Game.inCombat(), this.bot.allowCombatGather()) ||
                        ChatDialog.canContinue(),
                    5
                );
                return;
            }
            // Same post-bank / off-camp miss as fishing: soft-home only when clearly
            // off-camp — not the tight 8-tile disk (hunt thrash on freeform).
            const here = Game.tile();
            const anchor = this.bot.getAnchor();
            if (
                here &&
                shouldSoftHomeFromGatherMiss(anchor.distanceTo(here), this.bot.leashRadius())
            ) {
                this.bot.setStatus('gather: returning to camp');
                await this.bot.walkHomeIfNeeded(m => this.bot.log(`  ${m}`));
                return;
            }
            const kind = this.bot.woodcutting() ? 'trees' : 'rocks';
            this.bot.setStatus(`gather: no ${this.bot.targetName()} in leash`);
            this.bot.log(
                `gather: no '${this.bot.targetName()}' (${this.bot.actionName()}) ${kind} within leash ${this.bot.leashRadius()} of ${this.bot.getAnchor()}`
            );
            await Execution.delayTicks(3);
            return;
        }
        const tile = target.tile();
        const here = Game.tile();
        // Why: scenery interactions can report success while an off-screen target receives no route, leaving broad named camps to reclick forever.
        if (here && Tile.from(here).distanceTo(tile) > 2) {
            this.bot.setStatus(`gather: walking to ${this.bot.targetName()} @ ${tile}`);
            const reached = await Traversal.walkTo(tile, {
                radius: 1,
                timeoutMs: 45_000,
                log: message => this.bot.log(`  ${message}`)
            });
            if (!reached) {
                this.bot.log(`gather: could not approach ${this.bot.targetName()} @ ${tile} from ${here}`);
            }
            return;
        }
        const key = keyOf(tile);
        // Track whether this session produced ore/logs — successful deplete must not
        // soft-cooldown the tile (iron respawn ~6t < old 8t cooldown → far path thrash).
        let gotProduct = false;

        if (!Game.animating()) {
            this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${tile}`);
            const before = Inventory.used();
            if (!(await target.interact(this.bot.actionName()))) {
                this.bot.log(`no '${this.bot.actionName()}' op on ${this.bot.targetName()}? ops=[${target.actions().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }

            await Execution.delayUntilTicks(() => Inventory.used() > before || Game.animating() || this.shouldYieldMine(tile), 20);
            await Sustain.run();
            if (this.gasAt(tile)) {
                await this.fleeGas(key, tile);
                return;
            }
            if (Inventory.used() > before) {
                gotProduct = true;
            }
            if (Inventory.used() === before && !Game.animating()) {
                if (ChatDialog.canContinue()) {
                    this.bot.reject(key);
                } else if (shouldCooldownGatherTile(false, this.findRock() !== null)) {
                    // Failed click with other targets available — brief skip only.
                    this.bot.cooldown(key);
                }
                return;
            }
            if (gotProduct) {
                if (await this.afterRollTickManip(() => this.reclickMine(tile))) {
                    return;
                }
            }
        }

        for (let guard = 0; guard < 200; guard++) {
            await Sustain.run();
            if (this.shouldYieldMine(tile)) {
                if (this.gasAt(tile)) {
                    await this.fleeGas(key, tile);
                }
                return;
            }
            const mark = Inventory.used();
            await Execution.delayUntilTicks(() => Inventory.used() > mark || !Game.animating() || this.shouldYieldMine(tile), 14);
            await Sustain.run();
            if (this.gasAt(tile)) {
                await this.fleeGas(key, tile);
                return;
            }
            if (Inventory.used() > mark) {
                gotProduct = true;
                if (await this.afterRollTickManip(() => this.reclickMine(tile))) {
                    return;
                }
                continue;
            }
            if (!Game.animating()) {
                // Why: an empty rock or a stump already drops out of findRock, so a natural end needs no soft cooldown.
                // Why: iron respawns faster than an 8-tick tile skip — nearby ore is back up while the bot paths across the mine.
                return;
            }
        }
    }

    // Why: the cycle is t1 click tree, t2–t4 wait, t5 knife log, t6 drop log, repeat (#160).
    // Why: Auto Retaliate stays ON, so the bot may die.
    // Why: it needs a Knife and willow logs in the pack.

    /** Farmer willows 6-tick cycle. */
    private async executeFarmerWillow(): Promise<void> {
        if (EventSignal.pending() || Inventory.isFull() || ChatDialog.canContinue()) {
            return;
        }

        // Resync cycle clock when unset or stale (login / long AFK).
        const now0 = Game.tick();
        let start = this.bot.farmerCycleStartTick();
        if (start < 0 || now0 - start > 18) {
            this.bot.noteFarmerCycleStart(now0);
            start = now0;
        }

        const phase = farmerWillowPhase(Game.tick(), start);
        if (phase === 'click-tree') {
            const tree = this.findRock();
            if (!tree) {
                const here = Game.tile();
                const anchor = this.bot.getAnchor();
                if (
                    here &&
                    shouldSoftHomeFromGatherMiss(anchor.distanceTo(here), this.bot.leashRadius())
                ) {
                    this.bot.setStatus('farmer: returning to camp');
                    await this.bot.walkHomeIfNeeded(m => this.bot.log(`  ${m}`));
                    return;
                }
                this.bot.setStatus('farmer: no tree in leash');
                await Execution.delayTicks(2);
                return;
            }
            const tile = tree.tile();
            this.bot.setStatus(`farmer t1: chop ${this.bot.targetName()} @ ${tile}`);
            // Stamp cycle start on the click beat so phase 0 stays aligned.
            this.bot.noteFarmerCycleStart(Game.tick());
            const before = Inventory.used();
            if (!(await tree.interact(this.bot.actionName()))) {
                this.bot.log(`farmer: no '${this.bot.actionName()}' on tree`);
                await Execution.delayTicks(1);
                return;
            }
            // Brief wait for anim/log; do not AFK the full cut — t5 will process.
            await Execution.delayUntilTicks(
                () =>
                    Inventory.used() > before
                    || Game.animating()
                    || EventSignal.pending()
                    || Inventory.isFull(),
                3
            );
            if (Inventory.used() > before) {
                this.bot.noteGatherRoll();
            }
            // Advance toward t5 without blocking the cycle in one task beat.
            await Execution.delayUntilTicks(
                () => {
                    const s = this.bot.farmerCycleStartTick();
                    const p = farmerWillowPhase(Game.tick(), s);
                    return p === 'cut-log' || p === 'drop-log' || p === 'click-tree';
                },
                8
            );
            return;
        }

        if (phase === 'cut-log') {
            // Knife the newest product log (arms +2 delay / processes the roll).
            if (ChatDialog.isMakeMenu()) {
                this.bot.setStatus('farmer t5: make-x');
                await this.bot.armKnifeDelay();
                return;
            }
            const log =
                Inventory.items().find(i => this.bot.isProduct(i.name) && isFletchableLogName(i.name)) ??
                this.bot.delayLogItem();
            const knife = Inventory.first(TICK_MANIP_KNIFE);
            if (!knife || !log) {
                this.bot.setStatus('farmer t5: need knife + log');
                this.bot.log('farmer: cut-log needs Knife + a fletchable log');
                await Execution.delayTicks(1);
                return;
            }
            this.bot.setStatus(`farmer t5: knife ${log.name}`);
            if (!(await knife.useOn(log))) {
                await Execution.delayTicks(1);
                return;
            }
            await Execution.delayUntilTicks(() => ChatDialog.isMakeMenu() || ChatDialog.canContinue() || !Game.animating(), 3);
            if (ChatDialog.isMakeMenu()) {
                await this.bot.armKnifeDelay();
            }
            // Wait into drop phase.
            await Execution.delayUntilTicks(
                () => farmerWillowPhase(Game.tick(), this.bot.farmerCycleStartTick()) === 'drop-log',
                4
            );
            return;
        }

        if (phase === 'drop-log') {
            this.bot.setStatus('farmer t6: drop log');
            // Drop one product log (prefer fletch leftovers / shafts stay).
            const dropped = await this.bot.dropOneProductLog();
            if (!dropped) {
                // Nothing to drop — still advance the cycle clock.
                this.bot.log('farmer: drop-log with empty product slot');
            }
            // Next cycle starts on the following tick.
            await Execution.delayUntilTicks(
                () => {
                    const s = this.bot.farmerCycleStartTick();
                    const elapsed = Game.tick() - s;
                    return elapsed >= 6 || farmerWillowPhase(Game.tick(), s) === 'click-tree';
                },
                4
            );
            // Roll cycle start forward by 6 so phase 0 lands on the next click beat.
            const s = this.bot.farmerCycleStartTick();
            if (Game.tick() - s >= 6) {
                this.bot.noteFarmerCycleStart(s + 6 * Math.floor((Game.tick() - s) / 6));
            }
            return;
        }

        // wait phases (t2–t4): sleep until cut-log / drop / next click.
        this.bot.setStatus('farmer: wait');
        await Execution.delayUntilTicks(
            () => {
                if (EventSignal.pending() || Inventory.isFull() || ChatDialog.canContinue()) {
                    return true;
                }
                const p = farmerWillowPhase(Game.tick(), this.bot.farmerCycleStartTick());
                return p !== 'wait';
            },
            7
        );
    }
}
