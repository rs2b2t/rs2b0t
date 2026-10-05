import Skill from '../../../client/shell/Skill.js';
import { methodFor, producer } from './methods.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { requirementKey, stockOf, type ActivityPlan, type Decision, type LevelerSnapshot, type SessionMemory } from './types.js';

export { scimitarFor } from './combat.js';
export const enabledSkills = Skill.names.filter((name, index) => Skill.used[index] && name !== '-unused-');
export const emptyMemory = (): SessionMemory => ({ objective: null, recent: [], cooldowns: {}, attempted: {}, deaths: 0 });

export function resolveActivity(s: LevelerSnapshot, plan: ActivityPlan, memory: SessionMemory, random: () => number, chain: string[] = []): Decision {
    if (chain.includes(plan.id)) return { kind: 'blocked', reason: `Supply dependency cycle: ${[...chain, plan.id].join(' -> ')}` };
    if ((memory.cooldowns[plan.id] ?? 0) > s.now) return { kind: 'blocked', reason: `${plan.label} is cooling down after a failed attempt` };
    let budget = 0;
    for (const need of plan.needs) {
        const missing = need.count - stockOf(s, requirementKey(need));
        if (missing <= 0) continue;
        const offer = supplyOffer(need.item);
        if (offer) {
            budget += purchaseBudget(offer, missing);
            if (budget > stockOf(s, 'Coins')) return { kind: 'blocked', reason: `Not enough banked Coins to buy ${need.item} (budget ${budget})` };
            continue;
        }
        const dependency = producer(s, plan.objective, need, memory, random);
        if (!dependency) return { kind: 'blocked', reason: `Cannot source ${need.count} ${need.item} for ${plan.label}` };
        return resolveActivity(s, dependency, memory, random, [...chain, plan.id]);
    }
    return { kind: 'activity', plan };
}

export function planNext(s: LevelerSnapshot, memory: SessionMemory, random: () => number = Math.random): Decision {
    if (!s.bankReady) return { kind: 'refresh' };
    if (enabledSkills.some(skill => !Number.isFinite(s.levels[skill]) || s.levels[skill] <= 0)) return { kind: 'blocked', reason: 'Skill levels have not loaded' };
    const unfinished = enabledSkills.filter(skill => s.levels[skill] < s.target);
    if (!unfinished.length) return { kind: 'complete' };
    const ordered = unfinished.map(skill => ({ skill, score: memory.attempted[skill] ?? 0, tie: random() }))
        .sort((a, b) => a.score - b.score || a.tie - b.tie).map(entry => entry.skill);
    if (memory.objective && unfinished.includes(memory.objective)) {
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
    return { kind: 'blocked', reason: [...new Set(reasons)].join('; ') };
}
