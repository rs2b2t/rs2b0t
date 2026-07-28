import type { QuestSustain } from '../quests/engine/types.js';

export interface ResolvedSustainPolicy {
    foods: readonly string[];
    eatBelowHp: number;
}

/** Pick the explicit inventory operation that consumes a supported food/drink. */
export function resolveConsumeAction(actions: readonly string[]): string | null {
    for (const wanted of ['Eat', 'Drink']) {
        const action = actions.find(candidate => candidate.toLowerCase() === wanted.toLowerCase());
        if (action) return action;
    }
    return null;
}

/** Merge the user's general food choice with the active quest's survival policy. */
export function resolveSustainPolicy(
    configuredFood: string | null,
    configuredEatBelowHp: number,
    quest?: QuestSustain
): ResolvedSustainPolicy {
    const foods: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [...(quest?.foods ?? []), configuredFood]) {
        const food = candidate?.trim();
        const key = food?.toLowerCase();
        if (!food || !key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        foods.push(food);
    }
    return {
        foods,
        eatBelowHp: Math.max(configuredEatBelowHp, quest?.eatBelowHp ?? configuredEatBelowHp)
    };
}
