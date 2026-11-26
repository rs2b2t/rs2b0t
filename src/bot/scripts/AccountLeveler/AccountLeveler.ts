import { liveCatalog } from '../../api/market/catalog.js';
import { utilityMagicPlan } from './utilityMagic.js';
import { ECONOMY_SALE, ECONOMY_SALE_LOT, supplierStockForSale } from './economySupplies.js';
import { MarketSeller, SUPPLIER_LOT_SOLD } from './marketSeller.js';
import { runeReserveOrder } from './runes.js';
import ReclaimLawTalisman from './reclaimLawTalisman.js';
import HardClueAccess from './hardClueAccess.js';
import { HARD_CLUE_FARM, ownedClueId } from './hardClues.js';
import AutoFighter, { SPELL_RESUPPLY } from '../AutoFighter/AutoFighter.js';
import { buyMarketItem, marketItemId, marketWorld, MARKET_COOLDOWN, MARKET_PREFIX, RUNE_AXE_ID, SEERS_MARKET_STAND } from './market.js';
import { FISH, refreshConsumables } from './catalog.js';
import { alternateCombatCamp, COMBAT_CAMPS } from './combat.js';
import { combatLevel } from './combatProgression.js';
import { auditDragonWeapons, DRAGON_SHOP_COOLDOWN } from './dragonWeapons.js';
import { enterZanaris, gameZanarisPort, inZanaris, leaveZanaris } from './zanaris.js';
import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { CROWD_COOLDOWN, CROWD_PREFIX, CrowdWatch, crowdKey, onTrainingSite, trainingArea } from './crowding.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { sortBank } from '../../api/bank/bankSort.js';
import { findQuestJunk } from '../../api/bank/bankQuestJunk.js';
import { questCategories } from '../BankSorter/BankSorterLogic.js';
import { heldClueLikeId } from '../../api/ai/clues/SolveClue.js';
import { CLUE_DB, CASKET_IDS } from '../../api/ai/clues/data/cluedb.js';
import { Bank } from '../../api/bank/Bank.js';
import { BankTeleport } from '../../api/bank/BankTeleport.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { readDragonProgress } from '../../api/ai/quests/defs/dragonslayer/journal.js';
import { DRAGON_CAMPS, dragonReady } from './dragons.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { levelerTravelZones } from './travel.js';
import Tile from '../../geometry/Tile.js';
import { desktopStorage } from '../../runtime/desktopStorage.js';
import { BotHost } from '../../runtime/BotHost.js';
import { Scheduler } from '../../runtime/Scheduler.js';
import { ScriptAborted } from '../../runtime/ScriptContext.js';
import { ScriptActivity } from '../../runtime/ScriptActivity.js';
import { ScriptRegistry, type ScriptMeta } from '../../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { dragonSwordSupply, emptyMemory, enabledSkills, planNext, readySupplierSaleItems, resolveActivity } from './planner.js';
import { LevelerSession, usesActivityCooldown } from './session.js';
import { LevelerStock } from './stock.js';
import { nextShopRetry, SHOP_STOCK_PREFIX } from './offers.js';
import { gameSupplyPort, provision, SupplyUnavailableError, SupplyStockError } from './supplies.js';
import { auditSupplies, SHOPPING_RESERVE } from './shopping.js';
import { ActionQueue, activityActions, describeActivity, type ActionEvent } from './actions.js';
import { paintLeveler } from './paint.js';
import { potionHerbByName } from '../../data/herbs.js';
import { canResumeObjective, meleeStepMet } from './priority.js';
import { bankedStockOf, banksGatheredResource, requirementKey, stockOf, type ActivityPlan, type Decision, type LevelerSnapshot, type Requirement, type SessionMemory } from './types.js';

interface FailureDiagnostic { at: number; activity: string; phase: string; reason: string; detail: string }

class ActivityTravelError extends Error {
    constructor(readonly plan: ActivityPlan) { super(`Cannot reach ${plan.label}`); }
}

export const SETTINGS: SettingsSchema = {
    mode: { type: 'string', default: 'Train skills', options: ['Train skills', 'Hard clue farming'], label: 'Goal', help: 'Train every enabled skill to its target. Hard clue farming keeps farming and solving, training missing requirements and completing supported quests as needed.' },
    supplierOnly: { type: 'boolean', default: false, label: 'Supply Seers Market only', help: 'Gather goods on World 1 and sell in lots of 1,000. Keep 1,000 per rune or arrow type and start selling it above 2,000 banked. Takes priority over the selected goal and target level.' },
    supplySeers: { type: 'boolean', default: true, label: 'Supply Seers after target', help: 'Gather and sell surplus supplies on World 1 after every enabled skill reaches its target.' },
    targetLevel: { type: 'number', default: 70, min: 2, max: 70, label: 'Target level', help: 'Train every enabled skill to at least this level.' },
    wilderness: { type: 'boolean', default: true, label: 'Allow Wilderness', help: 'Allow Wilderness training, agility, clue steps and gathering planks for Dragon Slayer.' }
};

export default class AccountLeveler extends LoopingBot {
    override loopDelay = 100;
    private session = new LevelerSession(emptyMemory());
    private readonly activity = new ScriptActivity(message => this.setDetail(message));
    private readonly supplies = {
        ...gameSupplyPort(message => this.setDetail(message)),
        walk: async (tile: WorldTile) => (inZanaris(tile) || await leaveZanaris(gameZanarisPort(message => this.setDetail(message))))
            && await Traversal.walkResilient(Tile.from(tile), { radius: 3, attempts: 4, timeoutMs: 120000, avoidZones: levelerTravelZones(tile, this.wilderness), log: message => this.setDetail(message) })
    };
    private readonly actions = new ActionQueue();
    private pendingPlans: ActivityPlan[] = [];
    private displayPlan: ActivityPlan | null = null;
    private shoppingChecked = false;
    private readonly runeGearChecked = new Set<string>();
    private unavailableItems = new Set<string>();
    private temporarilyUnavailable = new Map<string, number>();
    private lastFailure?: FailureDiagnostic;
    private shoppingBudget = 0;
    private detail = '';
    private readonly crowd = new CrowdWatch();
    private nextCrowdSample = 0;
    private crowdedPlan: ActivityPlan | null = null;
    private startedAt = Date.now();
    private lastSavedAt = 0;
    private lastLoggedAt = Date.now();
    private status = 'starting';
    private phase: 'bank' | 'train' | 'clue' = 'bank';
    private bankClueId?: number;
    private readonly stock = new LevelerStock();
    private stopObserving: (() => void) | null = null;
    private died = false;
    private lastTile: WorldTile | null = null;
    private deathTile: WorldTile | null = null;
    private retry: ActivityPlan | null = null;
    private resetCount = 0;
    private waitingUntil = 0;
    private target = 70;
    private dragonStage?: number;
    private wilderness = true;

    override async onStart(): Promise<void> {
        this.log('Waiting for the game scene before checking bank supplies');
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        this.target = Math.max(2, Math.min(70, this.settings.num('targetLevel', 70)));
        this.wilderness = this.settings.bool('wilderness', true);
        this.load();
        this.stopObserving = BotHost.addFrameListener(() => {
            this.stock.observe(Bank.items(), Bank.ready());
            if (this.phase === 'train' && Date.now() >= this.nextCrowdSample) this.sampleCrowd(Date.now());
            this.session.sampleWork(Date.now(), this.phase === 'train' && ScriptRunner.state === 'running' && !Bank.isOpen() && (Game.animating() || Game.inCombat()));
            if (ScriptRunner.state === 'running' && Date.now() - this.lastLoggedAt >= 30000) {
                const tile = Game.tile();
                this.log(`Still ${this.status}${this.detail ? `; ${this.detail}` : ''}; position ${tile ? `(${tile.x},${tile.z},${tile.level})` : 'unknown'}`);
            }
        });
        this.on('chat.message', message => {
            if (!/oh dear.*you are dead/i.test(message.text)) return;
            this.died = true;
            this.deathTile = this.lastTile;
            this.activity.interrupt('player died');
            Scheduler.active?.abortWaiters();
        });
        const goal = this.settings.bool('supplierOnly', false) ? 'Supply Seers Market only' : `${this.settings.str('mode', 'Train skills')}: training target ${this.target}`;
        this.log(`${goal}; Wilderness ${this.wilderness ? 'enabled' : 'disabled'}`);
    }

    private sampleCrowd(now: number): void {
        this.nextCrowdSample = now + 1000;
        const plan = this.session.plan;
        if (!plan || this.crowdedPlan === plan) return;
        const area = trainingArea(plan);
        if (!area) return;
        const child = this.activity.child;
        const tile = Game.tile();
        if (!tile || !Game.sceneReady() || Bank.isOpen() || ScriptRunner.state !== 'running' || !child
            || child instanceof AutoFighter && child.clueInProgress()) {
            this.crowd.reset();
            return;
        }
        if (this.crowd.observe(now, area, tile, Game.myName(), reader.players())) {
            this.session.memory.cooldowns[crowdKey(area.spot)] = now + CROWD_COOLDOWN;
            this.crowdedPlan = plan;
            this.log(`The training spot stayed crowded at ${plan.label} for 10 seconds. Skipping the area for 30 minutes.`);
            this.save();
        }
    }

    override log(message: string): void {
        this.lastLoggedAt = Date.now();
        super.log(message);
    }

    override async loop(): Promise<void> {
        if (!Game.sceneReady()) return;
        if (Date.now() < this.waitingUntil) return;
        this.lastTile = Game.tile();
        try {
            if (this.phase === 'clue') {
                await this.runBankClue();
                return;
            }
            if (this.died) {
                this.died = false;
                if (this.phase === 'bank') {
                    this.session.memory.deaths++;
                    this.fail('Player died while preparing supplies');
                    return;
                }
                const previous = this.session.plan;
                const decision = this.session.death(Date.now());
                if (previous?.deathWalk) this.actions.note(`Death walk: restocking for ${previous.label}`);
                else this.recordFailure('Player died');
                this.retry = decision === 'reset' ? previous : null;
                if (decision === 'rotate') this.pendingPlans = [];
                this.activity.stop();
                this.phase = 'bank';
                this.stock.invalidate();
                this.setStatus('recovering from death at the nearest bank');
                this.save();
            }
            if (this.phase === 'bank') {
                await this.selectAndStart();
                return;
            }
            const plan = this.session.plan;
            if (!plan) { this.phase = 'bank'; return; }
            if (!this.activity.outcome && this.activity.child instanceof AutoFighter && this.activity.child.clueInProgress()) {
                if (this.session.stalled(Date.now())) {
                    this.fail('clue preparation or recovery made no progress for three minutes');
                    return;
                }
                await this.activity.loop();
                this.observe();
                return;
            }
            if (this.activity.outcome?.kind === 'finished' && this.activity.outcome.reason === 'Clue retained for prerequisite training') {
                this.activity.stop();
                this.session.resupply(Date.now());
                this.retry = null;
                this.pendingPlans = [];
                this.phase = 'bank';
                this.stock.invalidate();
                this.setStatus('Clue retained; banking to prepare its requirements');
                this.save();
                return;
            }
            if (this.crowdedPlan === plan) {
                const area = trainingArea(plan);
                if (['EssMiner', 'RuneCrafter', 'JiveRC'].includes(plan.script) && area && this.lastTile && onTrainingSite(area, this.lastTile)
                    && !this.activity.outcome && !this.session.stalled(Date.now())) {
                    await this.activity.loop();
                    this.observe();
                    return;
                }
                if (await this.moveFromCrowdedCamp(plan)) return;
                this.activity.stop();
                this.session.resupply(Date.now());
                this.retry = null;
                this.pendingPlans = [];
                this.phase = 'bank';
                this.stock.invalidate();
                this.setStatus(`Leaving crowded area and replanning ${plan.objective}`);
                this.save();
                return;
            }
            const snapshot = this.snapshot();
            const outgrewNet = plan.script === 'Fisher' && plan.settings.fishMethod === FISH[0].method && snapshot.levels.fishing >= 40;
            if (outgrewNet || plan.deathWalk && combatLevel(snapshot.levels) >= 15 && !Game.inCombat()) {
                this.activity.stop();
                this.session.resupply(Date.now());
                this.retry = null;
                this.pendingPlans = [];
                this.phase = 'bank';
                this.stock.invalidate();
                this.setStatus(outgrewNet ? 'Fishing 40 reached, banking the catch' : 'Combat 15 reached; banking to prepare food for stronger targets');
                this.save();
                return;
            }
            const saleResult = plan.script === 'MarketSeller' && this.activity.outcome?.kind === 'finished' ? this.activity.outcome.reason : undefined;
            if (saleResult !== undefined && saleResult !== SUPPLIER_LOT_SOLD) this.session.memory.cooldowns[plan.id] = Date.now() + 15 * 60000;
            const reached = saleResult !== undefined || this.reached(plan, snapshot);
            const meleeMilestone = meleeStepMet(plan, snapshot.levels);
            const pendingPotions = plan.script === 'PotionMaker' && Inventory.countById(potionHerbByName(String(plan.settings.herb))?.unfId ?? 91) > 0;
            const remaining = (need: Requirement) => stockOf(snapshot, requirementKey(need)) + (plan.script === 'Alcher' || plan.script === 'JiveRC' && need.item === 'Rune essence'
                ? Inventory.items().filter(item => item.noted && (need.id === undefined ? item.name?.toLowerCase() === need.item.toLowerCase() : item.id === liveCatalog().notedOf.get(need.id))).reduce((count, item) => count + item.count, 0) : 0);
            const exhausted = !pendingPotions && plan.needs.some(need => need.minimum !== undefined
                ? remaining(need) < need.minimum
                : !need.equip && need.count > 1 && remaining(need) === 0);
            const depletedOnFinish = this.activity.outcome?.kind === 'finished' && plan.needs.some(need => remaining(need) < need.count);
            const spellResupply = plan.script === 'AutoFighter' && this.activity.outcome?.kind === 'finished' && this.activity.outcome.reason === SPELL_RESUPPLY;
            const sessionExpired = this.session.remainingMs <= 0 && !(plan.output && banksGatheredResource(plan));
            if (spellResupply || !Game.inCombat() && (reached || meleeMilestone || exhausted || depletedOnFinish || sessionExpired)) {
                this.activity.stop();
                if (!reached && !meleeMilestone && (spellResupply || exhausted || depletedOnFinish)) {
                    this.session.resupply(Date.now());
                    this.retry = ['Alcher', 'Superheater'].includes(plan.script) ? null : plan;
                    this.setStatus(`Supplies exhausted for ${plan.label}; checking bank before continuing`);
                } else {
                    const checkpoint = meleeMilestone ? `Reached ${plan.settings.meleeStyle} ${plan.meleeMilestone}` : undefined;
                    this.report({ id: 'train', message: saleResult ?? checkpoint ?? (reached && snapshot.supplierOnly ? 'Supply lot ready for Seers Market' : reached ? `Completed: ${describeActivity(plan)}` : `Training session finished: ${plan.label}`), state: 'done' });
                    this.session.complete(Date.now(), reached);
                    if (meleeMilestone) this.session.memory.objective = plan.objective;
                    if (!reached || meleeMilestone) this.pendingPlans = [];
                }
                this.phase = 'bank';
                this.stock.invalidate();
                this.save();
                return;
            }
            if (this.activity.outcome || this.session.stalled(Date.now())) {
                this.fail(this.activity.outcome?.reason ?? 'no progress for three minutes');
                return;
            }
            await this.eat();
            await this.activity.loop();
            this.observe();
        } catch (error) {
            if (error instanceof ScriptAborted) {
                if (this.died && !Scheduler.active?.aborted) return;
                throw error;
            }
            if (error instanceof ActivityTravelError && error.plan.combat) {
                const now = Date.now();
                this.recordFailure(error.message);
                this.activity.stop();
                this.session.memory.cooldowns[error.plan.id] = now + 15 * 60000;
                this.session.resupply(now);
                this.retry = null;
                this.pendingPlans = [];
                this.phase = 'bank';
                this.stock.invalidate();
                this.actions.fail(error.message);
                this.setStatus(`${error.message}; trying another combat camp`);
                this.waitingUntil = now + 3000;
                this.save();
                return;
            }
            if (error instanceof SupplyStockError) {
                const now = Date.now();
                for (const item of error.items) {
                    const retryAt = nextShopRetry(item, this.session.memory.cooldowns);
                    this.temporarilyUnavailable.set(item, retryAt > now ? retryAt : now + 60_000);
                }
                this.activity.stop();
                this.session.resupply(Date.now());
                this.retry = null;
                this.pendingPlans = [];
                this.phase = 'bank';
                this.stock.invalidate();
                this.setStatus(`${error.message}; checking available alternatives while the shop restocks`);
                this.waitingUntil = Date.now() + 3000;
                this.save();
                return;
            }
            if (error instanceof SupplyUnavailableError) {
                error.items.forEach(item => this.unavailableItems.add(item));
                this.activity.stop();
                this.session.resupply(Date.now());
                this.retry = null;
                this.pendingPlans = [];
                this.phase = 'bank';
                this.stock.invalidate();
                this.actions.fail(error.message);
                this.setStatus(`${error.message}; checking available alternatives at the bank`);
                this.waitingUntil = Date.now() + 3000;
                return;
            }
            this.fail(error instanceof Error ? error.message : String(error));
        }
    }

    override onPause(): void {
        this.activity.child?.onPause?.();
    }

    override onResume(): void {
        this.session.observe(`resumed:${Date.now()}`, Date.now());
        this.session.sampleWork(Date.now(), false);
        this.activity.child?.onResume?.();
    }

    override onStop(): void {
        this.stopObserving?.();
        this.stopObserving = null;
        this.activity.stop();
        Sustain.set(null);
        this.save();
    }

    override grindTargets(): string[] { return this.activity.child?.grindTargets() ?? []; }
    override ignoredRandoms(): string[] { return this.activity.child?.ignoredRandoms() ?? []; }
    override recoveryAnchor(): Tile | null {
        const tile = this.session.plan?.travel;
        return tile ? new Tile(tile.x, tile.z, tile.level) : this.activity.child?.recoveryAnchor?.() ?? null;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const snapshot = this.snapshot();
        const completed = enabledSkills.filter(skill => Skills.level(skill) >= this.target).length;
        paintLeveler(ctx, {
            target: this.target, supplierOnly: snapshot.supplierOnly, levels: snapshot.levels, completed, total: enabledSkills.length,
            objective: this.session.memory.objective, plan: this.displayPlan ?? this.session.plan,
            status: this.status, detail: [this.activity.currentTask, this.detail].filter(Boolean).join(': '), queue: this.actions,
            remainingMs: this.session.remainingMs, deaths: this.session.memory.deaths, wilderness: this.wilderness,
            bankReady: snapshot.bankReady, stock: snapshot.stock, heldCoins: Inventory.count('Coins'),
            tile: Game.tile(), waitingUntil: this.waitingUntil, now: Date.now(), startedAt: this.startedAt,
            shoppingBudget: this.shoppingBudget
        });
    }

    private snapshot(): LevelerSnapshot {
        this.stock.observe(Bank.items(), Bank.ready());
        const now = Date.now();
        const unavailable = new Set(this.unavailableItems);
        for (const [item, until] of this.temporarilyUnavailable) if (until > now) unavailable.add(item);
        for (const [key, until] of Object.entries(this.session.memory.cooldowns)) {
            if (until <= now || !key.startsWith(SHOP_STOCK_PREFIX)) continue;
            const item = key.slice(key.lastIndexOf(':') + 1);
            if (nextShopRetry(item, this.session.memory.cooldowns) > now) unavailable.add(item.toLowerCase());
        }
        const stock = this.stock.total([...Inventory.items(), ...Equipment.items()]);
        const seersWorld = marketWorld() === 1;
        const supplierOnly = this.settings.bool('supplierOnly', false);
        const market = !supplierOnly && seersWorld && (stock.coins ?? 0) > SHOPPING_RESERVE;
        return {
            marketItem: market ? need => marketItemId(need, this.session.memory.cooldowns, now) : undefined,
            levels: Object.fromEntries(enabledSkills.map(skill => [skill, Skills.level(skill)])),
            stock,
            bankStock: this.stock.banked,
            bankReady: this.stock.ready,
            quests: Object.fromEntries(Quests.all().map(({ name, status }) => [name, status === 'complete'])),
            dragonStage: this.dragonStage,
            questPoints: Quests.points(),
            accountName: Game.myName(), supplierOnly, seersWorld,
            supplySeers: seersWorld && this.settings.bool('supplySeers', true),
            target: this.target, mode: this.settings.str('mode', 'Train skills'), wilderness: this.wilderness, now, unavailableItems: [...unavailable]
        };
    }

    private async startBankClue(snapshot: LevelerSnapshot): Promise<boolean> {
        if (!snapshot.bankReady) return false;
        const id = ownedClueId(snapshot.stock, id => {
            const hardFarm = snapshot.mode === 'Hard clue farming' && (CLUE_DB[id]?.obj ?? CASKET_IDS[id]).includes('_hard_');
            return !hardFarm && !(this.session.memory.cooldowns[`bank-clue-${id}`] > snapshot.now);
        });
        if (id === undefined) return false;
        const meta = ScriptRegistry.get('ClueSolver');
        if (!meta) throw new Error('Missing ClueSolver');
        const food = ['Shark', 'Swordfish', 'Lobster', 'Salmon', 'Trout', 'Shrimps'].find(name => stockOf(snapshot, name) > 0);
        this.setStatus(`Preparing banked clue #${id}`);
        await this.supplies.deposit();
        if (!(await this.supplies.withdraw('#' + id, 1))) throw new Error(`Could not withdraw banked clue #${id}`);
        if (!(await this.supplies.closeBank())) throw new Error('Could not close bank for clue');
        this.bankClueId = id;
        this.phase = 'clue';
        this.displayPlan = null;
        this.actions.reset([]);
        this.setStatus(`Solving banked clue #${id}`);
        await this.activity.start(meta, { loadout: '', food: food ?? '', allowClueWilderness: snapshot.wilderness });
        this.session.observe(`starting clue ${id}`, Date.now());
        return true;
    }

    private async runBankClue(): Promise<void> {
        const outcome = this.activity.outcome;
        if (!outcome && !this.died && !this.session.stalled(Date.now())) {
            await this.activity.loop();
            this.observe();
            return;
        }
        this.activity.stop();
        if (outcome?.kind !== 'finished' || this.died) {
            const reason = this.died ? 'player died' : outcome?.reason ?? 'no progress for three minutes';
            for (const id of [this.bankClueId, heldClueLikeId()]) {
                if (id != null) this.session.memory.cooldowns[`bank-clue-${id}`] = Date.now() + 15 * 60000;
            }
            this.setStatus(`Deferring banked clue: ${reason}`);
        } else this.setStatus(outcome.reason);
        if (this.died) this.session.memory.deaths++;
        this.died = false;
        this.phase = 'bank';
        this.stock.invalidate();
        this.save();
    }

    private async selectAndStart(): Promise<void> {
        this.actions.destination = undefined;
        this.shoppingBudget = 0;
        this.setStatus('checking supplies at the nearest bank');
        if (!Bank.isOpen()) await BankTeleport.cast(String(this.displayPlan?.bankTeleport ?? this.displayPlan?.settings.bankTeleport ?? 'Off'), message => this.log(message), this.displayPlan?.script === 'GreenDragon');
        if (!(await this.supplies.bank())) throw new Error('Nearest bank could not be opened');
        const supplierOnly = this.settings.bool('supplierOnly', false);
        if (this.bankClueId !== undefined || Inventory.items().some(item => supplierOnly || item.noted && item.name === 'Rune essence')) {
            await this.supplies.deposit();
            this.bankClueId = undefined;
        }
        let snapshot = this.snapshot();
        if (snapshot.supplierOnly || snapshot.supplySeers && snapshot.bankReady && snapshot.mode !== 'Hard clue farming' && enabledSkills.every(skill => snapshot.levels[skill] >= snapshot.target)) {
            this.retry = null;
            this.pendingPlans = [];
            return this.enactDecision(planNext(snapshot, this.session.memory), snapshot);
        }
        if (await this.startBankClue(snapshot)) return;
        const questItems = findQuestJunk(Bank.items(), name => snapshot.quests[name] ? 'complete' : 'unknown');
        const sorted = await sortBank({ categoryOverrides: questCategories(questItems), log: message => this.setDetail(message) });
        if (sorted.moves) this.setDetail(`Bank sort: ${sorted.moves} moves, ${sorted.reason}`);
        if (dragonReady(snapshot) && Quests.status('Dragon Slayer') === 'inProgress') {
            await Bank.close();
            this.dragonStage = (await readDragonProgress())?.stage;
            if (!(await this.supplies.bank())) throw new Error('Could not reopen bank after reading Dragon Slayer progress');
            snapshot = this.snapshot();
        }
        if (await this.tryDragonWeapons(snapshot)) snapshot = this.snapshot();
        if (inZanaris(Game.tile())) {
            this.setStatus('Leaving Zanaris before preparing the next activity');
            if (!(await leaveZanaris(gameZanarisPort(message => this.setDetail(message))))) throw new Error('Could not leave Zanaris before preparing the next activity');
            if (!(await this.supplies.bank())) throw new Error('Could not reopen a mainland bank after leaving Zanaris');
            snapshot = this.snapshot();
        }
        const diamond = dragonSwordSupply(snapshot, this.session.memory, Math.random);
        if (diamond) {
            if (diamond.script === 'SeersMarket' && diamond.output?.id !== undefined) {
                this.displayPlan = diamond;
                await this.buyMarketSupply(snapshot, { ...diamond.output, id: diamond.output.id }, Number(diamond.settings.reserve));
            } else {
                await this.startPlannedActivity(diamond, snapshot);
            }
            return;
        }
        if (snapshot.mode === 'Hard clue farming') this.shoppingChecked = true;
        const runeSkills = snapshot.quests['Dragon Slayer'] ? ['attack', 'defence'].filter(skill => snapshot.levels[skill] >= 40) : [];
        if (!this.shoppingChecked || runeSkills.some(skill => !this.runeGearChecked.has(skill))) {
            const runeGearOnly = this.shoppingChecked;
            const axe = { item: 'Rune axe', count: 1, id: RUNE_AXE_ID };
            if (!runeGearOnly && snapshot.bankReady && !stockOf(snapshot, axe.item)
                && ['woodcutting', 'firemaking', 'fletching'].some(skill => snapshot.levels[skill] > 0 && snapshot.levels[skill] < snapshot.target)
                && snapshot.marketItem?.(axe) === RUNE_AXE_ID) {
                await this.buyMarketSupply(snapshot, axe, SHOPPING_RESERVE);
                snapshot = this.snapshot();
            }
            const audit = auditSupplies(snapshot, runeGearOnly);
            if (snapshot.bankReady) for (const skill of runeSkills) this.runeGearChecked.add(skill);
            this.shoppingBudget = audit.budget;
            if (audit.needs.length) {
                const plan: ActivityPlan = { id: 'stock-up', label: runeGearOnly ? 'Stock up on rune gear' : 'Stock up for unfinished skills', objective: this.session.memory.objective ?? 'supplies', script: '', settings: {}, needs: audit.needs };
                this.displayPlan = plan;
                this.actions.reset(activityActions(plan, snapshot, [], true));
                this.shoppingChecked = true;
                this.setStatus(`Bank audit: ${audit.needs.length} supplies to stock; budget ${audit.budget}gp plus travel reserve`);
                if (audit.skipped.length) this.setDetail(`Deferred purchases: ${audit.skipped.join('; ')}`);
                try {
                    await provision(plan, this.supplies, event => this.report(event), { bestEffort: true, shopCooldowns: this.session.memory.cooldowns });
                } finally {
                    this.shoppingBudget = 0;
                }
                if (!(await this.supplies.bank())) throw new Error('Could not reopen bank after stocking supplies');
                snapshot = this.snapshot();
            } else {
                this.setDetail(audit.skipped.length ? `Bank audit: deferred ${audit.skipped.join('; ')}` : 'Bank audit: supplies already stocked for unfinished skills');
            }
            this.shoppingChecked = true;
            this.shoppingBudget = 0;
        }
        let requested = this.retry ?? this.pendingPlans.shift();
        if (snapshot.mode === 'Hard clue farming' && requested?.id === HARD_CLUE_FARM) {
            requested = undefined;
            this.pendingPlans = [];
        }
        if (requested && meleeStepMet(requested, snapshot.levels)) {
            this.session.memory.objective = requested.objective;
            this.pendingPlans = [];
            requested = undefined;
        }
        if (requested?.deathWalk && combatLevel(snapshot.levels) >= 15) {
            this.setDetail('Combat 15 reached; replacing the queued death walk with food-backed training');
            this.session.memory.objective = requested.objective;
            this.pendingPlans = [];
            requested = undefined;
        }
        if (snapshot.mode !== 'Hard clue farming' && requested && !canResumeObjective(snapshot.levels, snapshot.target, requested.objective)) {
            this.setDetail(`Replanning completed or unavailable objective: ${requested.objective}`);
            this.pendingPlans = [];
            requested = undefined;
        }
        if (requested && snapshot.mode !== 'Hard clue farming' && (requested.objective === 'magic' || requested.objective === 'smithing')) {
            const spell = utilityMagicPlan(snapshot, requested.objective);
            if (spell || requested.script === 'Alcher' || requested.script === 'Superheater') {
                this.session.memory.objective = requested.objective;
                this.pendingPlans = [];
                requested = undefined;
            }
        }
        if (requested) requested = refreshConsumables(snapshot, requested);
        let decision = requested ? resolveActivity(snapshot, requested, this.session.memory, Math.random) : planNext(snapshot, this.session.memory);
        this.retry = null;
        if (decision.kind === 'blocked') {
            this.setDetail(`Replanning: ${decision.reason}`);
            this.pendingPlans = [];
            decision = planNext(snapshot, this.session.memory);
        }
        return this.enactDecision(decision, snapshot);
    }

    private async enactDecision(decision: Decision, snapshot: LevelerSnapshot): Promise<void> {
        if (decision.kind === 'complete') { await Bank.close(); this.requestFinish(`All ${enabledSkills.length} enabled skills reached ${this.target}`); return; }
        if (decision.kind === 'refresh') return;
        if (decision.kind === 'blocked') {
            const now = Date.now();
            const cooldown = Math.min(...[...Object.values(this.session.memory.cooldowns), ...this.temporarilyUnavailable.values()].filter(time => time > now));
            this.waitingUntil = Math.min(cooldown, now + 30000);
            this.unavailableItems.clear();
            this.stock.invalidate();
            this.setStatus(`waiting for another method: ${decision.reason}; rechecking in ${Math.ceil((this.waitingUntil - now) / 1000)}s`);
            await Bank.close();
            return;
        }
        const plan = decision.plan;
        if (plan.script === 'SeersMarket' && plan.output?.id !== undefined) {
            this.displayPlan = plan;
            const bought = await this.buyMarketSupply(snapshot, { ...plan.output, id: plan.output.id }, Number(plan.settings.reserve), typeof plan.settings.maxUnitPrice === 'number' ? plan.settings.maxUnitPrice : undefined, decision.queue);
            if (bought) this.session.memory.objective = plan.objective;
            this.pendingPlans = bought ? [...decision.queue.slice(1), ...this.pendingPlans] : [];
            return;
        }
        this.displayPlan = plan;
        if (this.resetCount === 0 && plan.objective !== 'economy' && snapshot.mode !== 'Hard clue farming') {
            const order = runeReserveOrder(snapshot, [...decision.queue, ...this.pendingPlans], this.session.memory.cooldowns);
            if (order) {
                this.session.memory.cooldowns['rune-reserves'] = snapshot.now + 30 * 60000;
                if (order.market) this.session.memory.cooldowns['rune-reserves:' + order.market.item] = snapshot.now + 120 * 60000;
                this.save();
                this.shoppingBudget = order.budget;
                try {
                    if (order.market) await this.buyMarketSupply(snapshot, order.market, order.reserve, undefined, decision.queue);
                    else {
                        const stockUp: ActivityPlan = { id: 'rune-reserves', script: '', settings: {}, objective: 'supplies', label: 'Restock rune reserves', needs: order.needs };
                        await provision(stockUp, this.supplies, event => this.report(event), { bestEffort: true, shopCooldowns: this.session.memory.cooldowns });
                    }
                } catch (error) {
                    if (error instanceof ScriptAborted) throw error;
                    this.setDetail('Rune restock deferred: ' + String(error));
                } finally {
                    this.shoppingBudget = 0;
                }
                if (!(await this.supplies.bank())) throw new Error('Could not reopen the bank after restocking runes');
                snapshot = this.snapshot();
                if ((plan.objective === 'magic' || plan.objective === 'smithing') && utilityMagicPlan(snapshot, plan.objective)) {
                    this.session.memory.objective = plan.objective;
                    this.pendingPlans = [];
                    return this.enactDecision(planNext(snapshot, this.session.memory), snapshot);
                }
            }
        }
        this.pendingPlans = [...decision.queue.slice(1), ...this.pendingPlans];
        await this.startPlannedActivity(plan, snapshot);
    }

    private async startPlannedActivity(plan: ActivityPlan, snapshot: LevelerSnapshot): Promise<void> {
        this.displayPlan = plan;
        this.actions.reset(activityActions(plan, snapshot, this.pendingPlans));
        const meta = plan.script === 'HardClueAccess'
            ? { name: plan.script, description: 'Prepare access for hard clue farming', create: () => new HardClueAccess() }
            : plan.script === 'MarketSeller' ? { name: plan.script, description: plan.label, create: () => new MarketSeller(plan.settings.supplierOnly === true, typeof plan.settings.item === 'string' ? plan.settings.item : undefined) }
                : plan.script === 'ReclaimLawTalisman' ? { name: plan.script, description: plan.label, create: () => new ReclaimLawTalisman() }
                    : ScriptRegistry.get(plan.script);
        if (!meta) throw new Error(`Missing activity script ${plan.script}`);
        this.session.start(plan, Date.now(), Math.random);
        this.save();
        this.setStatus(`preparing ${plan.label} for ${plan.objective}`);
        Sustain.set(() => this.eat());
        if (plan.script === 'MarketSeller' && plan.settings.supplierOnly) {
            const item = String(plan.settings.item);
            const keep = [{ item, count: supplierStockForSale(item, Number(plan.settings.quantity ?? ECONOMY_SALE_LOT)) }];
            if (!(await this.supplies.closeBank(plan.travel, keep))) throw new Error('Could not leave the bank for Seers Market');
            this.report({ id: 'bank:start', message: 'Market lot ready in the bank', state: 'done' });
        } else {
            await provision(plan, this.supplies, event => this.report(event), { shopCooldowns: this.session.memory.cooldowns });
        }
        await this.recoverNearbyDrops(plan);
        await this.travelAndTrain(plan, meta);
    }

    private async moveFromCrowdedCamp(plan: ActivityPlan): Promise<boolean> {
        const fighter = this.activity.child;
        if (plan.objective === 'economy' || plan.script !== 'AutoFighter' || !plan.combat || this.activity.outcome || this.session.remainingMs <= 0
            || fighter instanceof AutoFighter && fighter.needsBankBeforeTravel()) return false;
        const snapshot = this.snapshot();
        if (this.reached(plan, snapshot)) return false;
        const next = alternateCombatCamp(snapshot, plan, this.session.memory, Math.random, this.supplies.held, this.supplies.worn);
        if (!next) return false;
        const meta = ScriptRegistry.get(next.script);
        if (!meta) return false;
        this.activity.stop();
        this.session.plan = next;
        this.displayPlan = next;
        this.crowdedPlan = null;
        this.crowd.reset();
        const actions = activityActions(next, snapshot, this.pendingPlans);
        this.actions.reset(actions.slice(actions.findIndex(action => action.id === 'travel')));
        this.setStatus(`Leaving crowded ${plan.label} for ${next.label} with current supplies`);
        Sustain.set(() => this.eat());
        await this.travelAndTrain(next, meta);
        return true;
    }

    private async travelAndTrain(plan: ActivityPlan, meta: ScriptMeta): Promise<void> {
        if (plan.travel) {
            this.report({ id: 'travel', message: `Travelling to ${plan.label}`, state: 'running', destination: plan.travel });
            if (plan.script === 'JiveRC' && plan.settings.rune === 'Cosmic runes'
                && !(await enterZanaris(gameZanarisPort(message => this.setDetail(message))))) throw new ActivityTravelError(plan);
            if (!(await this.supplies.walk(plan.travel))) throw new ActivityTravelError(plan);
            this.report({ id: 'travel', message: `Arrived at ${plan.label}`, state: 'done', destination: plan.travel });
        }
        this.report({ id: 'train', message: `${describeActivity(plan)} using ${plan.script}`, state: 'running', destination: plan.travel });
        await this.activity.start(meta, plan.settings);
        this.session.sampleWork(Date.now(), false);
        this.crowd.reset();
        this.crowdedPlan = null;
        this.phase = 'train';
        this.resetCount = 0;
        this.observe();
    }

    private async tryDragonWeapons(snapshot: LevelerSnapshot): Promise<boolean> {
        if ((this.session.memory.cooldowns[DRAGON_SHOP_COOLDOWN] ?? 0) > snapshot.now) return false;
        const audit = auditDragonWeapons(snapshot);
        if (!audit.needs.length) {
            if (audit.skipped.length) this.setDetail(audit.skipped.join('; '));
            return false;
        }
        this.session.memory.cooldowns[DRAGON_SHOP_COOLDOWN] = snapshot.now + 15 * 60000;
        const plan: ActivityPlan = { id: DRAGON_SHOP_COOLDOWN, label: 'Buy dragon weapons in Zanaris', objective: 'attack', script: '', settings: {}, needs: audit.needs };
        this.displayPlan = plan;
        this.actions.reset(activityActions(plan, snapshot, [], true));
        this.shoppingBudget = audit.budget;
        this.setStatus(`Buying dragon weapons; budget ${audit.budget} coins`);
        this.save();
        try {
            await provision(plan, this.supplies, event => this.report(event), { shopCooldowns: this.session.memory.cooldowns });
        } catch (error) {
            if (error instanceof ScriptAborted) throw error;
            this.setDetail(`Dragon weapon purchase deferred: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.shoppingBudget = 0;
        }
        if (!(await this.supplies.bank())) throw new Error('Could not return to a bank after checking dragon weapons');
        await this.supplies.deposit();
        return true;
    }

    private async buyMarketSupply(snapshot: LevelerSnapshot, need: Requirement & { id: number }, reserve: number, maxUnitPrice?: number, queue: readonly ActivityPlan[] = []): Promise<boolean> {
        const spendable = stockOf(snapshot, 'Coins') - reserve;
        if (spendable < 1) return false;
        this.setStatus(`Checking Seers Market for ${need.count} ${need.item}`);
        await this.supplies.deposit();
        const keep = [...queue, ...this.pendingPlans].flatMap(plan => plan.needs);
        if (!(await this.supplies.closeBank(SEERS_MARKET_STAND, keep))) throw new Error('Could not close the bank before travelling to Seers Market');
        const result = await buyMarketItem({ id: need.id, quantity: need.count, world: 1, reserve, maxUnitPrice, log: message => this.setDetail(message) });
        if (result !== 'bought') {
            const unavailable = result === 'unavailable';
            this.session.memory.cooldowns[MARKET_PREFIX + need.id] = Date.now() + (unavailable ? MARKET_COOLDOWN : 60_000);
            this.setDetail(unavailable ? `Seers Market purchase unavailable for ${need.item}. Checking again in one hour.`
                : `Seers Market trade for ${need.item} did not complete. Eligible to retry in one minute.`);
            this.save();
        }
        if (!(await this.supplies.bank())) throw new Error('Could not bank after checking Seers Market');
        await this.supplies.deposit();
        return result === 'bought';
    }

    private reached(plan: ActivityPlan, snapshot: LevelerSnapshot): boolean {
        if (plan.script === 'EssMiner' && plan.output && (!Bank.isOpen() || !Bank.ready() || Inventory.count(plan.output.item) > 0)) return false;
        if (snapshot.supplierOnly && plan.output && Bank.isOpen() && readySupplierSaleItems(snapshot, this.session.memory).length) return true;
        if (plan.output && (snapshot.supplierOnly || banksGatheredResource(plan))) return snapshot.bankReady && bankedStockOf(snapshot, requirementKey(plan.output)) >= plan.output.count;
        if (plan.output) return stockOf(snapshot, plan.output.item) >= plan.output.count;
        if (plan.prerequisiteLevels) return Object.entries(plan.prerequisiteLevels).every(([skill, level]) => snapshot.levels[skill] >= level);
        if (plan.quest) return snapshot.quests[plan.quest] === true;
        return snapshot.levels[plan.objective] >= snapshot.target;
    }

    private observe(): void {
        const tile = Game.tile();
        const signature = JSON.stringify([
            enabledSkills.map(skill => Skills.xp(skill)), tile,
            Inventory.items().map(i => [i.id, i.count]), Quests.points()
        ]);
        this.session.observe(signature, Date.now());
    }

    private recordFailure(reason: string): void {
        this.lastFailure = { at: Date.now(), activity: this.session.plan?.label ?? this.displayPlan?.label ?? 'preparation', phase: this.phase, reason, detail: this.detail };
        this.save();
    }

    private fail(reason: string): void {
        const now = Date.now();
        const previous = this.session.plan;
        this.recordFailure(reason);
        this.activity.stop();
        const preparing = this.phase === 'bank' || !previous;
        const decision = preparing ? ++this.resetCount < 3 ? 'reset' : 'rotate' : this.session.failure(now);
        this.actions.fail(reason);
        if (preparing && decision === 'rotate') {
            if (previous && usesActivityCooldown(previous)) this.session.memory.cooldowns[previous.id] = now + 15 * 60000;
            this.session.resupply(now);
        }
        this.retry = decision === 'reset' ? previous : null;
        if (decision === 'rotate') this.pendingPlans = [];
        const delay = preparing ? Math.min(60000, 3000 * 2 ** Math.min(this.resetCount - 1, 5)) : decision === 'rotate' ? 30000 : 3000;
        this.setStatus(`${reason}; ${decision === 'reset' ? 'resetting at the nearest bank' : 'replanning at the nearest bank'} in ${delay / 1000}s`);
        this.phase = 'bank';
        this.stock.invalidate();
        this.waitingUntil = now + delay;
        this.save();
    }

    private async eat(): Promise<void> {
        const food = this.session.plan?.food;
        if (!food || Skills.hpFraction() > 0.65 || Bank.isOpen()) return;
        const item = Inventory.items().find(i => !i.noted && i.name?.toLowerCase() === food.toLowerCase() && i.actions().includes('Eat'));
        if (item) { await item.interact('Eat'); await Execution.delayTicks(1); }
    }

    private async recoverNearbyDrops(plan: ActivityPlan): Promise<void> {
        const death = this.deathTile;
        this.deathTile = null;
        const here = Game.tile();
        if (!death || !here || death.level !== here.level || plan.wilderness || Math.max(Math.abs(death.x - here.x), Math.abs(death.z - here.z)) > 64) return;
        if (!(await Traversal.walkResilient(Tile.from(death), { radius: 3, timeoutMs: 30000, avoidZones: levelerTravelZones(death, this.wilderness) }))) return;
        const wanted = new Set(plan.needs.map(n => n.item.toLowerCase()));
        for (let tries = 0; tries < 10 && !Inventory.isFull(); tries++) {
            const item = GroundItems.query().where(i => i.distance() <= 8 && wanted.has(i.name?.toLowerCase() ?? '')).nearest();
            if (!item) break;
            const before = Inventory.used();
            await item.interact('Take');
            if (!(await Execution.delayUntil(() => Inventory.used() > before, 2000))) break;
        }
    }

    private setStatus(message: string): void {
        if (message !== this.status) {
            this.log(message);
            this.actions.changedAt = Date.now();
        }
        this.status = message;
        this.actions.current = message;
        this.actions.note(message);
        this.save();
    }

    private report(event: ActionEvent): void {
        this.actions.update(event);
        this.setStatus(event.message);
    }

    private setDetail(message: string): void {
        this.detail = message;
        this.actions.note(message);
        this.log(message);
        if (Date.now() - this.lastSavedAt > 5000) this.save();
    }

    private storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
        return desktopStorage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    }

    private key(): string | null {
        const name = Game.myName();
        return name ? `rs2b0t:account-leveler:${name.toLowerCase()}` : null;
    }

    private load(): void {
        const key = this.key();
        if (!key) return;
        try {
            const saved = JSON.parse(this.storage()?.getItem(key) ?? '{}') as Partial<SessionMemory> & { diagnostics?: { history?: { at: number; message: string }[]; failure?: FailureDiagnostic } };
            const memory = emptyMemory();
            memory.objective = typeof saved.objective === 'string' && enabledSkills.includes(saved.objective) ? saved.objective : null;
            memory.recent = Array.isArray(saved.recent) ? saved.recent.filter(v => typeof v === 'string').slice(-6) : [];
            for (const field of ['attempted', 'cooldowns'] as const) {
                const values = saved[field];
                if (values && typeof values === 'object') memory[field] = Object.fromEntries(Object.entries(values).filter(([, v]) => Number.isFinite(v)));
            }
            memory.cooldowns = Object.fromEntries(Object.entries(memory.cooldowns).filter(([id, until]) => ((id.startsWith(ECONOMY_SALE + ':') || id.startsWith('bank-clue-') || id.startsWith(SHOP_STOCK_PREFIX) || id.startsWith(MARKET_PREFIX) || id.startsWith(CROWD_PREFIX)) && until > Date.now()) || id.startsWith('quest-') || id === 'ranging-guild' || DRAGON_CAMPS.includes(id) || COMBAT_CAMPS.some(camp => camp.id === id)));
            const failure = saved.diagnostics?.failure;
            if (failure && Number.isFinite(failure.at) && [failure.activity, failure.phase, failure.reason, failure.detail].every(value => typeof value === 'string')) this.lastFailure = failure;
            memory.deaths = typeof saved.deaths === 'number' && Number.isFinite(saved.deaths) ? Math.max(0, saved.deaths) : 0;
            this.session = new LevelerSession(memory);
            if (Array.isArray(saved.diagnostics?.history)) this.actions.history = saved.diagnostics.history
                .filter(event => event && Number.isFinite(event.at) && typeof event.message === 'string')
                .slice(-20).map(event => ({ at: event.at, message: event.message.slice(0, 2000) }));
        } catch { this.session = new LevelerSession(emptyMemory()); }
    }

    private save(): void {
        const key = this.key();
        if (!key) return;
        try {
            this.storage()?.setItem(key, JSON.stringify({ ...this.session.memory, diagnostics: {
                action: this.status, detail: this.detail, plan: this.displayPlan?.label, failure: this.lastFailure,
                tile: Game.tile(), destination: this.actions.destination,
                queue: this.actions.items, history: this.actions.history.slice(-20)
            } }));
            this.lastSavedAt = Date.now();
        }
        catch (error) { this.log(`Could not save progression: ${String(error)}`); }
    }
}
