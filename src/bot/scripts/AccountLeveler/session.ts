import type { ActivityPlan, SessionMemory } from './types.js';

export function usesActivityCooldown(plan: ActivityPlan): boolean { return plan.combat === true || !!plan.quest; }

export class LevelerSession {
    plan: ActivityPlan | null = null;
    remainingMs = 0;
    private progress = '';
    private progressAt = 0;
    private sampledAt: number | null = null;
    private failures: Record<string, number> = {};

    constructor(readonly memory: SessionMemory) {}

    start(plan: ActivityPlan, now: number, random: () => number): void {
        this.plan = plan;
        this.memory.objective = plan.objective;
        this.memory.attempted[plan.objective] = now;
        this.remainingMs = (10 + Math.min(1, Math.max(0, random())) * 10) * 60000;
        this.progressAt = now;
        this.progress = '';
        this.sampledAt = null;
    }

    observe(signature: string, now: number): void {
        if (signature === this.progress) return;
        this.progress = signature;
        this.progressAt = now;
    }

    stalled(now: number): boolean { return now - this.progressAt > 180000; }

    work(elapsedMs: number): void { this.remainingMs -= Math.max(0, elapsedMs); }

    sampleWork(now: number, training: boolean): void {
        if (this.plan && training && this.sampledAt !== null) this.work(Math.min(2000, now - this.sampledAt));
        this.sampledAt = now;
    }

    resupply(now: number): void {
        const plan = this.plan;
        if (!plan) return;
        this.memory.objective = plan.objective;
        this.memory.attempted[plan.objective] = now;
        delete this.failures[plan.id];
        this.plan = null;
    }

    failure(now: number): 'reset' | 'rotate' {
        const plan = this.plan;
        if (!plan) return 'reset';
        const count = (this.failures[plan.id] ?? 0) + 1;
        this.failures[plan.id] = count;
        if (!usesActivityCooldown(plan)) {
            if (count < 3) return 'reset';
            delete this.failures[plan.id];
            this.plan = null;
            return 'rotate';
        }
        if (count === 1) return 'reset';
        this.memory.cooldowns[plan.id] = now + 15 * 60000;
        this.memory.objective = null;
        this.plan = null;
        return 'rotate';
    }

    death(now: number): 'reset' | 'rotate' {
        this.memory.deaths++;
        if (this.plan?.deathWalk) {
            this.resupply(now);
            return 'reset';
        }
        return this.failure(now);
    }

    complete(now: number, objectiveMet: boolean): void {
        const plan = this.plan;
        if (!plan) return;
        this.memory.recent = [...this.memory.recent, plan.id].slice(-6);
        this.memory.attempted[plan.objective] = now;
        this.memory.objective = objectiveMet && (plan.output || plan.quest || plan.prerequisiteLevels) ? plan.objective : null;
        delete this.failures[plan.id];
        this.plan = null;
    }
}
