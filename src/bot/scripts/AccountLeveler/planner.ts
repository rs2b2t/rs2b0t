import Skill from '../../../client/shell/Skill.js';
import { usesActivityCooldown } from './session.js';
import { methodFor, producer } from './methods.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { SHOPPING_RESERVE } from './shopping.js';
import { canResumeObjective, trainingPriority } from './priority.js';
import { requirementKey, stockOf, type ActivityPlan, type Decision, type LevelerSnapshot, type SessionMemory } from './types.js';

export { scimitarFor } from './combat.js';
export const enabledSkills = Skill.names.filter((name, index) => Skill.used[index] && name !== '-unused-');
export const emptyMemory = (): SessionMemory => ({ objective: null, recent: [], cooldowns: {}, attempted: {}, deaths: 0 });

export function resolveActivity(s: LevelerSnapshot, plan: ActivityPlan, memory: SessionMemory, random: () => number, chain: string[] = []): Decision {
    if (chain.includes(plan.id)) return { kind: 'blocked', reason: `Supply dependency cycle: ${[...chain, plan.id].join(' -> ')}` };
    if (usesActivityCooldown(plan) && (memory.cooldowns[plan.id] ?? 0) > s.now) return { kind: 'blocked', reason: `${plan.label} is cooling down after a failed attempt` };
    let budget = 0;
    for (const need of plan.needs) {
        const missing = need.count - stockOf(s, requirementKey(need));
        if (missing <= 0) continue;
        if (s.unavailableItems?.includes(need.item.toLowerCase())) return { kind: 'blocked', reason: `${need.item} is unavailable from its supplier this run` };
        const offer = supplyOffer(need.item);
        if (offer) {
            budget += purchaseBudget(offer, missing);
            if (budget + SHOPPING_RESERVE > stockOf(s, 'Coins')) return { kind: 'blocked', reason: `Not enough banked Coins to buy ${need.item} (budget ${budget + SHOPPING_RESERVE}, including travel reserve)` };
            continue;
        }
        const dependency = producer(s, plan.objective, need, memory, random);
        if (!dependency) return { kind: 'blocked', reason: `Cannot source ${need.count} ${need.item} for ${plan.label}` };
        const resolved = resolveActivity(s, dependency, memory, random, [...chain, plan.id]);
        return resolved.kind === 'activity' ? { ...resolved, queue: [...resolved.queue, plan] } : resolved;
    }
    return { kind: 'activity', plan, queue: [plan] };
}

export function planNext(s: LevelerSnapshot, memory: SessionMemory, random: () => number = Math.random): Decision {
    if (!s.bankReady) return { kind: 'refresh' };
    if (enabledSkills.some(skill => !Number.isFinite(s.levels[skill]) || s.levels[skill] <= 0)) return { kind: 'blocked', reason: 'Skill levels have not loaded' };
    const unfinished = enabledSkills.filter(skill => s.levels[skill] < s.target);
    if (!unfinished.length) return { kind: 'complete' };
    const priority = trainingPriority(s.levels, s.target);
    const ordered = unfinished.filter(skill => priority.skills.includes(skill))
        .map(skill => ({ skill, level: priority.balance ? s.levels[skill] : 0, score: memory.attempted[skill] ?? 0, tie: random() }))
        .sort((a, b) => a.level - b.level || a.score - b.score || a.tie - b.tie).map(entry => entry.skill);
    if (memory.objective && canResumeObjective(s.levels, s.target, memory.objective)) {
        ordered.splice(ordered.indexOf(memory.objective), 1);
        ordered.unshift(memory.objective);
    }
    const reasons: string[] = [];
    for (const objective of ordered) {
        const method = methodFor(s, objective, memory, random);
        if (!method) { reasons.push(`No eligible method for ${objective}`); continue; }
        const decision = resolveActivity(s, method, memory, random, []);
        if (decision.kind === 'activity') return decision;
        if (decision.kind === 'blocked') reasons.push(decision.reason);
    }
    return { kind: 'blocked', reason: `${priority.label}: ${[...new Set(reasons)].join('; ')}` };
}
