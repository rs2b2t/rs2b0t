import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { levelerTravelZones } from '../AccountLeveler/travel.js';
import { gameZanarisPort, inZanaris, leaveZanaris } from '../AccountLeveler/zanaris.js';
import type { QuestPreparationRequest, QuestPreparationResult } from '../../api/ai/quests/engine/preparationTypes.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { BotHost } from '../../runtime/BotHost.js';
import { ScriptActivity } from '../../runtime/ScriptActivity.js';
import { ScriptAborted } from '../../runtime/ScriptContext.js';
import { Scheduler } from '../../runtime/Scheduler.js';
import { ScriptRegistry, type ScriptMeta } from '../../runtime/ScriptRegistry.js';
import { enabledSkills, emptyMemory } from '../AccountLeveler/planner.js';
import { LevelerStock } from '../AccountLeveler/stock.js';
import { gameSupplyPort, provision } from '../AccountLeveler/supplies.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot } from '../AccountLeveler/types.js';
import { planPreparation } from './preparation.js';
import { cakeSupplyActivity } from './cakeSupplyActivity.js';
import { groundSupplyActivity } from './groundSupplyActivity.js';
import { exitQuestArena, inQuestArena, ticketSupplyActivity, toadflaxSupplyActivity } from './agilitySupplyActivities.js';

export class PreparationError extends Error {}

export interface PreparationEnvironment {
    snapshot(): LevelerSnapshot;
    bank(): Promise<void>;
    prepare(plan: ActivityPlan): Promise<void>;
    invalidate(): void;
    progress(plan: ActivityPlan): string;
    canStop(): boolean;
    eat(food?: string): Promise<void>;
    now(): number;
    dispose(): void;
    meta(name: string): ScriptMeta | undefined;
}

interface PreparationOptions {
    wilderness?: boolean;
    restoreHooks?: () => void;
    environment?: PreparationEnvironment;
}

export class QuestPreparation {
    status = '';
    queue: string[] = [];
    private readonly activity: ScriptActivity;
    private readonly environment: PreparationEnvironment;
    private readonly memory = emptyMemory();
    private plan: ActivityPlan | null = null;
    private request = '';
    private signature = '';
    private progressAt = 0;
    private failures = 0;
    private interruption: string | null = null;
    private stopped = false;
    private generation = 0;

    constructor(private readonly log: (message: string) => void, private readonly options: PreparationOptions = {}) {
        this.activity = new ScriptActivity(log);
        this.environment = options.environment ?? gameEnvironment(log, options.wilderness ?? false);
    }

    get child() { return this.activity.child; }

    async tick(request: QuestPreparationRequest): Promise<QuestPreparationResult> {
        if (this.stopped) throw new PreparationError('Quest preparation stopped');
        const key = JSON.stringify(request);
        if (key !== this.request) {
            this.reset();
            this.request = key;
            this.failures = 0;
        }
        const generation = this.generation;
        try {
            if (this.interruption) {
                const reason = this.interruption;
                this.interruption = null;
                return this.fail(reason);
            }
            if (this.plan) {
                const plan = this.plan;
                const s = this.environment.snapshot();
                const progress = this.environment.progress(plan);
                if (progress !== this.signature) {
                    this.signature = progress;
                    this.progressAt = this.environment.now();
                    this.failures = 0;
                }
                const reached = plan.output ? stockOf(s, plan.output.item) >= plan.output.count
                    : !!plan.prerequisiteLevels && Object.entries(plan.prerequisiteLevels).every(([skill, level]) => s.levels[skill] >= level);
                if (reached && this.environment.canStop()) {
                    this.memory.recent = [...this.memory.recent, plan.id].slice(-6);
                    this.reset();
                    this.setStatus(`Completed ${plan.label}; checking remaining quest requirements`);
                    return 'working';
                }
                if (this.activity.outcome) return this.fail(this.activity.outcome.reason);
                if (this.environment.now() - this.progressAt > 180000) return this.fail(`No progress for three minutes: ${plan.label}`);
                await this.environment.eat(plan.food);
                await this.activity.loop();
                if (this.interruption) {
                    const reason = this.interruption;
                    this.interruption = null;
                    return this.fail(reason);
                }
                if (!this.activity.child) this.options.restoreHooks?.();
                return 'working';
            }
            this.setStatus('Checking bank for quest preparation');
            await this.environment.bank();
            if (generation !== this.generation) return 'working';
            const decision = planPreparation(this.environment.snapshot(), request, this.memory);
            if (decision.kind === 'blocked') throw new PreparationError(decision.reason);
            if (decision.kind === 'refresh') return this.fail('Bank contents did not load');
            if (decision.kind === 'complete') {
                this.queue = [];
                this.setStatus('Quest requirements ready');
                this.options.restoreHooks?.();
                return 'ready';
            }
            this.queue = decision.queue.map(plan => plan.output ? `${plan.label}: ${plan.output.count} ${plan.output.item}`
                : plan.prerequisiteLevels ? `${plan.label}: ${Object.entries(plan.prerequisiteLevels).map(([skill, level]) => `${skill} ${level}`).join(', ')}` : plan.label);
            this.plan = decision.plan;
            this.setStatus(`Preparing ${this.queue[0]}`);
            Sustain.set(() => this.environment.eat(decision.plan.food));
            await this.environment.prepare(decision.plan);
            if (generation !== this.generation) return 'working';
            if (!decision.plan.script) {
                await this.environment.bank();
                if (generation !== this.generation) return 'working';
                const supplied = this.environment.snapshot();
                const missing = decision.plan.needs.filter(need => stockOf(supplied, requirementKey(need)) < need.count);
                if (missing.length) return this.fail(`Supplies still missing: ${missing.map(need => `${need.count} ${need.item}`).join(', ')}`);
                this.reset();
                return 'working';
            }
            const meta = this.environment.meta(decision.plan.script);
            if (!meta || decision.plan.script === 'AIOQuester') throw new PreparationError(`Unsupported preparation activity ${decision.plan.script}`);
            this.signature = this.environment.progress(decision.plan);
            this.progressAt = this.environment.now();
            this.setStatus(this.queue[0]);
            await this.activity.start(meta, decision.plan.settings);
            if (!this.activity.child) this.options.restoreHooks?.();
            return 'working';
        } catch (error) {
            if (error instanceof ScriptAborted) {
                if (this.interruption && !Scheduler.active?.aborted) {
                    const reason = this.interruption;
                    this.interruption = null;
                    return this.fail(reason);
                }
                this.reset();
                throw error;
            }
            if (error instanceof PreparationError) { this.reset(); this.setStatus(error.message); throw error; }
            return this.fail(error instanceof Error ? error.message : String(error));
        }
    }

    pause(): void { this.child?.onPause?.(); }
    resume(): void { this.progressAt = this.environment.now(); this.child?.onResume?.(); }

    interrupt(reason: string): void {
        this.generation++;
        this.interruption = reason;
        this.activity.interrupt(reason);
        Scheduler.active?.abortWaiters();
    }

    stop(): void {
        this.stopped = true;
        this.reset();
        this.environment.dispose();
    }

    private reset(): void {
        this.generation++;
        this.activity.stop();
        this.plan = null;
        this.environment.invalidate();
        Sustain.set(null);
        this.options.restoreHooks?.();
    }

    private fail(reason: string): QuestPreparationResult {
        this.reset();
        this.failures++;
        this.setStatus(`Quest preparation attempt ${this.failures}/3: ${reason}`);
        if (this.failures >= 3) throw new PreparationError(this.status);
        return 'working';
    }

    private setStatus(message: string): void {
        if (message !== this.status) this.log(message);
        this.status = message;
    }
}

function gameEnvironment(log: (message: string) => void, wilderness: boolean): PreparationEnvironment {
    const stock = new LevelerStock();
    const supplies = {
        ...gameSupplyPort(log),
        walk: async (tile: WorldTile) => (inZanaris(tile) || await leaveZanaris(gameZanarisPort(log)))
            && await Traversal.walkResilient(Tile.from(tile), { radius: 3, attempts: 4, timeoutMs: 120000, avoidZones: levelerTravelZones(tile, wilderness), log })
    };
    let unsubscribe: (() => void) | undefined;
    const observe = () => stock.observe(Bank.items(), Bank.ready());
    const snapshot = (): LevelerSnapshot => {
        observe();
        return { levels: Object.fromEntries(enabledSkills.map(skill => [skill, Skills.level(skill)])),
            stock: stock.total([...Inventory.items(), ...Equipment.items()]), bankReady: stock.ready,
            quests: Object.fromEntries(Quests.all().map(quest => [quest.name, quest.status === 'complete'])),
            target: 99, wilderness, now: Date.now() };
    };
    return {
        snapshot,
        bank: async () => {
            unsubscribe ??= BotHost.addFrameListener(observe);
            await exitQuestArena(log);
            if (!(await supplies.bank())) throw new Error('Cannot open bank for quest preparation');
            observe();
        },
        prepare: async plan => {
            await provision(plan, supplies, event => log(event.message));
            if (plan.travel && !(await supplies.walk(plan.travel))) throw new Error(`Cannot reach ${plan.label}`);
        },
        invalidate: () => stock.invalidate(),
        progress: plan => JSON.stringify([Object.fromEntries(Object.keys(plan.prerequisiteLevels ?? { [plan.objective]: 0 }).map(skill => [skill, Skills.xp(skill)])),
            plan.output ? stockOf(snapshot(), plan.output.item) : null]),
        canStop: () => !Game.inCombat() && !inQuestArena(),
        eat: async food => {
            if (!food || Skills.hpFraction() > 0.65 || Bank.isOpen()) return;
            const item = Inventory.items().find(item => !item.noted && item.name?.toLowerCase() === food.toLowerCase() && item.actions().includes('Eat'));
            if (item) { await item.interact('Eat'); await Execution.delayTicks(1); }
        },
        now: Date.now,
        dispose: () => { unsubscribe?.(); unsubscribe = undefined; },
        meta: name => {
            if (name === 'QuestGroundSupply') return groundSupplyActivity;
            if (name === 'QuestToadflax') return toadflaxSupplyActivity;
            if (name === 'QuestArenaTickets') return ticketSupplyActivity(() => stockOf(snapshot(), 'Agility arena ticket'));
            if (name !== 'QuestCakeSupply') return ScriptRegistry.get(name);
            return cakeSupplyActivity(() => stockOf(snapshot(), 'Cake'), async () => {
                if (!(await supplies.bank())) throw new Error('Cannot bank stolen cakes');
                await supplies.deposit();
                observe();
                if (!(await supplies.closeBank())) throw new Error('Cannot close bank after storing cakes');
            });
        }
    };
}
