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
import { Paint } from '../../paint/Paint.js';
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
import { gameSupplyPort, provision } from './supplies.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

export const SETTINGS: SettingsSchema = {
    targetLevel: { type: 'number', default: 40, min: 2, max: 40, label: 'Target level', help: 'Train every enabled skill to at least this level.' },
    wilderness: { type: 'boolean', default: true, label: 'Allow Wilderness training', help: 'Include suitable Wilderness camps in randomized combat training.' }
};

export default class AccountLeveler extends LoopingBot {
    override loopDelay = 100;
    private session = new LevelerSession(emptyMemory());
    private readonly activity = new ScriptActivity(message => this.log(message));
    private readonly supplies = gameSupplyPort(message => this.setStatus(message));
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
                const previous = this.session.plan;
                const decision = this.session.death(Date.now());
                this.retry = decision === 'reset' ? previous : null;
                this.died = false;
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
            const pendingPotions = plan.script === 'PotionMaker' && Inventory.countById(91) > 0;
            const exhausted = !pendingPotions && plan.needs.some(need => !need.equip && need.count > 1 && stockOf(snapshot, requirementKey(need)) === 0);
            const depletedOnFinish = this.activity.outcome?.kind === 'finished' && plan.needs.some(need => stockOf(snapshot, requirementKey(need)) < need.count);
            if (!Game.inCombat() && (reached || exhausted || depletedOnFinish || this.session.remainingMs <= 0)) {
                this.activity.stop();
                if (!reached && (exhausted || depletedOnFinish)) this.session.resupply(Date.now());
                else this.session.complete(Date.now(), reached);
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        const completed = enabledSkills.filter(skill => Skills.level(skill) >= this.target).length;
        p.title(`AccountLeveler: ${completed}/${enabledSkills.length} skills at ${this.target}`);
        p.row(this.status);
        p.row(`Goal: ${this.session.memory.objective ?? 'selecting'}`, `Deaths: ${this.session.memory.deaths}`);
        p.row(this.session.plan?.label ?? 'Preparing next activity');
        ScriptRunner.paintControls(p);
        p.end();
    }

    private snapshot(): LevelerSnapshot {
        this.stock.observe(Bank.items(), Bank.ready());
        return {
            levels: Object.fromEntries(enabledSkills.map(skill => [skill, Skills.level(skill)])),
            stock: this.stock.total([...Inventory.items(), ...Equipment.items()]),
            bankReady: this.stock.ready,
            quests: Object.fromEntries(['Druidic Ritual', 'Rune Mysteries Quest'].map(name => [name, Quests.status(name) === 'complete'])),
            target: this.target, wilderness: this.wilderness, now: Date.now()
        };
    }

    private async selectAndStart(): Promise<void> {
        this.setStatus('checking supplies at the nearest bank');
        if (!(await this.supplies.bank())) throw new Error('Nearest bank could not be opened');
        const snapshot = this.snapshot();
        let decision = this.retry ? resolveActivity(snapshot, this.retry, this.session.memory, Math.random) : planNext(snapshot, this.session.memory);
        this.retry = null;
        if (decision.kind === 'blocked') decision = planNext(snapshot, this.session.memory);
        if (decision.kind === 'complete') { await Bank.close(); this.requestFinish(`All ${enabledSkills.length} enabled skills reached ${this.target}`); return; }
        if (decision.kind === 'refresh') return;
        if (decision.kind === 'blocked') {
            const cooldown = Math.min(...Object.values(this.session.memory.cooldowns).filter(time => time > Date.now()));
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
        const meta = ScriptRegistry.get(plan.script);
        if (!meta) throw new Error(`Missing activity script ${plan.script}`);
        this.session.start(plan, Date.now(), Math.random);
        this.save();
        this.setStatus(`preparing ${plan.label} for ${plan.objective}`);
        Sustain.set(() => this.eat());
        await provision(plan, this.supplies);
        await this.recoverNearbyDrops(plan);
        if (plan.travel) {
            this.setStatus(`travelling to ${plan.label}`);
            if (!(await Traversal.walkResilient(Tile.from(plan.travel), { radius: 4, timeoutMs: 120000, log: m => this.log(m) }))) throw new Error(`Cannot reach ${plan.label}`);
        }
        this.setStatus(`${plan.label}${plan.output ? ` for ${plan.output.count} ${plan.output.item}` : ''}`);
        await this.activity.start(meta, plan.settings);
        this.session.sampleWork(Date.now(), false);
        this.phase = 'train';
        this.resetCount = 0;
        this.observe();
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

    private fail(reason: string): void {
        const previous = this.session.plan;
        this.activity.stop();
        if (!previous) {
            if (++this.resetCount >= 3) { this.requestFinish(`AccountLeveler could not prepare: ${reason}`); return; }
        }
        const decision = this.session.failure(Date.now());
        this.retry = decision === 'reset' ? previous : null;
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
        if (message !== this.status) this.log(message);
        this.status = message;
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
            const saved = JSON.parse(this.storage()?.getItem(key) ?? '{}') as Partial<SessionMemory>;
            const memory = emptyMemory();
            memory.objective = typeof saved.objective === 'string' && enabledSkills.includes(saved.objective) ? saved.objective : null;
            memory.recent = Array.isArray(saved.recent) ? saved.recent.filter(v => typeof v === 'string').slice(-6) : [];
            for (const field of ['attempted', 'cooldowns'] as const) {
                const values = saved[field];
                if (values && typeof values === 'object') memory[field] = Object.fromEntries(Object.entries(values).filter(([, v]) => Number.isFinite(v)));
            }
            memory.deaths = typeof saved.deaths === 'number' && Number.isFinite(saved.deaths) ? Math.max(0, saved.deaths) : 0;
            this.session = new LevelerSession(memory);
        } catch { this.session = new LevelerSession(emptyMemory()); }
    }

    private save(): void {
        const key = this.key();
        if (!key) return;
        try { this.storage()?.setItem(key, JSON.stringify(this.session.memory)); }
        catch (error) { this.log(`Could not save progression: ${String(error)}`); }
    }
}
