import type { ActivityPlan } from './types.js';

export function isMeleeSkill(skill: string): boolean {
    return skill === 'strength' || skill === 'attack' || skill === 'defence';
}

export function earlyMeleeStep(levels: Record<string, number>, target: number) {
    const cap = Math.min(40, target);
    const lower = Math.min(levels.attack, levels.strength);
    if (lower < cap) {
        const level = Math.min(cap, (Math.floor(lower / 5) + 1) * 5);
        const skill = levels.strength < level ? 'strength' : 'attack';
        return { skill, level };
    }
    if (levels.defence < cap) return { skill: 'defence', level: cap };
}

export function meleeStepMet(plan: ActivityPlan, levels: Record<string, number>): boolean {
    return plan.meleeMilestone !== undefined && levels[String(plan.settings.meleeStyle)] >= plan.meleeMilestone;
}

export function canResumeObjective(levels: Record<string, number>, target: number, objective: string): boolean {
    return levels[objective] > 0 && levels[objective] < target;
}
