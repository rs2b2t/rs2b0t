import { resolveWorldNumber } from '../../../client/config/worlds.js';
import { SeersAxeBuyer } from './market.js';
import { refreshConsumables } from './catalog.js';
import { COMBAT_CAMPS } from './combat.js';
import { gatheringTool } from './equipment.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { desktopStorage } from '../../runtime/desktopStorage.js';
import { BotHost } from '../../runtime/BotHost.js';
import { Scheduler } from '../../runtime/Scheduler.js';
import { ScriptAborted } from '../../runtime/ScriptContext.js';
import { ScriptActivity } from '../../runtime/ScriptActivity.js';
import { ScriptRegistry } from '../../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { emptyMemory, enabledSkills, planNext, resolveActivity } from './planner.js';
import { LevelerSession } from './session.js';
import { LevelerStock } from './stock.js';
import { gameSupplyPort, provision, SupplyUnavailableError, SupplyStockError } from './supplies.js';
import { auditSupplies } from './shopping.js';
import { ActionQueue, activityActions, describeActivity, type ActionEvent } from './actions.js';
import { paintLeveler } from './paint.js';
import { herbByName } from '../PotionMaker/PotionMakerLogic.js';
import { canResumeObjective, trainingPriority } from './priority.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

interface FailureDiagnostic { at: number; activity: string; phase: string; reason: string; detail: string }

export const SETTINGS: SettingsSchema = {
    targetLevel: { type: 'number', default: 40, min: 2, max: 40, label: 'Target level', help: 'Train every enabled skill to at least this level.' },
    marketAxes: { type: 'boolean', default: true, label: 'Try Seers market axes', help: 'One optional Rune axe purchase from seers market when already on World 1. Falls back to available tools.' },
    marketAxeBudget: { type: 'number', default: 50000, min: 0, max: 1000000, label: 'Market axe price limit', help: 'Also capped at 10% of banked gold; keeps 200 coins for travel.' },
    wilderness: { type: 'boolean', default: true, label: 'Allow Wilderness training', help: 'Include suitable Wilderness camps in randomized combat training.' }
};

export default class AccountLeveler extends LoopingBot {
    override loopDelay = 100;
    private session = new LevelerSession(emptyMemory());
    private readonly activity = new ScriptActivity(message => this.setDetail(message));
    private readonly supplies = gameSupplyPort(message => this.setDetail(message));
    private readonly actions = new ActionQueue();
    private pendingPlans: ActivityPlan[] = [];
    private displayPlan: ActivityPlan | null = null;
    private shoppingChecked = false;
    private marketChecked = false;
    private readonly marketBuyer = new SeersAxeBuyer();
    private unavailableItems = new Set<string>();
    private temporarilyUnavailable = new Map<string, number>();
    private lastFailure?: FailureDiagnostic;
    private shoppingBudget = 0;
    private detail = '';
    private startedAt = Date.now();
    private lastSavedAt = 0;
    private status = 'starting';
    private phase: 'bank' | 'train' = 'bank';
    private readonly stock = new LevelerStock();
    private stopObserving: (() => void) | null = null;
    private died = false;
    private lastTile: WorldTile | null = null;
    private deathTile: WorldTile | null = null;
    private retry: ActivityPlan | null = null;
    private resetCount = 0;
    private waitingUntil = 0;
    private target = 40;
    private wilderness = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        this.target = Math.max(2, Math.min(40, this.settings.num('targetLevel', 40)));
        this.wilderness = this.settings.bool('wilderness', true);
        this.load();
        this.stopObserving = BotHost.addFrameListener(() => {
            this.stock.observe(Bank.items(), Bank.ready());
            this.session.sampleWork(Date.now(), this.phase === 'train' && ScriptRunner.state === 'running' && !Bank.isOpen() && (Game.animating() || Game.inCombat()));
        });
        this.on('chat.message', message => {
            if (!/oh dear.*you are dead/i.test(message.text)) return;
            this.died = true;
            this.deathTile = this.lastTile;
            this.activity.interrupt('player died');
            Scheduler.active?.abortWaiters();
        });
        this.log(`training ${enabledSkills.length} skills to ${this.target}; Wilderness ${this.wilderness ? 'enabled' : 'disabled'}`);
    }

    override async loop(): Promise<void> {
        if (!Game.sceneReady()) return;
        if (Date.now() < this.waitingUntil) return;
        this.lastTile = Game.tile();
        try {
            if (this.died) {
                this.died = false;
                if (this.phase === 'bank') {
                    this.session.memory.deaths++;
                    this.fail('Player died while preparing supplies');
                    return;
                }
                const previous = this.session.plan;
                const decision = this.session.death(Date.now());
                this.recordFailure('Player died');
                if (decision === 'stop') {
                    this.activity.stop();
                    this.requestFinish(`AccountLeveler stopped after repeated deaths during ${previous?.label ?? 'training'}; check the saved failure diagnostics`);
                    return;
                }
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
            const snapshot = this.snapshot();
            const reached = this.reached(plan, snapshot);
            const pendingPotions = plan.script === 'PotionMaker' && Inventory.countById(herbByName(String(plan.settings.herb))?.unfId ?? 91) > 0;
            const exhausted = !pendingPotions && plan.needs.some(need => need.minimum !== undefined
                ? stockOf(snapshot, requirementKey(need)) < need.minimum
                : !need.equip && need.count > 1 && stockOf(snapshot, requirementKey(need)) === 0);
            const depletedOnFinish = this.activity.outcome?.kind === 'finished' && plan.needs.some(need => stockOf(snapshot, requirementKey(need)) < need.count);
            if (!Game.inCombat() && (reached || exhausted || depletedOnFinish || this.session.remainingMs <= 0)) {
                this.activity.stop();
                if (!reached && (exhausted || depletedOnFinish)) {
                    this.session.resupply(Date.now());
                    this.retry = plan;
                    this.setStatus(`Supplies exhausted for ${plan.label}; checking bank before continuing`);
                } else {
                    this.report({ id: 'train', message: reached ? `Completed: ${describeActivity(plan)}` : `Training session finished: ${plan.label}`, state: 'done' });
                    this.session.complete(Date.now(), reached);
                    if (!reached) this.pendingPlans = [];
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
            if (error instanceof SupplyStockError) {
                error.items.forEach(item => this.temporarilyUnavailable.set(item, Date.now() + 60000));
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
            target: this.target, levels: snapshot.levels, completed, total: enabledSkills.length,
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
        return {
            levels: Object.fromEntries(enabledSkills.map(skill => [skill, Skills.level(skill)])),
            stock: this.stock.total([...Inventory.items(), ...Equipment.items()]),
            bankReady: this.stock.ready,
            quests: Object.fromEntries(['Druidic Ritual', 'Rune Mysteries Quest', 'Dragon Slayer'].map(name => [name, Quests.status(name) === 'complete'])),
            target: this.target, wilderness: this.wilderness, now: Date.now(), unavailableItems: [...this.unavailableItems, ...[...this.temporarilyUnavailable].filter(([, until]) => until > Date.now()).map(([item]) => item)]
        };
    }

    private async selectAndStart(): Promise<void> {
        this.actions.destination = undefined;
        this.shoppingBudget = 0;
        this.setStatus('checking supplies at the nearest bank');
        if (!(await this.supplies.bank())) throw new Error('Nearest bank could not be opened');
        let snapshot = this.snapshot();
        if (!this.shoppingChecked) {
            const audit = auditSupplies(snapshot);
            this.shoppingBudget = audit.budget;
            if (audit.needs.length) {
                const plan: ActivityPlan = { id: 'stock-up', label: 'Stock up for unfinished skills', objective: this.session.memory.objective ?? 'supplies', script: '', settings: {}, needs: audit.needs };
                this.displayPlan = plan;
                this.actions.reset(activityActions(plan, snapshot, [], true));
                this.shoppingChecked = true;
                this.setStatus(`Bank audit: ${audit.needs.length} supplies to stock; budget ${audit.budget}gp plus travel reserve`);
                if (audit.skipped.length) this.setDetail(`Deferred purchases: ${audit.skipped.join('; ')}`);
                try {
                    await provision(plan, this.supplies, event => this.report(event), { bestEffort: true });
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
        if (requested && !canResumeObjective(snapshot.levels, snapshot.target, requested.objective)) {
            this.setDetail(`${trainingPriority(snapshot.levels, snapshot.target).label}; replanning queued ${requested.objective} work`);
            this.pendingPlans = [];
            requested = undefined;
        }
        if (requested) requested = refreshConsumables(snapshot, requested);
        let decision = requested ? resolveActivity(snapshot, requested, this.session.memory, Math.random) : planNext(snapshot, this.session.memory);
        this.retry = null;
        if (decision.kind === 'blocked') {
            this.setDetail(`Replanning: ${decision.reason}`);
            this.pendingPlans = [];
            decision = planNext(snapshot, this.session.memory);
        }
        if (decision.kind === 'complete') { await Bank.close(); this.requestFinish(`All ${enabledSkills.length} enabled skills reached ${this.target}`); return; }
        if (decision.kind === 'refresh') return;
        if (decision.kind === 'blocked') {
            const cooldown = Math.min(...[...Object.values(this.session.memory.cooldowns), ...this.temporarilyUnavailable.values()].filter(time => time > Date.now()));
            if (Number.isFinite(cooldown)) {
                this.waitingUntil = cooldown;
                this.setStatus(`waiting for another method: ${decision.reason}`);
                await Bank.close();
                return;
            }
            await Bank.close();
            this.requestFinish(`AccountLeveler blocked: ${decision.reason}`);
            return;
        }
        const plan = decision.plan;
        if (plan.script === 'Woodcutter' && await this.tryMarketAxe(snapshot)) {
            snapshot = this.snapshot();
            plan.needs = plan.needs.map(need => / axe$/i.test(need.item) ? gatheringTool(snapshot, 'axe') : need);
        }
        this.pendingPlans = [...decision.queue.slice(1), ...this.pendingPlans];
        this.displayPlan = plan;
        this.actions.reset(activityActions(plan, snapshot, this.pendingPlans));
        const meta = ScriptRegistry.get(plan.script);
        if (!meta) throw new Error(`Missing activity script ${plan.script}`);
        this.session.start(plan, Date.now(), Math.random);
        this.save();
        this.setStatus(`preparing ${plan.label} for ${plan.objective}`);
        Sustain.set(() => this.eat());
        await provision(plan, this.supplies, event => this.report(event));
        await this.recoverNearbyDrops(plan);
        if (plan.travel) {
            this.report({ id: 'travel', message: `Travelling to ${plan.label}`, state: 'running', destination: plan.travel });
            if (!(await Traversal.walkResilient(Tile.from(plan.travel), { radius: 4, attempts: 4, timeoutMs: 120000, log: m => this.setDetail(m) }))) throw new Error(`Cannot reach ${plan.label}`);
            this.report({ id: 'travel', message: `Arrived at ${plan.label}`, state: 'done', destination: plan.travel });
        }
        this.report({ id: 'train', message: `${describeActivity(plan)} using ${plan.script}`, state: 'running', destination: plan.travel });
        await this.activity.start(meta, plan.settings);
        this.session.sampleWork(Date.now(), false);
        this.phase = 'train';
        this.resetCount = 0;
        this.observe();
    }

    private async tryMarketAxe(snapshot: LevelerSnapshot): Promise<boolean> {
        if (this.marketChecked || !this.settings.bool('marketAxes', true) || stockOf(snapshot, 'Rune axe') > 0 || typeof location === 'undefined') return false;
        const world = resolveWorldNumber(location.host, new URLSearchParams(location.search));
        if (world !== 1) return false;
        this.marketChecked = true;
        const budget = Math.floor(Math.min(this.settings.num('marketAxeBudget', 50000), stockOf(snapshot, 'Coins') * 0.1, stockOf(snapshot, 'Coins') - 200));
        if (budget < 1) return false;
        this.setStatus(`Checking seers market for a Rune axe; limit ${budget} coins`);
        await this.supplies.deposit();
        if (!(await this.supplies.withdraw('Coins', budget + 200))) return false;
        if (!(await this.supplies.closeBank())) return false;
        const bought = await this.marketBuyer.buy({ item: 'Rune axe', maxPrice: budget, world, log: message => this.setDetail(message) });
        if (!(await this.supplies.bank())) throw new Error('Could not bank after checking Seers market');
        await this.supplies.deposit();
        this.setDetail(bought ? 'Rune axe banked; preparing woodcutting supplies' : 'Seers market upgrade unavailable; using available axe');
        return bought;
    }

    private reached(plan: ActivityPlan, snapshot: LevelerSnapshot): boolean {
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
        const previous = this.session.plan;
        this.recordFailure(reason);
        this.activity.stop();
        const preparing = this.phase === 'bank' || !previous;
        const decision = preparing ? ++this.resetCount < 3 ? 'reset' : 'stop' : this.session.failure(Date.now());
        this.actions.fail(reason);
        if (decision === 'stop') {
            this.setStatus(`${reason}; stopped after three unsuccessful ${preparing ? 'preparation' : 'activity'} attempts`);
            this.requestFinish(`AccountLeveler could not ${preparing ? 'prepare' : 'continue ' + previous?.label}: ${reason}`);
            return;
        }
        this.retry = decision === 'reset' ? previous : null;
        if (decision === 'rotate') this.pendingPlans = [];
        this.setStatus(`${reason}; ${decision === 'reset' ? 'resetting at the nearest bank' : 'trying another method'}`);
        this.phase = 'bank';
        this.stock.invalidate();
        this.waitingUntil = Date.now() + 3000;
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
        if (!(await Traversal.walkResilient(Tile.from(death), { radius: 3, timeoutMs: 30000 }))) return;
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
            memory.cooldowns = Object.fromEntries(Object.entries(memory.cooldowns).filter(([id]) => id.startsWith('quest-') || COMBAT_CAMPS.some(camp => camp.id === id)));
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
