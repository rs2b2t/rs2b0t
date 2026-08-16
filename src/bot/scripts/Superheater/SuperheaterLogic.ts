// Pure data/decisions for Superheater — smelts bars with Superheat Item; the pack holds 28 slots but one is always taken by the nature-rune stack, leaving 27 for ore.

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

/** Nature rune — 1 per cast, kept in the pack across the deposit-all-except. */
export const NATURE_RUNE = 'Nature rune';

/** Wielded once so casts cost only the nature runes. */
export const FIRE_STAFF = 'Staff of fire';

/** Superheat Item unlocks at 43 Magic. */
export const MAGIC_REQUIRED = 43;

/** Target nature-rune pack count — well above the 27 casts of one trip. */
export const NATURES_DEFAULT = 50;

/** Any literal above 27 covers a full trip; the setting min enforces > 27. */
export const NATURES_MIN = 28;

/** Ore slots per trip = 28-pack minus the one nature-rune stack slot. */
export const SUPERHEAT_SLOTS = 27;

/** Quest-gated (Thurgo smelts blurite bars); offered but gated by level. */
const BLURITE: Recipe = { bar: 'Blurite', level: 13, ingredients: [{ ore: 'Blurite ore', perBar: 1 }] };

// Why: dropdown order puts the common bars first, Blurite last.
export const BAR_OPTIONS: readonly string[] = [...RECIPES.map(r => r.bar), BLURITE.bar];

const BAR_BY_NAME = new Map<string, Recipe>([...RECIPES, BLURITE].map(r => [r.bar.toLowerCase(), r]));

/** Find a bar recipe by dropdown/in-game name (case-insensitive). */
export function recipeForBar(bar: string): Recipe | undefined {
    return BAR_BY_NAME.get(bar.trim().toLowerCase());
}

/** Total ore slots one bar consumes (e.g. Steel = 1 Iron + 2 Coal = 3). */
export function oresPerBar(recipe: Recipe): number {
    return recipe.ingredients.reduce((sum, i) => sum + i.perBar, 0);
}

/** Full bars a 27-slot trip makes (bronze 13, steel 9, mithril 5, rune 3…). */
export function barsPerTrip(recipe: Recipe): number {
    return Math.floor(SUPERHEAT_SLOTS / oresPerBar(recipe));
}

/** The exact per-item count to withdraw for one trip (27 ores or fewer). */
export function withdrawSet(recipe: Recipe): Record<string, number> {
    const trips = barsPerTrip(recipe);
    const set: Record<string, number> = {};
    for (const i of recipe.ingredients) {
        set[i.ore] = trips * i.perBar;
    }
    return set;
}

/** The ingredient names in order — the first is the cast target. */
export function primaryOre(recipe: Recipe): string {
    return recipe.ingredients[0].ore;
}

export function recipeNames(recipe: Recipe): string[] {
    return recipe.ingredients.map(i => i.ore);
}

/** Full bars smeltable from the current counts, e.g. Steel = min(iron, coal/2). */
export function barsSmeltable(recipe: Recipe, count: (ore: string) => number): number {
    return Math.min(...recipe.ingredients.map(i => Math.floor(count(i.ore) / i.perBar)));
}
