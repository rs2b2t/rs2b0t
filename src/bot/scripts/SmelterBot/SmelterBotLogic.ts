import { barsSmeltable, oreQuantities, oresPerBar, primaryOre, RECIPES, type Recipe } from '../../data/smelting.js';

export { primaryOre, RECIPES, type Recipe };

export interface PackItem {
    readonly name: string | null;
}

export const BAR_OPTIONS: readonly string[] = RECIPES.map(r => r.bar);

export function recipeForBar(bar: string): Recipe | undefined {
    const wanted = bar.trim().toLowerCase();
    return RECIPES.find(r => r.bar.toLowerCase() === wanted);
}

export function setsPerTrip(recipe: Recipe): number {
    return Math.floor(28 / oresPerBar(recipe));
}

// Why: an empty list comes back only when not even a single bar can be made.
// Why: demanding a full trip and giving up otherwise turned a nearly-empty bank into a dead bot (#117).
// Why: a short trip still makes bars, and the next trip re-checks anyway.

/** What to withdraw given what the bank holds, capped at one trip. */
export function withdrawFor(recipe: Recipe, stock: (ore: string) => number): { ore: string; count: number }[] {
    const sets = Math.min(setsPerTrip(recipe), barsSmeltable(recipe, stock));
    if (sets <= 0) {
        return [];
    }
    return oreQuantities(recipe, sets);
}

export function withdrawPlan(recipe: Recipe): { ore: string; count: number }[] {
    return oreQuantities(recipe, setsPerTrip(recipe));
}

function matches(name: string | null, pattern: string): boolean {
    return name !== null && name.toLowerCase().includes(pattern.trim().toLowerCase());
}

// Why: gating on the primary ore alone lets a pack with iron but no coal skip the bank run, and the smelt trip then spins making nothing.

/** Whether the pack holds enough of every ingredient to smelt at least one bar. */
export function canSmelt(items: readonly PackItem[], recipe: Recipe): boolean {
    return recipe.ingredients.every(i => items.filter(it => matches(it.name, i.ore)).length >= i.perBar);
}

export function countPrimary(items: readonly PackItem[], recipe: Recipe): number {
    const pat = primaryOre(recipe);
    return items.filter(i => matches(i.name, pat)).length;
}

/** Milliseconds of no ore drop before the smelt task yields instead of parking the loop (#711). */
export const SMELT_IDLE_MS = 8_000;

/** True when the furnace has stopped consuming ore and the wait should retry. */
export function smeltStalled(nowCount: number, lastCount: number, idleMs: number, limitMs = SMELT_IDLE_MS): boolean {
    return nowCount >= lastCount && idleMs > limitMs;
}
