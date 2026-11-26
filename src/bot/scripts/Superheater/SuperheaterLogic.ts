import { oreQuantities, RECIPES, type Recipe } from '../../data/smelting.js';
import { barsPerTrip } from '../../api/magic/superheat.js';

export { barsSmeltable, oresPerBar, primaryOre, RECIPES, type Recipe } from '../../data/smelting.js';
export { barsPerTrip, MAGIC_REQUIRED, SUPERHEAT_FIRES, SUPERHEAT_SLOTS } from '../../api/magic/superheat.js';
export { FIRE_STAFF, FIRE_STAVES, NATURE_RUNE, pickFireStaff } from '../../api/magic/fireStaves.js';

/** Gold is the only bar whose Smithing XP the Goldsmith gauntlet multiplies. */
export function wantsGoldsmithGauntlets(bar: string, enabled: boolean): boolean {
    return enabled && bar.trim().toLowerCase() === 'gold';
}

/** 1-based menu op index of the first label matching `pattern`, or -1 when none does. */
export function opIndex(ops: readonly (string | null)[], pattern: RegExp): number {
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op !== null && pattern.test(op)) {
            return i + 1;
        }
    }
    return -1;
}

/** Target nature-rune pack count, well above the 27 casts of one trip. */
export const NATURES_DEFAULT = 50;

/** Any literal above 27 covers a full trip; the setting min enforces > 27. */
export const NATURES_MIN = 28;

/** Quest-gated (Thurgo smelts blurite bars); offered but gated by level. */
const BLURITE: Recipe = { bar: 'Blurite', level: 13, ingredients: [{ ore: 'Blurite ore', perBar: 1 }] };

// Why: dropdown order puts the common bars first, Blurite last.
export const BAR_OPTIONS: readonly string[] = [...RECIPES.map(r => r.bar), BLURITE.bar];

const BAR_BY_NAME = new Map<string, Recipe>([...RECIPES, BLURITE].map(r => [r.bar.toLowerCase(), r]));

/** Find a bar recipe by dropdown/in-game name (case-insensitive). */
export function recipeForBar(bar: string): Recipe | undefined {
    return BAR_BY_NAME.get(bar.trim().toLowerCase());
}

/** The exact per-item count to withdraw for one trip (27 ores or fewer). */
export function withdrawSet(recipe: Recipe, useFireRunes = false): Record<string, number> {
    const bars = barsPerTrip(recipe, useFireRunes);
    const set: Record<string, number> = {};
    for (const { ore, count } of oreQuantities(recipe, bars)) {
        set[ore] = count;
    }
    return set;
}
