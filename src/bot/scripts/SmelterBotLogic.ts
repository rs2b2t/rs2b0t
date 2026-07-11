/** Pure smelting recipe + pack helpers for SmelterBot (no client imports → plain
 *  bun test). Mirrors CookBotLogic's shape.
 *
 *  The Al Kharid furnace loop uses the one-ore-per-useOn path: using the PRIMARY
 *  (non-coal) ore on the "Furnace" loc smelts exactly one bar and the server
 *  consumes the whole recipe (primary + any coal). The withdraw plan controls
 *  exactly what's in the pack, which fully determines the bar produced. */

export interface PackItem {
    readonly name: string | null;
}

/** One ore in a recipe, and how many are consumed per bar. */
export interface Ingredient {
    /** Bank/inventory name substring, e.g. 'Copper ore', 'Coal'. */
    readonly ore: string;
    /** Count consumed per bar smelted. */
    readonly perBar: number;
}

export interface Recipe {
    /** Display name / dropdown option, e.g. 'Bronze'. */
    readonly bar: string;
    /** Ingredients; the FIRST is the primary ore we useOn the furnace. */
    readonly ingredients: readonly Ingredient[];
    /** Minimum Smithing level to smelt this bar. */
    readonly level: number;
}

/** The eight smeltable bars. The first ingredient of each recipe is the primary
 *  ore (the item we useOn the furnace); the rest (coal, or bronze's tin) are
 *  consumed by the server in the same smelt. */
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

/** Dropdown options for the `bar` setting, in recipe order. */
export const BAR_OPTIONS: readonly string[] = RECIPES.map(r => r.bar);

/** Inventory slots consumed to hold one full set (one bar's worth of ore). */
function slotsPerSet(recipe: Recipe): number {
    return recipe.ingredients.reduce((sum, i) => sum + i.perBar, 0);
}

/** Resolve a recipe by bar name (case-insensitive exact match), or undefined. */
export function recipeForBar(bar: string): Recipe | undefined {
    const wanted = bar.trim().toLowerCase();
    return RECIPES.find(r => r.bar.toLowerCase() === wanted);
}

/** The ingredient we useOn the furnace (the first, non-coal ore). */
export function primaryOre(recipe: Recipe): string {
    return recipe.ingredients[0].ore;
}

/** Full sets (bars) we can carry in a 28-slot pack for this recipe. */
export function setsPerTrip(recipe: Recipe): number {
    return Math.floor(28 / slotsPerSet(recipe));
}

/** The per-trip withdraw plan: each ingredient × setsPerTrip. Never exceeds 28
 *  total slots. */
export function withdrawPlan(recipe: Recipe): { ore: string; count: number }[] {
    const sets = setsPerTrip(recipe);
    return recipe.ingredients.map(i => ({ ore: i.ore, count: sets * i.perBar }));
}

function matches(name: string | null, pattern: string): boolean {
    return name !== null && name.toLowerCase().includes(pattern.trim().toLowerCase());
}

/** Count pack items that are the recipe's PRIMARY ore (progress is tracked by
 *  this count dropping as bars are smelted). */
export function countPrimary(items: readonly PackItem[], recipe: Recipe): number {
    const pat = primaryOre(recipe);
    return items.filter(i => matches(i.name, pat)).length;
}

/** Index of the LAST primary-ore slot, or -1. We useOn the last one so, as slots
 *  empty, we keep hitting an ore slot (mirrors CookBot's lastRawIndex). */
export function lastPrimaryIndex(items: readonly PackItem[], recipe: Recipe): number {
    const pat = primaryOre(recipe);
    for (let i = items.length - 1; i >= 0; i--) {
        if (matches(items[i].name, pat)) {
            return i;
        }
    }
    return -1;
}
