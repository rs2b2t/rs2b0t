import { combatPlan } from './combat.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

export function bankedPrayerPlan(s: LevelerSnapshot): ActivityPlan | null {
    if (!s.bankReady) return null;
    const boneName = ['Dragon bones', 'Babydragon bones', 'Big bones'].find(name => stockOf(s, name) > 0);
    if (!boneName) return null;
    return {
        id: `bury-${boneName.toLowerCase().replaceAll(' ', '-')}`, label: `Bury ${boneName}`, objective: 'prayer',
        script: 'BoneBurier', settings: { boneName }, needs: [{ item: boneName, count: Math.min(28, stockOf(s, boneName)) }]
    };
}

export function babyDragonPrayerPlan(s: LevelerSnapshot, memory: SessionMemory, random: () => number): ActivityPlan | null {
    const plans = ['Baby blue dragon', 'Baby red dragon']
        .map(target => combatPlan(s, 'prayer', memory, random, undefined, target))
        .filter((plan): plan is ActivityPlan => plan !== null);
    const fresh = plans.filter(plan => !memory.recent.slice(-3).includes(plan.id));
    const choices = fresh.length ? fresh : plans;
    return choices[Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length))] ?? null;
}
