import { barsSmeltable, oresPerBar, type Recipe } from '../../data/smelting.js';

export const MAGIC_REQUIRED = 43;
export const SUPERHEAT_FIRES = 4;
export const SUPERHEAT_SLOTS = 27;

export function barsPerTrip(recipe: Recipe, useFireRunes = false): number {
    return Math.floor((SUPERHEAT_SLOTS - Number(useFireRunes)) / oresPerBar(recipe));
}

export function superheatBatchSize(recipe: Recipe, fundedCasts: number, useFireRunes: boolean, oreCount: (ore: string) => number): number {
    return Math.min(fundedCasts, barsPerTrip(recipe, useFireRunes), barsSmeltable(recipe, oreCount));
}
