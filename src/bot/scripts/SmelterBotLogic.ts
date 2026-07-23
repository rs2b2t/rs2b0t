export interface PackItem {
    readonly name: string | null;
}

interface Ingredient {
    readonly ore: string;
    readonly perBar: number;
}

export interface Recipe {
    readonly bar: string;
    readonly ingredients: readonly Ingredient[];
    readonly level: number;
}

export const RECIPES: readonly Recipe[] = [
    { bar: 'Bronze', level: 1, ingredients: [{ ore: 'Copper ore', perBar: 1 }, { ore: 'Tin ore', perBar: 1 }] },
    { bar: 'Iron', level: 15, ingredients: [{ ore: 'Iron ore', perBar: 1 }] },
    { bar: 'Silver', level: 20, ingredients: [{ ore: 'Silver ore', perBar: 1 }] },
    { bar: 'Steel', level: 30, ingredients: [{ ore: 'Iron ore', perBar: 1 }, { ore: 'Coal', perBar: 2 }] },
    { bar: 'Gold', level: 40, ingredients: [{ ore: 'Gold ore', perBar: 1 }] },
    { bar: 'Mithril', level: 50, ingredients: [{ ore: 'Mithril ore', perBar: 1 }, { ore: 'Coal', perBar: 4 }] },
    { bar: 'Adamant', level: 70, ingredients: [{ ore: 'Adamantite ore', perBar: 1 }, { ore: 'Coal', perBar: 6 }] },
    { bar: 'Rune', level: 85, ingredients: [{ ore: 'Runite ore', perBar: 1 }, { ore: 'Coal', perBar: 8 }] }
];

export const BAR_OPTIONS: readonly string[] = RECIPES.map(r => r.bar);

function slotsPerSet(recipe: Recipe): number {
    return recipe.ingredients.reduce((sum, i) => sum + i.perBar, 0);
}

export function recipeForBar(bar: string): Recipe | undefined {
    const wanted = bar.trim().toLowerCase();
    return RECIPES.find(r => r.bar.toLowerCase() === wanted);
}

export function primaryOre(recipe: Recipe): string {
    return recipe.ingredients[0].ore;
}

export function setsPerTrip(recipe: Recipe): number {
    return Math.floor(28 / slotsPerSet(recipe));
}

export function withdrawPlan(recipe: Recipe): { ore: string; count: number }[] {
    const sets = setsPerTrip(recipe);
    return recipe.ingredients.map(i => ({ ore: i.ore, count: sets * i.perBar }));
}

function matches(name: string | null, pattern: string): boolean {
    return name !== null && name.toLowerCase().includes(pattern.trim().toLowerCase());
}

export function countPrimary(items: readonly PackItem[], recipe: Recipe): number {
    const pat = primaryOre(recipe);
    return items.filter(i => matches(i.name, pat)).length;
}
