import { resolveWorldNumber } from '../../../client/config/worlds.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { SolveClue, heldClueLikeId, type TrailResult } from '../../api/ai/clues/SolveClue.js';
import { CASKET_IDS } from '../../api/ai/clues/data/cluedb.js';
import { hardClueKit } from '../../api/ai/clues/hardClueKit.js';
import { DRAGON_SITES } from '../../api/combat/hunting/sites.js';
import { enterLair, leaveLair, walkApproach, type JiveHost } from '../../api/combat/hunting/supply.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { PriceBooks } from '../../api/market/bookStore.js';
import { resolvePrices } from '../../api/market/prices.js';
import { resolveSet } from '../../api/market/sets.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { desktopStorage } from '../../runtime/desktopStorage.js';
import { ScriptAborted } from '../../runtime/ScriptContext.js';
import { Scheduler } from '../../runtime/Scheduler.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { ScriptWorldResume } from '../../runtime/ScriptWorldResume.js';
import { levelerTravelZones } from '../AccountLeveler/travel.js';
import { selectEquipment } from './equipment.js';
import { Hunting } from './hunting.js';
import { survivalPort } from './liveSurvival.js';
import { buyMarketSupply, MARKET_SUPPLIES, MARKET_BATCH_LIMITS, type MarketSupply } from './market.js';
import { receiptMatches, exactMarketItems } from './marketTrade.js';
import { Occupancy } from './occupancy.js';
import { clueBlocker, selectSite } from './planner.js';
import { equipOwned, escapeManifest, escapeReady, freshBank, healAtBank, huntingPack, missingPack, normalized, packInventory } from './provision.js';
import { emptySession, restoreSession, sessionKey } from './session.js';
import { readSettings, DEFAULT_SETTINGS } from './settings.js';
import { inSite, SITES, siteRequirements } from './sites.js';
import { countDoses, countStock, planPack, stockDeficits } from './stock.js';
import { Survival, SurvivalFailure, type Hazard } from './survival.js';
import type { AccountSnapshot, JiveSettings, JiveSite, Phase, SessionState } from './types.js';

export { SETTINGS } from './settings.js';

export default class JiveTT extends LoopingBot {
    override loopDelay = 600;
    private config: JiveSettings = DEFAULT_SETTINGS;
    private memory: SessionState = emptySession('');
    private survival: Survival | null = null;
    private occupancy: Occupancy | null = null;
    private hunting: Hunting | null = null;
    private solver: SolveClue | null = null;
    private site: JiveSite | null = null;
    private weapon = '';
    private status = 'starting';
    private died = false;
    private connected = false;
    private stopSignal = new AbortController();
    private waitUntil = 0;
    private failures = 0;
    private deathRecoveries = 0;
    private lastSample = Date.now();
    private hazard: Hazard = { phase: 'travel', dragonfire: false, antipoison: false };

    override async onStart(): Promise<void> {
        try { this.config = readSettings(this.settings); }
        catch (error) { this.requestFinish(String(error instanceof Error ? error.message : error)); return; }
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        const account = Game.myName();
        if (!account) { this.requestFinish('Cannot identify the current account'); return; }
        this.memory = restoreSession(this.storage()?.getItem(sessionKey(account)) ?? null, account);
        this.memory.stopped = false;
        this.memory.phase = 'audit';
        this.site = SITES.find(site => site.id === this.memory.siteId) ?? null;
        this.survival = new Survival(survivalPort(this.memory.counters), this.config);
        this.occupancy = new Occupancy(account);
        this.connected = true;
        this.lastSample = Date.now();
        this.on('chat.message', message => {
            if (!/oh dear.*you are dead/i.test(message.text)) return;
            this.died = true;
            this.memory.counters.deaths++;
            this.memory.lastFailure = `Death during ${this.memory.phase} at ${JSON.stringify(Game.tile())}; retained ${JSON.stringify(normalized(Inventory.items()))}`;
            this.solver?.noteDeath();
            this.hunting?.reset();
            this.occupancy?.release();
            this.save();
            Scheduler.active?.abortWaiters();
        });
        Sustain.set(() => this.upkeep());
        Game.setAutoRetaliate(false);
        this.setStatus('Auditing current account and fresh bank stock');
    }

    override async loop(): Promise<void> {
        this.sample();
        if (this.memory.phase === 'parked' || this.stopSignal.signal.aborted) return;
        if (!Game.sceneReady()) { this.connected = false; return; }
        if (!this.connected) {
            this.connected = true;
            this.survival?.reset();
            this.hunting?.reset();
            this.solver = null;
            this.phase('audit', 'Revalidating account after reconnect');
        }
        if (this.died) {
            if (Skills.effective('hitpoints') <= 0) return;
            this.memory.lastFailure = `${this.memory.lastFailure ?? 'Death detected'}; after respawn retained ${JSON.stringify(normalized([...Inventory.items(), ...Equipment.items()]))}`;
            if (this.config.stopAfterDeath || this.deathRecoveries++ > 0) { this.park(this.memory.lastFailure); return; }
            this.died = false;
            if (this.site) this.memory.cooldowns[this.site.id] = Date.now() + 15 * 60000;
            this.solver = null;
            this.site = null;
            this.survival?.reset();
            this.phase('audit', 'Death recovery enabled; auditing retained items at a safe bank');
        }
        if (Date.now() < this.waitUntil) return;
        try {
            switch (this.memory.phase) {
                case 'audit': case 'bank': case 'prepare-clue': case 'rewards': await this.audit(); break;
                case 'market': await this.shop(); break;
                case 'switch-world':
                    if (!ScriptWorldResume.pending(this.memory.account)) this.park('World switch did not resume this account');
                    break;
                case 'travel': await this.travel(); break;
                case 'hunt': await this.hunt(); break;
                case 'solve': await this.solve(); break;
            }
        } catch (error) {
            if (error instanceof ScriptAborted) { if (!this.died) throw error; return; }
            const reason = error instanceof Error ? error.message : String(error);
            this.memory.lastFailure = reason;
            this.solver = null;
            this.hunting?.reset();
            this.occupancy?.release();
            if (error instanceof SurvivalFailure) {
                if (!(await this.escape())) { this.park(`Emergency escape failed: ${reason}`); return; }
                this.phase('bank', reason);
            } else if (++this.failures <= 1) {
                if (!(await this.escape())) { this.park(`Could not escape after failure: ${reason}`); return; }
                this.waitUntil = Date.now() + 3000;
                this.phase('bank', `Safe retry: ${reason}`);
            } else await this.safePark(reason);
        } finally { this.save(); }
    }

    private async audit(): Promise<void> {
        this.occupancy?.release();
        if (!(await this.escape())) throw new Error('Could not verify a safe exit');
        this.hazard = { phase: 'travel', dragonfire: false, antipoison: false };
        if (!(await freshBank(message => this.log(message)))) throw new Error('Could not reach a fresh bank snapshot');
        this.hazard = { phase: 'bank', dragonfire: false, antipoison: false };
        if (!this.reconcilePurchase()) return;
        if (this.memory.pendingRewards && !(await this.bankRewards())) return;
        const blocker = clueBlocker([...Inventory.items(), ...Bank.items()]);
        if (blocker && blocker.tier !== 'hard') { this.park(`Existing ${blocker.tier} clue or casket ${blocker.id} prevents hard clue drops`); return; }
        if (!blocker && this.memory.pendingClue) { this.park('Interrupted trail has no clue or verified reward receipt; reconcile before farming'); return; }
        await Bank.depositInventory();
        if (Inventory.used() !== 0) throw new Error('Could not deposit inventory at bank');
        const stock = [...Bank.items(), ...Equipment.items()];
        if (blocker?.casket) {
            this.memory.pendingClue ??= { id: blocker.id, acquired: false, outcome: null, retries: 0 };
            this.memory.pendingClue.acquired = false;
            this.memory.pendingClue.id = blocker.id;
            if (!(await Bank.withdrawXById(blocker.id, 1)) || !(await Bank.close())) throw new Error('Could not withdraw stored casket');
            this.startSolver();
            this.phase('solve', `Opening stored hard casket ${blocker.id}`);
            return;
        }
        const guardianKit = hardClueKit({ attack: Skills.level('attack'), lostCity: Quests.status('Lost City') === 'complete', items: stock }, 0, false);
        if (guardianKit !== 'ready') { this.park(`Hard clue guardian equipment/access is missing: ${guardianKit}`); return; }
        let kit = selectEquipment(stock, this.levels(), Quests.all().filter(q => q.status === 'complete').map(q => q.name), false);
        if (kit.kind === 'blocked') { this.park(kit.reason); return; }
        this.weapon = kit.weapon.name;
        if (blocker) {
            this.memory.pendingClue ??= { id: blocker.id, acquired: false, outcome: null, retries: 0 };
            if (this.memory.pendingClue.id !== blocker.id) this.memory.pendingClue.acquired = false;
            this.memory.pendingClue.id = blocker.id;
            if (!blocker.casket && (countStock(stock, 385) < 15 || countDoses(stock, 'prayer') < 8 || countDoses(stock, 'antipoison') < 1
                || escapeManifest('falador', 2).some(item => countStock(stock, item.id) < item.count))) {
                await this.requestRestock('Hard clue needs 15 sharks, 8 prayer doses, superantipoison and escape runes');
                return;
            }
            if (this.memory.returnWorld !== null && this.world() !== this.memory.returnWorld) { await Bank.close(); this.switchWorld(this.memory.returnWorld); return; }
            this.memory.returnWorld = null;
            this.memory.destinationWorld = null;
            if (!(await equipOwned(kit.items, message => this.log(message)))) throw new Error('Could not equip owned clue armour');
            await Bank.depositInventory();
            if (!(await Bank.withdrawXById(blocker.id, 1)) || !(await Bank.close())) throw new Error('Could not withdraw stored hard clue');
            this.startSolver();
            this.phase('solve', `Solving stored hard ${blocker.casket ? 'casket' : 'clue'} ${blocker.id}`);
            return;
        }
        this.memory.pendingClue = null;
        if (this.memory.returnWorld !== null && this.world() === 1 && this.memory.destinationWorld === 1) {
            this.phase('market', 'Resuming checkpointed W1 supply task');
            return;
        }
        const snapshot = this.snapshot(kit.weapon.id);
        const candidates = SITES.filter(site => this.occupancy!.count(this.world(), site.id) < site.capacity);
        const selection = selectSite(snapshot, this.config, this.memory, Date.now(), candidates);
        if (!selection) {
            if (SITES.some(site => this.config.allowedSites.includes(site.id) && siteRequirements(site, snapshot).length === 0)) {
                this.waitUntil = Date.now() + 30000;
                this.phase('bank', 'Eligible camps are occupied or cooling down; waiting at bank');
                return;
            }
            const reasons = SITES.filter(site => this.config.allowedSites.includes(site.id)).map(site => `${site.label}: ${siteRequirements(site, snapshot).join(', ') || 'occupied or cooling down'}`);
            this.park(reasons.join('; ') || 'No locally validated hunting sites are enabled');
            return;
        }
        this.site = selection.site;
        this.memory.siteId = this.site.id;
        kit = selectEquipment(stock, this.levels(), snapshot.quests, this.site.requirements.antifire, this.site.targets[0].defences);
        if (kit.kind === 'blocked') { this.park(kit.reason); return; }
        this.weapon = kit.weapon.name;
        const pack = huntingPack(this.site, this.config, stock);
        const deficit = missingPack(pack, stock);
        if (deficit) {
            if (pack.kind === 'blocked' && /slots|manifest|axe/.test(pack.reason)) { this.park(pack.reason); return; }
            await this.requestRestock(deficit);
            return;
        }
        if (this.memory.returnWorld !== null && this.world() !== this.memory.returnWorld) {
            await Bank.close(); this.switchWorld(this.memory.returnWorld); return;
        }
        this.memory.returnWorld = null;
        this.memory.destinationWorld = null;
        this.memory.restockSpent = 0;
        if (!(await equipOwned(kit.items, message => this.log(message))) || !(await healAtBank(message => this.log(message)))) throw new Error('Could not prepare owned gear and health');
        if (!(await packInventory(pack, message => this.log(message))) || !escapeReady(this.site.escapeTeleportId)) throw new Error('Trip manifest or escape verification failed');
        this.hunting = new Hunting(this.site, this.config, this.survival!, this.memory.counters, this.weapon, message => this.setStatus(message));
        this.failures = 0;
        this.phase('travel', `${this.site.label}: ${selection.reason}`);
    }

    private startSolver(): void {
        this.solver = new SolveClue({
            log: message => this.log(message), setStatus: message => this.setStatus(message), isFood: name => name === 'Shark',
            foodName: () => 'Shark', foodWithdraw: () => 15, hardFoodTarget: 15, weaponName: () => this.weapon,
            restorePrayer: () => true, useTeleports: () => true, allowWilderness: () => false, verifyRewards: true, guardianProtectionByHost: true,
            prayerDoseTarget: 8, escapeReserve: escapeManifest('falador'),
            prepareInitialBank: () => freshBank(message => this.log(message)),
            prepareRewards: async () => {
                if (!(await freshBank(message => this.log(message)))) return false;
                await Bank.depositAllMatching((_name, id) => heldClueLikeId() !== id);
                this.memory.rewardBankBefore = normalized(Bank.items());
                this.save();
                return await Bank.close() && Inventory.free() >= 20;
            },
            beforeStep: async step => {
                const pending = this.memory.pendingClue;
                if (pending) {
                    const id = step.type === 'open-casket' ? step.casketId : step.id;
                    if (pending.id !== id) { pending.resupplies = 0; pending.lastResupplyId = undefined; pending.retries = 0; }
                    pending.id = id;
                    if (step.type !== 'open-casket') {
                        for (const id of [step.puzzle?.id, step.keyFrom?.keyId]) {
                            if (id !== undefined && !Bank.countById(id) && !Inventory.countById(id)) pending.trailItems = [...new Set([...(pending.trailItems ?? []), id])];
                        }
                    }
                    this.save();
                }
                if (step.type === 'open-casket') return true;
                if (!escapeReady('falador') || countDoses(Inventory.items(), 'prayer', true) < 1) return false;
                if (step.guardian) {
                    const slots = new Set(Equipment.items().map(item => item.slot));
                    if (![4, 7, 0].every(slot => slots.has(slot)) || Inventory.countById(385) < 4) return false;
                }
                return true;
            },
            sustain: hazard => this.survival!.run({ phase: hazard.phase, dragonfire: false, antipoison: hazard.guardian === 'Saradomin Wizard' })
        });
    }

    private async solve(): Promise<void> {
        if (!this.solver) { this.phase('audit', 'Reconciling clue state'); return; }
        await this.solver.execute();
        const result = this.solver.result;
        if (!result) return;
        if (this.memory.pendingClue) {
            this.memory.pendingClue.outcome = result.kind;
            if (result.clueId !== null) this.memory.pendingClue.id = result.clueId;
        }
        if (result.kind === 'completed') {
            if (!result.rewards?.length) { this.park('Reward delivery could not be reconciled'); return; }
            this.memory.pendingRewards = { items: normalized(result.rewards), bankBefore: this.memory.rewardBankBefore };
            this.save();
            this.solver = null;
            this.phase('rewards', 'Banking verified clue rewards');
        } else if (result.kind === 'unsupported' || result.kind === 'access-blocked') await this.blockedClue(result);
        else if (result.kind === 'death') this.park('Death during clue solving; intervention required');
        else if (result.kind === 'stopped') this.park(result.reason);
        else {
            const pending = this.memory.pendingClue;
            if (!pending) { this.park(result.reason); return; }
            if (result.kind === 'resupply') {
                const id = heldClueLikeId();
                if (id === null) { this.park('Resupply requested without a held clue or casket'); return; }
                if (pending.lastResupplyId !== id) { pending.lastResupplyId = id; pending.resupplies = 0; }
                if ((pending.resupplies ?? 0) >= 1) { await this.safePark(result.reason); return; }
                pending.resupplies = (pending.resupplies ?? 0) + 1;
            } else {
                if (pending.retries >= 1) { await this.safePark(result.reason); return; }
                pending.retries++;
            }
            this.save();
            this.solver = null;
            if (!(await this.escape())) { this.park(`Clue retreat failed: ${result.reason}`); return; }
            this.phase('prepare-clue', result.reason);
        }
    }

    private async blockedClue(result: TrailResult): Promise<void> {
        this.memory.counters.blocked++;
        this.solver = null;
        if (!(await this.escape()) || !(await freshBank(message => this.log(message)))) { this.park('Blocked clue could not reach a safe bank'); return; }
        const id = result.clueId ?? heldClueLikeId();
        const pending = this.memory.pendingClue;
        if (this.config.blockedClue !== 'discard' || !pending?.acquired || id === null || CASKET_IDS[id] !== undefined) { this.park(result.reason); return; }
        for (const itemId of [id, ...(pending.trailItems ?? [])]) {
            if (CASKET_IDS[itemId] !== undefined) continue;
            if (itemId !== id && !Inventory.countById(itemId) && !Bank.countById(itemId)) continue;
            if (!Inventory.countById(itemId) && !(await Bank.withdrawXById(itemId, 1))) { this.park('Blocked clue identity could not be reconciled'); return; }
        }
        if (!(await Bank.close())) throw new Error('Could not close bank to discard clue');
        for (const itemId of [id, ...(pending.trailItems ?? [])]) {
            if (CASKET_IDS[itemId] !== undefined) continue;
            const item = Inventory.items().find(i => i.id === itemId);
            if (!item && itemId !== id) continue;
            if (!item || !(await item.interact('Drop')) || !(await Execution.delayUntilTicks(() => Inventory.countById(itemId) === 0, 4))) { this.park('Blocked clue discard was not confirmed'); return; }
        }
        this.memory.counters.discarded++;
        this.memory.pendingClue = null;
        this.phase('audit', `Discarded acquired hard clue ${id}: ${result.reason}`);
    }

    private async bankRewards(): Promise<boolean> {
        const pending = this.memory.pendingRewards!;
        {
            pending.items = normalized(pending.items);
            if (pending.bankBefore) pending.bankBefore = normalized(pending.bankBefore);
            if (!pending.bankBefore) { pending.bankBefore = normalized(Bank.items()); this.save(); }
            await Bank.depositInventory();
            const verified = Inventory.used() === 0 && pending.items.every(item => countStock(Bank.items(), item.id) >= countStock(pending.bankBefore!, item.id) + item.count);
            if (!verified) { this.park('Verified reward banking is incomplete; preserving the receipt for reconciliation'); return false; }
            this.memory.counters.completed++;
            this.memory.counters.rewardsBanked += pending.items.reduce((sum, item) => sum + item.count, 0);
            if (this.site) this.observation().completed++;
            this.memory.pendingRewards = null;
            this.memory.rewardBankBefore = null;
            this.memory.pendingClue = null;
            this.save();
            return true;
        }
    }

    private async travel(): Promise<void> {
        const site = this.site!;
        this.hazard = { phase: 'hunt', dragonfire: site.requirements.antifire, antipoison: site.requirements.antipoison };
        await this.upkeep();
        if (!this.survival!.canStartFight() || !escapeReady(site.escapeTeleportId)) { this.phase('bank', 'Trip reserve is insufficient'); return; }
        const route = site.dragonSiteKey ? DRAGON_SITES[site.dragonSiteKey] : null;
        if (route) {
            if (!(await enterLair(this.routeHost(), route))) { await this.routeFailed(); return; }
            await walkApproach(this.routeHost(), route);
        } else {
            for (const point of site.entry) if (!(await this.walk(point))) { await this.routeFailed(); return; }
        }
        if (!inSite(site, Game.tile()) && !(await this.walk(site.targets[0].spawnTiles[0]))) { await this.routeFailed(); return; }
        if (!inSite(site, Game.tile())) { await this.routeFailed(); return; }
        this.hunting?.reset();
        this.occupancy!.claim(this.world(), site.id);
        this.phase('hunt', `Hunting ${site.label}`);
    }

    private async hunt(): Promise<void> {
        if (!this.hunting) { this.phase('audit', 'Rebuilding hunt after restart'); return; }
        const before = this.memory.counters.kills;
        const outcome = await this.hunting.tick();
        this.observation().kills += this.memory.counters.kills - before;
        if (outcome === 'hunting') return;
        this.occupancy?.release();
        if (outcome === 'clue') {
            const id = heldClueLikeId();
            if (id === null) throw new Error('Claimed clue was not found in inventory');
            this.memory.pendingClue = { id, acquired: true, outcome: null, retries: 0 };
            this.memory.counters.clueDrops++;
            this.save();
        }
        if (outcome === 'contention') this.memory.cooldowns[this.site!.id] = Date.now() + 5 * 60000;
        if (!(await this.escape())) throw new Error('Hunting exit was not verified');
        this.hunting.reset();
        this.phase('bank', outcome === 'clue' ? 'Preparing claimed hard clue' : outcome === 'contention' ? 'Camp stalled; cooling down and replanning' : 'Banking loot and replenishing the safe trip');
    }

    private async shop(): Promise<void> {
        if (!(await freshBank(message => this.log(message)))) throw new Error('Market stock could not be refreshed');
        if (!this.reconcilePurchase()) return;
        await Bank.depositInventory();
        const deficits = stockDeficits(Bank.items(), this.config);
        const orders: { item: MarketSupply; quantity: number }[] = [
            { item: 'Shark', quantity: deficits.sharks }, { item: 'Prayer potion(3)', quantity: Math.ceil(deficits.prayerDoses / 3) },
            { item: 'Super set', quantity: deficits.superSets }, { item: 'Antifire potion(3)', quantity: this.site?.requirements.antifire ? Math.ceil(deficits.antifireDoses / 3) : 0 },
            { item: 'Superantipoison(3)', quantity: Math.ceil(deficits.antipoisonDoses / 3) }
        ];
        const runeTargets = [...escapeManifest(this.site?.escapeTeleportId ?? 'falador', 10), ...escapeManifest('falador', 10)];
        for (const rune of runeTargets) {
            const item = Object.entries(MARKET_SUPPLIES).find(([, id]) => id === rune.id)?.[0] as MarketSupply | undefined;
            if (item) orders.push({ item, quantity: Math.max(0, rune.count - countStock(Bank.items(), rune.id)) });
        }
        const order = orders.find(item => item.quantity > 0);
        if (!order) {
            const destination = this.memory.returnWorld;
            if (destination !== null && destination !== this.world()) { await Bank.close(); this.switchWorld(destination); return; }
            this.memory.returnWorld = null;
            this.memory.destinationWorld = null;
            this.phase('audit', 'Supply stock replenished');
            return;
        }
        const ceiling = this.ceiling(order.item);
        if (ceiling === null) { this.park(`Set a price ceiling or price book for ${order.item}`); return; }
        const budget = Math.min(this.config.maxRestockSpend - this.memory.restockSpent, Bank.countById(995) - this.config.coinReserve);
        let quantity = Math.min(order.quantity, this.config.marketBatch, MARKET_BATCH_LIMITS[order.item], Math.floor(budget / ceiling));
        if (quantity <= 0) { this.park('Restock spend cap or available coins cannot fund another bounded purchase'); return; }
        const travelFood = Math.min(3, Bank.countById(385));
        const trip = planPack([{ id: 995, count: Math.min(Bank.countById(995), budget + this.config.coinReserve), stackable: true, purpose: 'purchase' }, { id: 385, count: travelFood, stackable: false, purpose: 'travel' }], 3);
        if (!(await packInventory(trip, message => this.log(message)))) throw new Error('Could not pack bounded shopping coins and travel food');
        const slots = Inventory.free();
        const capacity = order.item.endsWith(' rune') ? slots > 0 ? Infinity : 0 : Math.floor(slots / (order.item === 'Super set' ? 3 : 1));
        quantity = Math.min(quantity, capacity);
        if (quantity <= 0) { this.park('Shopping supplies leave no room for the purchase receipt'); return; }
        this.hazard = { phase: 'travel', dragonfire: false, antipoison: false };
        const result = await buyMarketSupply({ account: this.memory.account, world: this.world(), item: order.item, quantity, maxUnitPrice: ceiling,
            maxSpend: budget, coinReserve: this.config.coinReserve, signal: this.stopSignal.signal, log: message => this.setStatus(message),
            persist: intent => { this.memory.pendingPurchase = intent; this.save(); } });
        if (result.kind === 'bought') {
            this.recordPurchase(order.item, result.quantity, result.spent);
            this.failures = 0;
            this.phase('market', `Bought ${result.quantity} ${order.item}; banking receipts`);
        } else if (result.kind === 'stockout' || result.kind === 'merchant-absent') {
            if (++this.failures > 2) { this.park(result.reason); return; }
            if (!(await freshBank(message => this.log(message)))) throw new Error('Could not wait safely after market failure');
            this.waitUntil = Date.now() + this.config.retrySeconds * 1000;
            this.setStatus(`${result.reason}; bounded retry at bank`);
        } else this.park(result.reason);
    }

    private async requestRestock(reason: string): Promise<void> {
        if (!this.config.marketEnabled) { this.park(`Market disabled; ${reason}`); return; }
        if (this.memory.returnWorld === null) { this.memory.returnWorld = this.world(); this.memory.restockSpent = 0; }
        if (this.world() !== 1) { await Bank.close(); this.switchWorld(1); return; }
        this.phase('market', `Restocking: ${reason}`);
    }

    private reconcilePurchase(): boolean {
        const intent = this.memory.pendingPurchase;
        if (!intent) return true;
        const actual = { coins: Inventory.countById(995), items: normalized(Inventory.items()) };
        if (receiptMatches(intent, actual)) this.recordPurchase(intent.item, intent.quantity, intent.cost);
        else if (actual.coins !== intent.coinsBefore || !exactMarketItems(actual.items, intent.itemsBefore)) {
            this.park('Interrupted purchase receipt is ambiguous; refreshed stock is preserved and the order will not be repeated');
            return false;
        }
        this.memory.pendingPurchase = null;
        this.save();
        return true;
    }

    private recordPurchase(item: string, count: number, coins: number): void {
        this.memory.counters.coinsSpent += coins;
        this.memory.restockSpent += coins;
        this.memory.purchases.push({ item, count, coins, at: Date.now() });
        this.memory.purchases = this.memory.purchases.slice(-100);
        this.memory.pendingPurchase = null;
        this.save();
    }

    private ceiling(item: MarketSupply): number | null {
        const explicit = this.config.priceCeilings[item];
        if (explicit) return explicit;
        const book = PriceBooks.byName(this.config.priceBook);
        if (!book) return null;
        const ids = item === 'Super set' ? resolveSet(item)?.itemIds ?? [] : [MARKET_SUPPLIES[item]];
        const rows = ids.map(id => book.rows.find(row => row.id === id));
        return rows.length > 0 && rows.every(row => row !== undefined) ? rows.reduce((sum, row) => sum + resolvePrices(book, row!).sell, 0) : null;
    }

    private switchWorld(world: number): void {
        this.occupancy?.release();
        this.hunting?.reset();
        this.memory.destinationWorld = world;
        this.phase('switch-world', `Checkpointing shopping task for World ${world}`);
        if (!ScriptWorldResume.request({ account: this.memory.account, world, returnWorld: this.memory.returnWorld ?? this.world(), settings: this.settings.raw() })) this.park('Profile-specific world switch is unavailable or unsafe');
    }

    private async escape(): Promise<boolean> {
        if (!Game.sceneReady() || this.died) return false;
        const route = this.site?.dragonSiteKey ? DRAGON_SITES[this.site.dragonSiteKey] : null;
        const exposed = this.site && (route ? route.inArea(Game.tile()) : inSite(this.site, Game.tile()));
        if ((!this.site || !exposed) && !Game.inCombat()) { this.hazard = { phase: 'travel', dragonfire: false, antipoison: false }; return true; }
        this.survival!.retreating = true;
        try {
            if (route && exposed) return await leaveLair(this.routeHost(), route) && !route.inArea(Game.tile());
            const before = Game.tile();
            const teleport = this.site && inSite(this.site, Game.tile()) ? this.site.escapeTeleportId : 'falador';
            if (escapeReady(teleport) && await Game.teleport(teleport)
                && await Execution.delayUntilTicks(() => !!Game.tile() && !!before && Tile.from(before).distanceTo(Game.tile()!) > 32 && !Game.inCombat(), 10)) return true;
            for (const point of this.site?.exit ?? []) if (!(await this.walk(point))) return false;
            return !Game.inCombat() && (!this.site || !inSite(this.site, Game.tile()));
        } finally {
            this.survival!.retreating = false;
            if (!Game.inCombat() && (!this.site || !(route ? route.inArea(Game.tile()) : inSite(this.site, Game.tile())))) this.hazard = { phase: 'travel', dragonfire: false, antipoison: false };
        }
    }

    private async routeFailed(): Promise<void> {
        this.memory.cooldowns[this.site!.id] = Date.now() + 15 * 60000;
        if (!(await this.escape())) { this.park(`Cannot leave failed route to ${this.site!.label}`); return; }
        this.phase('bank', `Route failed: ${this.site!.label}; cooling down`);
    }

    private routeHost(): JiveHost {
        return { log: message => this.log(message), setStatus: message => this.setStatus(message), parkFor: reason => { throw new Error(reason); }, countBankTrip: () => {},
            style: () => 'melee', foodName: () => 'Shark', foodWithdraw: () => this.config.sharks, weaponName: () => this.weapon,
            ammoName: () => '', spellName: () => '', keepExtra: () => [], leaveByWalk: () => false };
    }

    private walk(point: { x: number; z: number; level: number }): Promise<boolean> {
        return Traversal.walkResilient(Tile.from(point), { radius: 2, attempts: 2, timeoutMs: 60000, avoidZones: levelerTravelZones(), log: message => this.log(message) });
    }
    private upkeep(): Promise<void> { return this.survival?.run(this.hazard) ?? Promise.resolve(); }
    private levels(): Record<string, number> { return Object.fromEntries(['attack', 'strength', 'defence', 'hitpoints', 'prayer', 'magic', 'agility', 'woodcutting'].map(skill => [skill, Skills.level(skill)])); }
    private world(): number { return resolveWorldNumber(location.host, new URLSearchParams(location.search)); }
    private snapshot(weaponId: number): AccountSnapshot {
        return { account: this.memory.account, world: this.world(), bankFresh: Bank.ready(), inventory: Inventory.items(), bank: Bank.items(), equipment: Equipment.items(), levels: this.levels(),
            quests: Quests.all().filter(q => q.status === 'complete').map(q => q.name), weaponId, escapeReady: Skills.level('magic') >= 37, suppliesReady: false,
            access: [] };
    }
    private observation() {
        const key = this.site?.id ?? 'clue';
        return this.memory.observations[key] ??= { kills: 0, huntingMs: 0, idleMs: 0, bankingMs: 0, completed: 0 };
    }
    private sample(): void {
        const now = Date.now();
        const elapsed = Math.max(0, now - this.lastSample);
        this.lastSample = now;
        this.memory.counters.elapsedMs += elapsed;
        const observation = this.observation();
        observation.elapsedMs = (observation.elapsedMs ?? observation.huntingMs + observation.idleMs + observation.bankingMs) + elapsed;
        if (this.memory.phase === 'hunt') {
            this.memory.counters.huntingMs += elapsed;
            this.observation()[this.hunting?.fighting ? 'huntingMs' : 'idleMs'] += elapsed;
        } else if (['bank', 'audit', 'travel'].includes(this.memory.phase)) this.observation().bankingMs += elapsed;
    }
    private phase(phase: Phase, status: string): void { this.sample(); this.memory.phase = phase; this.setStatus(status); this.save(); }
    private setStatus(status: string): void { if (status !== this.status) this.log(status); this.status = status; }
    private park(reason: string): void {
        this.memory.lastFailure = reason;
        this.occupancy?.release();
        this.hunting?.reset();
        this.phase('parked', reason);
        this.requestFinish(reason);
    }
    private async safePark(reason: string): Promise<void> {
        const safe = await this.escape() && await freshBank(message => this.log(message));
        this.park(safe ? reason : `${reason}; could not verify arrival at a safe bank`);
    }
    private storage(): Pick<Storage, 'getItem' | 'setItem'> | null { return desktopStorage ?? (typeof localStorage === 'undefined' ? null : localStorage); }
    private save(): void { if (this.memory.account) this.storage()?.setItem(sessionKey(this.memory.account), JSON.stringify(this.memory)); }

    diagnostic() { return { phase: this.memory.phase, status: this.status, site: this.site?.id ?? null, species: this.hunting?.species ?? null, counters: { ...this.memory.counters }, lastFailure: this.memory.lastFailure }; }
    override onPause(): void { this.occupancy?.release(); }
    override onResume(): void {
        this.survival?.reset();
        this.lastSample = Date.now();
        if (this.site && this.memory.phase === 'hunt') this.occupancy?.claim(this.world(), this.site.id);
    }
    override onStop(): void {
        this.stopSignal.abort();
        this.solver?.stop();
        this.hunting?.reset();
        this.occupancy?.close();
        Sustain.set(null);
        if (!ScriptWorldResume.pending(this.memory.account)) this.memory.stopped = true;
        this.save();
    }
    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e8c35b' });
        const c = this.memory.counters;
        p.title(`JiveTT: ${this.memory.phase}`);
        p.text(this.status);
        p.row(`World ${this.world()} | ${this.site?.label ?? 'no site'}`, this.hunting?.species ?? '');
        p.row(`Kills ${c.kills} | clues ${c.clueDrops} | completed ${c.completed}`, `Discarded ${c.discarded} | blocked ${c.blocked}`);
        p.row(`Rewards banked ${c.rewardsBanked} | deaths ${c.deaths}`, `Spent ${c.coinsSpent} gp`);
        p.row(`Sharks ${c.sharksUsed} | doses ${c.dosesUsed}`, `Caskets/h ${c.elapsedMs ? (c.completed * 3600000 / c.elapsedMs).toFixed(2) : '0'}`);
        p.text(`Active hunting kills/h: ${c.huntingMs ? (c.kills * 3600000 / c.huntingMs).toFixed(1) : '0'}`);
        if (this.memory.lastFailure) p.text(this.memory.lastFailure);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
