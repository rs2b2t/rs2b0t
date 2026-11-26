export const QuestFood = { name: 'Trout' as string | null };

export function questFoodNames(fallbacks: readonly string[]): string[] {
    const names = new Map<string, string>();
    for (const name of [QuestFood.name?.trim(), ...fallbacks]) {
        if (name) names.set(name.toLowerCase(), name);
    }
    return [...names.values()];
}

/** Why: 8 unless a quest proves it needs more; the old 12-to-20 packs spent most of the inventory on food that was never eaten. */
export const FOOD_FLOAT = 8;
