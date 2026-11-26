export interface Recipe {
    readonly bar: string;
    readonly level: number;
    readonly ingredients: readonly Ingredient[];
}

interface Ingredient {
    readonly ore: string;
    readonly perBar: number;
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

export function oresPerBar(recipe: Recipe): number {
    return recipe.ingredients.reduce((sum, i) => sum + i.perBar, 0);
}

export function oreQuantities(recipe: Recipe, bars: number): { ore: string; count: number }[] {
    return recipe.ingredients.map(({ ore, perBar }) => ({ ore, count: bars * perBar }));
}

export function primaryOre(recipe: Recipe): string {
    return recipe.ingredients[0].ore;
}

export function barsSmeltable(recipe: Recipe, count: (ore: string) => number): number {
    return Math.min(...recipe.ingredients.map(i => Math.floor(count(i.ore) / i.perBar)));
}
